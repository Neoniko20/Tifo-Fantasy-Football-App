import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BASE   = "https://v3.football.api-sports.io";
const SEASON = 2024; // 2024/25 season

const LEAGUES: { key: string; id: number; name: string }[] = [
  { key: "bundesliga", id: 78,  name: "Bundesliga"     },
  { key: "premier",    id: 39,  name: "Premier League" },
  { key: "laliga",     id: 140, name: "La Liga"        },
  { key: "seriea",     id: 135, name: "Serie A"        },
  { key: "ligue1",     id: 61,  name: "Ligue 1"        },
];

const POS_MAP: Record<string, string> = {
  Goalkeeper: "GK",
  Defender:   "DF",
  Midfielder: "MF",
  Attacker:   "FW",
};

function calcSeasonFpts(stats: Record<string, any>, position: string): number {
  let p = 0;
  const { goals = 0, assists = 0, minutes = 0, shots_on = 0, key_passes = 0,
          dribbles = 0, tackles = 0, interceptions = 0, saves = 0,
          yellow_cards = 0, red_cards = 0, clean_sheets = 0, appearances = 0 } = stats;

  if      (position === "GK" || position === "DF") p += goals * 6;
  else if (position === "MF")                       p += goals * 5;
  else                                              p += goals * 4;

  p += assists      * 3;
  p += clean_sheets * (position === "GK" || position === "DF" ? 4 : position === "MF" ? 1 : 0);
  p += saves        * (position === "GK" ? 1.5 : 0);
  p += shots_on     * 0.5;
  p += key_passes   * 0.8;
  p += dribbles     * 0.2;
  p += tackles      * 0.6;
  p += interceptions* 0.6;
  p -= yellow_cards * 1;
  p -= red_cards    * 3;
  p += appearances  * 0.8; // ~70min avg playing time bonus

  return Math.round(p * 10) / 10;
}

async function apiGet(path: string, apiKey: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "x-rapidapi-key":  apiKey,
      "x-rapidapi-host": "v3.football.api-sports.io",
    },
  });
  if (!res.ok) throw new Error(`api-sports ${path} → ${res.status}`);
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length > 0) {
    const errMsg = JSON.stringify(json.errors);
    if (errMsg.includes("rateLimit")) throw new Error("RATE_LIMIT");
    throw new Error(`API error: ${errMsg}`);
  }
  return json;
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── GET: status per league (pages done, total pages, player count) ───────────
export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  // Read saved progress
  const { data: progress } = await supabase
    .from("import_progress")
    .select("*");
  const progressMap: Record<string, any> = {};
  for (const row of progress || []) progressMap[row.league_key] = row;

  // Player counts per league via team name matching
  const counts: Record<string, number> = {};
  for (const lg of LEAGUES) {
    const { count } = await supabase
      .from("players")
      .select("*", { count: "exact", head: true });
    counts[lg.key] = count || 0;
    break; // only total needed for now
  }
  const { count: totalCount } = await supabase
    .from("players")
    .select("*", { count: "exact", head: true });

  return NextResponse.json({
    totalPlayers: totalCount,
    season: SEASON,
    leagues: LEAGUES.map(l => ({
      ...l,
      pagesDone:  progressMap[l.key]?.pages_done  || 0,
      totalPages: progressMap[l.key]?.total_pages  || null,
      done:       progressMap[l.key]?.done         || false,
      lastRun:    progressMap[l.key]?.updated_at   || null,
    })),
  });
}

