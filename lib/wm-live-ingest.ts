import type { PlayerStatUpdatePayload } from "@/lib/wm-types";

// ── API-Football response types ───────────────────────────────────────────────

export interface AfFixturePlayerEntry {
  player: {
    id: number;
    name: string;
    photo?: string;
  };
  statistics: Array<{
    games: {
      minutes: number | null;
      position: string | null;    // "G" | "D" | "M" | "F"
      captain: boolean | null;
      substitute: boolean | null;
    };
    goals: {
      total: number | null;
      conceded: number | null;
      assists: number | null;
      saves: number | null;
    };
    shots: {
      total: number | null;
      on: number | null;
    };
    passes: {
      total: number | null;
      key: number | null;
      accuracy: string | number | null; // API returns string "38" or number
    };
    tackles: {
      total: number | null;
      blocks: number | null;
      interceptions: number | null;
    };
    dribbles: {
      attempts: number | null;
      success: number | null;
    };
    cards: {
      yellow: number | null;
      red: number | null;
    };
  }>;
}

export interface AfFixtureTeamBlock {
  team: { id: number; name: string };
  players: AfFixturePlayerEntry[];
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

const n = (v: number | null | undefined): number => v ?? 0;

/** Maps one API-Football player-stats entry to PlayerStatUpdatePayload. */
export function mapAfStatToPayload(
  entry: AfFixturePlayerEntry,
): PlayerStatUpdatePayload {
  const s = entry.statistics[0];
  if (!s) return { api_football_player_id: entry.player.id };

  const minutes = n(s.games.minutes);
  const position = (s.games.position ?? "").toUpperCase(); // "G" | "D" | "M" | "F"

  // Clean sheet: goalkeeper or defender who played and conceded 0
  const conceded = n(s.goals.conceded);
  const cleanSheet =
    minutes > 0 && conceded === 0 && (position === "G" || position === "D" || position === "M");

  const passAccuracyRaw = s.passes.accuracy;
  const pass_accuracy =
    passAccuracyRaw != null ? parseInt(String(passAccuracyRaw), 10) || 0 : 0;

  return {
    api_football_player_id: entry.player.id,
    minutes,
    goals:         n(s.goals.total),
    assists:       n(s.goals.assists),
    shots_on:      n(s.shots.on),
    key_passes:    n(s.passes.key),
    pass_accuracy,
    dribbles:      n(s.dribbles.success),
    tackles:       n(s.tackles.total),
    interceptions: n(s.tackles.interceptions),
    saves:         n(s.goals.saves),
    yellow_cards:  n(s.cards.yellow),
    red_cards:     n(s.cards.red),
    clean_sheet:   cleanSheet,
  };
}

/**
 * Hour-bucketed idempotency key for a player-stat-update event.
 * API-Football delivers cumulative stats — a new key per hour allows each
 * polling interval to overwrite the previous score via upsert, while still
 * preventing duplicates within the same hour.
 */
export function makeIngestIdempotencyKey(
  apiFixtureId: number,
  apiPlayerId: number,
  pollHour: string = new Date().toISOString().slice(0, 13), // "2026-06-13T20"
): string {
  return `fixture:${apiFixtureId}:player:${apiPlayerId}:poll:${pollHour}`;
}

/**
 * Returns true if a fixture with the given kickoff is still relevant
 * for live-ingest polling (live or recently finished within windowMs).
 */
export function isFixtureRelevant(
  status: string,
  kickoffIso: string,
  nowMs: number = Date.now(),
  windowMs: number = 3 * 60 * 60 * 1000, // 3 hours
): boolean {
  if (status === "live") return true;
  if (status === "finished") {
    const kickoff = Date.parse(kickoffIso);
    return !isNaN(kickoff) && nowMs - kickoff < windowMs;
  }
  return false;
}
