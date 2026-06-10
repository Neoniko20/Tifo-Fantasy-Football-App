/**
 * WM Auto-Sub unit tests
 *
 * Covers:
 *  1. applyLiveSubs  — Algorithmus-Korrektheit (Starter-Ersatz, GK-Regel, Idempotenz)
 *  2. applyAutoSubToLineup — Einzel-Sub-Persistenz-Helper (startingXI, bench, Idempotenz)
 *  3. shouldScorePlayer nach Auto-Sub — eingewechselter Spieler punktet, ausgewechselter nicht
 */

import { describe, it, expect } from "vitest";
import { applyLiveSubs, applyAutoSubToLineup } from "@/lib/live-sub";
import { shouldScorePlayer } from "@/lib/wm-ingest";

// ── Test-Fixtures ─────────────────────────────────────────────────────────────

const XI   = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const BENCH = [12, 13, 14, 15];

const allMF = (ids: number[]) =>
  Object.fromEntries(ids.map(id => [id, "MF"]));

const played = (ids: number[], min = 90) =>
  Object.fromEntries(ids.map(id => [id, min]));

const didNotPlay = (ids: number[]) =>
  Object.fromEntries(ids.map(id => [id, 0]));

// Standard-Setup: alle spielen 90 Min, alle MF
const POS  = allMF([...XI, ...BENCH]);
const MINS = { ...played(XI), ...played(BENCH) };

// ═══════════════════════════════════════════════════════════════════════════
// 1. applyLiveSubs — Algorithmus
// ═══════════════════════════════════════════════════════════════════════════