// ─── POST: run import (resumes from last saved page) ──────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    // league: specific league key or "all"
    // maxCalls: limit API calls this run (default 90 to stay safe)
    const leagueFilter: string       = body.league   || "all";
    const maxCalls: number           = body.maxCalls || 90;
    const forceRestart: boolean      = body.restart  || false;

    const apiKey = process.env.NEXT_PUBLIC_FOOTBALL_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "API-Key fehlt" }, { status: 500 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const leaguesToProcess = leagueFilter === "all"
      ? LEAGUES
      : LEAGUES.filter(l => l.key === leagueFilter);

    // Load existing progress (table may not exist yet — fail gracefully)
    const { data: progressRows, error: progressErr } = await supabase
      .from("import_progress")
      .select("*")
      .in("league_key", leaguesToProcess.map(l => l.key));
    const hasProgressTable = !progressErr;
    const progressMap: Record<string, any> = {};
    for (const row of progressRows || []) progressMap[row.league_key] = row;

    let totalApiCalls  = 0;
    let totalUpserted  = 0;
    const summary: { league: string; pagesImported: number; players: number; done: boolean; remaining?: number }[] = [];
    let hitLimit = false;

    for (const league of leaguesToProcess) {
      if (hitLimit) break;

      const prev = progressMap[league.key];
      if (prev?.done && !forceRestart) {
        summary.push({ league: league.name, pagesImported: 0, players: 0, done: true });
        continue;
      }

      const startPage = forceRestart ? 1 : ((prev?.pages_done || 0) + 1);
      let   page      = startPage;
      let   totalPages= prev?.total_pages || 999;
      let   leagueUpserted = 0;
      let   leaguePages    = 0;

      while (page <= totalPages) {
        if (totalApiCalls >= maxCalls) { hitLimit = true; break; }

        let json: any;
        try {
          json = await apiGet(
            `/players?league=${league.id}&season=${SEASON}&page=${page}`,
            apiKey,
          );
        } catch (err: any) {
          if (err.message === "RATE_LIMIT") { hitLimit = true; break; }
          throw err;
        }
        totalApiCalls++;
        totalPages = json.paging?.total || totalPages;

        const players: any[] = json.response || [];
        const rows = players
          .map((entry: any) => {
            const player = entry.player;
            const stats  = entry.statistics?.[0];
            if (!stats) return null;

            const posRaw   = stats.games?.position || "";
            const position = POS_MAP[posRaw] || null;
            if (!position) return null;

            const goals         = stats.goals?.total           || 0;
            const assists       = stats.goals?.assists          || 0;
            const appearances   = stats.games?.appearences      || 0;
            const minutes       = stats.games?.minutes           || 0;
            const shots_on      = stats.shots?.on                || 0;
            const key_passes    = stats.passes?.key              || 0;
            const dribbles      = stats.dribbles?.success        || 0;
            const tackles       = stats.tackles?.total           || 0;
            const interceptions = stats.tackles?.interceptions    || 0;
            const saves         = stats.goals?.saves             || 0;
            const yellow_cards  = stats.cards?.yellow            || 0;
            const red_cards     = stats.cards?.red               || 0;
            const rating        = parseFloat(stats.games?.rating) || 0;
            // Clean sheets: api doesn't give per-player CS directly; approximate from conceded
            const clean_sheets  = stats.goals?.conceded === 0 ? appearances : 0;

            const fpts = calcSeasonFpts({
              goals, assists, minutes, shots_on, key_passes, dribbles,
              tackles, interceptions, saves, yellow_cards, red_cards,
              clean_sheets, appearances,
            }, position);

            return {
              id:          player.id,
              name:        player.name,
              photo_url:   player.photo  || null,
              position,
              team_name:   stats.team?.name || null,
              api_team_id: stats.team?.id   || null,
              nationality: player.nationality || null,
              rating:      rating > 0 ? rating : null,
              fpts,
              goals,
              assists,
            };
          })
          .filter(Boolean);

        if (rows.length > 0) {
          const { error } = await supabase.from("players").upsert(rows, { onConflict: "id" });
          if (!error) { leagueUpserted += rows.length; totalUpserted += rows.length; }
          else console.error(`Upsert error page ${page} ${league.key}:`, error.message);
        }

        leaguePages++;
        page++;

        // Save progress after each page (skip if table doesn't exist)
        if (hasProgressTable) {
          await supabase.from("import_progress").upsert({
            league_key:  league.key,
            pages_done:  page - 1,
            total_pages: totalPages,
            done:        page > totalPages,
            updated_at:  new Date().toISOString(),
          }, { onConflict: "league_key" });
        }

        if (page <= totalPages && !hitLimit) await delay(2200); // respect rate limit
      }

      const done = page > totalPages;
      summary.push({
        league:         league.name,
        pagesImported:  leaguePages,
        players:        leagueUpserted,
        done,
        remaining:      done ? 0 : totalPages - (page - 1),
      });
    }

    const incomplete = summary.filter(s => !s.done && (s.remaining || 0) > 0);
    return NextResponse.json({
      ok:           true,
      totalUpserted,
      totalApiCalls,
      hitDailyLimit: hitLimit,
      summary,
      message: hitLimit
        ? `Tageslimit erreicht nach ${totalApiCalls} Calls — ${totalUpserted} Spieler importiert. Morgen weitermachen!`
        : `Fertig! ${totalUpserted} Spieler in ${totalApiCalls} Calls importiert.`,
      remainingLeagues: incomplete.map(s => `${s.league} (noch ${s.remaining} Seiten)`),
      needsProgressTable: !hasProgressTable,
    });

  } catch (err: any) {
    console.error("import-players error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
