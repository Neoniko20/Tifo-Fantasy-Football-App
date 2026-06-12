/**
 * TIFO — WM Player API ID Backfill
 *
 * Befüllt players.api_football_player_id für WM-Spieler, die noch keine
 * externe ID haben. Nutzt API-Football /players/squads pro Nation.
 *
 * Standard: Dry-Run — keine DB-Schreibzugriffe.
 * Mit --apply werden sichere Matches in die DB geschrieben.
 *
 * Verwendung:
 *   # Dry-Run (Standard)
 *   node --experimental-strip-types scripts/wm-backfill-player-api-ids.ts
 *
 *   # Dry-Run mit Debug-Output
 *   node --experimental-strip-types scripts/wm-backfill-player-api-ids.ts --debug
 *
 *   # Echte Schreibzugriffe (nur nach Dry-Run-Freigabe)
 *   node --experimental-strip-types scripts/wm-backfill-player-api-ids.ts --apply
 *
 *   # Andere Saison
 *   node --experimental-strip-types scripts/wm-backfill-player-api-ids.ts --season 2026
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_SEASON = 2026;
const AFOOT_BASE    = "https://v3.football.api-sports.io";
const RATE_LIMIT_MS = 2200;
const CACHE_DIR     = path.join(process.cwd(), ".cache", "api-football", "wm-2026");

// ── CLI args ───────────────────────────────────────────────────────────────

const APPLY  = process.argv.includes("--apply");
const DEBUG  = process.argv.includes("--debug");

const seasonArg = process.argv.find(a => a.startsWith("--season=") || a === "--season");
const WC_SEASON = seasonArg
  ? parseInt(
      seasonArg.includes("=")
        ? seasonArg.split("=")[1]
        : (process.argv[process.argv.indexOf("--season") + 1] ?? String(DEFAULT_SEASON)),
      10,
    )
  : DEFAULT_SEASON;

const tournamentIdArg = process.argv.find(a => a.startsWith("--tournament-id=") || a === "--tournament-id");
const EXPLICIT_TOURNAMENT_ID = tournamentIdArg
  ? tournamentIdArg.includes("=")
    ? tournamentIdArg.split("=")[1]
    : process.argv[process.argv.indexOf("--tournament-id") + 1]
  : null;

// ── Types ──────────────────────────────────────────────────────────────────

export interface ApiPlayer {
  id:       number;
  name:     string;
  position: string;
}

export interface LocalPlayer {
  id:                     number;
  name:                   string;
  position:               string | null;
  api_football_player_id: number | null;
  nation_id:              string;
  nation_name:            string;
  api_team_id:            number | null;
}

export type MatchOutcome =
  | { type: "exact";     apiId: number; apiName: string }
  | { type: "ambiguous"; candidates: Array<{ id: number; name: string }> }
  | { type: "missing" };

// ── Name normalization ─────────────────────────────────────────────────────

/**
 * Normalizes a player name for matching:
 * - Lowercase
 * - Remove diacritics (é→e, ü→u, etc.)
 * - Remove non-alphanumeric chars except spaces
 * - Collapse multiple spaces
 */
export function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    // Remove combining diacritical marks (accents etc.)
    .replace(/[̀-ͯ]/g, "")
    // Remove non-alphanumeric chars except spaces
    .replace(/[^a-z0-9 ]/g, "")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

// ── Player matching ────────────────────────────────────────────────────────

/**
 * Matches a local player name against a list of API-Football players.
 * Returns exact match, ambiguous (multiple matches), or missing.
 *
 * Conservative strategy: only exact normalized-name matches are trusted.
 * Multiple matches → ambiguous → not written.
 */
export function matchPlayer(localName: string, apiPlayers: ApiPlayer[]): MatchOutcome {
  const normalized = normalizePlayerName(localName);
  const candidates = apiPlayers.filter(
    p => normalizePlayerName(p.name) === normalized,
  );

  if (candidates.length === 1) {
    return { type: "exact", apiId: candidates[0].id, apiName: candidates[0].name };
  }
  if (candidates.length > 1) {
    return { type: "ambiguous", candidates: candidates.map(p => ({ id: p.id, name: p.name })) };
  }
  return { type: "missing" };
}