describe("applyLiveSubs", () => {
  it("ersetzt Starter mit 0 Minuten durch ersten validen Bank-Spieler", () => {
    const mins = { ...MINS, 2: 0 }; // Spieler 2 hat nicht gespielt
    const { effectiveXI, subs } = applyLiveSubs(XI, BENCH, mins, POS);

    expect(effectiveXI).toContain(12);       // 12 (bench[0]) eingewechselt
    expect(effectiveXI).not.toContain(2);    // 2 raus
    expect(effectiveXI).toHaveLength(11);
    expect(subs).toEqual([{ out: 2, in: 12 }]);
  });

  it("kein valider Bank-Spieler → keine Einwechslung, subs leer", () => {
    const mins = { ...played(XI), ...didNotPlay(BENCH), 2: 0 };
    const { effectiveXI, subs } = applyLiveSubs(XI, BENCH, mins, POS);

    expect(effectiveXI).toEqual(XI);
    expect(subs).toHaveLength(0);
  });

  it("Bank-Spieler kann nur einmal eingewechselt werden", () => {
    // Spieler 2 und 3 nicht gespielt, nur Spieler 12 gespielt
    const mins = { ...played(XI), ...didNotPlay(BENCH), 2: 0, 3: 0, 12: 60 };
    const { subs } = applyLiveSubs(XI, BENCH, mins, POS);

    expect(subs).toHaveLength(1); // nur ein Sub möglich
    expect(subs[0]).toEqual({ out: 2, in: 12 });
  });

  it("GK kann nur durch GK ersetzt werden", () => {
    const xi    = [11, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1];
    const bench = [15, 13, 14, 12];
    const pos   = { ...allMF([...XI, ...BENCH]), 11: "GK", 15: "GK" };
    const mins  = { ...played(xi), ...played(bench), 11: 0 }; // GK 11 nicht gespielt

    const { subs } = applyLiveSubs(xi, bench, mins, pos);

    expect(subs).toHaveLength(1);
    expect(subs[0]).toEqual({ out: 11, in: 15 }); // GK durch GK ersetzt
  });

  it("nicht-GK Starter wird nicht durch GK ersetzt — GK in bench übersprungen", () => {
    const pos  = { ...allMF([...XI, ...BENCH]), 12: "GK" }; // bench[0] ist GK
    const mins = { ...played(XI), ...played(BENCH), 2: 0 }; // Spieler 2 (MF) nicht gespielt

    const { effectiveXI, subs } = applyLiveSubs(XI, BENCH, mins, pos);

    // bench[0]=12 (GK) übersprungen → bench[1]=13 (MF) eingewechselt
    expect(effectiveXI[1]).toBe(13);
    expect(subs[0]).toEqual({ out: 2, in: 13 });
  });

  it("eliminierter Bank-Spieler wird übersprungen", () => {
    const mins      = { ...played(XI), ...played(BENCH), 2: 0 };
    const eliminated = { 12: true }; // bench[0] eliminiert

    const { subs } = applyLiveSubs(XI, BENCH, mins, POS, eliminated);

    expect(subs[0]).toEqual({ out: 2, in: 13 }); // 12 übersprungen → 13
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. applyAutoSubToLineup — Einzel-Sub-Persistenz-Helper
// ═══════════════════════════════════════════════════════════════════════════

describe("applyAutoSubToLineup", () => {
  it("ersetzt Starter durch Bank-Spieler in startingXI", () => {
    const { startingXI, applied } = applyAutoSubToLineup(XI, BENCH, 2, 12);

    expect(applied).toBe(true);
    expect(startingXI).toContain(12);
    expect(startingXI).not.toContain(2);
    expect(startingXI).toHaveLength(11);
  });

  it("entfernt eingewechselten Spieler aus bench", () => {
    const { bench, applied } = applyAutoSubToLineup(XI, BENCH, 2, 12);

    expect(applied).toBe(true);
    expect(bench).not.toContain(12);
    expect(bench).toContain(13);
    expect(bench).toContain(14);
    expect(bench).toContain(15);
  });

  it("ist idempotent: gleicher Sub zweimal → applied=false beim zweiten Aufruf", () => {
    const first  = applyAutoSubToLineup(XI, BENCH, 2, 12);
    expect(first.applied).toBe(true);

    const second = applyAutoSubToLineup(first.startingXI, first.bench, 2, 12);
    expect(second.applied).toBe(false);
    expect(second.startingXI).toEqual(first.startingXI); // keine Änderung
    expect(second.bench).toEqual(first.bench);
  });

  it("player_out nicht in XI → applied=false, keine Änderung", () => {
    const { startingXI, bench, applied } = applyAutoSubToLineup(XI, BENCH, 99, 12);

    expect(applied).toBe(false);
    expect(startingXI).toEqual(XI);
    expect(bench).toEqual(BENCH);
  });

  it("mehrere Subs korrekt anwendbar (sequenziell)", () => {
    const after1 = applyAutoSubToLineup(XI, BENCH, 2, 12);
    const after2 = applyAutoSubToLineup(after1.startingXI, after1.bench, 3, 13);

    expect(after2.startingXI).toContain(12);
    expect(after2.startingXI).toContain(13);
    expect(after2.startingXI).not.toContain(2);
    expect(after2.startingXI).not.toContain(3);
    expect(after2.bench).not.toContain(12);
    expect(after2.bench).not.toContain(13);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. shouldScorePlayer nach Auto-Sub
// ═══════════════════════════════════════════════════════════════════════════

describe("shouldScorePlayer nach Auto-Sub", () => {
  it("eingewechselter Spieler erhält nach Sub Punkte (score=true)", () => {
    const { startingXI } = applyAutoSubToLineup(XI, BENCH, 2, 12);
    const lineup = { captain_id: null, starting_xi: startingXI };

    expect(shouldScorePlayer(12, lineup).score).toBe(true);
  });

  it("ausgewechselter Starter erhält nach Sub keine Punkte (score=false)", () => {
    const { startingXI } = applyAutoSubToLineup(XI, BENCH, 2, 12);
    const lineup = { captain_id: null, starting_xi: startingXI };

    expect(shouldScorePlayer(2, lineup).score).toBe(false);
  });

  it("Captain der eingewechselt wird bekommt Captain-Bonus", () => {
    const { startingXI } = applyAutoSubToLineup(XI, BENCH, 2, 12);
    const lineup = { captain_id: 12, starting_xi: startingXI };

    const result = shouldScorePlayer(12, lineup);
    expect(result.score).toBe(true);
    expect(result.isCaptain).toBe(true);
  });

  it("nicht eingewechselter Starter bleibt in starting_xi und punktet", () => {
    const { startingXI } = applyAutoSubToLineup(XI, BENCH, 2, 12);
    const lineup = { captain_id: null, starting_xi: startingXI };

    // Spieler 1 war nicht betroffen → immer noch Starter
    expect(shouldScorePlayer(1, lineup).score).toBe(true);
    // Spieler 3–11 ebenfalls
    expect(shouldScorePlayer(5, lineup).score).toBe(true);
  });

  it("Bank-Spieler der NICHT eingewechselt wurde punktet nicht", () => {
    const { startingXI } = applyAutoSubToLineup(XI, BENCH, 2, 12);
    const lineup = { captain_id: null, starting_xi: startingXI };

    // 13, 14, 15 noch auf Bank
    expect(shouldScorePlayer(13, lineup).score).toBe(false);
    expect(shouldScorePlayer(15, lineup).score).toBe(false);
  });
});
