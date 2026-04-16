import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { sendPush } from '@/lib/push';

export async function GET(req: NextRequest) {
  // CRON_SECRET auth — same pattern as other cron routes
  const authHeader = req.headers.get('authorization') || '';
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Feature flag — dormant until LIVE_PUSH_ENABLED=true
  if (process.env.LIVE_PUSH_ENABLED !== 'true') {
    return NextResponse.json({ ok: false, reason: 'disabled' });
  }

  const supabase = createServiceRoleClient();

  // Only run when a GW is active
  const { data: activeGW } = await supabase
    .from('liga_gameweeks')
    .select('id, gameweek')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!activeGW) {
    return NextResponse.json({ ok: true, skipped: 'no active gameweek' });
  }

  // Fetch live fixtures from API-Football
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'API_FOOTBALL_KEY not set' }, { status: 500 });
  }

  const res = await fetch('https://v3.football.api-sports.io/fixtures?live=all', {
    headers: { 'x-apisports-key': apiKey },
  });
  const json = await res.json() as any;
  const fixtures: any[] = json.response ?? [];

  // Collect all goal/assist events from live fixtures
  type LiveEvent = { fixtureId: number; playerId: number; type: 'goal' | 'assist' };
  const events: LiveEvent[] = [];

  for (const fixture of fixtures) {
    for (const ev of (fixture.events ?? [])) {
      if (ev.type === 'Goal' && ev.player?.id) {
        events.push({ fixtureId: fixture.fixture.id, playerId: ev.player.id, type: 'goal' });
      }
      if (ev.assist?.id) {
        events.push({ fixtureId: fixture.fixture.id, playerId: ev.assist.id, type: 'assist' });
      }
    }
  }

  if (events.length === 0) {
    return NextResponse.json({ ok: true, events: 0 });
  }

  // Check cache to avoid re-sending already-notified events
  // NOTE: live_push_cache table does not exist yet; `as any` suppresses TS errors
  const cacheKeys = events.map((e) => `${e.fixtureId}:${e.playerId}:${e.type}`);
  const { data: cached } = await (supabase as any)
    .from('live_push_cache')
    .select('cache_key')
    .in('cache_key', cacheKeys);

  const cachedSet = new Set(((cached as any[]) ?? []).map((r: any) => r.cache_key as string));
  const newEvents = events.filter((e) => !cachedSet.has(`${e.fixtureId}:${e.playerId}:${e.type}`));

  if (newEvents.length === 0) {
    return NextResponse.json({ ok: true, events: 0, reason: 'all cached' });
  }

  // Find affected team owners via liga_lineups.starting_xi (JSONB array of player_ids).
  // squad_players tracks squad ownership but has no starting-XI column; the starting XI
  // is stored in liga_lineups.starting_xi for the active gameweek.
  let notified = 0;
  for (const event of newEvents) {
    // Fetch all lineups for the active GW where this player appears in starting_xi
    const { data: lineups } = await supabase
      .from('liga_lineups')
      .select('team_id, league_id, teams(user_id)')
      .eq('gameweek', activeGW.gameweek)
      .contains('starting_xi', JSON.stringify([event.playerId]));

    for (const lineup of (lineups ?? [])) {
      const team = (lineup as any).teams;
      if (!team?.user_id || !lineup.league_id) continue;

      await sendPush(
        team.user_id,
        event.type === 'goal' ? 'live_goal' : 'live_assist',
        {
          title: event.type === 'goal' ? '⚽ Tor!' : '🎯 Assist!',
          body: `Spieler-ID ${event.playerId}`, // TODO: replace with player name when activating
          link: `/leagues/${lineup.league_id}`,
        },
        lineup.league_id,
      );
      notified++;
    }
  }

  // Cache processed events to avoid re-sending on next invocation
  // NOTE: live_push_cache table does not exist yet; create it before enabling LIVE_PUSH_ENABLED
  if (newEvents.length > 0) {
    await (supabase as any).from('live_push_cache').insert(
      newEvents.map((e) => ({ cache_key: `${e.fixtureId}:${e.playerId}:${e.type}` }))
    );
  }

  return NextResponse.json({ ok: true, events: newEvents.length, notified });
}
