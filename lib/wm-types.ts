// ═══════════════════════════════════════════════════════
// TIFO — WM MODUS TYPEN
// ═══════════════════════════════════════════════════════

import type { ScoringRules } from "./scoring";

export type WMPhase = "group" | "round_of_32" | "round_of_16" | "quarter" | "semi" | "final";
export type WMStatus = "upcoming" | "active" | "finished";
export type WaiverSystem = "priority" | "budget" | "none";
export type Position = "GK" | "DF" | "MF" | "FW";

export interface WMTournament {
  id: string;
  name: string;
  season: number;
  api_league_id?: number;
  start_date: string;
  end_date: string;
  status: WMStatus;
}

export interface WMNation {
  id: string;
  tournament_id: string;
  api_team_id?: number;
  name: string;
  code: string;
  flag_url?: string;
  group_letter?: string;
  group_position?: number;
  eliminated_after_gameweek?: number | null;
  final_position?: number;
}

export interface WMGameweek {
  id: string;
  tournament_id: string;
  gameweek: number;
  label: string;
  phase: WMPhase;
  start_date?: string;
  end_date?: string;
  deadline?: string;        // ISO timestamptz — Lineup-Abgabefrist
  updated_at?: string;
  status: WMStatus;
  transfer_window_open: boolean;
  waiver_window_open: boolean;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

export type WMFixtureStatus = "scheduled" | "live" | "finished";

export type WMStage =
  | "group"
  | "round_of_32"
  | "round_of_16"
  | "quarter"
  | "semi"
  | "final";

export interface WMFixture {
  id: string;
  tournament_id: string;
  gameweek: number;
  stage: WMStage;
  home_nation_id: string;
  away_nation_id: string;
  kickoff: string;         // ISO timestamptz
  stadium?: string | null;
  city?: string | null;
  status: WMFixtureStatus;
  home_score: number | null;
  away_score: number | null;
  penalties_home?: number | null;   // display only — no scoring impact
  penalties_away?: number | null;
  api_fixture_id?: number | null;
  created_at?: string;
  // Joined relations (optional — populated by select with FK expansion)
  home_nation?: WMNation;
  away_nation?: WMNation;
}

export interface PositionLimit {
  min: number;
  max: number;
}

export interface WMLeagueSettings {
  id?: string;
  league_id: string;
  tournament_id: string;

  // Kader
  squad_size: number;
  bench_size: number;
  position_limits: Record<Position, PositionLimit>;
  allowed_formations: string[];

  // Transfers
  transfers_per_gameweek: number;
  transfers_unlimited: boolean;

  // Waiver
  waiver_mode_starts_gameweek: number;
  waiver_priority_enabled: boolean;
  waiver_budget_enabled: boolean;
  waiver_budget_starting: number;
  waiver_claims_limit_enabled: boolean;
  waiver_max_claims_per_gameweek: number;

  // Auto-Subs
  auto_subs_enabled: boolean;

  // Scoring
  scoring_rules?: Partial<ScoringRules> | null;
}

export interface TeamLineup {
  id?: string;
  team_id: string;
  tournament_id: string;
  gameweek: number;
  formation: string;
  starting_xi: number[];  // player_ids in Positions-Reihenfolge
  bench: number[];        // player_ids
  captain_id?: number;
  vice_captain_id?: number;
  locked: boolean;
}

export interface WaiverClaim {
  id?: string;
  league_id: string;
  team_id: string;
  player_in: number;
  player_out?: number;
  gameweek: number;
  priority: number;
  bid_amount: number;  // für FAAB
  status: "pending" | "approved" | "rejected";
  rejected_reason?: string;
}

export interface WaiverPriority {
  team_id: string;
  priority: number;  // 1 = schlechtester = darf zuerst
  gameweek: number;
}

export interface WMGameweekPoints {
  player_id: number;
  league_id: string;
  gameweek: number;
  points: number;
  nation_active: boolean;
  goals: number;
  assists: number;
  minutes: number;
  shots_on: number;
  key_passes: number;
  tackles: number;
  saves: number;
  yellow_cards: number;
  red_cards: number;
  clean_sheet: boolean;
}

// ── Ingest Layer Types ─────────────────────────────────────────────────────────

export type WMEventType =
  | "fixture.status_changed"       // scheduled → live → finished
  | "fixture.score_updated"        // home_score, away_score
  | "fixture.penalties_updated"    // penalties_home, penalties_away
  | "player.stat_update"           // goals, assists, minutes, cards, saves, clean_sheet
  | "gameweek.status_changed"      // upcoming → active → finished
  | "nation.eliminated"            // nach einem GW ausgeschieden
  | "gameweek.points_recalculated" // Punkte neu berechnet — triggert Live Center
  | "auto_sub.applied"             // Auto-Sub durchgeführt — triggert Chat
  | "waiver.claim_processed";      // Waiver-Entscheidung — triggert Chat

export interface WMIngestEvent {
  type: WMEventType;
  version?: 1;               // Event-Schema-Version; immer 1 setzen für Zukunftssicherheit
  tournament_id: string;
  gameweek?: number;
  payload: Record<string, unknown>;
  idempotency_key?: string;  // Simulator + API-Football Sync
  source?: "simulator" | "admin" | "api_football";
}

export type ProcessedBy =
  | "ingest_api"
  | "simulator"
  | "recovery_job"
  | "manual_admin"
  | "api_football_sync";

export interface IngestResult {
  ok: boolean;
  event_id?: string;
  applied: string[];
  warnings: string[];
  error?: string;
}

// Default-Werte für neue Liga-Settings
export const DEFAULT_WM_SETTINGS: Omit<WMLeagueSettings, "league_id" | "tournament_id"> = {
  squad_size: 11,
  bench_size: 4,
  position_limits: {
    GK: { min: 1, max: 2 },
    DF: { min: 2, max: 5 },
    MF: { min: 2, max: 5 },
    FW: { min: 1, max: 3 },
  },
  allowed_formations: ["4-3-3", "4-2-3-1", "3-5-2", "5-3-2", "4-4-2", "3-4-3"],
  transfers_per_gameweek: 3,
  transfers_unlimited: false,
  waiver_mode_starts_gameweek: 4,
  waiver_priority_enabled: true,
  waiver_budget_enabled: false,
  waiver_budget_starting: 100,
  waiver_claims_limit_enabled: true,
  waiver_max_claims_per_gameweek: 3,
  auto_subs_enabled: true,
};
