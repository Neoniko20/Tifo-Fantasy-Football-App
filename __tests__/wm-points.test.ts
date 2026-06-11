import { describe, it, expect } from "vitest";
import { calculateWMGameweekPoints, type GWStats } from "@/lib/wm-points";
import { DEFAULT_SCORING_RULES } from "@/lib/scoring";
import type { WMNation } from "@/lib/wm-types";

const r = DEFAULT_SCORING_RULES;

// ── Test-Hilfsfunktionen ──────────────────────────────────────────────────

const baseStats = (overrides: Partial<GWStats> = {}): GWStats => ({
  goals: 0,
  assists: 0,
  minutes: 90,
  shots_on: 0,
  key_passes: 0,
  pass_accuracy: 0,
  dribbles: 0,
  tackles: 0,
  interceptions: 0,
  saves: 0,
  clean_sheet: false,
  yellow_cards: 0,
  red_cards: 0,
  position: "MF",
  ...overrides,
});

const nation = (overrides: Partial<WMNation> = {}): WMNation => ({
  id: "n1",
  tournament_id: "t1",
  name: "Test Nation",
  code: "TN",
  eliminated_after_gameweek: null,
  ...overrides,
});

const gw = (stats: Partial<GWStats> = {}, isCaptain = false, nat?: WMNation | null, rules?: Parameters<typeof calculateWMGameweekPoints>[4]) =>
  calculateWMGameweekPoints(baseStats(stats), nat === undefined ? nation() : nat, 1, isCaptain, rules);

// ── Spielzeit / Appearance ───────────────────────────────────────────────

describe("calculateWMGameweekPoints — Spielzeit", () => {
  it("≥60 Minuten → voller Bonus", () => {
    expect(gw({ minutes: 90 }).points).toBeCloseTo(r.minutes_full);
    expect(gw({ minutes: 60 }).points).toBeCloseTo(r.minutes_full);
  });

  it("1–59 Minuten → Teilbonus", () => {
    expect(gw({ minutes: 45 }).points).toBeCloseTo(r.minutes_partial);
    expect(gw({ minutes: 1 }).points).toBeCloseTo(r.minutes_partial);
  });

  it("0 Minuten → 0 Punkte", () => {
    expect(gw({ minutes: 0 }).points).toBe(0);
  });

  it("0 Minuten → nation_active trotzdem true", () => {
    expect(gw({ minutes: 0 }).nation_active).toBe(true);
  });
});

// ── Tore nach Position ───────────────────────────────────────────────────

describe("calculateWMGameweekPoints — Tore nach Position", () => {
  it("GK-Tor = goal_gk + Spielzeit", () => {
    expect(gw({ goals: 1, position: "GK" }).points).toBeCloseTo(r.goal_gk + r.minutes_full);
  });

  it("DF-Tor = goal_df + Spielzeit", () => {
    expect(gw({ goals: 1, position: "DF" }).points).toBeCloseTo(r.goal_df + r.minutes_full);
  });

  it("MF-Tor = goal_mf + Spielzeit", () => {
    expect(gw({ goals: 1, position: "MF" }).points).toBeCloseTo(r.goal_mf + r.minutes_full);
  });

  it("FW-Tor = goal_fw + Spielzeit", () => {
    expect(gw({ goals: 1, position: "FW" }).points).toBeCloseTo(r.goal_fw + r.minutes_full);
  });

  it("3 FW-Tore skalieren linear", () => {
    const one = gw({ goals: 1, position: "FW" }).points - r.minutes_full;
    const three = gw({ goals: 3, position: "FW" }).points - r.minutes_full;
    expect(three).toBeCloseTo(one * 3);
  });
});

// ── Assists ───────────────────────────────────────────────────────────────

