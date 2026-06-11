// lib/wm-ingest.ts
// Central event-processing library for the WM Ingest Layer.
// All producers (Admin, Simulator, API-Football) use this.
// No route handler logic here — pure processing.

import { createServiceRoleClient } from "@/lib/supabase-server";
import { calculateWMGameweekPoints } from "@/lib/wm-points";
import type {
  WMIngestEvent, WMEventType, ProcessedBy, IngestResult,
  WMNation, Position, AutoSubPayload, WaiverClaimPayload,
} from "@/lib/wm-types";
import type { GWStats } from "@/lib/wm-points";
import {
  writeSystemMessage,
  fanOutSystemMessage,
  goalMessage,
  fixtureStartMessage,
  fixtureEndMessage,
  nationEliminatedMessage,
  autoSubMessage,
  waiverMessage,
  waiverRejectedMessage,
} from "@/lib/wm-system-messages";
import { applyAutoSubToLineup } from "@/lib/live-sub";

// ── Scoring guard — pure helper, exported for unit tests ─────────────────────

/**
 * Entscheidet ob ein Spieler für ein Team in einem GW Punkte erhalten soll.
 *
 * Regeln:
 * - Kein Lineup → kein Score (returns score: false, reason: "no_lineup")
 * - Spieler nicht in starting_xi → kein Score (Bankspieler)
 * - Spieler in starting_xi → Score; isCaptain=true wenn er captain_id ist
 *
 * Achtung: Auto-Sub schreibt nur eine System-Message und ändert starting_xi
 * nicht in der DB. Ein auto-gebenchter Spieler bleibt in starting_xi und
 * erhält weiterhin Punkte. Das ist korrektes Verhalten bis Auto-Sub vollständig
 * implementiert ist (GAP-5).
 */
