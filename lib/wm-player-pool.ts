// ═══════════════════════════════════════════════════════════════════
// TIFO — WM PLAYER POOL UTILITIES
// Replaces all .gte("id",90001).lte("id",90200) test-mode checks.
// Single source of truth for player pool scoping by tournament type.
// ═══════════════════════════════════════════════════════════════════

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns whether a tournament uses test players.
 *
 * Replaces: supabase.from("players").select("id").gte("id",90001).lte("id",90120).limit(1)
 *
 * Test tournament  → true  → pool: players WHERE is_test_player = true
 * Real tournament  → false → pool: players WHERE is_test_player = false
 */
export async function isTestTournament(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("wm_tournaments")
    .select("is_test_tournament")
    .eq("id", tournamentId)
    .single();
  return data?.is_test_tournament ?? false;
}

/**
 * Returns the player pool for a WM tournament filtered by tournament type.
 *
 * - Test tournament  → only players WHERE is_test_player = true
 * - Real tournament  → only players WHERE is_test_player = false
 *
 * Replaces: if (hasTestPlayers) query.gte("id",90001).lte("id",90200).in("team_name", ...)
 *
 * @param nationNames  Optional array of nation names to filter by (team_name).
 *                     Pass undefined or [] to skip nation filter.
 * @param options.select  Optional Supabase select string. Defaults to "*".
 */
export async function getWmPlayerPool(
  supabase: SupabaseClient,
  tournamentId: string,
  options: {
    nationNames?: string[];
    position?: string;
    select?: string;
    orderBy?: { column: string; ascending: boolean };
    limit?: number;
  } = {},
): Promise<Array<Record<string, unknown>>> {
  const testFlag = await isTestTournament(supabase, tournamentId);

  let query = supabase
    .from("players")
    .select(options.select ?? "*")
    .eq("is_test_player", testFlag);

  if (options.nationNames && options.nationNames.length > 0) {
    query = query.in("team_name", options.nationNames);
  }
  if (options.position) {
    query = query.eq("position", options.position);
  }

  const col = options.orderBy?.column ?? "fpts";
  const asc = options.orderBy?.ascending ?? false;
  query = query.order(col, { ascending: asc, nullsFirst: false });

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data } = await query;
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}
