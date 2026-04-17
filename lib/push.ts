import webpush from 'web-push';
import { createServiceRoleClient } from '@/lib/supabase-server';

export type PushEvent =
  | 'waiver_approved' | 'waiver_rejected'
  | 'trade_accepted'  | 'trade_rejected'
  | 'gw_started'      | 'gw_finished'
  | 'draft_your_turn' | 'draft_pick_made'
  | 'chat_message'
  | 'live_goal'       | 'live_assist';

export type PushPayload = {
  title: string;
  body: string;
  link: string;
  icon?: string;
};

const DEFAULT_GLOBAL = {
  push_enabled: true,
  gw_start: true,
  gw_end: true,
  draft_your_turn: true,
  draft_pick_made: false,
};

const DEFAULT_LEAGUE = {
  enabled: true,
  waiver_results: true,
  trade_results: true,
  chat_messages: true,
  live_goals: false,
};

/**
 * Sends a push notification to all active subscriptions for a user.
 * Checks user + league prefs before sending.
 * Auto-deletes expired subscriptions (HTTP 410/404 from push service).
 */
export async function sendPush(
  userId: string,
  event: PushEvent,
  payload: PushPayload,
  leagueId?: string,
): Promise<void> {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  const supabase = createServiceRoleClient();

  // Check global prefs
  const { data: globalRow } = await supabase
    .from('user_notification_prefs')
    .select('prefs')
    .eq('user_id', userId)
    .maybeSingle();

  const gp = { ...DEFAULT_GLOBAL, ...(globalRow?.prefs ?? {}) };
  if (!gp.push_enabled) return;

  if (event === 'gw_started'      && !gp.gw_start)       return;
  if (event === 'gw_finished'     && !gp.gw_end)          return;
  if (event === 'draft_your_turn' && !gp.draft_your_turn) return;
  if (event === 'draft_pick_made' && !gp.draft_pick_made) return;

  // Check league prefs
  if (leagueId) {
    const { data: leagueRow } = await supabase
      .from('league_notification_prefs')
      .select('prefs')
      .eq('user_id', userId)
      .eq('league_id', leagueId)
      .maybeSingle();

    const lp = { ...DEFAULT_LEAGUE, ...(leagueRow?.prefs ?? {}) };
    if (!lp.enabled) return;
    if (event === 'waiver_approved' && !lp.waiver_results) return;
    if (event === 'waiver_rejected' && !lp.waiver_results) return;
    if (event === 'trade_accepted'  && !lp.trade_results)  return;
    if (event === 'trade_rejected'  && !lp.trade_results)  return;
    if (event === 'chat_message'    && !lp.chat_messages)  return;
    if ((event === 'live_goal' || event === 'live_assist') && !lp.live_goals) return;
  }

  // Load all subscriptions for this user
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (!subs || subs.length === 0) return;

  const expiredIds: string[] = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          expiredIds.push(sub.id);
        }
      }
    })
  );

  if (expiredIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', expiredIds);
  }
}

/**
 * Sends a push notification to all users in a league.
 * Each user's own prefs are checked individually inside sendPush().
 */
export async function sendPushToLeague(
  leagueId: string,
  event: PushEvent,
  payload: PushPayload,
  excludeUserId?: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data: teams } = await supabase
    .from('teams')
    .select('user_id')
    .eq('league_id', leagueId);

  const userIds = (teams ?? [])
    .map((t: any) => t.user_id as string)
    .filter((id) => id && id !== excludeUserId);

  await Promise.allSettled(
    userIds.map((userId) => sendPush(userId, event, payload, leagueId))
  );
}
