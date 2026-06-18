/**
 * WM Fixture Score Backfill
 *
 * Holt finale Spielstände für abgeschlossene WM-Fixtures aus API-Football
 * und schreibt sie in die wm_fixtures-Tabelle.
 *
 * DEFAULT: Dry-run — kein Write ohne --apply
 *
 * Verwendung:
 *   npx tsx scripts/wm-backfill-fixture-scores.ts
 *   npx tsx scripts/wm-backfill-fixture-scores.ts --apply
 *   npx tsx scripts/wm-backfill-fixture-scores.ts --gameweeks=1,2
 *   npx tsx scripts/wm-backfill-fixture-scores.ts --tournament=<uuid>
 *   npx tsx scripts/wm-backfill-fixture-scores.ts --gameweeks=1,2 --apply
 *
 * Was wird geschrieben (nur mit --apply, nur bei API-Status FT/AET/PEN/AWD/WO):
 *   wm_fixtures.home_score
 *   wm_fixtures.away_score
 *   wm_fixtures.status  →  "finished"
 *
 * Was wird NICHT geschrieben:
 *   wm_gameweek_points  (kein Fantasy-Punkte-Backfill)
 *   wm_event_log        (keine Events)
 *   Alles andere
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ── Env Loading ───────────────────────────────────────────────────────────────

function loadDotEnv(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (k && !process.env[k]) process.env[k] = v;
  }
}

loadDotEnv();

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--apply");

const gwArg = args.find(a => a.startsWith("--gameweeks="));
const GAMEWEEKS: number[] | null = gwArg
  ? gwArg.replace("--gameweeks=", "").split(",").map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n))
  : null;

const tournArg = args.find(a => a.startsWith("--tournament="));
const TOURNAMENT_FILTER: string | null = tournArg ? tournArg.replace("--tournament=", "").trim() : null;

// ── API-Football ──────────────────────────────────────────────────────────────

const AF_BASE = "https://v3.football.api-sports.io";
const _delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** API-Football fixture statuses that mean the match is finished */
export const FINISHED_AF_STATUSES = new Set(["FT", "AET", "PEN", "AWD", "WO"]);

/** Maps API-Football short status to our WMFixtureStatus */
export function mapAfStatus(shortStatus: string): "scheduled" | "live" | "finished" {
  if (FINISHED_AF_STATUSES.has(shortStatus)) return "finished";
  if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE"].includes(shortStatus)) return "live";
  return "scheduled";
}

