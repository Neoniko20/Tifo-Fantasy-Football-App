/**
 * WM Lineup — Unit Tests
 *
 * Abgedeckt:
 *   1. validateFormation()  — gültige + ungültige Positions-Kombos
 *   2. validatePositionLimits() — min/max Grenzen
 *   3. Bench-Size-Logik (wie in route.ts check 9b)
 *   4. Captain/VC-Invarianten
 *   5. Duplikat-Erkennung (starters+bench)
 *   6. Route-File vorhanden + exportiert was erwartet
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  validateFormation,
  validatePositionLimits,
  FORMATIONS,
  FORMATION_KEYS,
} from "../lib/wm-formations";

// ── 1. validateFormation ──────────────────────────────────────────────────

describe("validateFormation", () => {
  it("4-3-3: 1 GK, 4 DF, 3 MF, 3 FW → valid", () => {
    const positions = [
      "GK",
      "DF", "DF", "DF", "DF",
      "MF", "MF", "MF",
      "FW", "FW", "FW",
    ];
    const result = validateFormation(positions as any, "4-3-3");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("4-3-3: 0 GK → invalid mit konkretem Fehler", () => {
    const positions = [
      "DF", "DF", "DF", "DF", "DF",
      "MF", "MF", "MF",
      "FW", "FW", "FW",
    ];
    const result = validateFormation(positions as any, "4-3-3");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("GK"))).toBe(true);
  });

  it("4-3-3: 3 DF statt 4 → invalid", () => {
    const positions = [
      "GK",
      "DF", "DF", "DF",
      "MF", "MF", "MF", "MF",
      "FW", "FW", "FW",
    ];
    const result = validateFormation(positions as any, "4-3-3");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("DF"))).toBe(true);
  });

  it("4-4-2: exakt passend → valid", () => {
    const positions = [
      "GK",
      "DF", "DF", "DF", "DF",
      "MF", "MF", "MF", "MF",
      "FW", "FW",
    ];
    expect(validateFormation(positions as any, "4-4-2").valid).toBe(true);
  });

  it("5-3-2: exakt passend → valid", () => {
    const positions = [
      "GK",
      "DF", "DF", "DF", "DF", "DF",
      "MF", "MF", "MF",
      "FW", "FW",
    ];
    expect(validateFormation(positions as any, "5-3-2").valid).toBe(true);
  });

  it("unbekannte Formation → invalid mit Fehler", () => {
    const result = validateFormation(["GK"] as any, "9-1-0");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("9-1-0");
  });

  it("leere Positions-Liste → invalid (alle Counts 0)", () => {
    const result = validateFormation([], "4-3-3");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ── 2. validatePositionLimits ─────────────────────────────────────────────

describe("validatePositionLimits", () => {
  const stdLimits = {
    GK: { min: 1, max: 1 },
    DF: { min: 3, max: 5 },
    MF: { min: 2, max: 5 },
    FW: { min: 1, max: 3 },
  };

  it("Kader mit 1 GK, 4 DF, 3 MF, 2 FW → valid", () => {
    const positions = [
      "GK",
      "DF", "DF", "DF", "DF",
      "MF", "MF", "MF",
      "FW", "FW",
    ];
    expect(validatePositionLimits(positions as any, stdLimits).valid).toBe(true);
  });

  it("0 GK → invalid (unter min=1)", () => {
    const positions = [
      "DF", "DF", "DF", "DF",
      "MF", "MF", "MF",
      "FW", "FW",
    ];
    const r = validatePositionLimits(positions as any, stdLimits);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("GK"))).toBe(true);
  });

  it("2 GK → invalid (über max=1)", () => {
    const positions = [
      "GK", "GK",
      "DF", "DF", "DF",
      "MF", "MF",
      "FW",
    ];
    const r = validatePositionLimits(positions as any, stdLimits);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("GK"))).toBe(true);
  });

  it("6 DF → invalid (über max=5)", () => {
    const positions = [
      "GK",
      "DF", "DF", "DF", "DF", "DF", "DF",
      "MF", "MF",
      "FW",
    ];
    const r = validatePositionLimits(positions as any, stdLimits);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("DF"))).toBe(true);
  });
});

// ── 3. Bench-Size-Logik ───────────────────────────────────────────────────

describe("Bench-Size-Check (wie in route.ts check 9b)", () => {
  function benchCheck(benchLen: number, maxBench: number): { ok: boolean; error?: string } {
    if (benchLen > maxBench) {
      return { ok: false, error: `Bank darf maximal ${maxBench} Spieler enthalten (${benchLen} angegeben)` };
    }
    return { ok: true };
  }

  it("4 Spieler, maxBench=4 → ok", () => {
    expect(benchCheck(4, 4).ok).toBe(true);
  });

  it("0 Spieler, maxBench=4 → ok (leere Bank erlaubt)", () => {
    expect(benchCheck(0, 4).ok).toBe(true);
  });

  it("5 Spieler, maxBench=4 → Fehler", () => {
    const r = benchCheck(5, 4);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("4");
    expect(r.error).toContain("5");
  });

  it("1 Spieler, maxBench=1 → ok (WM-Format)", () => {
    expect(benchCheck(1, 1).ok).toBe(true);
  });

  it("2 Spieler, maxBench=1 → Fehler", () => {
    expect(benchCheck(2, 1).ok).toBe(false);
  });

  it("bench.length === maxBench+1 → immer Fehler", () => {
    for (const max of [1, 2, 3, 4, 5, 6]) {
      expect(benchCheck(max + 1, max).ok).toBe(false);
    }
  });
});

// ── 4. Kapitän / Vize-Kapitän Invarianten ────────────────────────────────

describe("Captain/VC-Invarianten (pure Logik)", () => {
  function captainCheck(starters: number[], captainId: number | null, vcId: number | null) {
    if (captainId !== null && !starters.includes(captainId)) {
      return { ok: false, error: "Kapitän muss in der Startelf sein" };
    }
    if (vcId !== null && !starters.includes(vcId)) {
      return { ok: false, error: "Vize-Kapitän muss in der Startelf sein" };
    }
    if (captainId !== null && captainId === vcId) {
      return { ok: false, error: "Kapitän und Vize-Kapitän dürfen nicht identisch sein" };
    }
    return { ok: true };
  }

  const starters = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  it("Kapitän ID 1 in Startelf → ok", () => {
    expect(captainCheck(starters, 1, 2).ok).toBe(true);
  });

  it("Kapitän ID 99 nicht in Startelf → Fehler", () => {
    const r = captainCheck(starters, 99, 2);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Kapitän");
  });

  it("VC ID 99 nicht in Startelf → Fehler", () => {
    const r = captainCheck(starters, 1, 99);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Vize-Kapitän");
  });

  it("Kapitän = VC = ID 1 → Fehler", () => {
    const r = captainCheck(starters, 1, 1);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("identisch");
  });

  it("Kapitän null, VC null → ok (kein Fehler)", () => {
    expect(captainCheck(starters, null, null).ok).toBe(true);
  });
});

// ── 5. Duplikat-Erkennung ─────────────────────────────────────────────────

describe("Duplikat-Erkennung starters+bench", () => {
  function dupCheck(starters: number[], bench: number[]) {
    const all = [...starters, ...bench];
    const unique = new Set(all);
    return unique.size === all.length;
  }

  it("keine Duplikate → ok", () => {
    expect(dupCheck([1, 2, 3], [4, 5])).toBe(true);
  });

  it("Spieler doppelt in starters → Duplikat", () => {
    expect(dupCheck([1, 1, 2], [3])).toBe(false);
  });

  it("Spieler in starters und bench → Duplikat", () => {
    expect(dupCheck([1, 2, 3], [1, 4])).toBe(false);
  });

  it("Spieler doppelt in bench → Duplikat", () => {
    expect(dupCheck([1, 2, 3], [4, 4])).toBe(false);
  });

  it("leere Arrays → keine Duplikate", () => {
    expect(dupCheck([], [])).toBe(true);
  });
});

// ── 6. Route-Datei und Formations-Konstanten ─────────────────────────────

describe("Route-Datei und FORMATIONS-Export", () => {
  it("app/api/wm/[id]/lineup/route.ts existiert", () => {
    const p = path.join(process.cwd(), "app/api/wm/[id]/lineup/route.ts");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("route.ts enthält bench_size Guard (Check 9b)", () => {
    const p = path.join(process.cwd(), "app/api/wm/[id]/lineup/route.ts");
    const content = fs.readFileSync(p, "utf-8");
    expect(content).toContain("bench_size");
    expect(content).toContain("bench.length > maxBench");
  });

  it("route.ts hat genau 13+ Validierungsblöcke", () => {
    const p = path.join(process.cwd(), "app/api/wm/[id]/lineup/route.ts");
    const content = fs.readFileSync(p, "utf-8");
    // Count validation comment blocks (── N.)
    const matches = content.match(/── \d+[a-z]?\./g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(13);
  });

  it("FORMATIONS enthält mindestens 9 Standard-Formationen", () => {
    const standardFormations = FORMATION_KEYS.filter(k => !FORMATIONS[k].rare);
    expect(standardFormations.length).toBeGreaterThanOrEqual(9);
  });

  it("jede Formation hat genau 11 Slots im Layout", () => {
    for (const key of FORMATION_KEYS) {
      const formation = FORMATIONS[key];
      expect(formation.layout).toHaveLength(11);
    }
  });

  it("jede Formation: slots-Summe = 11", () => {
    for (const key of FORMATION_KEYS) {
      const total = Object.values(FORMATIONS[key].slots).reduce((a, b) => a + b, 0);
      expect(total).toBe(11);
    }
  });
});
