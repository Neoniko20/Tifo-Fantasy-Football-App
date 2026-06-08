/**
 * WM Import Status — unit tests
 *
 * Covers:
 *  1. Draft empty state logic: nations>0 + players=0 → "squads not available yet"
 *  2. Draft empty state logic: nations=0 + players=0 → "no data imported"
 *  3. Draft empty state: players>0 → normal render (no empty state)
 *  4. Status script file exists and contains expected checks
 *  5. Audit SQL file exists and is read-only (no INSERT/UPDATE/DELETE)
 *  6. computeReadinessStatus — all combinations
 *  7. Draft gate — blocked when no players (real tournament)
 *  8. Audit doc exists
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  computeReadinessStatus,
  formatReadinessLines,
  WM_EXPECTED_NATIONS,
  WM_EXPECTED_FIXTURES,
} from "../lib/wm-readiness";

// ── Helper: simulate draft empty-state decision logic ─────────────────────
// Mirrors the conditional in app/wm/[id]/draft/page.tsx
type EmptyStateKind = "squads-pending" | "nothing-imported" | "show-players";

function draftEmptyStateKind(opts: {
  isRealTournament: boolean | null;
  playersLength: number;
  nationsLength: number;
}): EmptyStateKind {
  const { isRealTournament, playersLength, nationsLength } = opts;
  if (isRealTournament === true && playersLength === 0) {
    return nationsLength > 0 ? "squads-pending" : "nothing-imported";
  }
  return "show-players";
}

// ── 1. Draft empty state logic ────────────────────────────────────────────
describe("Draft empty state — nations imported, players=0", () => {
  it("shows squads-pending when nations > 0 and players = 0 (real tournament)", () => {
    expect(draftEmptyStateKind({ isRealTournament: true, playersLength: 0, nationsLength: 48 }))
      .toBe("squads-pending");
  });

  it("shows squads-pending with partial nations count", () => {
    expect(draftEmptyStateKind({ isRealTournament: true, playersLength: 0, nationsLength: 1 }))
      .toBe("squads-pending");
  });

  it("shows nothing-imported when nations = 0 and players = 0 (real tournament)", () => {
    expect(draftEmptyStateKind({ isRealTournament: true, playersLength: 0, nationsLength: 0 }))
      .toBe("nothing-imported");
  });

  it("shows players when players > 0 (real tournament)", () => {
    expect(draftEmptyStateKind({ isRealTournament: true, playersLength: 832, nationsLength: 48 }))
      .toBe("show-players");
  });

  it("shows players for test tournament regardless of counts", () => {
    expect(draftEmptyStateKind({ isRealTournament: false, playersLength: 0, nationsLength: 0 }))
      .toBe("show-players");
  });

  it("shows players while tournament type is loading (null)", () => {
    expect(draftEmptyStateKind({ isRealTournament: null, playersLength: 0, nationsLength: 0 }))
      .toBe("show-players");
  });
});

// ── 2. Status script exists and has expected checks ───────────────────────
describe("wm-import-status.ts script", () => {
  const scriptPath = path.join(process.cwd(), "scripts", "wm-import-status.ts");
  const content = fs.readFileSync(scriptPath, "utf-8");

  it("file exists", () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it("checks wm_nations count", () => {
    expect(content).toContain("wm_nations");
  });

  it("checks wm_fixtures count", () => {
    expect(content).toContain("wm_fixtures");
  });

  it("checks players with api_football_player_id", () => {
    expect(content).toContain("api_football_player_id");
  });

  it("reports nations with and without api_team_id", () => {
    expect(content).toContain("api_team_id");
    expect(content).toContain("nationsWithId");
    expect(content).toContain("nationsWithoutId");
  });

  it("reports fixtures with and without api_fixture_id", () => {
    expect(content).toContain("api_fixture_id");
    expect(content).toContain("fixturesWithId");
    expect(content).toContain("fixturesWithoutId");
  });

  it("is read-only (no DB writes)", () => {
    expect(content).not.toContain(".insert(");
    expect(content).not.toContain(".upsert(");
    expect(content).not.toContain(".update(");
    expect(content).not.toContain(".delete(");
  });
});

// ── 3. Audit SQL is read-only ─────────────────────────────────────────────
describe("db/audit/wm_legacy_rows.sql", () => {
  const sqlPath = path.join(process.cwd(), "db", "audit", "wm_legacy_rows.sql");
  const content = fs.readFileSync(sqlPath, "utf-8");

  it("file exists", () => {
    expect(fs.existsSync(sqlPath)).toBe(true);
  });

  it("contains no INSERT statements", () => {
    expect(content.toUpperCase()).not.toMatch(/^\s*INSERT\b/m);
  });

  it("contains no UPDATE statements", () => {
    expect(content.toUpperCase()).not.toMatch(/^\s*UPDATE\b/m);
  });

  it("contains no DELETE statements", () => {
    expect(content.toUpperCase()).not.toMatch(/^\s*DELETE\b/m);
  });

  it("contains no DROP statements", () => {
    expect(content.toUpperCase()).not.toMatch(/^\s*DROP\b/m);
  });

  it("queries wm_nations for rows without api_team_id", () => {
    expect(content).toContain("wm_nations");
    expect(content.toLowerCase()).toContain("api_team_id is null");
  });

  it("queries wm_fixtures for rows without api_fixture_id", () => {
    expect(content).toContain("wm_fixtures");
    expect(content.toLowerCase()).toContain("api_fixture_id is null");
  });
});

// ── 6. computeReadinessStatus ─────────────────────────────────────────────
describe("computeReadinessStatus", () => {
  it("all ready when thresholds met", () => {
    const s = computeReadinessStatus({
      nationsWithId:  WM_EXPECTED_NATIONS,
      fixturesWithId: WM_EXPECTED_FIXTURES,
      playersWithId:  832,
    });
    expect(s.nations.ready).toBe(true);
    expect(s.fixtures.ready).toBe(true);
    expect(s.players.ready).toBe(true);
    expect(s.draftBlocked).toBe(false);
  });

  it("draftBlocked when players = 0 (even if nations+fixtures ready)", () => {
    const s = computeReadinessStatus({
      nationsWithId:  48,
      fixturesWithId: 72,
      playersWithId:  0,
    });
    expect(s.players.ready).toBe(false);
    expect(s.draftBlocked).toBe(true);
  });

  it("nations not ready when below threshold", () => {
    const s = computeReadinessStatus({ nationsWithId: 47, fixturesWithId: 72, playersWithId: 1 });
    expect(s.nations.ready).toBe(false);
    expect(s.draftBlocked).toBe(false);
  });

  it("fixtures not ready when below threshold", () => {
    const s = computeReadinessStatus({ nationsWithId: 48, fixturesWithId: 71, playersWithId: 1 });
    expect(s.fixtures.ready).toBe(false);
    expect(s.draftBlocked).toBe(false);
  });

  it("all blocked at zero counts", () => {
    const s = computeReadinessStatus({ nationsWithId: 0, fixturesWithId: 0, playersWithId: 0 });
    expect(s.nations.ready).toBe(false);
    expect(s.fixtures.ready).toBe(false);
    expect(s.players.ready).toBe(false);
    expect(s.draftBlocked).toBe(true);
  });

  it("exposes expected constants in returned shape", () => {
    const s = computeReadinessStatus({ nationsWithId: 48, fixturesWithId: 72, playersWithId: 0 });
    expect(s.nations.expected).toBe(WM_EXPECTED_NATIONS);
    expect(s.fixtures.expected).toBe(WM_EXPECTED_FIXTURES);
  });
});

// ── 7. formatReadinessLines ───────────────────────────────────────────────
describe("formatReadinessLines", () => {
  it("contains draft-blocked line when no players", () => {
    const s = computeReadinessStatus({ nationsWithId: 48, fixturesWithId: 72, playersWithId: 0 });
    const lines = formatReadinessLines(s);
    expect(lines.some(l => l.includes("Draft Blocked"))).toBe(true);
    expect(lines.some(l => l.includes("Squads Pending"))).toBe(true);
  });

  it("contains draft-ready line when players imported", () => {
    const s = computeReadinessStatus({ nationsWithId: 48, fixturesWithId: 72, playersWithId: 832 });
    const lines = formatReadinessLines(s);
    expect(lines.some(l => l.includes("Draft Ready"))).toBe(true);
    expect(lines.every(l => !l.includes("Draft Blocked"))).toBe(true);
  });

  it("returns 4 lines", () => {
    const s = computeReadinessStatus({ nationsWithId: 48, fixturesWithId: 72, playersWithId: 0 });
    expect(formatReadinessLines(s)).toHaveLength(4);
  });
});

// ── 8. Draft gate helper (mirrors startDraft guard in draft/page.tsx) ─────
describe("Draft gate — startDraft blocked when real tournament + no players", () => {
  function isDraftBlocked(opts: {
    isRealTournament: boolean | null;
    playersLength: number;
  }): boolean {
    return opts.isRealTournament === true && opts.playersLength === 0;
  }

  it("blocked for real tournament with 0 players", () => {
    expect(isDraftBlocked({ isRealTournament: true, playersLength: 0 })).toBe(true);
  });

  it("not blocked for real tournament with 1+ players", () => {
    expect(isDraftBlocked({ isRealTournament: true, playersLength: 1 })).toBe(false);
  });

  it("not blocked for test tournament with 0 players", () => {
    expect(isDraftBlocked({ isRealTournament: false, playersLength: 0 })).toBe(false);
  });

  it("not blocked while tournament type is loading (null)", () => {
    expect(isDraftBlocked({ isRealTournament: null, playersLength: 0 })).toBe(false);
  });

  it("not blocked for real tournament with full squad", () => {
    expect(isDraftBlocked({ isRealTournament: true, playersLength: 832 })).toBe(false);
  });
});

// ── 9. Audit doc exists ───────────────────────────────────────────────────
describe("docs/wm-import-audit.md", () => {
  const auditPath = path.join(process.cwd(), "docs", "wm-import-audit.md");

  it("file exists", () => {
    expect(fs.existsSync(auditPath)).toBe(true);
  });

  it("documents nations without api_team_id", () => {
    const content = fs.readFileSync(auditPath, "utf-8");
    expect(content.toLowerCase()).toContain("api_team_id");
  });

  it("documents fixtures without api_fixture_id", () => {
    const content = fs.readFileSync(auditPath, "utf-8");
    expect(content.toLowerCase()).toContain("api_fixture_id");
  });

  it("contains no destructive SQL", () => {
    const content = fs.readFileSync(auditPath, "utf-8").toUpperCase();
    expect(content).not.toMatch(/^\s*DELETE\b/m);
    expect(content).not.toMatch(/^\s*DROP\b/m);
    expect(content).not.toMatch(/^\s*UPDATE\b/m);
    expect(content).not.toMatch(/^\s*INSERT\b/m);
  });

  it("includes recommended action", () => {
    const content = fs.readFileSync(auditPath, "utf-8").toLowerCase();
    expect(content).toContain("recommended action");
  });
});
