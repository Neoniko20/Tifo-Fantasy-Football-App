// ═══════════════════════════════════════════════════════
// TIFO — FORMATIONS SYSTEM
// ═══════════════════════════════════════════════════════

import type { Position } from "./wm-types";

export interface FormationSlot {
  position: Position;
  row: number;   // 0=GK, 1=DF-Reihe, 2=MF-Reihe, 3=FW-Reihe
  col: number;   // Position in der Reihe (0-based, zentriert)
}

export interface FormationConfig {
  label: string;
  slots: Record<Position, number>;  // wie viele pro Position
  layout: FormationSlot[];           // für UI-Positionierung auf Spielfeld
  rare?: boolean;                    // seltene Formation – nur via Admin freischaltbar
}

export const FORMATIONS: Record<string, FormationConfig> = {
  "4-3-3": {
    label: "4-3-3",
    slots: { GK: 1, DF: 4, MF: 3, FW: 3 },
    layout: [
      // GK
      { position: "GK", row: 0, col: 2 },
      // DF (4)
      { position: "DF", row: 1, col: 0 },
      { position: "DF", row: 1, col: 1 },
      { position: "DF", row: 1, col: 3 },
      { position: "DF", row: 1, col: 4 },
      // MF (3)
      { position: "MF", row: 2, col: 1 },
      { position: "MF", row: 2, col: 2 },
      { position: "MF", row: 2, col: 3 },
      // FW (3)
      { position: "FW", row: 3, col: 1 },
      { position: "FW", row: 3, col: 2 },
      { position: "FW", row: 3, col: 3 },
    ],
  },

  "4-4-2": {
    label: "4-4-2",
    slots: { GK: 1, DF: 4, MF: 4, FW: 2 },
    layout: [
      { position: "GK", row: 0, col: 2 },
      { position: "DF", row: 1, col: 0 },
      { position: "DF", row: 1, col: 1 },
      { position: "DF", row: 1, col: 3 },
      { position: "DF", row: 1, col: 4 },
      { position: "MF", row: 2, col: 0 },
      { position: "MF", row: 2, col: 1 },
      { position: "MF", row: 2, col: 3 },
      { position: "MF", row: 2, col: 4 },
      { position: "FW", row: 3, col: 1 },
      { position: "FW", row: 3, col: 3 },
    ],
  },

  "3-5-2": {
    label: "3-5-2",
    slots: { GK: 1, DF: 3, MF: 5, FW: 2 },
    layout: [
      { position: "GK", row: 0, col: 2 },
      { position: "DF", row: 1, col: 1 },
      { position: "DF", row: 1, col: 2 },
      { position: "DF", row: 1, col: 3 },
      { position: "MF", row: 2, col: 0 },
      { position: "MF", row: 2, col: 1 },
      { position: "MF", row: 2, col: 2 },
      { position: "MF", row: 2, col: 3 },
      { position: "MF", row: 2, col: 4 },
      { position: "FW", row: 3, col: 1 },
      { position: "FW", row: 3, col: 3 },
    ],
  },

  "5-3-2": {
    label: "5-3-2",
    slots: { GK: 1, DF: 5, MF: 3, FW: 2 },
    layout: [
      { position: "GK", row: 0, col: 2 },
      { position: "DF", row: 1, col: 0 },
      { position: "DF", row: 1, col: 1 },
      { position: "DF", row: 1, col: 2 },
      { position: "DF", row: 1, col: 3 },
      { position: "DF", row: 1, col: 4 },
      { position: "MF", row: 2, col: 1 },
      { position: "MF", row: 2, col: 2 },
      { position: "MF", row: 2, col: 3 },
      { position: "FW", row: 3, col: 1 },
      { position: "FW", row: 3, col: 3 },
    ],
  },

  "3-4-3": {
    label: "3-4-3",
    slots: { GK: 1, DF: 3, MF: 4, FW: 3 },
    layout: [
      { position: "GK", row: 0, col: 2 },
      { position: "DF", row: 1, col: 1 },
      { position: "DF", row: 1, col: 2 },
      { position: "DF", row: 1, col: 3 },
      { position: "MF", row: 2, col: 0 },
      { position: "MF", row: 2, col: 1 },
      { position: "MF", row: 2, col: 3 },
      { position: "MF", row: 2, col: 4 },
      { position: "FW", row: 3, col: 1 },
      { position: "FW", row: 3, col: 2 },
      { position: "FW", row: 3, col: 3 },
    ],
  },

  "4-5-1": {
    label: "4-5-1",
    slots: { GK: 1, DF: 4, MF: 5, FW: 1 },
    layout: [
      { position: "GK", row: 0, col: 2 },
      { position: "DF", row: 1, col: 0 },
      { position: "DF", row: 1, col: 1 },
      { position: "DF", row: 1, col: 3 },
      { position: "DF", row: 1, col: 4 },
      { position: "MF", row: 2, col: 0 },
      { position: "MF", row: 2, col: 1 },
      { position: "MF", row: 2, col: 2 },
      { position: "MF", row: 2, col: 3 },
      { position: "MF", row: 2, col: 4 },
      { position: "FW", row: 3, col: 2 },
    ],
  },

  "5-4-1": {
    label: "5-4-1",
    slots: { GK: 1, DF: 5, MF: 4, FW: 1 },
    layout: [
      { position: "GK", row: 0, col: 2 },
      { position: "DF", row: 1, col: 0 },
      { position: "DF", row: 1, col: 1 },
      { position: "DF", row: 1, col: 2 },
      { position: "DF", row: 1, col: 3 },
      { position: "DF", row: 1, col: 4 },
      { position: "MF", row: 2, col: 0 },
      { position: "MF", row: 2, col: 1 },
      { position: "MF", row: 2, col: 3 },
      { position: "MF", row: 2, col: 4 },
      { position: "FW", row: 3, col: 2 },
    ],
  },

  "5-2-3": {
    label: "5-2-3",
    slots: { GK: 1, DF: 5, MF: 2, FW: 3 },
    layout: [
      { position: "GK", row: 0, col: 2 },
      { position: "DF", row: 1, col: 0 },
      { position: "DF", row: 1, col: 1 },
      { position: "DF", row: 1, col: 2 },
      { position: "DF", row: 1, col: 3 },
      { position: "DF", row: 1, col: 4 },
      { position: "MF", row: 2, col: 1 },
      { position: "MF", row: 2, col: 3 },
      { position: "FW", row: 3, col: 1 },
      { position: "FW", row: 3, col: 2 },
      { position: "FW", row: 3, col: 3 },
    ],
  },

  "3-6-1": {
    label: "3-6-1",
    slots: { GK: 1, DF: 3, MF: 6, FW: 1 },
    layout: [
      { position: "GK", row: 0, col: 2 },
      { position: "DF", row: 1, col: 1 },
      { position: "DF", row: 1, col: 2 },
      { position: "DF", row: 1, col: 3 },
      { position: "MF", row: 2, col: 0 },
      { position: "MF", row: 2, col: 1 },
      { position: "MF", row: 2, col: 2 },
      { position: "MF", row: 3, col: 2 },
      { position: "MF", row: 3, col: 3 },
      { position: "MF", row: 3, col: 4 },
      { position: "FW", row: 4, col: 2 },
    ],
  },

  // ── Seltene Formationen (nur per Admin freischaltbar) ──────────────

  "4-2-4": {
    label: "4-2-4",
    rare: true,
    slots: { GK: 1, DF: 4, MF: 2, FW: 4 },
    layout: [
      { position: "GK", row: 0, col: 2 },
      { position: "DF", row: 1, col: 0 },
      { position: "DF", row: 1, col: 1 },
      { position: "DF", row: 1, col: 3 },
      { position: "DF", row: 1, col: 4 },
      { position: "MF", row: 2, col: 1 },
      { position: "MF", row: 2, col: 3 },
      { position: "FW", row: 3, col: 0 },
      { position: "FW", row: 3, col: 1 },
      { position: "FW", row: 3, col: 3 },
      { position: "FW", row: 3, col: 4 },
    ],
  },

  "3-3-4": {
    label: "3-3-4",
    rare: true,
    slots: { GK: 1, DF: 3, MF: 3, FW: 4 },
    layout: [
      { position: "GK", row: 0, col: 2 },
      { position: "DF", row: 1, col: 1 },
      { position: "DF", row: 1, col: 2 },
      { position: "DF", row: 1, col: 3 },
      { position: "MF", row: 2, col: 1 },
      { position: "MF", row: 2, col: 2 },
      { position: "MF", row: 2, col: 3 },
      { position: "FW", row: 3, col: 0 },
      { position: "FW", row: 3, col: 1 },
      { position: "FW", row: 3, col: 3 },
      { position: "FW", row: 3, col: 4 },
    ],
  },

  "4-6-0": {
    label: "4-6-0",
    rare: true,
    slots: { GK: 1, DF: 4, MF: 6, FW: 0 },
    layout: [
      { position: "GK", row: 0, col: 2 },
      { position: "DF", row: 1, col: 0 },
      { position: "DF", row: 1, col: 1 },
      { position: "DF", row: 1, col: 3 },
      { position: "DF", row: 1, col: 4 },
      { position: "MF", row: 2, col: 1 },  // 2 defensive MF
      { position: "MF", row: 2, col: 3 },
      { position: "MF", row: 3, col: 0 },  // 4 attacking MF
      { position: "MF", row: 3, col: 1 },
      { position: "MF", row: 3, col: 3 },
      { position: "MF", row: 3, col: 4 },
    ],
  },
};

