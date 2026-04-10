/**
 * lib/scoring.ts — Configurable points engine (F-34)
 *
 * All scoring weights are stored as ScoringRules and saved per league in
 * liga_settings.scoring_rules (JSONB).  Falls back to DEFAULT_SCORING_RULES
 * when no custom rules are present.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoringRules {
  // Goals — per position
  goal_gk:          number;  // default 6
  goal_df:          number;  // default 6
  goal_mf:          number;  // default 5
  goal_fw:          number;  // default 4

  // Assists
  assist:           number;  // default 3

  // Clean sheet — per position
  clean_sheet_gk:   number;  // default 4
  clean_sheet_df:   number;  // default 4
  clean_sheet_mf:   number;  // default 1
  clean_sheet_fw:   number;  // default 0

  // GK-specific
  save:             number;  // default 1.5

  // Attacking / creative
  shot_on_target:   number;  // default 0.5
  key_pass:         number;  // default 0.8

  // Technical (per 1% — e.g. 0.5 means pass_accuracy/100 * 0.5)
  pass_accuracy:    number;  // default 0.5

  // Defensive
  dribble:          number;  // default 0.2
  tackle:           number;  // default 0.6
  interception:     number;  // default 0.6

  // Discipline
  yellow_card:      number;  // default −1
  red_card:         number;  // default −3

  // Appearance
  minutes_full:     number;  // ≥60 min,  default 1
  minutes_partial:  number;  // 1–59 min, default 0.4

  // Captain
  captain_multiplier: number; // default 2
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults (classic Tifo schema)
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SCORING_RULES: ScoringRules = {
  goal_gk:            6,
  goal_df:            6,
  goal_mf:            5,
  goal_fw:            4,
  assist:             3,
  clean_sheet_gk:     4,
  clean_sheet_df:     4,
  clean_sheet_mf:     1,
  clean_sheet_fw:     0,
  save:               1.5,
  shot_on_target:     0.5,
  key_pass:           0.8,
  pass_accuracy:      0.5,
  dribble:            0.2,
  tackle:             0.6,
  interception:       0.6,
  yellow_card:        -1,
  red_card:           -3,
  minutes_full:       1,
  minutes_partial:    0.4,
  captain_multiplier: 2,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Merge partial overrides on top of defaults — safe for partial JSONB from DB */
