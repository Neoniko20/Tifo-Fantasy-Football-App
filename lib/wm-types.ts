// ═══════════════════════════════════════════════════════
// TIFO — WM MODUS TYPEN
// ═══════════════════════════════════════════════════════

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
  status: WMStatus;
  transfer_window_open: boolean;
  waiver_window_open: boolean;
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