describe("calculateWMGameweekPoints — Assists", () => {
  it("1 Assist = assist + Spielzeit", () => {
    expect(gw({ assists: 1 }).points).toBeCloseTo(r.assist + r.minutes_full);
  });

  it("Tor + Assist stapeln sich korrekt", () => {
    expect(gw({ goals: 1, assists: 1, position: "MF" }).points).toBeCloseTo(
      r.goal_mf + r.assist + r.minutes_full,
    );
  });
});

// ── Clean Sheet ───────────────────────────────────────────────────────────

describe("calculateWMGameweekPoints — Clean Sheet", () => {
  it("GK Clean Sheet = clean_sheet_gk + Spielzeit", () => {
    expect(gw({ clean_sheet: true, position: "GK" }).points).toBeCloseTo(
      r.clean_sheet_gk + r.minutes_full,
    );
  });

  it("DF Clean Sheet = clean_sheet_df + Spielzeit", () => {
    expect(gw({ clean_sheet: true, position: "DF" }).points).toBeCloseTo(
      r.clean_sheet_df + r.minutes_full,
    );
  });

  it("MF Clean Sheet = clean_sheet_mf + Spielzeit", () => {
    expect(gw({ clean_sheet: true, position: "MF" }).points).toBeCloseTo(
      r.clean_sheet_mf + r.minutes_full,
    );
  });

  it("FW erhält keinen Clean-Sheet-Bonus (default 0)", () => {
    expect(gw({ clean_sheet: true, position: "FW" }).points).toBeCloseTo(
      r.clean_sheet_fw + r.minutes_full,
    );
  });
});

// ── GK-Paraden ───────────────────────────────────────────────────────────

describe("calculateWMGameweekPoints — GK Paraden", () => {
  it("5 Paraden = 5 × save + Spielzeit", () => {
    expect(gw({ saves: 5, position: "GK" }).points).toBeCloseTo(
      5 * r.save + r.minutes_full,
    );
  });

  it("Paraden zählen nur für GK", () => {
    expect(gw({ saves: 5, position: "DF" }).points).toBeCloseTo(r.minutes_full);
  });
});

// ── Karten / Disziplin ───────────────────────────────────────────────────

describe("calculateWMGameweekPoints — Karten", () => {
  it("Gelbe Karte = −|yellow_card|", () => {
    const base = gw().points;
    const carded = gw({ yellow_cards: 1 }).points;
    expect(base - carded).toBeCloseTo(Math.abs(r.yellow_card));
  });

  it("Rote Karte = −|red_card|", () => {
    const base = gw().points;
    const carded = gw({ red_cards: 1 }).points;
    expect(base - carded).toBeCloseTo(Math.abs(r.red_card));
  });

  it("Rote Karte + 89 Min → Spielzeit-Bonus + Abzug", () => {
    const pts = gw({ minutes: 89, red_cards: 1 }).points;
    expect(pts).toBeCloseTo(r.minutes_full - Math.abs(r.red_card));
  });
});

// ── Nation eliminiert ─────────────────────────────────────────────────────

describe("calculateWMGameweekPoints — Nation eliminiert", () => {
  it("Nation nach GW 2 eliminiert → Punkte bei GW 3 = 0", () => {
    const result = calculateWMGameweekPoints(
      baseStats({ goals: 2, position: "FW" }),
      nation({ eliminated_after_gameweek: 2 }),
      3,
    );
    expect(result.points).toBe(0);
    expect(result.nation_active).toBe(false);
  });

  it("Nation nach GW 2 eliminiert → Punkte bei GW 2 normal", () => {
    const result = calculateWMGameweekPoints(
      baseStats({ goals: 1, position: "FW" }),
      nation({ eliminated_after_gameweek: 2 }),
      2,
    );
    expect(result.points).toBeGreaterThan(0);
    expect(result.nation_active).toBe(true);
  });

  it("Nation nach GW 1 eliminiert → Punkte bei GW 1 normal", () => {
    const result = calculateWMGameweekPoints(
      baseStats({ goals: 1, position: "FW" }),
      nation({ eliminated_after_gameweek: 1 }),
      1,
    );
    expect(result.points).toBeGreaterThan(0);
    expect(result.nation_active).toBe(true);
  });

  it("null nation (unbekannte Nation) → Punkte werden normal berechnet", () => {
    const result = calculateWMGameweekPoints(
      baseStats({ goals: 1, position: "FW" }),
      null,
      1,
    );
    expect(result.points).toBeGreaterThan(0);
    expect(result.nation_active).toBe(true);
  });

  it("Nation ohne eliminated_after_gameweek → immer aktiv", () => {
    const result = calculateWMGameweekPoints(
      baseStats({ goals: 1, position: "FW" }),
      nation({ eliminated_after_gameweek: undefined }),
      8,
    );
    expect(result.nation_active).toBe(true);
    expect(result.points).toBeGreaterThan(0);
  });
});