// ── Env loading ────────────────────────────────────────────────────────────

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
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && val && !process.env[key]) process.env[key] = val;
  }
}

function assertEnv(): void {
  const missing: string[] = [];
  if (!process.env.FOOTBALL_API_KEY)          missing.push("FOOTBALL_API_KEY");
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL)  missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    console.error(`ERROR: Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
}

// ── API fetch with cache ───────────────────────────────────────────────────

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

async function fetchSquad(apiTeamId: number): Promise<ApiPlayer[]> {
  const cacheFile = path.join(CACHE_DIR, `squad-team-${apiTeamId}.json`);

  if (fs.existsSync(cacheFile)) {
    if (DEBUG) console.log(`  [cache] squad-team-${apiTeamId}.json`);
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    return extractPlayers(cached);
  }

  if (DEBUG) console.log(`  [api]   GET /players/squads?team=${apiTeamId}`);
  const res = await fetch(`${AFOOT_BASE}/players/squads?team=${apiTeamId}`, {
    headers: { "x-apisports-key": process.env.FOOTBALL_API_KEY! },
  });

  const remaining = res.headers.get("x-ratelimit-requests-remaining");
  if (remaining !== null && parseInt(remaining, 10) < 10) {
    console.warn(`⚠️  Quota kritisch niedrig: ${remaining} Requests verbleibend`);
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("retry-after") || "15", 10);
    console.warn(`  Rate limit — warte ${retryAfter}s...`);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return fetchSquad(apiTeamId); // retry after backoff
  }

  if (!res.ok) throw new Error(`HTTP ${res.status} für team ${apiTeamId}`);

  const json = await res.json();
  fs.writeFileSync(cacheFile, JSON.stringify(json, null, 2));
  return extractPlayers(json);
}

function extractPlayers(json: any): ApiPlayer[] {
  const entry = json.response?.[0];
  if (!entry) return [];
  return (entry.players ?? []).map((p: any) => ({
    id:       p.id,
    name:     p.name,
    position: p.position ?? "",
  }));
}

// ── DB helpers ─────────────────────────────────────────────────────────────

async function loadWMPlayers(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<LocalPlayer[]> {
  // Join: wm_player_nations → players + wm_nations (for api_team_id)
  const { data, error } = await supabase
    .from("wm_player_nations")
    .select(`
      player_id,
      players!inner ( id, name, position, api_football_player_id ),
      wm_nations!inner ( id, name, api_team_id )
    `)
    .eq("tournament_id", tournamentId);

  if (error) throw new Error(`wm_player_nations query failed: ${error.message}`);
  if (!data?.length) return [];

  return data.map((row: any) => ({
    id:                     row.players.id,
    name:                   row.players.name,
    position:               row.players.position,
    api_football_player_id: row.players.api_football_player_id ?? null,
    nation_id:              row.wm_nations.id,
    nation_name:            row.wm_nations.name,
    api_team_id:            row.wm_nations.api_team_id ?? null,
  }));
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadDotEnv();
  assertEnv();
  ensureCacheDir();

  console.log(`\nTIFO — WM Player API ID Backfill`);
  console.log(`  Modus     : ${APPLY ? "APPLY (schreibt in DB)" : "DRY RUN (keine DB-Schreibzugriffe)"}`);
  console.log(`  Saison    : ${WC_SEASON}`);
  if (EXPLICIT_TOURNAMENT_ID) console.log(`  Tournament: ${EXPLICIT_TOURNAMENT_ID}`);
  if (!APPLY) console.log(`\n  ℹ️  Zum Schreiben: --apply hinzufügen\n`);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // ── 1. Tournament laden ────────────────────────────────────────────────────
  let tournamentId: string;
  if (EXPLICIT_TOURNAMENT_ID) {
    tournamentId = EXPLICIT_TOURNAMENT_ID;
  } else {
    const { data: tournament, error } = await supabase
      .from("wm_tournaments")
      .select("id, name")
      .eq("season", WC_SEASON)
      .limit(1)
      .maybeSingle();
    if (error || !tournament) {
      console.error(`ERROR: Kein wm_tournaments-Eintrag für season=${WC_SEASON}`);
      process.exit(1);
    }
    tournamentId = tournament.id;
    console.log(`  Turnier   : ${tournament.name} (${tournamentId})`);
  }

  // ── 2. Lokale WM-Spieler laden ─────────────────────────────────────────────
  console.log(`\n[1/4] Lade WM-Spieler aus DB...`);
  const allPlayers = await loadWMPlayers(supabase, tournamentId);

  const alreadyMapped = allPlayers.filter(p => p.api_football_player_id !== null);
  const needsMapping  = allPlayers.filter(p => p.api_football_player_id === null);

  console.log(`  Gesamt WM-Spieler : ${allPlayers.length}`);
  console.log(`  Bereits gemappt   : ${alreadyMapped.length}`);
  console.log(`  Benötigen Mapping : ${needsMapping.length}`);

  if (needsMapping.length === 0) {
    console.log(`\n✅ Alle WM-Spieler haben bereits api_football_player_id — nichts zu tun.`);
    return;
  }

  // ── 3. API-Football Squads per Nation laden ────────────────────────────────
  // Unique nations aus den unmapped players
  const nationMap = new Map<string, { name: string; api_team_id: number | null }>();
  for (const p of needsMapping) {
    if (!nationMap.has(p.nation_id)) {
      nationMap.set(p.nation_id, { name: p.nation_name, api_team_id: p.api_team_id });
    }
  }

  const nationsWithId    = [...nationMap.entries()].filter(([, n]) => n.api_team_id !== null);
  const nationsWithoutId = [...nationMap.entries()].filter(([, n]) => n.api_team_id === null);

  console.log(`\n[2/4] Lade API-Football Squads...`);
  console.log(`  Nationen total     : ${nationMap.size}`);
  console.log(`  Mit api_team_id    : ${nationsWithId.length}`);
  console.log(`  Ohne api_team_id   : ${nationsWithoutId.length}${nationsWithoutId.length > 0 ? " ⚠️  werden übersprungen" : ""}`);

  if (nationsWithoutId.length > 0 && DEBUG) {
    for (const [, n] of nationsWithoutId) {
      console.log(`    ⚠️  ${n.name} — api_team_id fehlt`);
    }
  }

  // Squad-Daten pro Nation laden (mit Cache)
  // Delay nur bei echten API-Calls, nicht bei Cache-Hits
  const squadByNation = new Map<string, ApiPlayer[]>(); // nation_id → players
  let apiCallsDone = 0;

  for (let i = 0; i < nationsWithId.length; i++) {
    const [nationId, nation] = nationsWithId[i];
    const cacheFile = path.join(CACHE_DIR, `squad-team-${nation.api_team_id}.json`);
    const isCached  = fs.existsSync(cacheFile);

    if (!isCached && apiCallsDone > 0) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    }

    try {
      const players = await fetchSquad(nation.api_team_id!);
      squadByNation.set(nationId, players);
      if (!isCached) apiCallsDone++;
      if (DEBUG) {
        const src = isCached ? "cache" : "api";
        console.log(`  [${i + 1}/${nationsWithId.length}] ${nation.name}: ${players.length} Spieler [${src}]`);
      } else {
        process.stdout.write(isCached ? "c" : ".");
      }
    } catch (err: any) {
      console.warn(`\n  ⚠️  Fehler für ${nation.name}: ${err.message}`);
      squadByNation.set(nationId, []);
    }
  }

  if (!DEBUG) console.log(); // newline after dots

  // ── 4. Matching ────────────────────────────────────────────────────────────
  console.log(`\n[3/4] Matche lokale Spieler gegen API-Football...`);

  const matched:   Array<{ local: LocalPlayer; apiId: number; apiName: string }> = [];
  const ambiguous: Array<{ local: LocalPlayer; candidates: Array<{ id: number; name: string }> }> = [];
  const missing:   LocalPlayer[] = [];
  const noSquad:   LocalPlayer[] = [];

  for (const player of needsMapping) {
    const apiPlayers = squadByNation.get(player.nation_id);

    if (apiPlayers === undefined) {
      // Nation hatte keine api_team_id → kein Squad verfügbar
      noSquad.push(player);
      continue;
    }

    const outcome = matchPlayer(player.name, apiPlayers);
    if (outcome.type === "exact") {
      matched.push({ local: player, apiId: outcome.apiId, apiName: outcome.apiName });
    } else if (outcome.type === "ambiguous") {
      ambiguous.push({ local: player, candidates: outcome.candidates });
    } else {
      missing.push(player);
    }
  }

  // ── 5. Report ──────────────────────────────────────────────────────────────
  console.log(`\n[4/4] Ergebnis`);
  console.log(`════════════════════════════════════════════════════════════`);
  console.log(`  nationsChecked   : ${nationsWithId.length}`);
  console.log(`  localPlayersTotal: ${allPlayers.length}`);
  console.log(`  alreadyMapped    : ${alreadyMapped.length}`);
  console.log(`  apiPlayersTotal  : ${[...squadByNation.values()].reduce((s, p) => s + p.length, 0)}`);
  console.log(`  ─────────────────────────────────────────────────────────`);
  console.log(`  matchedExact     : ${matched.length}  ${matched.length > 0 ? "✅" : ""}`);
  console.log(`  ambiguous        : ${ambiguous.length}  ${ambiguous.length > 0 ? "⚠️  (nicht geschrieben)" : ""}`);
  console.log(`  missing          : ${missing.length}  ${missing.length > 0 ? "⚠️  (kein API-Match)" : ""}`);
  console.log(`  noSquad          : ${noSquad.length}  ${noSquad.length > 0 ? "⚠️  (Nation ohne api_team_id)" : ""}`);
  console.log(`  wouldUpdate      : ${matched.length}`);
  console.log(`════════════════════════════════════════════════════════════`);

  if (DEBUG || ambiguous.length > 0) {
    if (ambiguous.length > 0) {
      console.log(`\n⚠️  Mehrdeutige Matches (nicht geschrieben):`);
      for (const { local, candidates } of ambiguous) {
        console.log(`  "${local.name}" (${local.nation_name}) → ${candidates.length} Treffer:`);
        for (const c of candidates) {
          console.log(`    id=${c.id}  name="${c.name}"`);
        }
      }
    }
  }

  if (DEBUG && missing.length > 0) {
    console.log(`\n⚠️  Kein API-Match gefunden:`);
    for (const p of missing.slice(0, 20)) {
      console.log(`  "${p.name}" (${p.nation_name})`);
    }
    if (missing.length > 20) console.log(`  ... und ${missing.length - 20} weitere`);
  }

  if (DEBUG && matched.length > 0) {
    console.log(`\n✅ Exact Matches (Vorschau):`);
    for (const { local, apiId, apiName } of matched.slice(0, 10)) {
      console.log(`  "${local.name}" → id=${apiId}  api_name="${apiName}" (${local.nation_name})`);
    }
    if (matched.length > 10) console.log(`  ... und ${matched.length - 10} weitere`);
  }

  if (!APPLY) {
    console.log(`\n[DRY RUN] ${matched.length} Updates würden geschrieben.`);
    console.log(`  Zum Schreiben: --apply hinzufügen`);
    return;
  }

  // ── 6. Apply ───────────────────────────────────────────────────────────────
  console.log(`\nSchreibe ${matched.length} Updates...`);
  let updated   = 0;
  let updateErr = 0;

  for (const { local, apiId } of matched) {
    const { error } = await supabase
      .from("players")
      .update({ api_football_player_id: apiId })
      .eq("id", local.id)
      .is("api_football_player_id", null); // Safety: nie überschreiben

    if (error) {
      console.warn(`  ⚠️  Update failed für player ${local.id} (${local.name}): ${error.message}`);
      updateErr++;
    } else {
      updated++;
    }
  }

  console.log(`\n  updated   : ${updated}`);
  console.log(`  errors    : ${updateErr}`);
  if (updated > 0) {
    console.log(`\n✅ Backfill abgeschlossen. ${updated} Spieler haben jetzt api_football_player_id.`);
  }
}

// Guard: nur ausführen wenn direkt aufgerufen, nicht beim Import (z.B. in Tests)
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error("\nFATAL:", err);
    process.exit(1);
  });
}
