import { describe, it, expect } from "vitest";
import { calcPoints, DEFAULT_SCORING_RULES } from "@/lib/scoring";

const rules = DEFAULT_SCORING_RULES;

// Helper: build minimal stats object
const stats = (overrides: Record<string, any> = {}) => ({
  goals: 0, assists: 0, minutes: 90, shots_on: 0, key_passes: 0,
  pass_accuracy: 0, dribbles: 0, tackles: 0, interceptions: 0,
  saves: 0, yellow_cards: 0, red_cards: 0, clean_sheet: false,
  ...overrides,
});

describe("calcPoints — appearance", () => {
  it("gives full appearance bonus for ≥60 minutes", () => {
    expect(calcPoints(stats({ minutes: 90 }), "MF", false)).toBeCloseTo(rules.minutes_full);
    expect(calcPoints(stats({ minutes: 60 }), "MF", false)).toBeCloseTo(rules.minutes_full);
  });

  it("gives partial appearance for 1–59 minutes", () => {
    expect(calcPoints(stats({ minutes: 45 }), "MF", false)).toBeCloseTo(rules.minutes_partial);
    expect(calcPoints(stats({ minutes: 1  }), "MF", false)).toBeCloseTo(rules.minutes_partial);
  });

  it("gives no appearance bonus for 0 minutes", () => {
    expect(calcPoints(stats({ minutes: 0 }), "MF", false)).toBe(0);
  });
});

describe("calcPoints — goals by position", () => {
  const goalStats = stats({ goals: 1 });

  it("GK goal = 6 + appearance", () => {
    expect(calcPoints(goalStats, "GK", false)).toBeCloseTo(rules.goal_gk + rules.minutes_full);
  });

  it("DF goal = 6 + appearance", () => {
    expect(calcPoints(goalStats, "DF", false)).toBeCloseTo(rules.goal_df + rules.minutes_full);
  });

  it("MF goal = 5 + appearance", () => {
    expect(calcPoints(goalStats, "MF", false)).toBeCloseTo(rules.goal_mf + rules.minutes_full);
  });

  it("FW goal = 4 + appearance", () => {
    expect(calcPoints(goalStats, "FW", false)).toBeCloseTo(rules.goal_fw + rules.minutes_full);
  });

  it("multiple goals scale linearly", () => {
    const base = calcPoints(stats({ goals: 1 }), "FW", false);
    const triple = calcPoints(stats({ goals: 3 }), "FW", false);
    expect(triple - rules.minutes_full).toBeCloseTo((base - rules.minutes_full) * 3);
  });
});

describe("calcPoints — assist", () => {
  it("assist = 3 + appearance", () => {
    expect(calcPoints(stats({ assists: 1 }), "MF", false)).toBeCloseTo(rules.assist + rules.minutes_full);
  });

  it("goal + assist stacks correctly", () => {
    const expected = rules.goal_mf + rules.assist + rules.minutes_full;
    expect(calcPoints(stats({ goals: 1, assists: 1 }), "MF", false)).toBeCloseTo(expected);
  });
});

describe("calcPoints — clean sheet", () => {
  const csStats = stats({ clean_sheet: true });

  it("GK clean sheet = 4", () => {
    expect(calcPoints(csStats, "GK", false)).toBeCloseTo(rules.clean_sheet_gk + rules.minutes_full);
  });

  it("DF clean sheet = 4", () => {
    expect(calcPoints(csStats, "DF", false)).toBeCloseTo(rules.clean_sheet_df + rules.minutes_full);
  });

  it("MF clean sheet = 1", () => {
    expect(calcPoints(csStats, "MF", false)).toBeCloseTo(rules.clean_sheet_mf + rules.minutes_full);
  });

  it("FW gets no clean sheet bonus", () => {
    expect(calcPoints(csStats, "FW", false)).toBeCloseTo(rules.clean_sheet_fw + rules.minutes_full);
  });
});