// ── Validation ──────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Prüft ob die Startelf zur gewählten Formation passt */
export function validateFormation(
  playerPositions: Position[],
  formation: string
): ValidationResult {
  const config = FORMATIONS[formation];
  if (!config) return { valid: false, errors: [`Unbekannte Formation: ${formation}`] };

  const errors: string[] = [];
  const counts = countPositions(playerPositions);

  for (const [pos, needed] of Object.entries(config.slots) as [Position, number][]) {
    const has = counts[pos] ?? 0;
    if (has !== needed) {
      errors.push(`${pos}: ${has}/${needed}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Prüft ob Kader die Position-Limits einhält (min/max) */
export function validatePositionLimits(
  playerPositions: Position[],
  limits: Record<Position, { min: number; max: number }>
): ValidationResult {
  const errors: string[] = [];
  const counts = countPositions(playerPositions);

  for (const [pos, limit] of Object.entries(limits) as [Position, { min: number; max: number }][]) {
    const has = counts[pos] ?? 0;
    if (has < limit.min) errors.push(`Zu wenige ${pos}: ${has}/${limit.min} min`);
    if (has > limit.max) errors.push(`Zu viele ${pos}: ${has}/${limit.max} max`);
  }

  return { valid: errors.length === 0, errors };
}

/** Berechnet Gesamtkader-Größe aus Settings */
export function totalSquadSize(squadSize: number, benchSize: number): number {
  return squadSize + benchSize;
}

/** Berechnet Draft-Runden aus Kader-Größe */
export function draftRounds(squadSize: number, benchSize: number): number {
  return totalSquadSize(squadSize, benchSize);
}

/** Hilfsfunktion: zählt Positionen */
function countPositions(positions: Position[]): Record<Position, number> {
  return positions.reduce((acc, pos) => {
    acc[pos] = (acc[pos] ?? 0) + 1;
    return acc;
  }, {} as Record<Position, number>);
}

/** Gibt erlaubte Formationen für eine Position-Limits-Config zurück */
export function compatibleFormations(
  limits: Record<Position, { min: number; max: number }>
): string[] {
  return Object.keys(FORMATIONS).filter(key => {
    const slots = FORMATIONS[key].slots;
    for (const [pos, count] of Object.entries(slots) as [Position, number][]) {
      const limit = limits[pos];
      if (!limit) return false;
      if (count < limit.min || count > limit.max) return false;
    }
    return true;
  });
}

export const FORMATION_KEYS = Object.keys(FORMATIONS);