export function mergeRules(partial?: Partial<ScoringRules> | null): ScoringRules {
  if (!partial) return DEFAULT_SCORING_RULES;
  return { ...DEFAULT_SCORING_RULES, ...partial };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core calc function
// ─────────────────────────────────────────────────────────────────────────────

export function calcPoints(
  stats:     Record<string, any>,
  position:  string,
  isCaptain: boolean,
  rules?:    Partial<ScoringRules> | null,
): number {
  const r = mergeRules(rules);

  const goals    = stats.goals        || 0;
  const assists  = stats.assists      || 0;
  const minutes  = stats.minutes      || 0;
  const shotsOn  = stats.shots_on     || 0;
  const keyPass  = stats.key_passes   || 0;
  const passAcc  = stats.pass_accuracy || 0;
  const dribbles = stats.dribbles     || 0;
  const tackles  = stats.tackles      || 0;
  const intercep = stats.interceptions || 0;
  const saves    = stats.saves        || 0;
  const yellow   = stats.yellow_cards || 0;
  const red      = stats.red_cards    || 0;
  const cs       = stats.clean_sheet  || false;

  let p = 0;

  // Goals
  if      (position === "GK") p += goals * r.goal_gk;
  else if (position === "DF") p += goals * r.goal_df;
  else if (position === "MF") p += goals * r.goal_mf;
  else                        p += goals * r.goal_fw;

  // Assists
  p += assists * r.assist;

  // Clean sheet
  if (cs) {
    if      (position === "GK") p += r.clean_sheet_gk;
    else if (position === "DF") p += r.clean_sheet_df;
    else if (position === "MF") p += r.clean_sheet_mf;
    else                        p += r.clean_sheet_fw;
  }

  // GK saves
  if (position === "GK") p += saves * r.save;

  // Technical
  p += shotsOn  * r.shot_on_target;
  p += keyPass  * r.key_pass;
  p += (passAcc / 100) * r.pass_accuracy;
  p += dribbles * r.dribble;
  p += tackles  * r.tackle;
  p += intercep * r.interception;

  // Discipline
  p -= yellow * Math.abs(r.yellow_card);
  p -= red    * Math.abs(r.red_card);

  // Appearance
  if      (minutes >= 60) p += r.minutes_full;
  else if (minutes  >  0) p += r.minutes_partial;

  const base = Math.round(p * 10) / 10;
  return isCaptain ? base * r.captain_multiplier : base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor metadata — used to render the settings UI
// ─────────────────────────────────────────────────────────────────────────────

export interface RuleGroup {
  label:   string;
  color:   string;
  fields:  { key: keyof ScoringRules; label: string; step: number; min: number; max: number }[];
}

export const RULE_GROUPS: RuleGroup[] = [
  {
    label: "Tore",
    color: "#f5a623",
    fields: [
      { key: "goal_gk", label: "TW", step: 0.5, min: 0, max: 20 },
      { key: "goal_df", label: "AB", step: 0.5, min: 0, max: 20 },
      { key: "goal_mf", label: "MF", step: 0.5, min: 0, max: 20 },
      { key: "goal_fw", label: "ST", step: 0.5, min: 0, max: 20 },
    ],
  },
  {
    label: "Vorlagen",
    color: "#f5a623",
    fields: [
      { key: "assist", label: "Assist", step: 0.5, min: 0, max: 10 },
    ],
  },
  {
    label: "Zu-Null",
    color: "#4a9eff",
    fields: [
      { key: "clean_sheet_gk", label: "TW",   step: 0.5, min: 0, max: 10 },
      { key: "clean_sheet_df", label: "AB",   step: 0.5, min: 0, max: 10 },
      { key: "clean_sheet_mf", label: "MF",   step: 0.5, min: 0, max: 10 },
      { key: "clean_sheet_fw", label: "ST",   step: 0.5, min: 0, max: 10 },
    ],
  },
  {
    label: "Torwart",
    color: "#f5a623",
    fields: [
      { key: "save", label: "Parade", step: 0.5, min: 0, max: 5 },
    ],
  },
  {
    label: "Angriff / Kreativ",
    color: "#00ce7d",
    fields: [
      { key: "shot_on_target", label: "Schuss aufs Tor", step: 0.1, min: 0, max: 5 },
      { key: "key_pass",       label: "Schlüsselpass",   step: 0.1, min: 0, max: 5 },
      { key: "pass_accuracy",  label: "Passgenauigkeit (pro %)", step: 0.1, min: 0, max: 2 },
    ],
  },
  {
    label: "Defensiv",
    color: "#4a9eff",
    fields: [
      { key: "dribble",      label: "Dribbling",    step: 0.1, min: 0, max: 3 },
      { key: "tackle",       label: "Tackle",       step: 0.1, min: 0, max: 3 },
      { key: "interception", label: "Interception", step: 0.1, min: 0, max: 3 },
    ],
  },
  {
    label: "Karten",
    color: "#ff4d6d",
    fields: [
      { key: "yellow_card", label: "Gelb", step: 0.5, min: -10, max: 0 },
      { key: "red_card",    label: "Rot",  step: 0.5, min: -10, max: 0 },
    ],
  },
  {
    label: "Einsatzzeit",
    color: "#c8b080",
    fields: [
      { key: "minutes_full",    label: "≥60 Min",  step: 0.5, min: 0, max: 5 },
      { key: "minutes_partial", label: "1–59 Min", step: 0.1, min: 0, max: 3 },
    ],
  },
  {
    label: "Kapitän",
    color: "#f5a623",
    fields: [
      { key: "captain_multiplier", label: "Multiplikator", step: 0.5, min: 1, max: 4 },
    ],
  },
];
