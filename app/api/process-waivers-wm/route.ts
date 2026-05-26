import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { rotatePriority } from "@/lib/waiver-init";
import { sendPush } from "@/lib/push";
import { processIngestEvent } from "@/lib/wm-ingest";

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

/** WM-Kader-Größe aus wm_squad_players (scoped by league_id) */
async function getSquadSize(teamId: string, leagueId: string): Promise<number> {
  const { data } = await supabase
    .from("wm_squad_players")
    .select("player_id", { count: "exact" })
    .eq("team_id", teamId)
    .eq("league_id", leagueId);
  return data?.length ?? 0;
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

async function getTeamName(teamId: string): Promise<string> {
  const { data } = await supabase.from("teams").select("name").eq("id", teamId).single();
  return data?.name ?? `Team ${teamId.slice(0, 8)}`;
}

/** Fire a waiver system message via the ingest layer (idempotent via claim.id). */
async function fireWaiverMessage(
  leagueId: string,
  tournamentId: string | null,
  gameweek: number,
  claim: Claim,
  teamName: string,
  playerInName: string,
  playerOutName: string | null,
  status: "approved" | "rejected",
  rejectedReason?: string,
): Promise<void> {
  await processIngestEvent(leagueId, {
    type: "waiver.claim_processed",
    tournament_id: tournamentId ?? "",
    gameweek,
    source: "admin",
    idempotency_key: `wm-waiver-${claim.id}-${status}`,
    payload: {
      team_id:        claim.team_id,
      team_name:      teamName,
      player_in_id:   claim.player_in,
      player_in_name: playerInName,
      player_out_id:  claim.player_out ?? undefined,
      player_out_name: playerOutName ?? undefined,
      status,
      rejected_reason: rejectedReason,
    },
  }, "ingest_api");
}

/**
 * Move player_in into wm_squad_players; optionally drop player_out back to wire.
 * Writes acquired_via = 'waiver', sets league_id + tournament_id.
 */
async function executeTransfer(
  leagueId: string,
  tournamentId: string | null,
  teamId: string,
  playerIn: number,
  playerOut: number | null,
  gameweek: number,
  bidAmount: number,
  budgetEnabled: boolean,
  currentFaab: number,
): Promise<{ ok: boolean; error?: string }> {
  // 1. Remove player_in from waiver wire
  await supabase
    .from("waiver_wire")
    .update({ status: "claimed" })
    .eq("league_id", leagueId)
    .eq("player_id", playerIn);

  // 2. Add player_in to wm_squad_players
  const { error: insertError } = await supabase.from("wm_squad_players").insert({
    league_id:    leagueId,
    tournament_id: tournamentId,
    team_id:      teamId,
    player_id:    playerIn,
    acquired_via: "waiver",
  });

  if (insertError) {
    // Duplicate constraint → player already claimed in this league (race condition)
    if (insertError.code === "23505") {
      // Roll back wire status change
      await supabase
        .from("waiver_wire")
        .update({ status: "available" })
        .eq("league_id", leagueId)
        .eq("player_id", playerIn);
      return { ok: false, error: "duplicate_player" };
    }
    console.error("[process-waivers-wm] wm_squad_players insert:", insertError.message);
    return { ok: false, error: insertError.message };
  }

  // 3. Drop player_out from wm_squad_players + return to wire
  if (playerOut) {
    await supabase
      .from("wm_squad_players")
      .delete()
      .eq("team_id", teamId)
      .eq("league_id", leagueId)
      .eq("player_id", playerOut);

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
        league_id:                leagueId,
        player_id:                playerOut,
        available_from_gameweek:  gameweek,
        status:                   "available",
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

  return { ok: true };
}

async function notifyTeam(
  userId: string,
  leagueId: string,
  title: string,
  body: string,
  link: string,
): Promise<void> {
  await supabase.from("notifications").insert({
    user_id:   userId,
    league_id: leagueId,
    kind:      "waiver_result",
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
  tournamentId: string | null,
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
        // ── System message (meaningful rejection — higher priority won)
        const tName = await getTeamName(teamId);
        await fireWaiverMessage(leagueId, tournamentId, gameweek, claim, tName, pName, null, "rejected", "höhere Priorität");
        const userId = await getTeamUserId(teamId);
        if (userId) {
          await notifyTeam(userId, leagueId, "Waiver abgelehnt",
            `Dein Claim für ${pName} wurde abgelehnt — höhere Priorität.`,
            `/wm/${leagueId}/waiver`);
          await sendPush(userId, "waiver_rejected",
            { title: "❌ Waiver abgelehnt", body: "Dein Claim wurde abgelehnt.", link: `/wm/${leagueId}/waiver` },
            leagueId);
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

      const squadSize = await getSquadSize(teamId, leagueId);
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

      const transfer = await executeTransfer(
        leagueId, tournamentId, teamId, claim.player_in, claim.player_out,
        gameweek, claim.bid_amount, settings.waiver_budget_enabled, faab,
      );

      if (!transfer.ok) {
        const pName = await getPlayerName(claim.player_in);
        const reason = transfer.error === "duplicate_player"
          ? `${pName} ist bereits in dieser Liga vergeben`
          : `Transfer-Fehler: ${transfer.error}`;
        await supabase.from("waiver_claims").update({
          status: "rejected",
          rejected_reason: reason,
          processed_at: new Date().toISOString(),
        }).eq("id", claim.id);
        log.push(`⚠️ Team ${teamId.slice(0, 8)}: ${reason}`);
        rejected++;
        continue;
      }

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

      // ── System message (idempotent via claim.id)
      const tName = await getTeamName(teamId);
      await fireWaiverMessage(leagueId, tournamentId, gameweek, claim, tName, pInName, pOutName, "approved");

      const userId = await getTeamUserId(teamId);
      if (userId) {
        await notifyTeam(userId, leagueId, "Waiver genehmigt! ✅",
          `${pInName} gehört jetzt zu deinem Kader${pOutName ? ` (${pOutName} entlassen)` : ""}.`,
          `/wm/${leagueId}/waiver`);
        await sendPush(userId, "waiver_approved",
          { title: "✅ Waiver genehmigt", body: `${pInName} gehört jetzt zu deinem Kader${pOutName ? ` (${pOutName} entlassen)` : ""}.`, link: `/wm/${leagueId}/waiver` },
          leagueId);
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
  tournamentId: string | null,
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
      // ── System message (meaningful rejection — overbid)
      const tName = await getTeamName(claim.team_id);
      await fireWaiverMessage(leagueId, tournamentId, gameweek, claim, tName, pName, null, "rejected", "überboten");
      const userId = await getTeamUserId(claim.team_id);
      if (userId) {
        await notifyTeam(userId, leagueId, "Waiver abgelehnt",
          `Dein Claim für ${pName} wurde überboten.`,
          `/wm/${leagueId}/waiver`);
        await sendPush(userId, "waiver_rejected",
          { title: "❌ Waiver abgelehnt", body: "Dein Claim wurde abgelehnt.", link: `/wm/${leagueId}/waiver` },
          leagueId);
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

    const squadSize = await getSquadSize(claim.team_id, leagueId);
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
    const transfer = await executeTransfer(
      leagueId, tournamentId, claim.team_id, claim.player_in, claim.player_out,
      gameweek, claim.bid_amount, true, currentFaab,
    );

    if (!transfer.ok) {
      const pName = await getPlayerName(claim.player_in);
      const reason = transfer.error === "duplicate_player"
        ? `${pName} ist bereits in dieser Liga vergeben`
        : `Transfer-Fehler: ${transfer.error}`;
      await supabase.from("waiver_claims").update({
        status: "rejected",
        rejected_reason: reason,
        processed_at: new Date().toISOString(),
      }).eq("id", claim.id);
      log.push(`⚠️ Team ${claim.team_id.slice(0, 8)}: ${reason}`);
      rejected++;
      continue;
    }

    await supabase.from("waiver_claims").update({
      status: "approved",
      processed_at: new Date().toISOString(),
    }).eq("id", claim.id);

    claimedPlayers.add(claim.player_in);
    approved++;

    const pInName = await getPlayerName(claim.player_in);
    const pOutName = claim.player_out ? await getPlayerName(claim.player_out) : null;
    log.push(`✅ FAAB ${claim.bid_amount}: +${pInName}${pOutName ? ` −${pOutName}` : ""}`);

    // ── System message (idempotent via claim.id)
    const tName = await getTeamName(claim.team_id);
    await fireWaiverMessage(leagueId, tournamentId, gameweek, claim, tName, pInName, pOutName, "approved");

    const userId = await getTeamUserId(claim.team_id);
    if (userId) {
      await notifyTeam(userId, leagueId, "Waiver genehmigt! ✅",
        `${pInName} gehört jetzt zu deinem Kader (Bid: ${claim.bid_amount} Bucks).`,
        `/wm/${leagueId}/waiver`);
      await sendPush(userId, "waiver_approved",
        { title: "✅ Waiver genehmigt", body: `${pInName} gehört jetzt zu deinem Kader${pOutName ? ` (${pOutName} entlassen)` : ""}.`, link: `/wm/${leagueId}/waiver` },
        leagueId);
    }
  }

  return { approved, rejected, log };
}

// ─── Route Handler (manuell / via Admin) ──────────────────────────────────────

export async function POST(req: NextRequest) {
  const { leagueId, gameweek: gwParam } = await req.json().catch(() => ({}));
  if (!leagueId) return NextResponse.json({ ok: false, error: "leagueId required" }, { status: 400 });

  return processWmWaivers(leagueId, gwParam ?? null);
}

// ─── Shared processing logic (also used by cron) ──────────────────────────────

export async function processWmWaivers(
  leagueId: string,
  gwParam: number | null,
): Promise<NextResponse> {
  // Resolve tournament_id + gameweek
  const { data: settingsData } = await supabase
    .from("wm_league_settings")
    .select("waiver_budget_enabled, waiver_budget_starting, squad_size, tournament_id")
    .eq("league_id", leagueId)
    .maybeSingle();

  const tournamentId: string | null = settingsData?.tournament_id ?? null;

  let gameweek: number = gwParam ?? 0;
  if (!gameweek && tournamentId) {
    const { data: gw } = await supabase
      .from("wm_gameweeks")
      .select("gameweek")
      .eq("tournament_id", tournamentId)
      .eq("status", "active")
      .maybeSingle();
    gameweek = gw?.gameweek ?? 1;
  } else if (!gameweek) {
    gameweek = 1;
  }

  const settings: Settings = {
    waiver_budget_enabled:  settingsData?.waiver_budget_enabled  ?? false,
    waiver_budget_starting: settingsData?.waiver_budget_starting ?? 100,
    squad_size:             settingsData?.squad_size             ?? 18,
  };

  // Load pending claims
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

  const result: ProcessResult = settings.waiver_budget_enabled
    ? await processByFaab(claims, settings, leagueId, tournamentId, gameweek)
    : await processByPriority(claims, settings, leagueId, tournamentId, gameweek);

  // Rotate priority + close waiver window
  await rotatePriority(leagueId, gameweek);

  if (tournamentId) {
    await supabase
      .from("wm_gameweeks")
      .update({ waiver_window_open: false })
      .eq("tournament_id", tournamentId)
      .eq("gameweek", gameweek);
  }

  return NextResponse.json({ ok: true, ...result });
}