// ── Vice-Captain Fallback ─────────────────────────────────────────────────

describe("calculateWMGameweekPoints — Vice-Captain Fallback", () => {
  it("VC bekommt captain_multiplier wenn Captain nicht gespielt hat (isViceCaptain=true)", () => {
    const base = gw({ goals: 1, position: "FW" }).points;
    const vc   = calculateWMGameweekPoints(baseStats({ goals: 1, position: "FW" }), nation(), 1, false, null, true).points;
    expect(vc).toBeCloseTo(base * r.captain_multiplier);
  });

  it("VC ohne Einsatz (0 Min) bekommt trotz isViceCaptain=true 0 Punkte", () => {
    const vc = calculateWMGameweekPoints(baseStats({ minutes: 0 }), nation(), 1, false, null, true).points;
    expect(vc).toBe(0);
  });

  it("Captain (isCaptain=true) hat Vorrang vor VC-Flag — kein doppelter Multiplier", () => {
    const onlyCaptain = gw({ goals: 1, position: "FW" }, true).points;
    const both = calculateWMGameweekPoints(baseStats({ goals: 1, position: "FW" }), nation(), 1, true, null, true).points;
    expect(both).toBeCloseTo(onlyCaptain);
  });

  it("VC-Flag false → normaler Score ohne Multiplier", () => {
    const base  = gw({ goals: 1, position: "FW" }).points;
    const noVc  = calculateWMGameweekPoints(baseStats({ goals: 1, position: "FW" }), nation(), 1, false, null, false).points;
    expect(noVc).toBeCloseTo(base);
  });

  it("VC mit eliminierter Nation = 0 Punkte, auch wenn isViceCaptain=true", () => {
    const result = calculateWMGameweekPoints(
      baseStats({ goals: 2, position: "FW" }),
      nation({ eliminated_after_gameweek: 1 }),
      3,
      false,
      null,
      true,
    );
    expect(result.points).toBe(0);
  });

  it("VC mit custom captain_multiplier 3× bekommt 3-fachen Score", () => {
    const base = gw({ goals: 1, position: "FW" }, false, undefined, { captain_multiplier: 3 }).points;
    const vc   = calculateWMGameweekPoints(baseStats({ goals: 1, position: "FW" }), nation(), 1, false, { captain_multiplier: 3 }, true).points;
    expect(vc).toBeCloseTo(base * 3);
  });
});

// ── Captain-Multiplier ───────────────────────────────────────────────────

describe("calculateWMGameweekPoints — Captain-Multiplier", () => {
  it("Captain verdoppelt den Basis-Score", () => {
    const base = gw({ goals: 1, position: "FW" }).points;
    const cap = gw({ goals: 1, position: "FW" }, true).points;
    expect(cap).toBeCloseTo(base * r.captain_multiplier);
  });

  it("Captain mit 0 Minuten = 0 Punkte", () => {
    expect(gw({ minutes: 0 }, true).points).toBe(0);
  });

  it("Captain-Spielzeit-Bonus wird ebenfalls verdoppelt", () => {
    const base = gw().points;
    const cap = gw({}, true).points;
    expect(cap).toBeCloseTo(base * r.captain_multiplier);
  });

  it("Captain mit eliminierter Nation = 0 Punkte", () => {
    const result = calculateWMGameweekPoints(
      baseStats({ goals: 2, position: "FW" }),
      nation({ eliminated_after_gameweek: 1 }),
      3,
      true,
    );
    expect(result.points).toBe(0);
  });
});

