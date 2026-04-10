import { createServiceRoleClient } from "@/lib/supabase-server";
import { rotatePriority } from "./waiver-init";

const supabaseServer = createServiceRoleClient();

interface ProcessResult {
  leagueId: string;
  gameweek: number;
  approved: number;
  rejected: number;
  errors: string[];
}

/**
 * Process pending waiver claims for one league and gameweek.
 *
 * Sort order:
 *   1. If waiver_budget_enabled → highest bid wins (tiebreak: earliest created_at)
 *   2. Else → lowest priority number wins
 */
export async function processWaivers(leagueId: string, gameweek: number): Promise<ProcessResult> {
  const result: ProcessResult = { leagueId, gameweek, approved: 0, rejected: 0, errors: [] };

  const { data: settings } = await supabaseServer
    .from("liga_settings").select("*").eq("league_id", leagueId).maybeSingle();
  if (!settings || !settings.waiver_enabled) {
    result.errors.push("waivers not enabled");
    return result;
  }

  const budgetMode = !!settings.waiver_budget_enabled;

  const { data: claims } = await supabaseServer
    .from("waiver_claims")
    .select("*")
    .eq("league_id", leagueId)
    .eq("gameweek", gameweek)
    .eq("status", "pending");

  if (!claims || claims.length === 0) {
    await rotatePriority(leagueId, gameweek);
    return result;
  }

  const sorted = claims.slice().sort((a: any, b: any) => {
    if (budgetMode) {
      if (a.bid_amount !== b.bid_amount) return b.bid_amount - a.bid_amount;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    if (a.priority !== b.priority) return a.priority - b.priority;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const takenPlayerIds = new Set<number>();

  for (const claim of sorted) {
    const { id, team_id, player_in, player_out, bid_amount } = claim as any;

    if (takenPlayerIds.has(player_in)) {
      await supabaseServer.from("waiver_claims")
        .update({ status: "rejected", rejected_reason: "player taken by higher priority claim", processed_at: new Date().toISOString() })
        .eq("id", id);
      result.rejected++;
      continue;
    }

    // Roster check
    const { count: squadSize } = await supabaseServer
      .from("draft_picks")
      .select("id", { count: "exact", head: true })
      .eq("team_id", team_id);
    const maxSquad = settings.squad_size || 15;
    if (!player_out && (squadSize ?? 0) >= maxSquad) {
      await supabaseServer.from("waiver_claims")
        .update({ status: "rejected", rejected_reason: "roster full, must drop a player", processed_at: new Date().toISOString() })
        .eq("id", id);
      result.rejected++;
      continue;
    }

    // FAAB check
    if (budgetMode) {
      const { data: team } = await supabaseServer
        .from("teams").select("faab_budget").eq("id", team_id).single();
      const budget = Number((team as any)?.faab_budget ?? settings.waiver_budget_starting ?? 100);
      if (budget < bid_amount) {
        await supabaseServer.from("waiver_claims")
          .update({ status: "rejected", rejected_reason: "insufficient FAAB budget", processed_at: new Date().toISOString() })
          .eq("id", id);
        result.rejected++;
        continue;
      }
    }

    // Execute swap
    if (player_out) {
      await supabaseServer.from("draft_picks")
        .delete().eq("team_id", team_id).eq("player_id", player_out);
      await supabaseServer.from("waiver_wire").upsert({
        league_id: leagueId, player_id: player_out, status: "available", available_from_gameweek: gameweek + 1,
      }, { onConflict: "league_id,player_id" });
    }

    const { data: maxPick } = await supabaseServer.from("draft_picks")
      .select("pick_number").eq("team_id", team_id).order("pick_number", { ascending: false }).limit(1).maybeSingle();
    const nextPickNum = ((maxPick as any)?.pick_number ?? 0) + 1;
    await supabaseServer.from("draft_picks").insert({
      team_id,
      player_id: player_in,
      pick_number: nextPickNum,
      round: 99,
    });

    await supabaseServer.from("waiver_wire")
      .update({ status: "claimed" })
      .eq("league_id", leagueId).eq("player_id", player_in);

    if (budgetMode) {
      const { data: team } = await supabaseServer
        .from("teams").select("faab_budget").eq("id", team_id).single();
      const remaining = Number((team as any)?.faab_budget ?? settings.waiver_budget_starting ?? 100) - bid_amount;
      await supabaseServer.from("teams").update({ faab_budget: remaining }).eq("id", team_id);
    }

    await supabaseServer.from("waiver_claims")
      .update({ status: "approved", processed_at: new Date().toISOString() })
      .eq("id", id);

    takenPlayerIds.add(player_in);
    result.approved++;
  }

  await rotatePriority(leagueId, gameweek);

  await supabaseServer.from("liga_admin_audit_log").insert({
    league_id: leagueId,
    actor_id:  null,
    actor_label: "cron",
    action: "waivers_processed",
    gameweek,
    metadata: { approved: result.approved, rejected: result.rejected },
  });

  return result;
}