describe("calcPoints — GK saves", () => {
  it("3 saves = 4.5 points", () => {
    const expected = 3 * rules.save + rules.minutes_full;
    expect(calcPoints(stats({ saves: 3 }), "GK", false)).toBeCloseTo(expected);
  });

  it("saves only count for GK position", () => {
    const dfPoints = calcPoints(stats({ saves: 3 }), "DF", false);
    expect(dfPoints).toBeCloseTo(rules.minutes_full); // saves ignored for non-GK
  });
});

describe("calcPoints — discipline", () => {
  it("yellow card deducts 1 point", () => {
    const base = calcPoints(stats(), "MF", false);
    const carded = calcPoints(stats({ yellow_cards: 1 }), "MF", false);
    expect(base - carded).toBeCloseTo(Math.abs(rules.yellow_card));
  });

  it("red card deducts 3 points", () => {
    const base = calcPoints(stats(), "MF", false);
    const carded = calcPoints(stats({ red_cards: 1 }), "MF", false);
    expect(base - carded).toBeCloseTo(Math.abs(rules.red_card));
  });

  it("player sent off in 89th minute still gets partial appearance", () => {
    // Red card on 89 min: minutes played is still > 0
    const pts = calcPoints(stats({ minutes: 89, red_cards: 1 }), "MF", false);
    expect(pts).toBeCloseTo(rules.minutes_full - Math.abs(rules.red_card));
  });
});

describe("calcPoints — captain multiplier", () => {
  it("captain doubles base score", () => {
    const base = calcPoints(stats({ goals: 1 }), "FW", false);
    const cap  = calcPoints(stats({ goals: 1 }), "FW", true);
    expect(cap).toBeCloseTo(base * rules.captain_multiplier);
  });

  it("captain with 0 minutes = 0 points", () => {
    expect(calcPoints(stats({ minutes: 0 }), "FW", true)).toBe(0);
  });

  it("captain appearance bonus also doubles", () => {
    const base = calcPoints(stats(), "MF", false); // only appearance
    const cap  = calcPoints(stats(), "MF", true);
    expect(cap).toBeCloseTo(base * rules.captain_multiplier);
  });
});

describe("calcPoints — custom rules", () => {
  it("custom goal_fw overrides default", () => {
    const custom = { goal_fw: 10 };
    const pts = calcPoints(stats({ goals: 1 }), "FW", false, custom);
    expect(pts).toBeCloseTo(10 + rules.minutes_full);
  });

  it("null rules falls back to defaults", () => {
    const withNull  = calcPoints(stats({ goals: 1 }), "FW", false, null);
    const withUndef = calcPoints(stats({ goals: 1 }), "FW", false, undefined);
    expect(withNull).toBeCloseTo(withUndef);
    expect(withNull).toBeCloseTo(rules.goal_fw + rules.minutes_full);
  });
});

describe("calcPoints — combined edge cases", () => {
  it("GK with clean sheet, saves, full minutes, no goals", () => {
    const pts = calcPoints(
      stats({ clean_sheet: true, saves: 5, minutes: 90 }),
      "GK",
      false,
    );
    const expected = rules.clean_sheet_gk + 5 * rules.save + rules.minutes_full;
    expect(pts).toBeCloseTo(expected);
  });

  it("FW hattrick as captain", () => {
    const base = 3 * rules.goal_fw + rules.minutes_full;
    const cap  = Math.round(base * rules.captain_multiplier * 10) / 10;
    expect(calcPoints(stats({ goals: 3 }), "FW", true)).toBeCloseTo(cap);
  });

  it("MF with goal + assist + yellow card", () => {
    const pts = calcPoints(stats({ goals: 1, assists: 1, yellow_cards: 1 }), "MF", false);
    const expected = rules.goal_mf + rules.assist + rules.minutes_full - Math.abs(rules.yellow_card);
    expect(pts).toBeCloseTo(expected);
  });
});
