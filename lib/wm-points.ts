// ═══════════════════════════════════════════════════════
// TIFO — WM PUNKTE-BERECHNUNG
// Gleiche Logik wie Liga, nutzt ScoringRules aus lib/scoring.ts
// ═══════════════════════════════════════════════════════

import type { Position, WMNation } from "./wm-types";
import { mergeRules, type ScoringRules } from "./scoring";

export type { ScoringRules };

export interface GWStats {
  goals: number;
  assists: number;
  minutes: number;
  shots_on: number;
  key_passes: number;
  pass_accuracy: number;
  dribbles: number;
  tackles: number;
  interceptions: number;
  saves: number;
  clean_sheet: boolean;
  yellow_cards: number;
  red_cards: number;
  position: Position;
}

export interface GWPointsResult {
  points: number;
  nation_active: boolean;
  breakdown: GWStats & { position: Position };
}

/**
 * Berechnet Punkte für einen Spieler in einem Gameweek.
 * Gibt 0 zurück wenn die Nation des Spielers ausgeschieden ist.
 * rules=undefined → DEFAULT_SCORING_RULES (identisches Ergebnis wie vorher)
 */
export function calculateWMGameweekPoints(
  stats: GWStats,
  nation: WMNation | null,
  gameweek: number,
  isCaptain = false,
  rules?: Partial<ScoringRules> | null,
  isViceCaptain = false,
): GWPointsResult {
  const nation_active =
    !nation?.eliminated_after_gameweek ||
    gameweek <= nation.eliminated_after_gameweek;

  if (!nation_active) {
    return { points: 0, nation_active: false, breakdown: { ...stats } };
  }

  const r = mergeRules(rules);
  let p = 0;
  const pos = stats.position;

  // Tore (positionsabhängig)
  if (pos === "GK")      p += stats.goals * r.goal_gk;
  else if (pos === "DF") p += stats.goals * r.goal_df;
  else if (pos === "MF") p += stats.goals * r.goal_mf;
  else                   p += stats.goals * r.goal_fw;

  // Assists
  p += stats.assists * r.assist;

  // Clean Sheet (positionsabhängig)
  if (stats.clean_sheet) {
    if (pos === "GK")       p += r.clean_sheet_gk;
    else if (pos === "DF")  p += r.clean_sheet_df;
    else if (pos === "MF")  p += r.clean_sheet_mf;
    // FW: r.clean_sheet_fw (default 0) — nothing to add
  }

  // Saves (nur GK)
  if (pos === "GK") p += stats.saves * r.save;

  // Offensive Stats
  p += stats.shots_on   * r.shot_on_target;
  p += stats.key_passes * r.key_pass;
  p += (stats.pass_accuracy / 100) * r.pass_accuracy;
  p += stats.dribbles   * r.dribble;

  // Defensive Stats
  p += stats.tackles       * r.tackle;
  p += stats.interceptions * r.interception;

  // Karten
  p -= stats.yellow_cards * Math.abs(r.yellow_card);
  p -= stats.red_cards    * Math.abs(r.red_card);

  // Spielzeit
  if (stats.minutes >= 60)     p += r.minutes_full;
  else if (stats.minutes > 0)  p += r.minutes_partial;

  const base = Math.round(p * 10) / 10;

  // isCaptain takes precedence; isViceCaptain applies captain_multiplier only
  // when captain did not play (determined by caller via DB lookup).
  const actingCaptain = isCaptain || isViceCaptain;
  return {
    points: actingCaptain ? base * r.captain_multiplier : base,
    nation_active: true,
    breakdown: { ...stats },
  };
}

/**
 * Berechnet Saison-Totalpunkte eines Teams aus allen GW-Punkten.
 */
export function calculateTeamTotal(gwPoints: { points: number }[]): number {
  return Math.round(
    gwPoints.reduce((sum, gw) => sum + gw.points, 0) * 10
  ) / 10;
}
