import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ──────────────────────────────────────────────────────────────────

export type GlobalPrefs = {
  push_enabled: boolean;
  gw_start: boolean;
  gw_end: boolean;
  draft_your_turn: boolean;
  draft_pick_made: boolean;
};

export type LeaguePrefs = {
  enabled: boolean;
  waiver_results: boolean;
  trade_results: boolean;
  chat_messages: boolean;
  live_goals: boolean;
};

export const DEFAULT_GLOBAL: GlobalPrefs = {
  push_enabled: true,
  gw_start: true,
  gw_end: true,
  draft_your_turn: true,
  draft_pick_made: false,
};

export const DEFAULT_LEAGUE: LeaguePrefs = {
  enabled: true,
  waiver_results: true,
  trade_results: true,
  chat_messages: true,
  live_goals: false,
};

// ── Client-side read/write (uses user session) ─────────────────────────────

export async function getGlobalPrefs(supabase: SupabaseClient): Promise<GlobalPrefs> {
  const { data } = await supabase
    .from('user_notification_prefs')
    .select('prefs')
    .maybeSingle();
  return { ...DEFAULT_GLOBAL, ...(data?.prefs ?? {}) };
}

export async function setGlobalPrefs(
  supabase: SupabaseClient,
  prefs: Partial<GlobalPrefs>,
): Promise<void> {
  const { data: existing } = await supabase
    .from('user_notification_prefs')
    .select('prefs')
    .maybeSingle();
  const merged = { ...DEFAULT_GLOBAL, ...(existing?.prefs ?? {}), ...prefs };
  await supabase
    .from('user_notification_prefs')
    .upsert({ prefs: merged, updated_at: new Date().toISOString() });
}

export async function getLeaguePrefs(
  supabase: SupabaseClient,
  leagueId: string,
): Promise<LeaguePrefs> {
  const { data } = await supabase
    .from('league_notification_prefs')
    .select('prefs')
    .eq('league_id', leagueId)
    .maybeSingle();
  return { ...DEFAULT_LEAGUE, ...(data?.prefs ?? {}) };
}

export async function setLeaguePrefs(
  supabase: SupabaseClient,
  leagueId: string,
  prefs: Partial<LeaguePrefs>,
): Promise<void> {
  const { data: existing } = await supabase
    .from('league_notification_prefs')
    .select('prefs')
    .eq('league_id', leagueId)
    .maybeSingle();
  const merged = { ...DEFAULT_LEAGUE, ...(existing?.prefs ?? {}), ...prefs };
  await supabase
    .from('league_notification_prefs')
    .upsert({ league_id: leagueId, prefs: merged, updated_at: new Date().toISOString() });
}
