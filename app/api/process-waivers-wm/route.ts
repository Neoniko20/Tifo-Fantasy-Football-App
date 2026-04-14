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
  const { data: sq } = await supabase
    .from("squad_players").select("player_id", { count: "exact" }).eq("team_id", teamId);
  return sq?.length ?? 0;
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

async function getPlayerName(playerId: number): Promise<string> {
  const { data } = await supabase.from("players").select("name").eq("id", playerId).single();
  return data?.name ?? `Spieler #${playerId}`;
}

/** Move player_in onto this team's squad_players; optionally drop player_out back to wire. */
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

  // 2. Add player_in to squad_players
  await supabase.from("squad_players").insert({ team_id: teamId, player_id: playerIn });

  // 3. Remove player_out from squad
  if (playerOut) {
    await supabase.from("squad_players")
      .delete()
      .eq("team_id", teamId)
      .eq("player_id", playerOut);

    // Put player_out back on wire
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

  // 4. Deduct FAAB budget
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
  title: string,
  body: string,
  link: string,
): Promise<void> {
  await supabase.from("notifications").insert({
    user_id: userId,
    league_id: leagueId,
    kind: "waiver_result",
    title,
    body,
    link,
  });
}

// ─── Priority-based processing ────────────────────────────────────────────────

async function processByPriority(
  claims: Claim[],
  settings: Settings,
  leagueId: string,
  gameweek: number,
): Promise<ProcessResult> {
  const log: string[] = [];
  let approved = 0;
  let rejected = 0;

  const sorted = [...claims].sort((a, b) =>
    a.priority !== b.priority ? a.priority - b.priority : a.claim_order - b.claim_order
  );

  const claimedPlayers = new Set<number>();

  const byTeam = new Map<string, Claim[]>();
  for (const c of sorted) {
    if (!byTeam.has(c.team_id)) byTeam.set(c.team_id, []);
    byTeam.get(c.team_id)!.push(c);
  }

  const teamOrder = [...byTeam.keys()].sort((a, b) => {
    const pa = sorted.find(c => c.team_id === a)?.priority ?? 999;
    const pb = sorted.find(c => c.team_id === b)?.priority ?? 999;
    return pa - pb;
  });

  for (const teamId of teamOrder) {
    const teamClaims = byTeam.get(teamId)!;
    let claimedThisTeam = false;

    for (const claim of teamClaims) {
      if (claimedThisTeam) {
        await supabase.from("waiver_claims").update({
          status: "rejected",
          rejected_reason: "Team hat bereits einen Claim in dieser Runde erhalten",
          processed_at: new Date().toISOString(),
        }).eq("id", claim.id);
        rejected++;
        continue;
      }

      if (claimedPlayers.has(claim.player_in)) {
        const pName = await getPlayerName(claim.player_in);
        await supabase.from("waiver_claims").update({
          status: "rejected",
          rejected_reason: `${pName} wurde von einem anderen Team beansprucht`,
          processed_at: new Date().toISOString(),
        }).eq("id", claim.id);
        const userId = await getTeamUserId(teamId);
        if (userId) {
          await notifyTeam(userId, leagueId,
            "Waiver abgelehnt",
            `Dein Claim für ${pName} wurde abgelehnt — höhere Priorität.`,
            `/wm/${leagueId}/waiver`
          );
        }
        rejected++;
        continue;
      }

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
        await notifyTeam(userId, leagueId,
          "Waiver genehmigt! ✅",
          `${pInName} gehört jetzt zu deinem Kader${pOutName ? ` (${pOutName} entlassen)` : ""}.`,
          `/wm/${leagueId}/waiver`
        );
      }
    }
  }

  return { approved, rejected, log };
}

// ─── FAAB-based processing ─────────────────────────────────────────────────────

async function processByFaab(
  claims: Claim[],
  settings: Settings,
  leagueId: string,
  gameweek: number,
): Promise<ProcessResult> {
  const log: string[] = [];
  let approved = 0;
  let rejected = 0;

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
        await notifyTeam(userId, leagueId,
          "Waiver abgelehnt",
          `Dein Claim für ${pName} wurde überboten.`,
          `/wm/${leagueId}/waiver`
        );
      }
      rejected++;
      continue;
    }

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
      await notifyTeam(userId, leagueId,
        "Waiver genehmigt! ✅",
        `${pInName} gehört jetzt zu deinem Kader (Bid: ${claim.bid_amount} Bucks).`,
        `/wm/${leagueId}/waiver`
      );
    }
  }

  return { approved, rejected, log };
}

// ─── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { leagueId, gameweek: gwParam } = await req.json().catch(() => ({}));
  if (!leagueId) return NextResponse.json({ ok: false, error: "leagueId required" }, { status: 400 });

  // Determine gameweek from wm_gameweeks
  let gameweek: number = gwParam;
  if (!gameweek) {
    // Need tournament_id from wm_league_settings first
    const { data: settingsRef } = await supabase
      .from("wm_league_settings")
      .select("tournament_id")
      .eq("league_id", leagueId)
      .maybeSingle();

    if (settingsRef?.tournament_id) {
      const { data: gw } = await supabase
        .from("wm_gameweeks")
        .select("gameweek")
        .eq("tournament_id", settingsRef.tournament_id)
        .eq("status", "active")
        .maybeSingle();
      gameweek = gw?.gameweek ?? 1;
    } else {
      gameweek = 1;
    }
  }

  // Load WM settings
  const { data: settingsData } = await supabase
    .from("wm_league_settings")
    .select("waiver_budget_enabled, waiver_budget_starting, squad_size, tournament_id")
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

  // Process
  const result: ProcessResult = settings.waiver_budget_enabled
    ? await processByFaab(claims, settings, leagueId, gameweek)
    : await processByPriority(claims, settings, leagueId, gameweek);

  // Rotate waiver priority after processing
  await rotatePriority(leagueId, gameweek);

  // Close the waiver window in wm_gameweeks
  if (settingsData?.tournament_id) {
    await supabase
      .from("wm_gameweeks")
      .update({ waiver_window_open: false })
      .eq("tournament_id", settingsData.tournament_id)
      .eq("gameweek", gameweek);
  }

  return NextResponse.json({ ok: true, ...result });
}
