/**
 * TIFO — WM 2026 Real Roster Ingest
 *
 * Imports WC 2026 teams, fixtures, and player squads from API-Football
 * into wm_nations, wm_fixtures, and players tables.
 *
 * Usage:
 *   npx tsx scripts/ingest-wm-2026-api-football.ts [--dry-run]
 *   node --experimental-strip-types scripts/ingest-wm-2026-api-football.ts [--dry-run]
 *
 * --dry-run: fetch & log only, NO DB writes
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ── Constants ──────────────────────────────────────────────────────────────
const WC_LEAGUE_ID = 1;
const WC_SEASON    = 2026;
const AFOOT_BASE   = "https://v3.football.api-sports.io";
const AFOOT_MIN_INTERVAL_MS = 2200;

const CACHE_DIR = path.join(process.cwd(), ".cache", "api-football", "wm-2026");

// ── CLI args ───────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");

// ── Env vars ───────────────────────────────────────────────────────────────
const FOOTBALL_API_KEY        = process.env.FOOTBALL_API_KEY;
const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertEnv(): void {
  const missing: string[] = [];
  // Check process.env directly — module-level consts are captured before loadDotEnv() runs
  if (!process.env.FOOTBALL_API_KEY)          missing.push("FOOTBALL_API_KEY");
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL)  missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    console.error(`ERROR: Missing required env vars: ${missing.join(", ")}`);
    console.error("Tip: ensure .env.local is loaded (use dotenv or export vars manually)");
    process.exit(1);
  }
}

// ── Load .env.local if vars not already set ────────────────────────────────
function loadDotEnv(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    // Strip surrounding quotes from value
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && val && !process.env[key]) {
      process.env[key] = val;
    }
  }
}

// ── Position map ───────────────────────────────────────────────────────────
const POS_MAP: Record<string, string> = {
  Goalkeeper: "GK",
  Defender:   "DF",
  Midfielder: "MF",
  Attacker:   "FW",
  Forward:    "FW",
};

function mapPosition(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (POS_MAP[raw]) return POS_MAP[raw];
  const lower = raw.toLowerCase();
  if (lower.includes("goal") || lower.includes("keeper")) return "GK";
  if (lower.includes("defend") || lower.includes("back"))  return "DF";
  if (lower.includes("mid"))                               return "MF";
  if (lower.includes("attack") || lower.includes("forward") || lower.includes("striker")) return "FW";
  return null;
}

// ── Stage / gameweek mapping ───────────────────────────────────────────────
type WMStage = "group" | "round_of_32" | "round_of_16" | "quarter" | "semi" | "final";

interface RoundMapping {
  stage: WMStage;
  gameweek: number;
}

function mapRound(round: string): RoundMapping | null {
  const r = round.toLowerCase();

  // Group Stage - 1 / Group Stage - 2 / Group Stage - 3
  const groupMatch = r.match(/group\s+stage\s*[-–]\s*(\d+)/);
  if (groupMatch) {
    const gw = parseInt(groupMatch[1], 10);
    return { stage: "group", gameweek: gw };
  }

  // Round of 32 (WC 2026: 48 teams, 12 groups of 4 → new knockout round)
  if (r.includes("round of 32") || r.includes("round of 48")) {
    return { stage: "round_of_32", gameweek: 4 };
  }
  // Round of 16
  if (r.includes("round of 16") || r.includes("last 16")) {
    return { stage: "round_of_16", gameweek: 5 };
  }
  // Quarter-finals
  if (r.includes("quarter")) {
    return { stage: "quarter", gameweek: 6 };
  }
  // Semi-finals
  if (r.includes("semi")) {
    return { stage: "semi", gameweek: 7 };
  }
  // 3rd-place playoff: same gameweek as final (GW7), distinct stage
  if (r.includes("3rd") || r.includes("third")) {
    return { stage: "final", gameweek: 7 };
  }
  // Final
  if (r.includes("final") && !r.includes("semi") && !r.includes("quarter")) {
    return { stage: "final", gameweek: 8 };
  }

  return null;
}

// ── Status map ─────────────────────────────────────────────────────────────
type WMFixtureStatus = "scheduled" | "live" | "finished";

function mapStatus(short: string | undefined): WMFixtureStatus {
  if (!short) return "scheduled";
  const LIVE_STATUSES    = new Set(["1H", "2H", "HT", "ET", "P", "BT", "INT", "LIVE"]);
  const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
  if (LIVE_STATUSES.has(short))     return "live";
  if (FINISHED_STATUSES.has(short)) return "finished";
  return "scheduled";
}

// ── Cache helpers ──────────────────────────────────────────────────────────
function ensureCacheDir(): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function readCache(filename: string): any | null {
  const p = path.join(CACHE_DIR, filename);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(filename: string, data: any): void {
  const p = path.join(CACHE_DIR, filename);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

// ── Rate-limited API fetch with cache ─────────────────────────────────────
let lastAfootCall = 0;
let apiRequestCount = 0;

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function afootFetch(
  endpointPath: string,
  cacheFile: string,
  label: string,
  retryCount: number = 0,
): Promise<any> {
  // Check cache first
  const cached = readCache(cacheFile);
  if (cached !== null) {
    console.log(`[cache hit] ${label}`);
    return cached;
  }

  // Rate-limit throttle
  const now = Date.now();
  const wait = AFOOT_MIN_INTERVAL_MS - (now - lastAfootCall);
  if (wait > 0) await delay(wait);
  lastAfootCall = Date.now();

  apiRequestCount++;
  console.log(`[api] GET ${endpointPath} (requests: ${apiRequestCount})`);

  const res = await fetch(`${AFOOT_BASE}${endpointPath}`, {
    headers: {
      "x-rapidapi-key":  process.env.FOOTBALL_API_KEY!,
      "x-rapidapi-host": "v3.football.api-sports.io",
    },
  });

  // Rate limit hit — wait and retry up to 3 times
  if (res.status === 429) {
    if (retryCount >= 3) {
      throw new Error(`api-football ${endpointPath} → HTTP 429 (max retries exceeded)`);
    }
    const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10);
    console.warn(`  Rate limited on ${endpointPath}, retrying after ${retryAfter}s (attempt ${retryCount + 1}/3)`);
    await delay(retryAfter * 1000);
    lastAfootCall = 0;
    return afootFetch(endpointPath, cacheFile, label, retryCount + 1);
  }

  if (!res.ok) {
    throw new Error(`api-football ${endpointPath} → HTTP ${res.status}`);
  }

  const json = await res.json();

  // Warn on API-level errors
  if (json.errors && typeof json.errors === "object" && Object.keys(json.errors).length > 0) {
    console.warn(`  API errors on ${endpointPath}:`, JSON.stringify(json.errors));
  }

  // Warn on low quota
  const remaining = res.headers.get("x-ratelimit-requests-remaining");
  if (remaining !== null && parseInt(remaining, 10) < 10) {
    console.warn(`  API quota low: ${remaining} requests remaining`);
  }

  // Write to cache
  writeCache(cacheFile, json);

  return json;
}

// ── Step 1: Fetch and upsert teams → wm_nations ────────────────────────────
async function ingestTeams(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<Map<number, string>> {
  console.log("\n── Step 1: Teams ─────────────────────────────────────────");

  const json = await afootFetch(
    `/teams?league=${WC_LEAGUE_ID}&season=${WC_SEASON}`,
    "teams.json",
    `teams league=${WC_LEAGUE_ID} season=${WC_SEASON}`,
  );

  const teams: any[] = json.response || [];
  console.log(`  Found ${teams.length} teams from API`);

  if (teams.length === 0) throw new Error("API returned 0 teams for WC 2026 — aborting. Data may not be available yet.");

  // api_team_id → wm_nations.id
  const teamIdToNationId = new Map<number, string>();

  if (DRY_RUN) {
    console.log("  [DRY RUN] Would upsert teams:");
    for (const item of teams) {
      const t = item.team;
      console.log(`    ${t.name} (${t.code}) — api_team_id=${t.id} flag=${t.logo}`);
    }
    console.log(`  [DRY RUN] Skipped upserting ${teams.length} nations.`);
    return teamIdToNationId;
  }

  const rows = teams.map((item: any) => ({
    tournament_id: tournamentId,
    api_team_id:   item.team.id,
    name:          item.team.name,
    code:          item.team.code || null,
    flag_url:      item.team.logo || null,
  }));

  // Use name as conflict key: existing nations may have api_team_id=null,
  // so upsert by (tournament_id, name) to update them with the real api_team_id.
  const { error } = await supabase
    .from("wm_nations")
    .upsert(rows, { onConflict: "tournament_id,name" });

  if (error) {
    throw new Error(`wm_nations upsert failed: ${error.message}`);
  }

  // Re-fetch to get UUIDs
  const { data: nations, error: fetchError } = await supabase
    .from("wm_nations")
    .select("id, api_team_id")
    .eq("tournament_id", tournamentId)
    .not("api_team_id", "is", null);

  if (fetchError) throw new Error(`wm_nations fetch failed: ${fetchError.message}`);

  for (const n of nations || []) {
    if (n.api_team_id != null) teamIdToNationId.set(n.api_team_id, n.id);
  }

  console.log(`  Upserted ${rows.length} nations.`);
  return teamIdToNationId;
}

// ── Step 2: Fetch and upsert fixtures → wm_fixtures ───────────────────────
async function ingestFixtures(
  supabase: SupabaseClient,
  tournamentId: string,
  teamIdToNationId: Map<number, string>,
): Promise<void> {
  console.log("\n── Step 2: Fixtures ──────────────────────────────────────");

  const json = await afootFetch(
    `/fixtures?league=${WC_LEAGUE_ID}&season=${WC_SEASON}`,
    "fixtures.json",
    `fixtures league=${WC_LEAGUE_ID} season=${WC_SEASON}`,
  );

  const fixtures: any[] = json.response || [];
  console.log(`  Found ${fixtures.length} fixtures from API`);

  const unmappedRounds = new Set<string>();
  const rows: any[] = [];

  for (const fix of fixtures) {
    const roundStr: string = fix.league?.round || "";
    const mapping = mapRound(roundStr);
    if (!mapping) {
      unmappedRounds.add(roundStr);
      continue;
    }

    const homeApiTeamId: number = fix.teams?.home?.id;
    const awayApiTeamId: number = fix.teams?.away?.id;

    const homeNationId = teamIdToNationId.get(homeApiTeamId);
    const awayNationId = teamIdToNationId.get(awayApiTeamId);

    if (!homeNationId || !awayNationId) {
      console.warn(
        `  Skipping fixture ${fix.fixture?.id}: unknown nation ` +
        `home=${homeApiTeamId} away=${awayApiTeamId}`,
      );
      continue;
    }

    const statusShort: string = fix.fixture?.status?.short;
    const homeScore = fix.goals?.home ?? null;
    const awayScore = fix.goals?.away ?? null;

    rows.push({
      tournament_id:   tournamentId,
      gameweek:        mapping.gameweek,
      stage:           mapping.stage,
      home_nation_id:  homeNationId,
      away_nation_id:  awayNationId,
      kickoff:         fix.fixture?.date || null,
      stadium:         fix.fixture?.venue?.name || null,
      city:            fix.fixture?.venue?.city || null,
      status:          mapStatus(statusShort),
      home_score:      typeof homeScore === "number" ? homeScore : null,
      away_score:      typeof awayScore === "number" ? awayScore : null,
      api_fixture_id:  fix.fixture?.id || null,
    });
  }

  if (unmappedRounds.size > 0) {
    console.warn("  Unmapped rounds (fixtures skipped):");
    for (const r of unmappedRounds) console.warn(`    "${r}"`);
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would upsert ${rows.length} fixtures (${fixtures.length - rows.length} skipped).`);
    if (rows.length > 0) {
      console.log(`  [DRY RUN] Sample fixture:`, JSON.stringify(rows[0], null, 2));
    }
    return;
  }

  // Upsert in batches of 50 to avoid payload limits
  const BATCH = 50;
  let upserted = 0;
  let hadError = false;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("wm_fixtures")
      .upsert(batch, { onConflict: "api_fixture_id" });
    if (error) {
      // Fall back to composite key upsert for rows without api_fixture_id
      console.warn(`  Batch upsert error (api_fixture_id conflict): ${error.message}`);
      hadError = true;
    } else {
      upserted += batch.length;
    }
  }

  if (hadError) throw new Error("One or more batch writes failed — check logs above");

  console.log(`  Upserted ${upserted} fixtures (${fixtures.length - rows.length} unmapped).`);
}

// ── Step 3: Fetch and upsert players (paginated) ───────────────────────────
async function ingestPlayers(
  supabase: SupabaseClient,
  teamIdToNationId: Map<number, string>,
): Promise<void> {
  console.log("\n── Step 3: Players (paginated) ───────────────────────────");

  let page = 1;
  let totalUpserted = 0;
  let totalPages = 1;
  const allPlayerRows: any[] = [];

  while (true) {
    const cacheFile = `players-page-${page}.json`;
    const label = `players page ${page}`;

    const json = await afootFetch(
      `/players?league=${WC_LEAGUE_ID}&season=${WC_SEASON}&page=${page}`,
      cacheFile,
      label,
    );

    const currentPage = json.paging?.current ?? page;
    totalPages = json.paging?.total ?? 1;

    const entries: any[] = json.response || [];
    console.log(`  [${currentPage}/${totalPages}] ${entries.length} players on this page`);

    for (const entry of entries) {
      const player   = entry.player;
      const stats    = entry.statistics?.[0];
      if (!stats) continue;

      const posRaw   = stats.games?.position;
      const position = mapPosition(posRaw);
      if (!position) {
        console.warn(`  Skipping player ${player?.name} — unknown position "${posRaw}"`);
        continue;
      }

      const apiTeamId: number | undefined = stats.team?.id;
      const teamName: string              = stats.team?.name || player?.nationality || null;
      const ratingRaw = parseFloat(stats.games?.rating || "");
      const rating    = isNaN(ratingRaw) ? null : Math.round(ratingRaw * 100) / 100;

      allPlayerRows.push({
        // Primary key in players table = player.id (api-football player id)
        id:                     player.id,
        api_football_player_id: player.id,
        name:                   player.name,
        position,
        nationality:            player.nationality || null,
        photo_url:              player.photo       || null,
        team_name:              teamName,
        api_team_id:            apiTeamId          || null,
        is_test_player:         false,
        player_source:          "api_football",
        fpts:                   0,
        rating,
        goals:         stats.goals?.total           || 0,
        assists:       stats.goals?.assists          || 0,
        saves:         stats.goals?.saves            || 0,
        minutes:       stats.games?.minutes          || 0,
        appearances:   stats.games?.appearences      || 0,  // API-Football typo: "appearences" — matches API field name
        shots_on:      stats.shots?.on               || 0,
        key_passes:    stats.passes?.key             || 0,
        pass_accuracy: Math.round(parseFloat(stats.passes?.accuracy || "0") || 0),
        tackles:       stats.tackles?.total          || 0,
        interceptions: stats.tackles?.interceptions  || 0,
        dribbles:      stats.dribbles?.success       || 0,
        yellow_cards:  (stats.cards?.yellow || 0) + (stats.cards?.yellowred || 0),
        red_cards:     (stats.cards?.red    || 0) + (stats.cards?.yellowred || 0),
      });
    }

    // Break when current page >= total pages
    if (currentPage >= totalPages) {
      break;
    }

    page++;
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would upsert ${allPlayerRows.length} players.`);
    if (allPlayerRows.length > 0) {
      const sample = allPlayerRows[0];
      console.log("  [DRY RUN] Sample player:", JSON.stringify({
        id: sample.id,
        name: sample.name,
        position: sample.position,
        team_name: sample.team_name,
        nationality: sample.nationality,
        api_team_id: sample.api_team_id,
      }, null, 2));
    }
    return;
  }

  // Upsert players in batches of 100
  const BATCH = 100;
  let hadError = false;
  for (let i = 0; i < allPlayerRows.length; i += BATCH) {
    const batch = allPlayerRows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("players")
      .upsert(batch, { onConflict: "id" });
    if (error) {
      console.error(`  Player upsert error (batch ${i / BATCH + 1}): ${error.message}`);
      hadError = true;
    } else {
      totalUpserted += batch.length;
    }
  }

  if (hadError) throw new Error("One or more batch writes failed — check logs above");

  console.log(`  Upserted ${totalUpserted} players (pages 1-${totalPages}).`);
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  loadDotEnv();
  assertEnv();

  ensureCacheDir();

  console.log(`\nTIFO — WM 2026 Real Roster Ingest`);
  console.log(`  League ID : ${WC_LEAGUE_ID}  Season: ${WC_SEASON}`);
  console.log(`  Cache dir : ${CACHE_DIR}`);
  console.log(`  Mode      : ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE (writing to DB)"}`);
  console.log();

  // Create Supabase client (write operations need service role)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Look up tournament
  const { data: tournament, error: tErr } = await supabase
    .from("wm_tournaments")
    .select("id, name, season")
    .eq("season", WC_SEASON)
    .limit(1)
    .maybeSingle();

  if (tErr) {
    console.error("ERROR: Failed to query wm_tournaments:", tErr.message);
    process.exit(1);
  }
  if (!tournament) {
    console.error(`ERROR: No wm_tournaments row found for season=${WC_SEASON}.`);
    console.error("Run the wm_schema.sql migration first.");
    process.exit(1);
  }

  console.log(`Tournament: "${tournament.name}" (id=${tournament.id})`);

  // Step 1 — Teams
  let teamIdToNationId: Map<number, string>;
  try {
    teamIdToNationId = await ingestTeams(supabase, tournament.id);
  } catch (err: any) {
    console.error("ERROR in Step 1 (teams):", err.message);
    process.exit(1);
  }

  // In dry-run we don't have real UUIDs — build a fake map from cache for steps 2/3
  if (DRY_RUN && teamIdToNationId.size === 0) {
    const cached = readCache("teams.json");
    if (cached?.response) {
      for (const item of cached.response) {
        // Use placeholder UUID so fixture mapping can proceed in dry-run
        teamIdToNationId.set(item.team.id, `dry-run-uuid-${item.team.id}`);
      }
    }
  }

  // Step 2 — Fixtures
  try {
    await ingestFixtures(supabase, tournament.id, teamIdToNationId);
  } catch (err: any) {
    console.error("ERROR in Step 2 (fixtures):", err.message);
    process.exit(1);
  }

  // Step 3 — Players
  try {
    await ingestPlayers(supabase, teamIdToNationId);
  } catch (err: any) {
    console.error("ERROR in Step 3 (players):", err.message);
    process.exit(1);
  }

  // Summary
  console.log("\n──────────────────────────────────────────────────────────");
  console.log(`Total API requests: ${apiRequestCount}`);
  if (DRY_RUN) {
    console.log("DRY RUN — no DB writes performed.");
  } else {
    console.log("Done. All data written to DB.");
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
