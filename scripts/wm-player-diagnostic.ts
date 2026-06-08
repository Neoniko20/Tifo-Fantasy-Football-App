/**
 * TIFO — WM Player Diagnostic
 *
 * Testet die API-Football Player-Endpunkte OHNE Cache und OHNE DB-Zugriff.
 *
 * Verwendung:
 *   # Statistik-Endpunkt (Seite 1) — pre-Turnier meist leer
 *   node --experimental-strip-types scripts/wm-player-diagnostic.ts
 *
 *   # Statistik-Endpunkt (alle Seiten)
 *   node --experimental-strip-types scripts/wm-player-diagnostic.ts --all-pages
 *
 *   # Squad-Endpunkt — ein Beispiel-Team (empfohlen pre-Turnier)
 *   node --experimental-strip-types scripts/wm-player-diagnostic.ts --squads
 *
 *   # Squad-Endpunkt — mehrere Teams aus der Team-Cache-Datei
 *   node --experimental-strip-types scripts/wm-player-diagnostic.ts --squads --team-count=5
 */

import * as fs from "fs";
import * as path from "path";

const WC_LEAGUE_ID = 1;
const WC_SEASON    = 2026;
const AFOOT_BASE   = "https://v3.football.api-sports.io";
const CACHE_DIR    = path.join(process.cwd(), ".cache", "api-football", "wm-2026");
const RATE_LIMIT_MS = 2200;

const ALL_PAGES   = process.argv.includes("--all-pages");
const SQUADS_MODE = process.argv.includes("--squads");
const teamCountArg = process.argv.find(a => a.startsWith("--team-count="));
const TEAM_COUNT  = teamCountArg ? parseInt(teamCountArg.split("=")[1], 10) : 1;

// ── .env.local laden ──────────────────────────────────────────────────────
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

