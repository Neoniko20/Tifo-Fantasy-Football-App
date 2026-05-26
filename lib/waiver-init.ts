import { createServiceRoleClient } from "@/lib/supabase-server";

const supabaseServer = createServiceRoleClient();

/**
 * Rebuilds waiver_wire for a league.
 *
 * Liga mode  — excludes players in: draft_picks, squad_players, liga_ir_slots
 * WM mode    — excludes players in: wm_squad_players  (already includes draft picks)
 *
 * Mode is auto-detected from leagues.mode. No callers need to change.
 */
export async function rebuildWaiverWire(leagueId: string): Promise<{ inserted: number }> {
  const { data: teams } = await supabaseServer
    .from("teams").select("id").eq("league_id", leagueId);
  const teamIds = (teams || []).map((t: any) => t.id);
  if (teamIds.length === 0) return { inserted: 0 };

  // ── Detect league mode ────────────────────────────────────────────
  const { data: leagueRow } = await supabaseServer
    .from("leagues")
    .select("mode")
    .eq("id", leagueId)
    .single();

  const isWm = leagueRow?.mode === "wm";

  // ── Collect owned player IDs ──────────────────────────────────────
  const owned = new Set<number>();

  if (isWm) {
    // WM: a single table holds all players regardless of acquisition method
    const { data: wmSquad } = await supabaseServer
      .from("wm_squad_players")
      .select("player_id")
      .in("team_id", teamIds);
    for (const r of wmSquad || []) owned.add(r.player_id);
  } else {
    // Liga: three sources to check
    const [{ data: drafted }, { data: squads }, { data: irs }] = await Promise.all([
      supabaseServer.from("draft_picks").select("player_id").in("team_id", teamIds),
      supabaseServer.from("squad_players").select("player_id").in("team_id", teamIds),
      supabaseServer
        .from("liga_ir_slots")
        .select("player_id")
        .in("team_id", teamIds)
        .is("returned_at_gw", null),
    ]);
    for (const r of drafted  || []) owned.add(r.player_id);
    for (const r of squads   || []) owned.add(r.player_id);
    for (const r of irs      || []) owned.add(r.player_id);
  }

  // ── Build wire from all players minus owned ───────────────────────
  const { data: allPlayers } = await supabaseServer.from("players").select("id");
  const available = (allPlayers || [])
    .map((p: any) => p.id)
    .filter((id: number) => !owned.has(id));

  await supabaseServer.from("waiver_wire").delete().eq("league_id", leagueId);

  const rows = available.map((player_id: number) => ({
    league_id: leagueId,
    player_id,
    available_from_gameweek: 1,
    status: "available",
  }));

  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await supabaseServer.from("waiver_wire").insert(rows.slice(i, i + chunkSize));
  }

  return { inserted: rows.length };
}

/**
 * (Re)computes waiver priority. Weakest team = priority 1 = claims first.
 */
export async function resetWaiverPriority(leagueId: string, gameweek: number): Promise<void> {
  const { data: teams } = await supabaseServer
    .from("teams").select("id, total_points").eq("league_id", leagueId);

  const sorted = (teams || []).slice().sort((a: any, b: any) =>
    (a.total_points || 0) - (b.total_points || 0)
  );

  for (let i = 0; i < sorted.length; i++) {
    const team = sorted[i] as any;
    await supabaseServer.from("waiver_priority").upsert({
      league_id: leagueId,
      team_id:   team.id,
      priority:  i + 1,
      gameweek,
      updated_at: new Date().toISOString(),
    }, { onConflict: "league_id,team_id" });
  }
}

/**
 * Rotation: teams that successfully claimed drop to the bottom; losers move up.
 */
export async function rotatePriority(leagueId: string, gameweekJustProcessed: number): Promise<void> {
  const { data: winners } = await supabaseServer
    .from("waiver_claims")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("gameweek", gameweekJustProcessed)
    .eq("status", "approved");

  const winnerIds = new Set<string>((winners || []).map((w: any) => w.team_id));

  const { data: current } = await supabaseServer
    .from("waiver_priority")
    .select("*")
    .eq("league_id", leagueId)
    .order("priority");

  const winnersList: any[] = [];
  const losersList:  any[] = [];
  for (const row of (current || [])) {
    if (winnerIds.has(row.team_id)) winnersList.push(row);
    else losersList.push(row);
  }

  const reordered = [...losersList, ...winnersList];
  for (let i = 0; i < reordered.length; i++) {
    const row = reordered[i] as any;
    await supabaseServer.from("waiver_priority")
      .update({ priority: i + 1, gameweek: gameweekJustProcessed + 1 })
      .eq("id", row.id);
  }
}
