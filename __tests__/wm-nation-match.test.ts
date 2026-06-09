/**
 * wm-nation-match — unit tests
 *
 * Testet crossMatchNations() und suggestNameFixes() aus lib/wm-nation-match.ts.
 * Kein DB-Zugriff, keine Seiteneffekte.
 */

import { describe, it, expect } from "vitest";
import { crossMatchNations, suggestNameFixes } from "../lib/wm-nation-match";

// ── Hilfsfunktion ──────────────────────────────────────────────────────────
function countsMap(entries: Array<[string, number]>): Map<string, number> {
  return new Map(entries);
}

// ── 1. Vollständige Übereinstimmung ───────────────────────────────────────
describe("crossMatchNations — vollständige Übereinstimmung", () => {
  it("alle 3 Nationen haben Spieler → nationsWithoutPlayers=0, draftBlocked=false", () => {
    const r = crossMatchNations(
      ["France", "Germany", "Brazil"],
      countsMap([["France", 26], ["Germany", 26], ["Brazil", 26]]),
    );
    expect(r.nationsWithPlayers).toBe(3);
    expect(r.nationsWithoutPlayers).toBe(0);
    expect(r.unmatched).toHaveLength(0);
    expect(r.totalPlayersInPool).toBe(78);
    expect(r.totalOrphanPlayers).toBe(0);
  });

  it("matched-Array ist alphabetisch sortiert", () => {
    const r = crossMatchNations(
      ["France", "Brazil", "Argentina"],
      countsMap([["France", 26], ["Brazil", 26], ["Argentina", 26]]),
    );
    const names = r.matched.map(m => m.nationName);
    expect(names).toEqual(["Argentina", "Brazil", "France"]);
  });
});

// ── 2. Namenskonflikt ─────────────────────────────────────────────────────
describe("crossMatchNations — Namenskonflikte", () => {
  it("South Korea vs Korea Republic → unmatched enthält 'South Korea'", () => {
    const r = crossMatchNations(
      ["South Korea"],
      countsMap([["Korea Republic", 26]]),
    );
    expect(r.unmatched).toContain("South Korea");
    expect(r.nationsWithoutPlayers).toBe(1);
    expect(r.orphanTeamNames[0].teamName).toBe("Korea Republic");
    expect(r.totalOrphanPlayers).toBe(26);
    expect(r.totalPlayersInPool).toBe(0);
  });

  it("Curaçao vs Curacao (ohne Akzent) → unmatched", () => {
    const r = crossMatchNations(
      ["Curaçao"],
      countsMap([["Curacao", 26]]),
    );
    expect(r.unmatched).toContain("Curaçao");
    expect(r.nationsWithoutPlayers).toBe(1);
  });

  it("Iran vs IR Iran → unmatched enthält 'Iran'", () => {
    const r = crossMatchNations(
      ["Iran"],
      countsMap([["IR Iran", 26]]),
    );
    expect(r.unmatched).toContain("Iran");
    expect(r.orphanTeamNames[0].teamName).toBe("IR Iran");
  });
});

// ── 3. Vereinsspieler (Waisen) ────────────────────────────────────────────
describe("crossMatchNations — Vereinsspieler als Waisen", () => {
  it("Vereinsspieler werden als orphanTeamNames gelistet", () => {
    const r = crossMatchNations(
      ["France", "Germany"],
      countsMap([
        ["France", 26],
        ["Germany", 26],
        ["Bayern München", 25],
        ["Newcastle", 29],
      ]),
    );
    expect(r.nationsWithPlayers).toBe(2);
    expect(r.orphanTeamNames).toHaveLength(2);
    const orphanNames = r.orphanTeamNames.map(o => o.teamName);
    expect(orphanNames).toContain("Bayern München");
    expect(orphanNames).toContain("Newcastle");
    expect(r.totalOrphanPlayers).toBe(54);
    // Draft Pool zählt nur gematchte Spieler
    expect(r.totalPlayersInPool).toBe(52);
  });

  it("orphanTeamNames sind nach Spieleranzahl absteigend sortiert", () => {
    const r = crossMatchNations(
      [],
      countsMap([["Bayern München", 10], ["Newcastle", 29], ["Liverpool", 16]]),
    );
    expect(r.orphanTeamNames[0].teamName).toBe("Newcastle");
    expect(r.orphanTeamNames[1].teamName).toBe("Liverpool");
    expect(r.orphanTeamNames[2].teamName).toBe("Bayern München");
  });
});

// ── 4. Edge Cases ─────────────────────────────────────────────────────────
describe("crossMatchNations — Edge Cases", () => {
  it("leere Listen", () => {
    const r = crossMatchNations([], new Map());
    expect(r.totalNations).toBe(0);
    expect(r.nationsWithPlayers).toBe(0);
    expect(r.nationsWithoutPlayers).toBe(0);
    expect(r.totalPlayersInPool).toBe(0);
    expect(r.totalOrphanPlayers).toBe(0);
  });

  it("Nation ohne Spieler (count=0 in Map)", () => {
    const r = crossMatchNations(
      ["Panama"],
      countsMap([["Panama", 0]]),
    );
    expect(r.unmatched).toContain("Panama");
    expect(r.nationsWithoutPlayers).toBe(1);
  });

  it("Nation nicht in playerCounts → unmatched", () => {
    const r = crossMatchNations(
      ["Qatar"],
      new Map(),
    );
    expect(r.unmatched).toContain("Qatar");
  });

  it("totalNations entspricht nationNames.length", () => {
    const r = crossMatchNations(
      ["A", "B", "C"],
      countsMap([["A", 5], ["B", 5]]),
    );
    expect(r.totalNations).toBe(3);
    expect(r.nationsWithPlayers).toBe(2);
    expect(r.nationsWithoutPlayers).toBe(1);
  });
});

// ── 5. suggestNameFixes ───────────────────────────────────────────────────
describe("suggestNameFixes — Kandidaten-Vorschläge", () => {
  it("Teilstring-Match: 'Korea' in 'South Korea' und 'Korea Republic'", () => {
    const hints = suggestNameFixes(
      ["South Korea"],
      [{ teamName: "Korea Republic", playerCount: 26 }],
    );
    expect(hints).toHaveLength(1);
    expect(hints[0].nationName).toBe("South Korea");
    expect(hints[0].candidateTeamName).toBe("Korea Republic");
  });

  it("kein Kandidat für vollständig verschiedene Namen", () => {
    const hints = suggestNameFixes(
      ["Burkina Faso"],
      [{ teamName: "Bayern München", playerCount: 25 }],
    );
    expect(hints).toHaveLength(0);
  });

  it("leere Inputs → keine Hints", () => {
    expect(suggestNameFixes([], [])).toHaveLength(0);
    expect(suggestNameFixes(["France"], [])).toHaveLength(0);
  });

  it("Teilstring: 'Czech Republic' vs 'Republic of Czechia'", () => {
    const hints = suggestNameFixes(
      ["Czech Republic"],
      [{ teamName: "Republic of Czechia", playerCount: 26 }],
    );
    // 'Republic' ist gemeinsames Wort (>=4 Zeichen)
    expect(hints.length).toBeGreaterThan(0);
  });
});
