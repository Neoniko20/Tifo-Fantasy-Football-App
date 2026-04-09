import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const AFOOT_BASE = "https://v3.football.api-sports.io";
const AFOOT_SEASON = 2026;

const AFOOT_LEAGUE_IDS: Record<string, number> = {
  bundesliga: 78,
  premier:    39,
  seriea:     135,
  ligue1:     61,
  laliga:     140,
};

function calcPoints(
  stats: Record<string, any>,
  position: string,
  isCaptain: boolean,
): number {
  let p = 0;
  const goals   = stats.goals   || 0;
  const assists  = stats.assists  || 0;
  const minutes  = stats.minutes  || 0;
  const shotsOn  = stats.shots_on || 0;
  const keyPass  = stats.key_passes || 0;
  const passAcc  = stats.pass_accuracy || 0;
  const dribbles = stats.dribbles || 0;
  const tackles  = stats.tackles  || 0;
  const intercep = stats.interceptions || 0;
  const saves    = stats.saves    || 0;
  const yellow   = stats.yellow_cards || 0;
  const red      = stats.red_cards    || 0;
  const cs       = stats.clean_sheet  || false;

  if      (position === "GK" || position === "DF") p += goals * 6;
  else if (position === "MF")                       p += goals * 5;
  else                                              p += goals * 4;

  p += assists * 3;
  if (cs) {
    if      (position === "GK" || position === "DF") p += 4;
    else if (position === "MF")                       p += 1;
  }
  if (position === "GK") p += saves * 1.5;
  p += shotsOn  * 0.5;
  p += keyPass  * 0.8;
  p += (passAcc / 100) * 0.5;
  p += dribbles * 0.2;
  p += tackles  * 0.6;
  p += intercep * 0.6;
  p -= yellow   * 1;
  p -= red      * 3;
  if      (minutes >= 60) p += 1;
  else if (minutes  >  0) p += 0.4;

  const base = Math.round(p * 10) / 10;
  return isCaptain ? base * 2 : base;
}

