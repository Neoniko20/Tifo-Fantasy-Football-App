// lib/wm-ingest.ts
// Central event-processing library for the WM Ingest Layer.
// All producers (Admin, Simulator, API-Football) use this.
// No route handler logic here — pure processing.

import { createServiceRoleClient } from "@/lib/supabase-server";
import { calculateWMGameweekPoints } from "@/lib/wm-points";
import type {
  WMIngestEvent, WMEventType, ProcessedBy, IngestResult,
  WMNation, Position,
} from "@/lib/wm-types";
import type { GWStats } from "@/lib/wm-points";

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
    case "fixture.status_changed":    return handleFixtureStatus(event, supabase);
    case "fixture.penalties_updated": return handlePenaltiesUpdated(event, supabase);
    case "player.stat_update":        return handlePlayerStatUpdate(leagueId, event, supabase);
    case "gameweek.status_changed":   return handleGameweekStatus(event, supabase);
    case "nation.eliminated":         return handleNationEliminated(event, supabase);
    // Side-effect-only events (system messages added in Phase B2)
    case "gameweek.points_recalculated":
    case "auto_sub.applied":
    case "waiver.claim_processed":
      return { applied: [`event_logged:${event.type}`], warnings: [] };
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
  return { applied: ["wm_fixtures.status"], warnings: [] };
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
  return { applied: ["wm_nations.eliminated_after_gameweek"], warnings: [] };
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

  // Lookup player position
  const { data: player } = await supabase
    .from("players").select("position").eq("id", p.player_id).maybeSingle();
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

  for (const entry of squadEntries) {
    // Check if player is captain this GW for this team
    const { data: lineup } = await supabase
      .from("team_lineups")
      .select("captain_id")
      .eq("team_id", entry.team_id)
      .eq("gameweek", gw)
      .maybeSingle();
    const isCaptain = lineup?.captain_id === p.player_id;

    const result = calculateWMGameweekPoints(stats, nation, gw, isCaptain, settings?.scoring_rules);

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
        is_captain:   isCaptain,
      }, { onConflict: "team_id,player_id,gameweek" });

    if (error) {
      warnings.push(`upsert failed for team ${entry.team_id}: ${error.message}`);
    } else {
      applied.push(`wm_gameweek_points:${entry.team_id}:${p.player_id}`);
    }
  }

  return { applied, warnings };
}
