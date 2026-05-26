import { NextRequest, NextResponse } from "next/server";

/**
 * Sprint 0 — WM API-Football Validierung
 *
 * Read-only diagnostic. Schreibt nichts in die Datenbank.
 * Prüft ob FIFA WM 2026 in api-football verfügbar ist:
 *   - League / Season vorhanden?
 *   - Teams / Nationen abrufbar?
 *   - Fixtures vorhanden?
 *   - Spieler-Squads verfügbar?
 *
 * GET /api/wm/test-api-football
 * Optional: ?secret=<CRON_SECRET> für Produktionsschutz
 */

const BASE        = "https://v3.football.api-sports.io";
const WC_LEAGUE_ID = 1;   // FIFA World Cup in api-football
const WC_SEASON    = 2026;

// Minimaler Throttle — Free-Tier: 10 req/min
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function afetch(path: string, apiKey: string): Promise<{ json: any; remaining: string | null }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-apisports-key": apiKey },
    cache: "no-store",
  });

  const remaining = res.headers.get("x-ratelimit-requests-remaining");

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("retry-after") || "10", 10);
    await delay(retryAfter * 1000);
    return afetch(path, apiKey); // one retry
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — ${path}`);
  }

  const json = await res.json();
  return { json, remaining };
}

// ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // Optional guard — bei gesetztem Secret muss es stimmen
  const secret = req.nextUrl.searchParams.get("secret");
  if (process.env.CRON_SECRET && secret && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "FOOTBALL_API_KEY nicht gesetzt" },
      { status: 500 }
    );
  }

  // ── Result structure ──────────────────────────────────────────────
  const result: {
    leagueFound: boolean;
    seasonFound: boolean;
    teamsAvailable: boolean;
    fixturesAvailable: boolean;
    squadsAvailable: boolean;
    recommendedNextStep: string;
    rawSample: Record<string, any>;
    diagnostics: Record<string, any>;
    schemaGaps: string[];
    csvFallback: Record<string, any>;
  } = {
    leagueFound:      false,
    seasonFound:      false,
    teamsAvailable:   false,
    fixturesAvailable: false,
    squadsAvailable:  false,
    recommendedNextStep: "",
    rawSample:  {},
    diagnostics: {
      apiKeyPrefix: `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`,
      wcLeagueId:   WC_LEAGUE_ID,
      season:       WC_SEASON,
      checkedAt:    new Date().toISOString(),
      apiCallsUsed: 0,
      quotaRemaining: null as string | null,
    },
    schemaGaps: [],
    csvFallback: {},
  };

  let calls = 0;

  // ── 1. League + Season Check ──────────────────────────────────────
  try {
    await delay(300);
    const { json, remaining } = await afetch(
      `/leagues?id=${WC_LEAGUE_ID}&season=${WC_SEASON}`,
      apiKey
    );
    calls++;
    result.diagnostics.quotaRemaining = remaining;

    const leagues: any[] = json.response || [];
    result.leagueFound = leagues.length > 0;

    if (result.leagueFound) {
      const league = leagues[0];
      const seasons: any[] = league.seasons || [];
      result.seasonFound = seasons.some((s: any) => s.year === WC_SEASON);

      result.rawSample.league = {
        id:      league.league?.id,
        name:    league.league?.name,
        type:    league.league?.type,
        logo:    league.league?.logo,
        country: league.country?.name,
        seasons: seasons
          .filter((s: any) => s.year >= 2022)
          .map((s: any) => ({ year: s.year, current: s.current, coverage: s.coverage })),
      };
    } else {
      result.rawSample.leagueSearchHint =
        "Kein Ergebnis für league=1&season=2026. " +
        "Prüfe alternativ: /leagues?search=World+Cup oder /leagues?type=Cup&country=World";
    }
  } catch (e: any) {
    result.rawSample.leagueError = e.message;
  }

  // Abbruch wenn Liga nicht gefunden — spart Quota
  if (!result.leagueFound) {
    result.recommendedNextStep =
      "FIFA WM 2026 nicht in API gefunden. " +
      "Mögliche Ursache: Free-Tier schränkt WC-Zugang ein, oder Season 2026 wurde noch nicht freigeschaltet. " +
      "Empfehlung: Statischen CSV-Fallback nutzen (s. csvFallback-Feld).";
    result.csvFallback = buildCsvFallback();
    result.diagnostics.apiCallsUsed = calls;
    return NextResponse.json(result);
  }

  // ── 2. Teams / Nationen ───────────────────────────────────────────
  try {
    await delay(2200); // Free-Tier Throttle
    const { json, remaining } = await afetch(
      `/teams?league=${WC_LEAGUE_ID}&season=${WC_SEASON}`,
      apiKey
    );
    calls++;
    if (remaining) result.diagnostics.quotaRemaining = remaining;

    const teams: any[] = json.response || [];
    result.teamsAvailable = teams.length > 0;

    result.rawSample.teams = {
      count: teams.length,
      expectedCount: 48,
      complete: teams.length >= 48,
      sample: teams.slice(0, 5).map((t: any) => ({
        id:   t.team?.id,
        name: t.team?.name,
        code: t.team?.code,
        logo: t.team?.logo,
      })),
    };

    // Schema-Gap: wm_nations hat api_team_id-Spalte, aber alle Werte sind NULL
    if (result.teamsAvailable) {
      result.schemaGaps.push(
        "wm_nations.api_team_id ist vorhanden aber nicht befüllt — " +
        "Sync-Route nötig: /api/wm/sync-nations matched Namen gegen API-IDs"
      );
    }
  } catch (e: any) {
    result.rawSample.teamsError = e.message;
  }

  // ── 3. Fixtures ───────────────────────────────────────────────────
  try {
    await delay(2200);
    const { json, remaining } = await afetch(
      `/fixtures?league=${WC_LEAGUE_ID}&season=${WC_SEASON}`,
      apiKey
    );
    calls++;
    if (remaining) result.diagnostics.quotaRemaining = remaining;

    const fixtures: any[] = json.response || [];
    result.fixturesAvailable = fixtures.length > 0;

    // Group by round for overview
    const byRound: Record<string, number> = {};
    for (const f of fixtures) {
      const round: string = f.league?.round || "unknown";
      byRound[round] = (byRound[round] || 0) + 1;
    }

    result.rawSample.fixtures = {
      count: fixtures.length,
      expectedCount: 104,
      complete: fixtures.length >= 100,
      byRound,
      sample: fixtures.slice(0, 3).map((f: any) => ({
        id:     f.fixture?.id,
        date:   f.fixture?.date,
        round:  f.league?.round,
        status: f.fixture?.status?.short,
        home:   f.teams?.home?.name,
        away:   f.teams?.away?.name,
        venue:  f.fixture?.venue?.name,
        city:   f.fixture?.venue?.city,
      })),
    };

    // Schema-Gap: keine wm_fixtures-Tabelle
    if (result.fixturesAvailable) {
      result.schemaGaps.push(
        "Keine wm_fixtures-Tabelle im Schema — " +
        "Fixtures müssen in neue Tabelle importiert werden, " +
        "damit Gameweek-Zuordnung (start_date/end_date) automatisch funktioniert"
      );
    }
  } catch (e: any) {
    result.rawSample.fixturesError = e.message;
  }

  // ── 4. Squad-Check (nur ein Beispiel-Team, spart Quota) ───────────
  const firstTeamId = result.rawSample.teams?.sample?.[0]?.id;
  if (result.teamsAvailable && firstTeamId) {
    try {
      await delay(2200);
      const { json, remaining } = await afetch(
        `/players/squads?team=${firstTeamId}`,
        apiKey
      );
      calls++;
      if (remaining) result.diagnostics.quotaRemaining = remaining;

      const squads: any[] = json.response || [];
      const playerList: any[] = squads[0]?.players || [];
      result.squadsAvailable = playerList.length > 0;

      result.rawSample.squad = {
        team:        squads[0]?.team?.name,
        playerCount: playerList.length,
        samplePlayers: playerList.slice(0, 5).map((p: any) => ({
          id:       p.id,
          name:     p.name,
          position: p.position,
          number:   p.number,
          age:      p.age,
          photo:    p.photo,
        })),
      };

      if (result.squadsAvailable) {
        result.schemaGaps.push(
          "wm_gameweek_points.player_id referenziert players.id (Vereinsspieler) — " +
          "National-Team-Squads müssen gegen bestehende players-Tabelle gematcht werden " +
          "(z.B. via Name-Fuzzy-Match oder separater wm_players-Mapping-Tabelle)"
        );
      }
    } catch (e: any) {
      result.rawSample.squadError = e.message;
    }
  }

  result.diagnostics.apiCallsUsed = calls;

  // ── 5. Recommendation ─────────────────────────────────────────────
  const ok = result.leagueFound && result.seasonFound;
  const hasTeams    = result.teamsAvailable;
  const hasFixtures = result.fixturesAvailable;
  const hasSquads   = result.squadsAvailable;

  if (ok && hasTeams && hasFixtures && hasSquads) {
    result.recommendedNextStep =
      "Alle Daten verfügbar. Phase 1 kann sofort starten. " +
      "Priorität: (1) wm_nations.api_team_id befüllen via /api/wm/sync-nations, " +
      "(2) wm_fixtures-Tabelle anlegen + Fixtures importieren, " +
      "(3) Players-Mapping-Tabelle wm_player_map (nation_player_id → players.id) anlegen.";
  } else if (ok && hasTeams && hasFixtures && !hasSquads) {
    result.recommendedNextStep =
      "Liga, Teams und Fixtures verfügbar — Squads noch nicht abrufbar (Nationalteams oft später). " +
      "Empfehlung: Phase 1 ohne Squads starten. " +
      "Draft-Pool über Vereinszugehörigkeit filtern (players.nationality), Squads vor WM-Start nachtragen.";
  } else if (ok && hasTeams && !hasFixtures) {
    result.recommendedNextStep =
      "Liga und Teams da, aber noch keine Fixtures für 2026. " +
      "Spielplan erscheint typischerweise 6–12 Monate vor WM-Start. " +
      "Fallback: Gameweek-Daten manuell über Admin eintragen.";
  } else if (ok && !hasTeams) {
    result.recommendedNextStep =
      "Liga gefunden, aber noch keine Teams für Season 2026. " +
      "API-Football schaltet Teilnehmer-Daten oft erst nach Qualifikationsende frei. " +
      "Fallback: wm_nations.api_team_id manuell via SQL befüllen (s. csvFallback).";
    result.csvFallback = buildCsvFallback();
  } else {
    result.recommendedNextStep =
      "Teilweise verfügbar. Keine sofortige Aktion nötig — " +
      "Admin-UI für manuelle Punkteerfassung als Fallback verwenden.";
  }

  return NextResponse.json(result, { status: 200 });
}

// ── CSV / Static Fallback ─────────────────────────────────────────────
function buildCsvFallback() {
  return {
    explanation:
      "Falls API keine Daten liefert: wm_nations.api_team_id manuell befüllen. " +
      "Bekannte api-football Team-IDs für WM-2026-Nationen (Stand: WM 2022 IDs, " +
      "bleiben zwischen WM-Turnieren stabil).",
    sqlExample:
      "UPDATE wm_nations SET api_team_id = 10 WHERE code = 'ARG'; -- Argentinien = 10",
    knownIds: {
      ARG: 10,
      BRA: 6,
      FRA: 2,
      GER: 25,
      ENG: 10462, // oder 26 je nach api-version
      ESP: 9,
      NED: 1118,
      POR: 27,
      BEL: 1,
      URU: 4,
      MEX: 16,
      USA: 6665,
      CAN: 100,
      JPN: 30,
      KOR: 149,
      AUS: 26,
      SEN: 73,
      MAR: 120,
      TUR: 42,
      SUI: 15,
    },
    note:
      "IDs aus offizieller api-football-Dokumentation. " +
      "Für alle 48 Nationen: GET /teams?league=1&season=2022 als Referenz nutzen.",
  };
}
