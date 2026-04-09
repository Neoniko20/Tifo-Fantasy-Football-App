import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.NEXT_PUBLIC_FOOTBALL_API_KEY || "";
const BASE = "https://v3.football.api-sports.io";

// Cache per fixture: live = 45s, finished = 1h
const cache = new Map<string, { data: any; fetchedAt: number; isLive: boolean }>();

async function afetch(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-apisports-key": API_KEY },
    next: { revalidate: 0 },
  });
  return res.json();
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fixtureId: string }> }
) {
  const { fixtureId } = await params;
  const now = Date.now();
  const cached = cache.get(fixtureId);
  const ttl = cached?.isLive ? 45_000 : 60 * 60_000;

  if (cached && (now - cached.fetchedAt) < ttl) {
    return NextResponse.json(cached.data);
  }

  try {
    // Fetch fixture details + lineups + events + statistics in parallel
    const [detailRes, lineupRes, eventsRes, statsRes] = await Promise.all([
      afetch(`/fixtures?id=${fixtureId}`),
      afetch(`/fixtures/lineups?fixture=${fixtureId}`),
      afetch(`/fixtures/events?fixture=${fixtureId}`),
      afetch(`/fixtures/statistics?fixture=${fixtureId}`),
    ]);

    const fixture = detailRes.response?.[0];
    if (!fixture) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const statusShort = fixture.fixture.status.short;
    const isLive = ["1H","2H","HT","ET","P","BT","INT"].includes(statusShort);
    const isFinished = ["FT","AET","PEN","AWD"].includes(statusShort);

    // Process lineups
    const lineups = (lineupRes.response || []).map((team: any) => ({
      teamId: team.team.id,
      teamName: team.team.name,
      teamLogo: team.team.logo,
      formation: team.formation,
      startXI: (team.startXI || []).map((p: any) => ({
        id: p.player.id,
        name: p.player.name,
        number: p.player.number,
        pos: p.player.pos,
        grid: p.player.grid,
      })),
      substitutes: (team.substitutes || []).map((p: any) => ({
        id: p.player.id,
        name: p.player.name,
        number: p.player.number,
        pos: p.player.pos,
      })),
      coach: team.coach?.name,
    }));

    // Process events (goals, cards, subs)
    const events = (eventsRes.response || []).map((e: any) => ({
      time: e.time.elapsed,
      extra: e.time.extra,
      teamId: e.team.id,
      teamName: e.team.name,
      type: e.type,       // Goal, Card, subst, Var
      detail: e.detail,   // Normal Goal, Yellow Card, etc.
      playerName: e.player.name,
      playerId: e.player.id,
      assistName: e.assist?.name,
      assistId: e.assist?.id,
    }));

    // Process team statistics
    const statistics = (statsRes.response || []).map((team: any) => ({
      teamId: team.team.id,
      teamName: team.team.name,
      stats: Object.fromEntries(
        (team.statistics || []).map((s: any) => [s.type, s.value])
      ),
    }));

    const payload = {
      id: fixture.fixture.id,
      date: fixture.fixture.date,
      venue: fixture.fixture.venue?.name,
      status: statusShort,
      statusLong: fixture.fixture.status.long,
      elapsed: fixture.fixture.status.elapsed,
      isLive,
      isFinished,
      league: {
        id: fixture.league.id,
        name: fixture.league.name,
        logo: fixture.league.logo,
        round: fixture.league.round,
      },
      home: {
        id: fixture.teams.home.id,
        name: fixture.teams.home.name,
        logo: fixture.teams.home.logo,
        winner: fixture.teams.home.winner,
      },
      away: {
        id: fixture.teams.away.id,
        name: fixture.teams.away.name,
        logo: fixture.teams.away.logo,
        winner: fixture.teams.away.winner,
      },
      goals: { home: fixture.goals.home, away: fixture.goals.away },
      score: fixture.score,
      lineups,
      events,
      statistics,
    };

    cache.set(fixtureId, { data: payload, fetchedAt: now, isLive });
    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
