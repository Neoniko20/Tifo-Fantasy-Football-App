import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { sendPush, sendPushToLeague, type PushPayload } from '@/lib/push';

type DispatchBody =
  | { event: 'trade_accepted' | 'trade_rejected'; userId: string; payload: PushPayload; leagueId: string }
  | { event: 'draft_your_turn'; userId: string; payload: PushPayload; leagueId: string }
  | { event: 'draft_pick_made'; leagueId: string; payload: PushPayload; excludeUserId?: string }
  | { event: 'gw_started' | 'gw_finished'; gwId: string; payload: PushPayload }
  | { event: 'chat_message'; leagueId: string; payload: PushPayload; excludeUserId?: string };

export async function POST(req: NextRequest) {
  // Authenticate caller via Bearer token — matches subscribe/unsubscribe pattern
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const supabaseAuth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body: DispatchBody = await req.json().catch(() => null);
  if (!body?.event) {
    return NextResponse.json({ ok: false, error: 'event required' }, { status: 400 });
  }

  try {
    switch (body.event) {
      case 'trade_accepted':
      case 'trade_rejected':
      case 'draft_your_turn':
        await sendPush(body.userId, body.event, body.payload, body.leagueId);
        break;

      case 'draft_pick_made':
      case 'chat_message':
        await sendPushToLeague(body.leagueId, body.event, body.payload, body.excludeUserId);
        break;

      case 'gw_started':
      case 'gw_finished': {
        // Look up the fantasy league that owns this gameweek row.
        // active_leagues stores real-league string keys ("bundesliga", "premier", etc.) —
        // not fantasy league UUIDs. The owning fantasy league is liga_gameweeks.league_id.
        const supabase = createServiceRoleClient();
        const { data: gw } = await supabase
          .from('liga_gameweeks')
          .select('league_id')
          .eq('id', body.gwId)
          .maybeSingle();

        if (!gw?.league_id) break;

        await sendPushToLeague(gw.league_id, body.event, body.payload);
        break;
      }

      default:
        return NextResponse.json({ ok: false, error: 'unknown event' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('[push-dispatch]', err?.message);
    return NextResponse.json({ ok: false, error: 'send failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