async function afootFetch(path: string, apiKey: string) {
  const res = await fetch(`${AFOOT_BASE}${path}`, {
    headers: {
      "x-rapidapi-key":  apiKey,
      "x-rapidapi-host": "v3.football.api-sports.io",
    },
  });
  if (!res.ok) throw new Error(`api-football ${path} → ${res.status}`);
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    const { leagueId, gameweek } = await req.json();
    if (!leagueId || !gameweek) {
      return NextResponse.json({ error: "leagueId und gameweek erforderlich" }, { status: 400 });
    }

    const apiKey = process.env.NEXT_PUBLIC_FOOTBALL_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "API-Key fehlt" }, { status: 500 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    // ── 1. Spieltag-Info laden ────────────────────────────────────────────
    const { data: gw } = await supabase
      .from("liga_gameweeks")
      .select("*")
      .eq("league_id", leagueId)
      .eq("gameweek", gameweek)
      .single();

    if (!gw?.start_date || !gw?.end_date) {
      return NextResponse.json({ error: "Spieltag hat kein Datum" }, { status: 400 });
    }

    const activeLgs: string[] = gw.active_leagues || [];
    if (activeLgs.length === 0) {
      return NextResponse.json({ message: "Länderspielpause – keine Spiele zu importieren" });
    }

    // ── 2. Teams + Lineups + Spieler dieses Fantasy-GW ────────────────────
    const { data: teams } = await supabase
      .from("teams").select("id").eq("league_id", leagueId);
    const teamIds: string[] = (teams || []).map((t: any) => t.id);

    // Lineups für diesen GW (starting_xi, captain_id)
    const { data: lineups } = await supabase
      .from("liga_lineups")
      .select("team_id, starting_xi, captain_id")
      .eq("league_id", leagueId)
      .eq("gameweek", gameweek)
      .in("team_id", teamIds);

    // Map: playerId → [ { teamId, isCaptain } ]
    const playerTeamMap: Record<number, { teamId: string; isCaptain: boolean }[]> = {};
    for (const lu of (lineups || [])) {
      const xi: number[] = lu.starting_xi || [];
      for (const pid of xi) {
        if (!playerTeamMap[pid]) playerTeamMap[pid] = [];
        playerTeamMap[pid].push({ teamId: lu.team_id, isCaptain: pid === lu.captain_id });
      }
    }

    const relevantPlayerIds = Object.keys(playerTeamMap).map(Number);
    if (relevantPlayerIds.length === 0) {
      return NextResponse.json({ message: "Keine Lineups für diesen Spieltag gefunden" });
    }

    // Spieler-Info (Position)
    const { data: playerRows } = await supabase
      .from("players")
      .select("id, position")
      .in("id", relevantPlayerIds);
    const playerPositionMap: Record<number, string> = {};
    for (const p of (playerRows || [])) playerPositionMap[p.id] = p.position;

    // ── 3. Fixtures von api-football holen ───────────────────────────────
    // Aggregierte Stats pro Spieler (für Doppelspieltage)
    type StatAgg = {
      goals: number; assists: number; minutes: number; shots_on: number;
      key_passes: number; pass_accuracy_sum: number; pass_accuracy_count: number;
      dribbles: number; tackles: number; interceptions: number;
      saves: number; yellow_cards: number; red_cards: number; clean_sheet: boolean;
    };
    const playerStats: Record<number, StatAgg> = {};

    let apiCallsUsed = 0;

    for (const lgKey of activeLgs) {
      const lgId = AFOOT_LEAGUE_IDS[lgKey];
      if (!lgId) continue;

      // Fixtures im Datumsfenster
      const fixturesJson = await afootFetch(
        `/fixtures?league=${lgId}&season=${AFOOT_SEASON}&from=${gw.start_date}&to=${gw.end_date}`,
        apiKey,
      );
      apiCallsUsed++;

      const fixtures: any[] = fixturesJson.response || [];

      for (const fix of fixtures) {
        const fixtureId = fix.fixture.id;
        // Nur abgeschlossene Spiele importieren
        if (!["FT", "AET", "PEN"].includes(fix.fixture.status.short)) continue;

        const homeTeamId: number = fix.teams.home.id;
        const awayTeamId: number = fix.teams.away.id;
        const homeGoals: number  = fix.goals.home ?? 0;
        const awayGoals: number  = fix.goals.away ?? 0;

        // Spieler-Stats für dieses Fixture
        const statsJson = await afootFetch(`/fixtures/players?fixture=${fixtureId}`, apiKey);
        apiCallsUsed++;

        const teams: any[] = statsJson.response || [];
        for (const teamData of teams) {
          const isHome  = teamData.team.id === homeTeamId;
          const goalsConceded = isHome ? awayGoals : homeGoals;

          for (const playerEntry of teamData.players || []) {
            const pid: number = playerEntry.player.id;
            if (!relevantPlayerIds.includes(pid)) continue; // nicht in unserem Pool

            const s = playerEntry.statistics?.[0];
            if (!s) continue;

            const mins = s.games?.minutes || 0;
            const cs   = goalsConceded === 0 && mins >= 60;

            if (!playerStats[pid]) {
              playerStats[pid] = {
                goals: 0, assists: 0, minutes: 0, shots_on: 0,
                key_passes: 0, pass_accuracy_sum: 0, pass_accuracy_count: 0,
                dribbles: 0, tackles: 0, interceptions: 0,
                saves: 0, yellow_cards: 0, red_cards: 0, clean_sheet: false,
              };
            }
            const agg = playerStats[pid];
            agg.goals        += s.goals?.total       || 0;
            agg.assists      += s.goals?.assists      || 0;
            agg.minutes      += mins;
            agg.shots_on     += s.shots?.on           || 0;
            agg.key_passes   += s.passes?.key         || 0;
            const acc = parseFloat(s.passes?.accuracy) || 0;
            if (acc > 0) { agg.pass_accuracy_sum += acc; agg.pass_accuracy_count++; }
            agg.dribbles     += s.dribbles?.success   || 0;
            agg.tackles      += s.tackles?.total      || 0;
            agg.interceptions+= s.tackles?.interceptions || 0;
            agg.saves        += s.goals?.saves        || 0;
            agg.yellow_cards += s.cards?.yellow       || 0;
            agg.red_cards    += s.cards?.red          || 0;
            if (cs) agg.clean_sheet = true;
          }
        }
      }
    }

    // ── 4. Punkte berechnen & speichern ──────────────────────────────────
    const teamGWPoints: Record<string, number> = {};

    for (const [pidStr, agg] of Object.entries(playerStats)) {
      const pid      = Number(pidStr);
      const position = playerPositionMap[pid] || "MF";
      const passAcc  = agg.pass_accuracy_count > 0
        ? agg.pass_accuracy_sum / agg.pass_accuracy_count
        : 0;

      const statsFlat = {
        goals: agg.goals, assists: agg.assists, minutes: agg.minutes,
        shots_on: agg.shots_on, key_passes: agg.key_passes,
        pass_accuracy: passAcc, dribbles: agg.dribbles,
        tackles: agg.tackles, interceptions: agg.interceptions,
        saves: agg.saves, yellow_cards: agg.yellow_cards,
        red_cards: agg.red_cards, clean_sheet: agg.clean_sheet,
      };

      const teams = playerTeamMap[pid] || [];
      for (const { teamId, isCaptain } of teams) {
        const pts = calcPoints(statsFlat, position, isCaptain);

        await supabase.from("liga_gameweek_points").upsert({
          team_id:    teamId,
          league_id:  leagueId,
          player_id:  pid,
          gameweek,
          points:     pts,
          is_captain: isCaptain,
          ...statsFlat,
        }, { onConflict: "team_id,player_id,gameweek" });

        teamGWPoints[teamId] = (teamGWPoints[teamId] || 0) + pts;
      }
    }

    // ── 5. Team-Gesamtpunkte aktualisieren ────────────────────────────────
    for (const teamId of teamIds) {
      const { data: allPts } = await supabase
        .from("liga_gameweek_points")
        .select("points")
        .eq("team_id", teamId);
      const total = (allPts || []).reduce((s: number, r: any) => s + (r.points || 0), 0);
      await supabase.from("teams")
        .update({ total_points: Math.round(total * 10) / 10 })
        .eq("id", teamId);
    }

    // ── 6. GW-Status auf "finished" setzen ───────────────────────────────
    await supabase.from("liga_gameweeks")
      .update({ status: "finished" })
      .eq("league_id", leagueId)
      .eq("gameweek", gameweek);

    return NextResponse.json({
      ok: true,
      apiCallsUsed,
      playersImported: Object.keys(playerStats).length,
      message: `GW${gameweek} importiert — ${Object.keys(playerStats).length} Spieler, ${apiCallsUsed} API-Calls`,
    });

  } catch (err: any) {
    console.error("import-gw-stats error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
