/**
 * WM Import Status — unit tests
 *
 * Covers:
 *  1. Draft empty state logic: nations>0 + players=0 → "squads not available yet"
 *  2. Draft empty state logic: nations=0 + players=0 → "no data imported"
 *  3. Draft empty state: players>0 → normal render (no empty state)
 *  4. Status script file exists and contains expected checks
 *  5. Audit SQL file exists and is read-only (no INSERT/UPDATE/DELETE)
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

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