// ── Custom scoring_rules ─────────────────────────────────────────────────

describe("calculateWMGameweekPoints — Custom Rules", () => {
  it("custom goal_fw überschreibt Default", () => {
    const result = gw({ goals: 1, position: "FW" }, false, undefined, { goal_fw: 10 });
    expect(result.points).toBeCloseTo(10 + r.minutes_full);
  });

  it("null rules fällt auf Defaults zurück", () => {
    const withNull = gw({ goals: 1, position: "FW" }, false, undefined, null);
    const withUndef = gw({ goals: 1, position: "FW" }, false, undefined, undefined);
    expect(withNull.points).toBeCloseTo(withUndef.points);
    expect(withNull.points).toBeCloseTo(r.goal_fw + r.minutes_full);
  });

  it("custom captain_multiplier 3× wird angewendet", () => {
    const base = gw({ goals: 1, position: "FW" }, false, undefined, { captain_multiplier: 3 }).points;
    const cap = gw({ goals: 1, position: "FW" }, true, undefined, { captain_multiplier: 3 }).points;
    expect(cap).toBeCloseTo(base * 3);
  });
});

// ── Rückgabe-Struktur ─────────────────────────────────────────────────────

describe("calculateWMGameweekPoints — Rückgabe-Struktur", () => {
  it("points, nation_active und breakdown werden zurückgegeben", () => {
    const result = gw({ goals: 1, position: "MF" });
    expect(result).toHaveProperty("points");
    expect(result).toHaveProperty("nation_active");
    expect(result).toHaveProperty("breakdown");
  });

  it("breakdown enthält die Stats-Felder", () => {
    const result = gw({ goals: 2, assists: 1, position: "FW" });
    expect(result.breakdown.goals).toBe(2);
    expect(result.breakdown.assists).toBe(1);
    expect(result.breakdown.position).toBe("FW");
  });

  it("Punkte werden auf 1 Dezimalstelle gerundet", () => {
    // pass_accuracy/100 * 0.5 kann Floating-Point erzeugen — Rounding-Check
    const result = gw({ pass_accuracy: 83 });
    const decimals = (result.points.toString().split(".")[1] ?? "").length;
    expect(decimals).toBeLessThanOrEqual(1);
  });
});

// ── Kombinierte Szenarien ────────────────────────────────────────────────

describe("calculateWMGameweekPoints — Kombinierte Szenarien", () => {
  it("GK: Clean Sheet + 5 Paraden + 90 Min", () => {
    const result = gw({ position: "GK", clean_sheet: true, saves: 5 });
    const expected = r.clean_sheet_gk + 5 * r.save + r.minutes_full;
    expect(result.points).toBeCloseTo(expected);
  });

  it("FW: Hattrick als Captain", () => {
    const base = 3 * r.goal_fw + r.minutes_full;
    const expected = Math.round(base * r.captain_multiplier * 10) / 10;
    expect(gw({ goals: 3, position: "FW" }, true).points).toBeCloseTo(expected);
  });

  it("MF: Tor + Assist + Gelbe Karte", () => {
    const result = gw({ goals: 1, assists: 1, yellow_cards: 1, position: "MF" });
    const expected = r.goal_mf + r.assist + r.minutes_full - Math.abs(r.yellow_card);
    expect(result.points).toBeCloseTo(expected);
  });

  it("DF: Tor + Clean Sheet + Tackle", () => {
    const result = gw({ goals: 1, clean_sheet: true, tackles: 2, position: "DF" });
    const expected = r.goal_df + r.clean_sheet_df + 2 * r.tackle + r.minutes_full;
    expect(result.points).toBeCloseTo(expected);
  });
});