// ── API abrufen (kein Cache) ───────────────────────────────────────────────
async function apiFetch(url: string): Promise<any> {
  console.log(`\n[api] GET ${url}`);

  const res = await fetch(url, {
    headers: {
      "x-rapidapi-key":  process.env.FOOTBALL_API_KEY!,
      "x-rapidapi-host": "v3.football.api-sports.io",
    },
  });

  const remaining = res.headers.get("x-ratelimit-requests-remaining");
  const limit     = res.headers.get("x-ratelimit-requests-limit");
  if (remaining !== null) {
    const rem = parseInt(remaining, 10);
    console.log(`[quota] ${remaining}/${limit ?? "?"} Requests verbleibend`);
    if (rem < 10) console.warn(`⚠️  Quota kritisch niedrig!`);
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after") || "?";
    console.error(`❌ Rate Limit (HTTP 429). Retry-After: ${retryAfter}s`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`❌ HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  return res.json();
}

// ── Statistik-Endpunkt: eine Seite auswerten ─────────────────────────────
function reportStatsPage(json: any, page: number): { current: number; total: number; count: number } {
  const current  = json.paging?.current ?? page;
  const total    = json.paging?.total   ?? 1;
  const results  = json.results         ?? 0;
  const entries: any[] = json.response  ?? [];

  console.log(`\n── Seite ${current}/${total} ─────────────────────────────────────`);
  console.log(`   results:         ${results}`);
  console.log(`   response.length: ${entries.length}`);
  if (json.errors && Object.keys(json.errors).length > 0) {
    console.warn(`   ⚠️  API errors:`, JSON.stringify(json.errors));
  }

  if (entries.length === 0) {
    console.log(`   ⚠️  Keine Spieler — Statistik-Endpunkt liefert pre-Turnier keine Daten.`);
    console.log(`   💡  Tipp: --squads verwenden für Kader-Daten.`);
    return { current, total, count: 0 };
  }

  const first = entries[0];
  const last  = entries[entries.length - 1];
  console.log(`\n   Erster: ${first.player?.name} (id=${first.player?.id}) | ${first.statistics?.[0]?.team?.name} | ${first.statistics?.[0]?.games?.position}`);
  console.log(`   Letzter: ${last.player?.name} (id=${last.player?.id}) | ${last.statistics?.[0]?.team?.name}`);
  return { current, total, count: entries.length };
}

// ── Squad-Endpunkt: ein Team auswerten ────────────────────────────────────
function reportSquad(json: any, teamId: number): number {
  const entry = json.response?.[0];
  if (!entry) {
    console.log(`   ⚠️  Keine Daten für team ${teamId}`);
    if (json.errors && Object.keys(json.errors).length > 0) {
      console.warn(`   API errors:`, JSON.stringify(json.errors));
    }
    return 0;
  }

  const teamName = entry.team?.name ?? `Team ${teamId}`;
  const players: any[] = entry.players ?? [];

  console.log(`\n── ${teamName} (id=${teamId}) ─────────────────────────────────`);
  console.log(`   Spieler: ${players.length}`);

  if (players.length === 0) {
    console.log(`   ⚠️  Kader leer`);
    return 0;
  }

  const first = players[0];
  const last  = players[players.length - 1];
  console.log(`   Erster: ${first.name} (id=${first.id}) | ${first.position} | Foto: ${first.photo ? "✅" : "—"}`);
  console.log(`   Letzter: ${last.name} (id=${last.id}) | ${last.position}`);

  // Positionsverteilung
  const posCounts: Record<string, number> = {};
  for (const p of players) {
    posCounts[p.position] = (posCounts[p.position] || 0) + 1;
  }
  console.log(`   Positionen: ${Object.entries(posCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`);

  return players.length;
}

// ── Teams aus Cache laden ──────────────────────────────────────────────────
function loadTeamIdsFromCache(limit: number): Array<{ id: number; name: string }> {
  const teamsPath = path.join(CACHE_DIR, "teams.json");
  if (!fs.existsSync(teamsPath)) {
    console.warn(`  ⚠️  teams.json nicht im Cache — nur Team-ID 2 (Frankreich) wird verwendet.`);
    return [{ id: 2, name: "France" }];
  }
  const json = JSON.parse(fs.readFileSync(teamsPath, "utf8"));
  return (json.response || [])
    .slice(0, limit)
    .map((item: any) => ({ id: item.team.id, name: item.team.name }));
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  loadDotEnv();

  if (!process.env.FOOTBALL_API_KEY) {
    console.error("ERROR: FOOTBALL_API_KEY fehlt in .env.local");
    process.exit(1);
  }

  console.log(`\nTIFO — WM Player Diagnostic`);
  console.log(`  Kein Cache, kein DB-Zugriff.`);

  if (SQUADS_MODE) {
    // ── /players/squads?team=<id> ────────────────────────────────────────
    console.log(`  Modus:    --squads (/players/squads?team=<id>)`);
    console.log(`  Teams:    ${TEAM_COUNT}`);

    const teams = loadTeamIdsFromCache(TEAM_COUNT);
    let totalPlayers = 0;

    for (let i = 0; i < teams.length; i++) {
      const { id, name } = teams[i];
      if (i > 0) await new Promise(r => setTimeout(r, RATE_LIMIT_MS));

      const json = await apiFetch(`${AFOOT_BASE}/players/squads?team=${id}`);
      totalPlayers += reportSquad(json, id);
    }

    console.log(`\n── Zusammenfassung ──────────────────────────────────────────`);
    console.log(`   Teams abgefragt:  ${teams.length}`);
    console.log(`   Spieler gesamt:   ${totalPlayers}`);

    if (totalPlayers > 0) {
      const projected = Math.round((totalPlayers / teams.length) * 48);
      console.log(`   Hochrechnung:     ~${projected} Spieler für alle 48 Teams`);
      console.log(`\n✅ Squad-Daten verfügbar! Import bereit:`);
      console.log(`   node --experimental-strip-types scripts/ingest-wm-2026-api-football.ts --dry-run --debug`);
    } else {
      console.log(`\n❌ Keine Squad-Daten — API-Football hat noch keine Kader.`);
    }

  } else {
    // ── /players?league&season (Statistik-Endpunkt) ──────────────────────
    console.log(`  Modus:    ${ALL_PAGES ? "Statistik alle Seiten" : "Statistik Seite 1"}`);
    console.log(`  Endpunkt: /players?league=${WC_LEAGUE_ID}&season=${WC_SEASON}`);

    if (!ALL_PAGES) {
      const json = await apiFetch(`${AFOOT_BASE}/players?league=${WC_LEAGUE_ID}&season=${WC_SEASON}&page=1`);
      const { total } = reportStatsPage(json, 1);
      if (total > 1) {
        console.log(`\n💡 ${total} Seiten verfügbar. Mit --all-pages alle zählen.`);
      }
    } else {
      let page = 1;
      let totalPages = 1;
      let totalPlayers = 0;

      while (true) {
        if (page > 1) await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
        const json = await apiFetch(`${AFOOT_BASE}/players?league=${WC_LEAGUE_ID}&season=${WC_SEASON}&page=${page}`);
        const { current, total, count } = reportStatsPage(json, page);
        totalPages = total;
        totalPlayers += count;
        if (current >= totalPages || count === 0) break;
        page++;
      }

      console.log(`\n── Zusammenfassung ──────────────────────────────────────────`);
      console.log(`   Seiten:  ${totalPages}  |  Spieler: ${totalPlayers}`);
      if (totalPlayers === 0) {
        console.log(`\n❌ Statistik-Endpunkt leer — Kader via --squads prüfen.`);
      }
    }
  }

  console.log();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