export function shouldScorePlayer(
  playerId: number,
  lineup: { captain_id: number | null; starting_xi: unknown } | null,
): { score: boolean; isCaptain: boolean; reason?: string } {
  if (!lineup) {
    return { score: false, isCaptain: false, reason: "no_lineup" };
  }
  const xi: number[] = Array.isArray(lineup.starting_xi) ? (lineup.starting_xi as number[]) : [];
  if (!xi.includes(playerId)) {
    return { score: false, isCaptain: false };
  }
  return { score: true, isCaptain: lineup.captain_id === playerId };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function processIngestEvent(
  leagueId: string,
  event: WMIngestEvent,
  processedBy: ProcessedBy = "ingest_api",
): Promise<IngestResult> {
  const supabase = createServiceRoleClient();
  const applied: string[] = [];
  const warnings: string[] = [];

  // 1. Idempotency check — if same idempotency_key already exists, return early
  if (event.idempotency_key) {
    const { data: existing } = await supabase
      .from("wm_event_log")
      .select("id, status")
      .eq("idempotency_key", event.idempotency_key)
      .maybeSingle();
    if (existing) {
      return { ok: true, event_id: existing.id, applied: [], warnings: ["idempotent:already_processed"] };
    }
  }

  // 2. Write to audit log (status: pending)
  const { data: logEntry, error: logError } = await supabase
    .from("wm_event_log")
    .insert({
      league_id:      leagueId,
      tournament_id:  event.tournament_id,
      gameweek:       event.gameweek ?? null,
      event_type:     event.type,
      payload:        event.payload,
      source:         event.source ?? "admin",
      idempotency_key: event.idempotency_key ?? null,
      status:         "pending",
      processed_by:   processedBy,
    })
    .select("id")
    .single();

  if (logError || !logEntry) {
    return {
      ok: false, applied: [], warnings: [],
      error: "Failed to write event log: " + (logError?.message ?? "unknown"),
    };
  }

  const eventId = logEntry.id as string;

  try {
    // 3. Dispatch to handler
    const result = await dispatchEvent(leagueId, event, supabase);
    applied.push(...result.applied);
    warnings.push(...result.warnings);

    // 4. Mark processed — use "partial" if any warnings include upsert failures
    const hasUpsertFailures = warnings.some(w => w.startsWith("upsert failed"));
    const finalStatus = hasUpsertFailures ? "partial" : "processed";
    const { error: updateError } = await supabase
      .from("wm_event_log")
      .update({ status: finalStatus, processed_at: new Date().toISOString() })
      .eq("id", eventId);
    if (updateError) warnings.push(`log_update_failed: ${updateError.message}`);

    return { ok: true, event_id: eventId, applied, warnings };

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const { error: updateError } = await supabase
      .from("wm_event_log")
      .update({ status: "failed", error_message: msg })
      .eq("id", eventId);
    if (updateError) warnings.push(`log_update_failed: ${updateError.message}`);
    return { ok: false, event_id: eventId, applied, warnings, error: msg };
  }
}

// ── Event dispatcher ──────────────────────────────────────────────────────────

async function dispatchEvent(
  leagueId: string,
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<{ applied: string[]; warnings: string[] }> {
  switch (event.type) {
    case "fixture.score_updated":     return handleScoreUpdated(event, supabase);
    case "fixture.status_changed":    return handleFixtureStatus(leagueId, event, supabase);
    case "fixture.penalties_updated": return handlePenaltiesUpdated(event, supabase);
    case "player.stat_update":        return handlePlayerStatUpdate(leagueId, event, supabase);
    case "gameweek.status_changed":   return handleGameweekStatus(event, supabase);
    case "nation.eliminated":         return handleNationEliminated(event, supabase);
    case "auto_sub.applied":          return handleAutoSub(leagueId, event, supabase);
    case "waiver.claim_processed":    return handleWaiverClaim(leagueId, event, supabase);
    case "gameweek.points_recalculated":
      return { applied: ["event_logged:gameweek.points_recalculated"], warnings: [] };
    default:
      return { applied: [], warnings: [`unknown_event_type:${(event as any).type}`] };
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleScoreUpdated(
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const { fixture_id, home_score, away_score } = event.payload as {
    fixture_id: string; home_score: number; away_score: number;
  };
  const { error } = await supabase
    .from("wm_fixtures")
    .update({ home_score, away_score })
    .eq("id", fixture_id);
  if (error) throw new Error("fixture score update failed: " + error.message);
  return { applied: ["wm_fixtures.score"], warnings: [] };
}

async function handleFixtureStatus(
  leagueId: string,
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const { fixture_id, status, extra_status } = event.payload as {
    fixture_id: string;
    status: "scheduled" | "live" | "finished";
    extra_status?: string | null;
  };
  const update: Record<string, unknown> = { status };
  if (extra_status !== undefined) update.extra_status = extra_status;
  const { error } = await supabase
    .from("wm_fixtures").update(update).eq("id", fixture_id);
  if (error) throw new Error("fixture status update failed: " + error.message);

  const applied = ["wm_fixtures.status"];
  const warnings: string[] = [];

  // Write system message for live/finished transitions
  if (status === "live" || status === "finished") {
    const { data: fixture } = await supabase
      .from("wm_fixtures")
      .select("home_score, away_score, home_nation:wm_nations!home_nation_id(name,flag_url), away_nation:wm_nations!away_nation_id(name,flag_url)")
      .eq("id", fixture_id)
      .maybeSingle();

    if (fixture) {
      const src = (event.source === "simulator" ? "simulator" : "ingest_api") as "simulator" | "ingest_api";
      const home = (fixture.home_nation as any) ?? {};
      const away = (fixture.away_nation as any) ?? {};

      const msg = status === "live"
        ? fixtureStartMessage(home.name ?? "?", home.flag_url ?? null, away.name ?? "?", away.flag_url ?? null, src, fixture_id)
        : fixtureEndMessage(home.name ?? "?", home.flag_url ?? null, fixture.home_score ?? 0, away.name ?? "?", away.flag_url ?? null, fixture.away_score ?? 0, src, fixture_id);

      await writeSystemMessage(supabase, leagueId, msg.content, msg.meta);
      applied.push("league_messages:fixture_" + status);
    } else {
      warnings.push("fixture not found for system message");
    }
  }

  return { applied, warnings };
}

async function handlePenaltiesUpdated(
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const { fixture_id, penalties_home, penalties_away } = event.payload as {
    fixture_id: string; penalties_home: number; penalties_away: number;
  };
  const { error } = await supabase
    .from("wm_fixtures")
    .update({ penalties_home, penalties_away })
    .eq("id", fixture_id);
  if (error) throw new Error("penalties update failed: " + error.message);
  return { applied: ["wm_fixtures.penalties"], warnings: [] };
}

async function handleGameweekStatus(
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const { gameweek, status } = event.payload as {
    gameweek?: number; status: "upcoming" | "active" | "finished";
  };
  const gw = gameweek ?? event.gameweek;
  if (!gw) throw new Error("gameweek required for gameweek.status_changed");
  const { error } = await supabase
    .from("wm_gameweeks")
    .update({ status })
    .eq("tournament_id", event.tournament_id)
    .eq("gameweek", gw);
  if (error) throw new Error("gameweek status update failed: " + error.message);
  return { applied: ["wm_gameweeks.status"], warnings: [] };
}

async function handleNationEliminated(
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const { nation_id, eliminated_after_gameweek } = event.payload as {
    nation_id: string; eliminated_after_gameweek: number;
  };
  const { error } = await supabase
    .from("wm_nations")
    .update({ eliminated_after_gameweek })
    .eq("id", nation_id);
  if (error) throw new Error("nation elimination failed: " + error.message);

  const applied = ["wm_nations.eliminated_after_gameweek"];
  const warnings: string[] = [];

  // Fan-out to all leagues in this tournament
  const { data: nation } = await supabase
    .from("wm_nations")
    .select("name, flag_url")
    .eq("id", nation_id)
    .maybeSingle();

  const src = (event.source === "simulator" ? "simulator" : "ingest_api") as "simulator" | "ingest_api";
  const msg = nationEliminatedMessage(
    nation?.name ?? "Unbekannte Nation",
    nation?.flag_url ?? null,
    eliminated_after_gameweek,
    src,
    nation_id,
  );
  await fanOutSystemMessage(supabase, event.tournament_id, msg.content, msg.meta);
  applied.push("league_messages:nation_eliminated");

  return { applied, warnings };
}

async function handlePlayerStatUpdate(
  leagueId: string,
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const applied: string[] = [];
  const warnings: string[] = [];

  const p = event.payload as {
    player_id: number;
    goals?: number; assists?: number; minutes?: number;
    shots_on?: number; key_passes?: number; pass_accuracy?: number;
    dribbles?: number; tackles?: number; interceptions?: number;
    saves?: number; yellow_cards?: number; red_cards?: number;
    clean_sheet?: boolean;
  };

  const gw = event.gameweek;
  if (!gw) {
    warnings.push("gameweek missing — player.stat_update skipped");
    return { applied, warnings };
  }

  // Lookup player name + position
  const { data: player } = await supabase
    .from("players").select("name, position").eq("id", p.player_id).maybeSingle();
  if (!player?.position) warnings.push(`player ${p.player_id} position not found, defaulted to MF`);

  // Lookup player nation for this tournament
  const { data: playerNationRow } = await supabase
    .from("wm_player_nations")
    .select("wm_nations(*)")
    .eq("player_id", p.player_id)
    .eq("tournament_id", event.tournament_id)
    .maybeSingle();
  const nation = (playerNationRow?.wm_nations as unknown as WMNation | null) ?? null;

  // Find all teams in this league that have this player
  const { data: squadEntries } = await supabase
    .from("wm_squad_players")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("player_id", p.player_id);

  if (!squadEntries?.length) {
    warnings.push(`player ${p.player_id} not in any squad in league ${leagueId}`);
    return { applied, warnings };
  }

  // Load league scoring rules (once)
  const { data: settings } = await supabase
    .from("wm_league_settings").select("scoring_rules").eq("league_id", leagueId).maybeSingle();

  const stats: GWStats = {
    position: ((player?.position as Position) ?? "MF"),
    goals:          p.goals ?? 0,
    assists:        p.assists ?? 0,
    minutes:        p.minutes ?? 0,
    shots_on:       p.shots_on ?? 0,
    key_passes:     p.key_passes ?? 0,
    pass_accuracy:  p.pass_accuracy ?? 0,
    dribbles:       p.dribbles ?? 0,
    tackles:        p.tackles ?? 0,
    interceptions:  p.interceptions ?? 0,
    saves:          p.saves ?? 0,
    yellow_cards:   p.yellow_cards ?? 0,
    red_cards:      p.red_cards ?? 0,
    clean_sheet:    p.clean_sheet ?? false,
  };

  const succeededTeamIds: string[] = [];

  for (const entry of squadEntries) {
    // Load lineup to determine starter status, captain and vice-captain
    const { data: lineup } = await supabase
      .from("team_lineups")
      .select("captain_id, vice_captain_id, starting_xi")
      .eq("team_id", entry.team_id)
      .eq("gameweek", gw)
      .maybeSingle();

    const { score, isCaptain, reason } = shouldScorePlayer(p.player_id, lineup);
    if (!score) {
      if (reason === "no_lineup") {
        warnings.push(`no lineup for team ${entry.team_id} GW${gw} — skipping points`);
      }
      continue; // Bankspieler oder fehlendes Lineup → keine Punkte
    }

    // Vice-captain fallback: VC gets captain_multiplier only when captain did not play.
    // "Did not play" = captain has no wm_gameweek_points row for this GW, or minutes === 0.
    // isCaptain always takes precedence.
    let isViceCaptain = false;
    const vcId = (lineup as { vice_captain_id?: number | null } | null)?.vice_captain_id ?? null;
    if (!isCaptain && vcId !== null && p.player_id === vcId) {
      const captainId = (lineup as { captain_id?: number | null } | null)?.captain_id ?? null;
      if (captainId !== null) {
        const { data: captainPoints } = await supabase
          .from("wm_gameweek_points")
          .select("minutes")
          .eq("team_id", entry.team_id)
          .eq("player_id", captainId)
          .eq("gameweek", gw)
          .maybeSingle();
        // Fallback active if captain has no row or minutes === 0
        const captainMinutes = captainPoints?.minutes ?? 0;
        isViceCaptain = captainMinutes === 0;
      }
    }

    const result = calculateWMGameweekPoints(stats, nation, gw, isCaptain, settings?.scoring_rules, isViceCaptain);

    const { error } = await supabase
      .from("wm_gameweek_points")
      .upsert({
        team_id:      entry.team_id,
        player_id:    p.player_id,
        gameweek:     gw,
        league_id:    leagueId,
        points:       result.points,
        goals:        p.goals ?? 0,
        assists:      p.assists ?? 0,
        minutes:      p.minutes ?? 0,
        shots_on:     p.shots_on ?? 0,
        key_passes:   p.key_passes ?? 0,
        tackles:      p.tackles ?? 0,
        saves:        p.saves ?? 0,
        yellow_cards: p.yellow_cards ?? 0,
        red_cards:    p.red_cards ?? 0,
        clean_sheet:  p.clean_sheet ?? false,
        nation_active: result.nation_active,
        is_captain:   isCaptain || isViceCaptain,
      }, { onConflict: "team_id,player_id,gameweek" });

    if (error) {
      warnings.push(`upsert failed for team ${entry.team_id}: ${error.message}`);
    } else {
      applied.push(`wm_gameweek_points:${entry.team_id}:${p.player_id}`);
      succeededTeamIds.push(entry.team_id);
    }
  }

  // ── total_points live rebuild ─────────────────────────────────────────────
  // For every team whose GW-points upsert succeeded, recompute teams.total_points
  // by summing ALL wm_gameweek_points rows for that team (across all GWs).
  // SUM-based rebuild (not increment) → idempotent, safe under concurrent writes.
  // Failure here is non-fatal: GW-points are already written; recovery via rebuild-points API.
  for (const teamId of succeededTeamIds) {
    const { data: allPts, error: sumError } = await supabase
      .from("wm_gameweek_points")
      .select("points")
      .eq("team_id", teamId);

    if (sumError) {
      warnings.push(`total_points sum failed for team ${teamId}: ${sumError.message}`);
      continue;
    }

    const newTotal = Math.round(
      (allPts ?? []).reduce((s, r) => s + (r.points ?? 0), 0) * 10,
    ) / 10;

    const { error: updateError } = await supabase
      .from("teams")
      .update({ total_points: newTotal })
      .eq("id", teamId);

    if (updateError) {
      warnings.push(`total_points update failed for team ${teamId}: ${updateError.message}`);
    } else {
      applied.push(`teams.total_points:${teamId}:${newTotal}`);
    }
  }

  // ── Goal system message ───────────────────────────────────────────────────
  // Write once per stat-update (not per team) when goals > 0
  if ((p.goals ?? 0) > 0 && player?.name) {
    const src = (event.source === "simulator" ? "simulator" : "ingest_api") as "simulator" | "ingest_api";

    // Find the live fixture for this player's nation
    let fixtureId: string | undefined;
    if (nation?.id) {
      const { data: fixtureRow } = await supabase
        .from("wm_fixtures")
        .select("id")
        .eq("tournament_id", event.tournament_id)
        .eq("status", "live")
        .or(`home_nation_id.eq.${nation.id},away_nation_id.eq.${nation.id}`)
        .maybeSingle();
      fixtureId = fixtureRow?.id;
    }

    const msg = goalMessage(
      player.name,
      nation?.name ?? "Unbekannte Nation",
      nation?.flag_url ?? null,
      p.goals ?? 1,
      src,
      p.player_id,
      fixtureId,
    );
    await writeSystemMessage(supabase, leagueId, msg.content, msg.meta);
    applied.push("league_messages:goal");
  }

  return { applied, warnings };
}

// ── Auto-Sub handler ──────────────────────────────────────────────────────────

/** @internal exported for unit tests only — use processIngestEvent in production */
export async function handleAutoSub(
  leagueId: string,
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const p   = event.payload as unknown as AutoSubPayload;
  const gw  = event.gameweek;
  const applied: string[] = [];
  const warnings: string[] = [];

  // ── Persist starting_xi + bench + team_substitutions (idempotent) ───────────
  if (gw === undefined) {
    warnings.push("missing_gameweek");
    console.warn("[handleAutoSub] event.gameweek undefined — cannot persist lineup changes");
  } else {
    const { data: lineup } = await supabase
      .from("team_lineups")
      .select("starting_xi, bench")
      .eq("team_id", p.team_id)
      .eq("gameweek", gw)
      .maybeSingle();

    if (!lineup) {
      warnings.push("lineup_not_found");
      console.warn(`[handleAutoSub] no lineup for team ${p.team_id} gw${gw}`);
    } else {
      const { startingXI: newXI, bench: newBench, applied: wasNew } = applyAutoSubToLineup(
        (lineup.starting_xi as number[]) ?? [],
        (lineup.bench       as number[]) ?? [],
        p.player_out_id,
        p.player_in_id,
      );

      if (wasNew) {
        const { error: lineupErr } = await supabase
          .from("team_lineups")
          .update({ starting_xi: newXI, bench: newBench, updated_at: new Date().toISOString() })
          .eq("team_id", p.team_id)
          .eq("gameweek", gw);

        if (lineupErr) {
          warnings.push("lineup_update_failed");
          console.error(`[handleAutoSub] lineup update failed for team ${p.team_id}:`, lineupErr.message);
        } else {
          applied.push("team_lineups:starting_xi");
        }
      }

      // Write team_substitutions — skip if row already exists
      const { data: existingSub } = await supabase
        .from("team_substitutions")
        .select("id")
        .eq("team_id",    p.team_id)
        .eq("gameweek",   gw)
        .eq("player_out", p.player_out_id)
        .eq("player_in",  p.player_in_id)
        .maybeSingle();

      if (!existingSub) {
        const { error: subInsertErr } = await supabase.from("team_substitutions").insert({
          team_id:    p.team_id,
          gameweek:   gw,
          player_out: p.player_out_id,
          player_in:  p.player_in_id,
          reason:     "auto_sub",
          auto:       true,
        });
        if (subInsertErr) {
          warnings.push("sub_insert_failed");
          console.error(`[handleAutoSub] sub record insert failed for team ${p.team_id}:`, subInsertErr.message);
        } else {
          applied.push("team_substitutions:auto_sub");
        }
      }
    }
  }

  // ── System message ───────────────────────────────────────────────────────────
  const src = (event.source === "simulator" ? "simulator" : "ingest_api") as "simulator" | "ingest_api";
  const msg = autoSubMessage(p.team_name, p.player_out_name, p.player_in_name, src, p.team_id);
  await writeSystemMessage(supabase, leagueId, msg.content, msg.meta);
  applied.push("league_messages:auto_sub");

  return { applied, warnings };
}

// ── Waiver-Claim handler ──────────────────────────────────────────────────────

async function handleWaiverClaim(
  leagueId: string,
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const p = event.payload as unknown as WaiverClaimPayload;
  const src = (event.source === "simulator" ? "simulator" : "ingest_api") as "simulator" | "ingest_api";

  if (p.status === "rejected") {
    const reason = p.rejected_reason ?? "höhere Priorität";
    const msg = waiverRejectedMessage(p.team_name, p.player_in_name, reason, src, p.team_id);
    await writeSystemMessage(supabase, leagueId, msg.content, msg.meta);
    return { applied: ["league_messages:waiver_rejected"], warnings: [] };
  }

  // Default: approved
  const msg = waiverMessage(p.team_name, p.player_in_name, p.player_out_name ?? null, src, p.team_id);
  await writeSystemMessage(supabase, leagueId, msg.content, msg.meta);
  return { applied: ["league_messages:waiver"], warnings: [] };
}
