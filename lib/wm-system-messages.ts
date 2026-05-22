// lib/wm-system-messages.ts
// Writes system messages to league_messages after WM ingest events.
// All messages use kind="system" + structured metadata for LiveTickerStrip
// and LiveEventFeed to consume.
//
// Push Notifications: architecture is open — just add a push call after
// writeSystemMessage() for high-priority messages when LIVE_PUSH_ENABLED=true.

import type { createServiceRoleClient } from "@/lib/supabase-server";

export type SystemMessagePriority = "high" | "medium" | "low";

export interface SystemMessageMeta {
  kind: "system";
  icon: string;
  ticker_text: string;
  priority: SystemMessagePriority;
  source: "simulator" | "ingest_api" | "admin";
  event_type:
    | "goal"
    | "assist"
    | "fixture_start"
    | "fixture_end"
    | "nation_eliminated"
    | "auto_sub"
    | "waiver"
    | "yellow_card"
    | "red_card"
    | "clean_sheet"
    | "gameweek_start"
    | "gameweek_end";
  // Optional relations
  related_player_id?: number;
  related_fixture_id?: string;
  related_nation_id?: string;
  related_team_id?: string;
}

type SupabaseClient = ReturnType<typeof createServiceRoleClient>;

// ── Write a single system message to one league ───────────────────────────────

export async function writeSystemMessage(
  supabase: SupabaseClient,
  leagueId: string,
  content: string,
  meta: SystemMessageMeta,
): Promise<void> {
  const { error } = await supabase.from("league_messages").insert({
    league_id:  leagueId,
    sender_id:  null,
    team_id:    null,
    content,
    kind:       "system",
    metadata:   meta,
  });
  if (error) {
    // Non-fatal: log but don't throw — a missing message isn't worth crashing the ingest
    console.warn(`[wm-system-messages] insert failed for league ${leagueId}:`, error.message);
  }
}

// ── Fan-out to ALL leagues linked to a tournament ─────────────────────────────
// Used for tournament-wide events like nation.eliminated

export async function fanOutSystemMessage(
  supabase: SupabaseClient,
  tournamentId: string,
  content: string,
  meta: SystemMessageMeta,
): Promise<void> {
  const { data: leagues } = await supabase
    .from("wm_league_settings")
    .select("league_id")
    .eq("tournament_id", tournamentId);

  if (!leagues?.length) return;

  await Promise.all(
    leagues.map(({ league_id }) =>
      writeSystemMessage(supabase, league_id, content, meta),
    ),
  );
}

// ── Message Templates ─────────────────────────────────────────────────────────

export function goalMessage(
  playerName: string,
  nationName: string,
  nationFlag: string | null,
  goals: number,
  source: SystemMessageMeta["source"],
  playerId: number,
  fixtureId?: string,
): { content: string; meta: SystemMessageMeta } {
  const flag = nationFlag ?? "🏳";
  const multi = goals > 1 ? ` (${goals}. Tor heute)` : "";
  const ticker = `⚽ ${flag} ${playerName} trifft für ${nationName}${multi}`;
  return {
    content: ticker,
    meta: {
      kind: "system",
      icon: "⚽",
      ticker_text: ticker,
      priority: "high",
      source,
      event_type: "goal",
      related_player_id: playerId,
      related_fixture_id: fixtureId,
    },
  };
}

export function fixtureStartMessage(
  homeName: string,
  homeFlag: string | null,
  awayName: string,
  awayFlag: string | null,
  source: SystemMessageMeta["source"],
  fixtureId: string,
): { content: string; meta: SystemMessageMeta } {
  const hf = homeFlag ?? "🏳";
  const af = awayFlag ?? "🏳";
  const ticker = `🔴 ${hf} ${homeName} – ${awayName} ${af} Anpfiff!`;
  return {
    content: ticker,
    meta: {
      kind: "system",
      icon: "🔴",
      ticker_text: ticker,
      priority: "medium",
      source,
      event_type: "fixture_start",
      related_fixture_id: fixtureId,
    },
  };
}

export function fixtureEndMessage(
  homeName: string,
  homeFlag: string | null,
  homeScore: number,
  awayName: string,
  awayFlag: string | null,
  awayScore: number,
  source: SystemMessageMeta["source"],
  fixtureId: string,
): { content: string; meta: SystemMessageMeta } {
  const hf = homeFlag ?? "🏳";
  const af = awayFlag ?? "🏳";
  const ticker = `✅ Abpfiff: ${hf} ${homeName} ${homeScore}–${awayScore} ${awayName} ${af}`;
  return {
    content: ticker,
    meta: {
      kind: "system",
      icon: "✅",
      ticker_text: ticker,
      priority: "medium",
      source,
      event_type: "fixture_end",
      related_fixture_id: fixtureId,
    },
  };
}

export function nationEliminatedMessage(
  nationName: string,
  nationFlag: string | null,
  afterGameweek: number,
  source: SystemMessageMeta["source"],
  nationId: string,
): { content: string; meta: SystemMessageMeta } {
  const flag = nationFlag ?? "🏳";
  const ticker = `💀 ${flag} ${nationName} nach GW${afterGameweek} ausgeschieden`;
  return {
    content: ticker,
    meta: {
      kind: "system",
      icon: "💀",
      ticker_text: ticker,
      priority: "high",
      source,
      event_type: "nation_eliminated",
      related_nation_id: nationId,
    },
  };
}

export function autoSubMessage(
  teamName: string,
  playerOutName: string,
  playerInName: string,
  source: SystemMessageMeta["source"],
  teamId: string,
): { content: string; meta: SystemMessageMeta } {
  const ticker = `🔄 ${teamName}: ${playerOutName} → ${playerInName} (Auto-Sub)`;
  return {
    content: ticker,
    meta: {
      kind: "system",
      icon: "🔄",
      ticker_text: ticker,
      priority: "medium",
      source,
      event_type: "auto_sub",
      related_team_id: teamId,
    },
  };
}

export function waiverMessage(
  teamName: string,
  playerInName: string,
  playerOutName: string | null,
  source: SystemMessageMeta["source"],
  teamId: string,
): { content: string; meta: SystemMessageMeta } {
  const drop = playerOutName ? ` (gibt ab: ${playerOutName})` : "";
  const ticker = `📋 ${teamName} holt ${playerInName}${drop}`;
  return {
    content: ticker,
    meta: {
      kind: "system",
      icon: "📋",
      ticker_text: ticker,
      priority: "low",
      source,
      event_type: "waiver",
      related_team_id: teamId,
    },
  };
}
