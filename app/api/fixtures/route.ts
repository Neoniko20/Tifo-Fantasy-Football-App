import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.NEXT_PUBLIC_FOOTBALL_API_KEY || "";
const BASE = "https://v3.football.api-sports.io";
const LEAGUE_IDS = [78, 39, 140, 135, 61];

const LEAGUE_META: Record<number, { name: string; flag: string }> = {
  78:  { name: "Bundesliga",     flag: "🇩🇪" },
  39:  { name: "Premier League", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  140: { name: "La Liga",        flag: "🇪🇸" },
  135: { name: "Serie A",        flag: "🇮🇹" },
  61:  { name: "Ligue 1",        flag: "🇫🇷" },
};

// In-memory cache: 60s for live, 5min for finished, 10min for scheduled
let cache: { data: any; fetchedAt: number; hasLive: boolean } | null = null;

function ttl(hasLive: boolean) {
  return hasLive ? 60_000 : 5 * 60_000;
}

async function afetch(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-apisports-key": API_KEY },
    next: { revalidate: 0 },
  });
  return res.json();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date"); // YYYY-MM-DD
  const forceRefresh = searchParams.get("refresh") === "1";

  // Use today in CET if no date given
  const today = dateParam || new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

  const now = Date.now();
  if (!forceRefresh && cache && cache.fetchedAt && (now - cache.fetchedAt) < ttl(cache.hasLive)) {
    return NextResponse.json(cache.data);
  }

  try {
    // Fetch all 5 leagues for the date in parallel
    const results = await Promise.all(
      LEAGUE_IDS.map(lid =>
        afetch(`/fixtures?league=${lid}&season=2024&date=${today}`)
          .then(d => ({ lid, fixtures: d.response || [] }))
          .catch(() => ({ lid, fixtures: [] }))
      )
    );

    let hasLive = false;
    const grouped: any[] = [];

    for (const { lid, fixtures } of results) {
      if (fixtures.length === 0) continue;

      const mapped = fixtures.map((f: any) => {
        const status = f.fixture.status.short; // NS, 1H, HT, 2H, ET, P, FT, AET, PEN, SUSP, INT, PST, CANC, ABD, AWD, WO
        const isLive = ["1H","2H","HT","ET","P","BT","INT"].includes(status);
        const isFinished = ["FT","AET","PEN","AWD"].includes(status);
        if (isLive) hasLive = true;
        return {
          id: f.fixture.id,
          date: f.fixture.date,
          status,
          statusLong: f.fixture.status.long,
          elapsed: f.fixture.status.elapsed,
          home: {
            id: f.teams.home.id,
            name: f.teams.home.name,
            logo: f.teams.home.logo,
            winner: f.teams.home.winner,
          },
          away: {
            id: f.teams.away.id,
            name: f.teams.away.name,
            logo: f.teams.away.logo,
            winner: f.teams.away.winner,
          },
          goals: {
            home: f.goals.home,
            away: f.goals.away,
          },
          score: {
            halftime: f.score.halftime,
            fulltime: f.score.fulltime,
          },
          isLive,
          isFinished,
          venue: f.fixture.venue?.name,
        };
      });

      // Sort: live first, then by kick-off time
      mapped.sort((a: any, b: any) => {
        if (a.isLive && !b.isLive) return -1;
        if (!a.isLive && b.isLive) return 1;
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });

      grouped.push({
        leagueId: lid,
        ...LEAGUE_META[lid],
        fixtures: mapped,
      });
    }

    // Sort leagues: leagues with live games first, then leagues with any games
    grouped.sort((a, b) => {
      const aLive = a.fixtures.some((f: any) => f.isLive) ? 0 : 1;
      const bLive = b.fixtures.some((f: any) => f.isLive) ? 0 : 1;
      return aLive - bLive;
    });

    const payload = { date: today, groups: grouped, hasLive, fetchedAt: now };
    cache = { data: payload, fetchedAt: now, hasLive };

    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({ error: e.message, groups: [], date: today }, { status: 500 });
  }
}
