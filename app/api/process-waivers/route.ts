import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { rotatePriority } from "@/lib/waiver-init";

const supabase = createServiceRoleClient();

// ─── Types ────────────────────────────────────────────────────────────────────

type Claim = {
  id: string;
  league_id: string;
  team_id: string;
  player_in: number;
  player_out: number | null;
  gameweek: number;
  priority: number;
  claim_order: number;
  bid_amount: number;
};

type Settings = {
  waiver_budget_enabled: boolean;
  waiver_budget_starting: number;
  squad_size: number;
};

type ProcessResult = {
  approved: number;
  rejected: number;
  log: string[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getTeamFaab(teamId: string, startingBudget: number): Promise<number> {
  const { data } = await supabase.from("teams").select("faab_budget").eq("id", teamId).single();
  return data?.faab_budget ?? startingBudget;
}

async function getSquadSize(teamId: string): Promise<number> {
  const [{ data: sq }, { data: dp }] = await Promise.all([
    supabase.from("squad_players").select("player_id", { count: "exact" }).eq("team_id", teamId),
    supabase.from("draft_picks").select("player_id", { count: "exact" }).eq("team_id", teamId),
  ]);
  // Use whichever table has data; squad_players is the post-draft source of truth
  if (sq && sq.length > 0) return sq.length;
  return dp?.length ?? 0;
}

async function isPlayerOnWire(leagueId: string, playerId: number): Promise<boolean> {
  const { data } = await supabase
    .from("waiver_wire")
    .select("id")
    .eq("league_id", leagueId)
    .eq("player_id", playerId)
    .eq("status", "available")
    .maybeSingle();
  return !!data;
}

async function getTeamUserId(teamId: string): Promise<string | null> {
  const { data } = await supabase.from("teams").select("user_id").eq("id", teamId).single();
  return data?.user_id ?? null;
}

async function getLeagueName(leagueId: string): Promise<string> {
  const { data } = await supabase.from("leagues").select("name").eq("id", leagueId).single();
  return data?.name ?? "Liga";
}

async function getPlayerName(playerId: number): Promise<string> {
  const { data } = await supabase.from("players").select("name").eq("id", playerId).single();
  return data?.name ?? `Spieler #${playerId}`;
}

/** Move player_in onto this team's squad; optionally drop player_out back to wire. */
async function executeTransfer(
  leagueId: string,
  teamId: string,
  playerIn: number,
  playerOut: number | null,
  gameweek: number,
  bidAmount: number,
  budgetEnabled: boolean,
  currentFaab: number,
): Promise<void> {
  // 1. Remove player_in from waiver wire
  await supabase
    .from("waiver_wire")
    .update({ status: "claimed" })
    .eq("league_id", leagueId)
    .eq("player_id", playerIn);

  // 2. Add player_in to squad
  //    Try squad_players first; fall back to draft_picks update
  const { data: existingSquad } = await supabase
    .from("squad_players")
    .select("id")
    .eq("team_id", teamId)
    .limit(1)
    .maybeSingle();

  if (existingSquad !== null || playerOut) {
    // Team uses squad_players table
    await supabase.from("squad_players").insert({ team_id: teamId, player_id: playerIn });

    // Remove player_out from squad_players (if specified)
    if (playerOut) {
      await supabase.from("squad_players")
        .delete()
        .eq("team_id", teamId)
        .eq("player_id", playerOut);
    }
  } else {
    // Fall back: update draft_picks (replace any existing pick)
    const { data: picks } = await supabase
      .from("draft_picks")
      .select("id")
      .eq("team_id", teamId)
      .limit(1);
    if (picks && picks.length > 0) {
      // Find the pick for player_out if specified, else use first pick as placeholder
      const pickToUpdate = playerOut
        ? (await supabase.from("draft_picks").select("id").eq("team_id", teamId).eq("player_id", playerOut).maybeSingle()).data
        : picks[0];
      if (pickToUpdate) {
        await supabase.from("draft_picks").update({ player_id: playerIn }).eq("id", pickToUpdate.id);
      } else {
        await supabase.from("draft_picks").insert({ team_id: teamId, player_id: playerIn, league_id: leagueId });
      }
    }
  }

  // 3. Put player_out back on wire (if specified)
  if (playerOut) {
    const { data: existing } = await supabase
      .from("waiver_wire")
      .select("id")
      .eq("league_id", leagueId)
      .eq("player_id", playerOut)
      .maybeSingle();

    if (existing) {
      await supabase.from("waiver_wire")
        .update({ status: "available" })
        .eq("league_id", leagueId)
        .eq("player_id", playerOut);
    } else {
      await supabase.from("waiver_wire").insert({
        league_id: leagueId,
        player_id: playerOut,
        available_from_gameweek: gameweek,
        status: "available",
      });
    }
  }

  // 4. Log the transfer
  await supabase.from("liga_transfers").insert({
    team_id: teamId,
    league_id: leagueId,
    player_in_id: playerIn,
    player_out_id: playerOut ?? playerIn, // liga_transfers requires both columns — use playerIn as fallback
    gameweek,
  });

  // 5. Deduct FAAB budget
  if (budgetEnabled && bidAmount > 0) {
    await supabase
      .from("teams")
      .update({ faab_budget: currentFaab - bidAmount })
      .eq("id", teamId);
  }
}

async function notifyTeam(
  userId: string,
  leagueId: string,
  kind: "waiver_result",
  title: string,
  body: string,
  link: string,
): Promise<void> {
  await supabase.from("notifications").insert({ user_id: userId, league_id: leagueId, kind, title, body, link });
}

// ─── Priority-based processing ───────────────────────────────────────────────

async function processByPriority(
  claims: Claim[],
  settings: Settings,
  leagueId: string,
  gameweek: number,
  leagueName: string,
): Promise<ProcessResult> {
  const log: string[] = [];
  let approved = 0;
  let rejected = 0;

  // Sort: by team waiver priority ASC, then claim_order ASC within each team
  const sorted = [...claims].sort((a, b) =>
    a.priority !== b.priority ? a.priority - b.priority : a.claim_order - b.claim_order
  );

  // Track which players have already been claimed this round
  const claimedPlayers = new Set<number>();
  // Track which teams have already successfully claimed
  const teamsClaimed = new Set<string>();

  // Group by team for per-team fallback logic
  const byTeam = new Map<string, Claim[]>();
  for (const c of sorted) {
    if (!byTeam.has(c.team_id)) byTeam.set(c.team_id, []);
    byTeam.get(c.team_id)!.push(c);
  }

  // Process in waiver priority order (one successful claim per team per round)
  const teamOrder = [...byTeam.keys()].sort((a, b) => {
    const pa = sorted.find(c => c.team_id === a)?.priority ?? 999;
    const pb = sorted.find(c => c.team_id === b)?.priority ?? 999;
    return pa - pb;
  });

  for (const teamId of teamOrder) {
    const teamClaims = byTeam.get(teamId)!;
    let claimedThisTeam = false;

    for (const claim of teamClaims) {
      // Already got one this round
      if (claimedThisTeam) {
        await supabase.from("waiver_claims").update({
          status: "rejected",
          rejected_reason: "Team hat bereits einen Claim in dieser Runde erhalten",
          processed_at: new Date().toISOString(),
        }).eq("id", claim.id);
        rejected++;
        continue;
      }

      // Player already taken by higher-priority team
      if (claimedPlayers.has(claim.player_in)) {
        const pName = await getPlayerName(claim.player_in);
        await supabase.from("waiver_claims").update({
          status: "rejected",
          rejected_reason: `${pName} wurde von einem anderen Team beansprucht`,
          processed_at: new Date().toISOString(),
        }).eq("id", claim.id);
        const userId = await getTeamUserId(teamId);
        if (userId) {
          await notifyTeam(userId, leagueId, "waiver_result",
            "Waiver abgelehnt",
            `Dein Claim für ${pName} wurde abgelehnt — höhere Priorität.`,
            `/leagues/${leagueId}/waiver`
          );
        }
        rejected++;
        continue;
      }

      // Player still on wire?
      const onWire = await isPlayerOnWire(leagueId, claim.player_in);
      if (!onWire) {
        const pName = await getPlayerName(claim.player_in);
        await supabase.from("waiver_claims").update({
          status: "rejected",
          rejected_reason: `${pName} ist nicht mehr verfügbar`,
          processed_at: new Date().toISOString(),
        }).eq("id", claim.id);
        rejected++;
        continue;
      }

      // Squad full check
      const squadSize = await getSquadSize(teamId);
      const maxSquad = settings.squad_size || 18;
      if (!claim.player_out && squadSize >= maxSquad) {
        const pName = await getPlayerName(claim.player_in);
        await supabase.from("waiver_claims").update({
          status: "rejected",
          rejected_reason: `Kader voll (${squadSize}/${maxSquad}) — kein Spieler zum Abgeben angegeben`,
          processed_at: new Date().toISOString(),
        }).eq("id", claim.id);
        rejected++;
        continue;
      }

      // ✅ Approve
      const faab = settings.waiver_budget_enabled
        ? await getTeamFaab(teamId, settings.waiver_budget_starting)
        : 0;

      await executeTransfer(leagueId, teamId, claim.player_in, claim.player_out, gameweek, claim.bid_amount, settings.waiver_budget_enabled, faab);

      await supabase.from("waiver_claims").update({
        status: "approved",
        processed_at: new Date().toISOString(),
      }).eq("id", claim.id);

      claimedPlayers.add(claim.player_in);
      claimedThisTeam = true;
      approved++;

      const pInName = await getPlayerName(claim.player_in);
      const pOutName = claim.player_out ? await getPlayerName(claim.player_out) : null;
      log.push(`✅ Team ${teamId.slice(0, 8)}: +${pInName}${pOutName ? ` −${pOutName}` : ""}`);

      const userId = await getTeamUserId(teamId);
      if (userId) {
        await notifyTeam(userId, leagueId, "waiver_result",
          "Waiver genehmigt! ✅",
          `${pInName} gehört jetzt zu deinem Kader${pOutName ? ` (${pOutName} entlassen)` : ""}.`,
          `/leagues/${leagueId}/waiver`
        );
      }
    }
  }

  return { approved, rejected, log };
}

// ─── FAAB-based processing ────────────────────────────────────────────────────

async function processByFaab(
  claims: Claim[],
  settings: Settings,
  leagueId: string,
  gameweek: number,
): Promise<ProcessResult> {
  const log: string[] = [];
  let approved = 0;
  let rejected = 0;

  // Sort: highest bid first; tie-break by submission time (created_at not in claim type — use id)
  const sorted = [...claims].sort((a, b) => b.bid_amount - a.bid_amount);

  const claimedPlayers = new Set<number>();

  for (const claim of sorted) {
    if (claimedPlayers.has(claim.player_in)) {
      const pName = await getPlayerName(claim.player_in);
      await supabase.from("waiver_claims").update({
        status: "rejected",
        rejected_reason: `${pName} wurde von einem anderen Team mit höherem Gebot beansprucht`,
        processed_at: new Date().toISOString(),
      }).eq("id", claim.id);
      const userId = await getTeamUserId(claim.team_id);
      if (userId) {
        await notifyTeam(userId, leagueId, "waiver_result",
          "Waiver abgelehnt",
          `Dein Claim für ${pName} wurde überboten.`,
          `/leagues/${leagueId}/waiver`
        );
      }
      rejected++;
      continue;
    }

    // Budget check
    const currentFaab = await getTeamFaab(claim.team_id, settings.waiver_budget_starting);
    if (claim.bid_amount > currentFaab) {
      const pName = await getPlayerName(claim.player_in);
      await supabase.from("waiver_claims").update({
        status: "rejected",
        rejected_reason: `Budget unzureichend (Bid: ${claim.bid_amount}, verfügbar: ${currentFaab})`,
        processed_at: new Date().toISOString(),
      }).eq("id", claim.id);
      rejected++;
      continue;
    }

    // Player still on wire?
    const onWire = await isPlayerOnWire(leagueId, claim.player_in);
    if (!onWire) {
      const pName = await getPlayerName(claim.player_in);
      await supabase.from("waiver_claims").update({
        status: "rejected",
        rejected_reason: `${pName} ist nicht mehr verfügbar`,
        processed_at: new Date().toISOString(),
      }).eq("id", claim.id);
      rejected++;
      continue;
    }

    // ✅ Approve
    await executeTransfer(leagueId, claim.team_id, claim.player_in, claim.player_out, gameweek, claim.bid_amount, true, currentFaab);

    await supabase.from("waiver_claims").update({
      status: "approved",
      processed_at: new Date().toISOString(),
    }).eq("id", claim.id);

    claimedPlayers.add(claim.player_in);
    approved++;

    const pInName = await getPlayerName(claim.player_in);
    const pOutName = claim.player_out ? await getPlayerName(claim.player_out) : null;
    log.push(`✅ FAAB ${claim.bid_amount}: +${pInName}${pOutName ? ` −${pOutName}` : ""}`);

    const userId = await getTeamUserId(claim.team_id);
    if (userId) {
      await notifyTeam(userId, leagueId, "waiver_result",
        "Waiver genehmigt! ✅",
        `${pInName} gehört jetzt zu deinem Kader (Bid: ${claim.bid_amount} Bucks).`,
        `/leagues/${leagueId}/waiver`
      );
    }
  }

  return { approved, rejected, log };
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { leagueId, gameweek: gwParam } = await req.json().catch(() => ({}));
  if (!leagueId) return NextResponse.json({ ok: false, error: "leagueId required" }, { status: 400 });

  // Determine gameweek
  let gameweek: number = gwParam;
  if (!gameweek) {
    const { data: gw } = await supabase
      .from("liga_gameweeks")
      .select("gameweek")
      .eq("league_id", leagueId)
      .eq("status", "active")
      .maybeSingle();
    gameweek = gw?.gameweek ?? 1;
  }

  // Load settings
  const { data: settingsData } = await supabase
    .from("liga_settings")
    .select("waiver_budget_enabled, waiver_budget_starting, squad_size")
    .eq("league_id", leagueId)
    .maybeSingle();

  const settings: Settings = {
    waiver_budget_enabled: settingsData?.waiver_budget_enabled ?? false,
    waiver_budget_starting: settingsData?.waiver_budget_starting ?? 100,
    squad_size: settingsData?.squad_size ?? 18,
  };

  // Load all pending claims for this GW
  const { data: claimsData, error: claimsError } = await supabase
    .from("waiver_claims")
    .select("id, league_id, team_id, player_in, player_out, gameweek, priority, claim_order, bid_amount")
    .eq("league_id", leagueId)
    .eq("gameweek", gameweek)
    .eq("status", "pending");

  if (claimsError) return NextResponse.json({ ok: false, error: claimsError.message }, { status: 500 });

  const claims = (claimsData || []) as Claim[];
  if (claims.length === 0) {
    return NextResponse.json({ ok: true, approved: 0, rejected: 0, log: ["Keine offenen Claims"] });
  }

  const leagueName = await getLeagueName(leagueId);

  // Process
  const result: ProcessResult = settings.waiver_budget_enabled
    ? await processByFaab(claims, settings, leagueId, gameweek)
    : await processByPriority(claims, settings, leagueId, gameweek, leagueName);

  // Rotate waiver priority after processing
  await rotatePriority(leagueId, gameweek);

  // Close the waiver window
  await supabase
    .from("liga_gameweeks")
    .update({ waiver_window_open: false })
    .eq("league_id", leagueId)
    .eq("gameweek", gameweek);

  // Audit log
  await supabase.from("liga_admin_audit_log").insert({
    league_id: leagueId,
    actor_id: null,
    actor_label: "admin",
    action: "waivers_processed",
    metadata: { gameweek, approved: result.approved, rejected: result.rejected },
  });

  return NextResponse.json({ ok: true, ...result });
}