async function afetch(path: string, apiKey: string): Promise<any> {
  for (let attempt = 0; attempt <= 3; attempt++) {
    const res = await fetch(`${AF_BASE}${path}`, {
      headers: { "x-apisports-key": apiKey },
      cache: "no-store",
    });

    if (res.status === 429) {
      if (attempt >= 3) throw new Error(`rate-limited after 3 retries — ${path}`);
      const raw = parseInt(res.headers.get("retry-after") ?? "10", 10);
      await _delay(Math.min(raw, 30) * 1000);
      continue;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status} — ${path}`);
    return res.json();
  }
  throw new Error("afetch: unexpected loop exit");
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface DbFixture {
  id: string;
  api_fixture_id: number | null;
  gameweek: number;
  status: string;
  home_score: number | null;
  away_score: number | null;
  kickoff: string | null;
  tournament_id: string;
}

interface AfFixtureResult {
  afStatus: string;            // e.g. "FT"
  homeScore: number | null;
  awayScore: number | null;
}

interface FixtureCheckResult {
  dbFixture: DbFixture;
  outcome:
    | "up_to_date"
    | "would_update"
    | "missing_api_id"
    | "api_not_finished"
    | "api_error"
    | "api_not_found";
  afResult?: AfFixtureResult;
  updatePayload?: {
    home_score: number;
    away_score: number;
    status: "finished";
  };
  error?: string;
}

// ── Report counters ───────────────────────────────────────────────────────────

interface Report {
  total: number;
  up_to_date: number;
  would_update: number;
  applied: number;
  missing_api_id: number;
  api_not_finished: number;
  api_not_found: number;
  api_error: number;
  errors: string[];
}

// ── Core check logic (exported for tests) ────────────────────────────────────

/**
 * Determines what should happen to a fixture based on DB state and API result.
 * Pure function — no side effects.
 */
export function buildFixtureUpdate(
  db: DbFixture,
  af: AfFixtureResult,
): { needsUpdate: boolean; payload?: { home_score: number; away_score: number; status: "finished" } } {
  if (!FINISHED_AF_STATUSES.has(af.afStatus)) {
    return { needsUpdate: false };
  }

  if (af.homeScore === null || af.awayScore === null) {
    return { needsUpdate: false };
  }

  const alreadyCorrect =
    db.status === "finished" &&
    db.home_score === af.homeScore &&
    db.away_score === af.awayScore;

  if (alreadyCorrect) return { needsUpdate: false };

  return {
    needsUpdate: true,
    payload: {
      home_score: af.homeScore,
      away_score: af.awayScore,
      status: "finished",
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.FOOTBALL_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("❌  NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlt");
    process.exit(1);
  }
  if (!apiKey) {
    console.error("❌  FOOTBALL_API_KEY fehlt");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("═══════════════════════════════════════════════════════");
  console.log("  WM Fixture Score Backfill");
  console.log(`  Modus: ${DRY_RUN ? "DRY-RUN (kein Write)" : "⚡ APPLY (schreibt in DB)"}`);
  if (GAMEWEEKS) console.log(`  Gameweeks: ${GAMEWEEKS.join(", ")}`);
  if (TOURNAMENT_FILTER) console.log(`  Tournament: ${TOURNAMENT_FILTER}`);
  console.log("═══════════════════════════════════════════════════════\n");

  // 1. Load fixtures from DB
  let query = supabase
    .from("wm_fixtures")
    .select("id, api_fixture_id, gameweek, status, home_score, away_score, kickoff, tournament_id")
    .order("gameweek")
    .order("kickoff");

  if (GAMEWEEKS && GAMEWEEKS.length > 0) {
    query = query.in("gameweek", GAMEWEEKS);
  }
  if (TOURNAMENT_FILTER) {
    query = query.eq("tournament_id", TOURNAMENT_FILTER);
  }

  // Only fetch fixtures that aren't already confirmed correct
  // (still check "finished" ones in case scores are wrong)
  const { data: fixtures, error: dbError } = await query;

  if (dbError) {
    console.error("❌  DB-Fehler beim Laden der Fixtures:", dbError.message);
    process.exit(1);
  }

  const allFixtures = (fixtures || []) as DbFixture[];
  console.log(`Fixtures in DB geladen: ${allFixtures.length}\n`);

  const report: Report = {
    total: allFixtures.length,
    up_to_date: 0,
    would_update: 0,
    applied: 0,
    missing_api_id: 0,
    api_not_finished: 0,
    api_not_found: 0,
    api_error: 0,
    errors: [],
  };

  const results: FixtureCheckResult[] = [];

  // 2. Check each fixture
  for (const fixture of allFixtures) {
    // Missing api_fixture_id
    if (!fixture.api_fixture_id) {
      report.missing_api_id++;
      results.push({ dbFixture: fixture, outcome: "missing_api_id" });
      console.log(`  ⚠️  GW${fixture.gameweek} id=${fixture.id.slice(0, 8)} — kein api_fixture_id`);
      continue;
    }

    // Rate-limit: 10 req/min on free tier → wait 1100ms between calls
    await _delay(1100);

    let afData: any;
    try {
      afData = await afetch(`/fixtures?id=${fixture.api_fixture_id}`, apiKey);
    } catch (err: any) {
      report.api_error++;
      const msg = `api_fetch_failed:${fixture.api_fixture_id}: ${err.message}`;
      report.errors.push(msg);
      results.push({ dbFixture: fixture, outcome: "api_error", error: err.message });
      console.log(`  ❌  GW${fixture.gameweek} af=${fixture.api_fixture_id} — API-Fehler: ${err.message}`);
      continue;
    }

    const response = afData?.response;
    if (!response || response.length === 0) {
      report.api_not_found++;
      results.push({ dbFixture: fixture, outcome: "api_not_found" });
      console.log(`  ❓  GW${fixture.gameweek} af=${fixture.api_fixture_id} — kein API-Response`);
      continue;
    }

    const entry = response[0];
    const afStatus: string = entry?.fixture?.status?.short ?? "NS";
    const homeScore: number | null = entry?.goals?.home ?? null;
    const awayScore: number | null = entry?.goals?.away ?? null;

    const afResult: AfFixtureResult = { afStatus, homeScore, awayScore };

    if (!FINISHED_AF_STATUSES.has(afStatus)) {
      report.api_not_finished++;
      results.push({ dbFixture: fixture, outcome: "api_not_finished", afResult });
      console.log(`  ⏳  GW${fixture.gameweek} af=${fixture.api_fixture_id} — Status=${afStatus} (noch nicht fertig)`);
      continue;
    }

    const { needsUpdate, payload } = buildFixtureUpdate(fixture, afResult);

    if (!needsUpdate) {
      report.up_to_date++;
      results.push({ dbFixture: fixture, outcome: "up_to_date", afResult });
      console.log(`  ✅  GW${fixture.gameweek} af=${fixture.api_fixture_id} — bereits aktuell (${fixture.home_score}:${fixture.away_score})`);
      continue;
    }

    // Would update / Apply
    report.would_update++;
    results.push({ dbFixture: fixture, outcome: "would_update", afResult, updatePayload: payload });

    if (DRY_RUN) {
      console.log(`  📋  GW${fixture.gameweek} af=${fixture.api_fixture_id} — würde schreiben: ${payload!.home_score}:${payload!.away_score} (DB war: ${fixture.home_score ?? "null"}:${fixture.away_score ?? "null"}, Status: ${fixture.status}→finished)`);
    } else {
      // Apply update
      const { error: updateError } = await supabase
        .from("wm_fixtures")
        .update({
          home_score: payload!.home_score,
          away_score: payload!.away_score,
          status: "finished",
        })
        .eq("id", fixture.id);

      if (updateError) {
        report.api_error++;
        report.errors.push(`update_failed:${fixture.id}: ${updateError.message}`);
        console.log(`  ❌  GW${fixture.gameweek} af=${fixture.api_fixture_id} — Write-Fehler: ${updateError.message}`);
      } else {
        report.applied++;
        console.log(`  ✅  GW${fixture.gameweek} af=${fixture.api_fixture_id} — geschrieben: ${payload!.home_score}:${payload!.away_score}`);
      }
    }
  }

  // 3. Summary
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Report");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Total fixtures checked:  ${report.total}`);
  console.log(`  Already up to date:      ${report.up_to_date}`);
  console.log(`  Would update:            ${report.would_update}`);
  if (!DRY_RUN) {
    console.log(`  Applied:                 ${report.applied}`);
  }
  console.log(`  Missing api_fixture_id:  ${report.missing_api_id}`);
  console.log(`  API not yet finished:    ${report.api_not_finished}`);
  console.log(`  API not found:           ${report.api_not_found}`);
  console.log(`  API/DB errors:           ${report.api_error}`);

  if (report.errors.length > 0) {
    console.log("\n  Errors:");
    for (const e of report.errors) console.log(`    - ${e}`);
  }

  if (DRY_RUN && report.would_update > 0) {
    console.log(`\n  💡  ${report.would_update} Fixture(s) würden aktualisiert.`);
    console.log("  Zum Schreiben: npx tsx scripts/wm-backfill-fixture-scores.ts --apply");
  }

  if (!DRY_RUN && report.applied > 0) {
    console.log(`\n  ✅  ${report.applied} Fixture(s) erfolgreich aktualisiert.`);
    console.log("  ℹ️   Fantasy-Punkte wurden NICHT berechnet (separater Schritt).");
  }

  console.log("═══════════════════════════════════════════════════════\n");
}

// Only run when executed directly (not when imported by tests)
const scriptPath = process.argv[1] ?? "";
if (scriptPath.includes("wm-backfill-fixture-scores")) {
  main().catch(err => {
    console.error("Unerwarteter Fehler:", err);
    process.exit(1);
  });
}
