// ═══════════════════════════════════════════════════════
// TIFO — WM PUNKTE-BERECHNUNG
// Gleiche Logik wie Liga, aber mit Nation-Status-Check
// ═══════════════════════════════════════════════════════

import type { Position, WMNation } from "./wm-types";

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
 */
export function calculateWMGameweekPoints(
  stats: GWStats,
  nation: WMNation | null,
  gameweek: number,
  isCaptain = false
): GWPointsResult {
  // Nation-Check: ist das Team noch im Turnier?
  const nation_active =
    !nation?.eliminated_after_gameweek ||
    gameweek <= nation.eliminated_after_gameweek;

  if (!nation_active) {
    return {
      points: 0,
      nation_active: false,
      breakdown: { ...stats },
    };
  }

  let p = 0;
  const pos = stats.position;

  // Tore (positionsabhängig)
  if (pos === "GK" || pos === "DF") p += stats.goals * 6;
  else if (pos === "MF")            p += stats.goals * 5;
  else                              p += stats.goals * 4; // FW

  // Assists
  p += stats.assists * 3;

  // Clean Sheet (positionsabhängig)
  if (stats.clean_sheet) {
    if (pos === "GK" || pos === "DF") p += 4;
    else if (pos === "MF")            p += 1;
  }

  // Saves (nur GK)
  if (pos === "GK") p += stats.saves * 1.5;

  // Offensive Stats
  p += stats.shots_on * 0.5;
  p += stats.key_passes * 0.8;
  p += (stats.pass_accuracy / 100) * 0.5;
  p += stats.dribbles * 0.2;

  // Defensive Stats
  p += stats.tackles * 0.6;
  p += stats.interceptions * 0.6;

  // Karten
  p -= stats.yellow_cards * 1;
  p -= stats.red_cards * 3;

  // Spielzeit
  if (stats.minutes >= 60) p += 1;
  else if (stats.minutes > 0) p += 0.4;

  const base = Math.round(p * 10) / 10;
  const captain_bonus = isCaptain ? base : 0;

  return {
    points: base + captain_bonus,
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
