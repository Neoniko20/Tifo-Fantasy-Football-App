import { describe, it, expect } from "vitest";
import {
  buildFixtureUpdate,
  mapAfStatus,
  FINISHED_AF_STATUSES,
} from "../scripts/wm-backfill-fixture-scores";

// ── Minimal DB fixture shape for tests ───────────────────────────────────────

function makeDbFixture(overrides: Partial<{
  id: string;
  api_fixture_id: number | null;
  gameweek: number;
  status: string;
  home_score: number | null;
  away_score: number | null;
  kickoff: string | null;
  tournament_id: string;
}> = {}) {
  return {
    id: "fix-uuid-1",
    api_fixture_id: 1001,
    gameweek: 1,
    status: "scheduled",
    home_score: null,
    away_score: null,
    kickoff: "2026-06-15T15:00:00Z",
    tournament_id: "tourn-uuid-1",
    ...overrides,
  };
}

// ── mapAfStatus ───────────────────────────────────────────────────────────────

describe("mapAfStatus", () => {
  it("maps FT to finished", () => {
    expect(mapAfStatus("FT")).toBe("finished");
  });

  it("maps AET to finished", () => {
    expect(mapAfStatus("AET")).toBe("finished");
  });

  it("maps PEN to finished", () => {
    expect(mapAfStatus("PEN")).toBe("finished");
  });

  it("maps AWD to finished", () => {
    expect(mapAfStatus("AWD")).toBe("finished");
  });

  it("maps WO to finished", () => {
    expect(mapAfStatus("WO")).toBe("finished");
  });

  it("maps 1H to live", () => {
    expect(mapAfStatus("1H")).toBe("live");
  });

  it("maps HT to live", () => {
    expect(mapAfStatus("HT")).toBe("live");
  });

  it("maps 2H to live", () => {
    expect(mapAfStatus("2H")).toBe("live");
  });

  it("maps NS to scheduled", () => {
    expect(mapAfStatus("NS")).toBe("scheduled");
  });

  it("maps unknown to scheduled", () => {
    expect(mapAfStatus("CANC")).toBe("scheduled");
  });
});

// ── FINISHED_AF_STATUSES ──────────────────────────────────────────────────────

describe("FINISHED_AF_STATUSES", () => {
  it("contains all expected statuses", () => {
    expect(FINISHED_AF_STATUSES.has("FT")).toBe(true);
    expect(FINISHED_AF_STATUSES.has("AET")).toBe(true);
    expect(FINISHED_AF_STATUSES.has("PEN")).toBe(true);
    expect(FINISHED_AF_STATUSES.has("AWD")).toBe(true);
    expect(FINISHED_AF_STATUSES.has("WO")).toBe(true);
  });

  it("does not contain live or scheduled statuses", () => {
    expect(FINISHED_AF_STATUSES.has("1H")).toBe(false);
    expect(FINISHED_AF_STATUSES.has("NS")).toBe(false);
    expect(FINISHED_AF_STATUSES.has("HT")).toBe(false);
  });
});

// ── buildFixtureUpdate ────────────────────────────────────────────────────────

describe("buildFixtureUpdate — non-finished API status", () => {
  it("returns needsUpdate=false for live fixture", () => {
    const db = makeDbFixture({ status: "scheduled" });
    const result = buildFixtureUpdate(db, { afStatus: "1H", homeScore: 1, awayScore: 0 });
    expect(result.needsUpdate).toBe(false);
    expect(result.payload).toBeUndefined();
  });

  it("returns needsUpdate=false for not-started fixture", () => {
    const db = makeDbFixture({ status: "scheduled" });
    const result = buildFixtureUpdate(db, { afStatus: "NS", homeScore: null, awayScore: null });
    expect(result.needsUpdate).toBe(false);
  });
});

describe("buildFixtureUpdate — missing scores from API", () => {
  it("returns needsUpdate=false if API homeScore is null", () => {
    const db = makeDbFixture({ status: "scheduled" });
    const result = buildFixtureUpdate(db, { afStatus: "FT", homeScore: null, awayScore: 1 });
    expect(result.needsUpdate).toBe(false);
  });

  it("returns needsUpdate=false if API awayScore is null", () => {
    const db = makeDbFixture({ status: "scheduled" });
    const result = buildFixtureUpdate(db, { afStatus: "FT", homeScore: 2, awayScore: null });
    expect(result.needsUpdate).toBe(false);
  });
});

describe("buildFixtureUpdate — already up to date", () => {
  it("returns needsUpdate=false if DB already has correct finished scores", () => {
    const db = makeDbFixture({ status: "finished", home_score: 2, away_score: 1 });
    const result = buildFixtureUpdate(db, { afStatus: "FT", homeScore: 2, awayScore: 1 });
    expect(result.needsUpdate).toBe(false);
  });

  it("returns needsUpdate=true if DB has correct scores but wrong status", () => {
    // DB says scheduled but API says FT — status needs updating
    const db = makeDbFixture({ status: "scheduled", home_score: 2, away_score: 1 });
    const result = buildFixtureUpdate(db, { afStatus: "FT", homeScore: 2, awayScore: 1 });
    expect(result.needsUpdate).toBe(true);
    expect(result.payload?.status).toBe("finished");
  });
});

describe("buildFixtureUpdate — needs update", () => {
  it("returns needsUpdate=true for unscored finished fixture", () => {
    const db = makeDbFixture({ status: "scheduled", home_score: null, away_score: null });
    const result = buildFixtureUpdate(db, { afStatus: "FT", homeScore: 3, awayScore: 1 });
    expect(result.needsUpdate).toBe(true);
    expect(result.payload).toEqual({ home_score: 3, away_score: 1, status: "finished" });
  });

  it("returns needsUpdate=true for wrong score in finished fixture", () => {
    const db = makeDbFixture({ status: "finished", home_score: 1, away_score: 0 });
    const result = buildFixtureUpdate(db, { afStatus: "FT", homeScore: 2, awayScore: 1 });
    expect(result.needsUpdate).toBe(true);
    expect(result.payload).toEqual({ home_score: 2, away_score: 1, status: "finished" });
  });

  it("handles AET (extra time) as finished", () => {
    const db = makeDbFixture({ status: "scheduled" });
    const result = buildFixtureUpdate(db, { afStatus: "AET", homeScore: 1, awayScore: 1 });
    expect(result.needsUpdate).toBe(true);
    expect(result.payload?.status).toBe("finished");
  });

  it("handles PEN (penalties) as finished", () => {
    const db = makeDbFixture({ status: "live" });
    const result = buildFixtureUpdate(db, { afStatus: "PEN", homeScore: 0, awayScore: 0 });
    expect(result.needsUpdate).toBe(true);
    expect(result.payload?.status).toBe("finished");
  });

  it("handles 0-0 result correctly (not confused with null)", () => {
    const db = makeDbFixture({ status: "scheduled", home_score: null, away_score: null });
    const result = buildFixtureUpdate(db, { afStatus: "FT", homeScore: 0, awayScore: 0 });
    expect(result.needsUpdate).toBe(true);
    expect(result.payload).toEqual({ home_score: 0, away_score: 0, status: "finished" });
  });
});

describe("buildFixtureUpdate — dry-run safety (no side effects)", () => {
  it("does not mutate the input fixture object", () => {
    const db = makeDbFixture({ status: "scheduled", home_score: null, away_score: null });
    const originalStatus = db.status;
    buildFixtureUpdate(db, { afStatus: "FT", homeScore: 2, awayScore: 1 });
    expect(db.status).toBe(originalStatus);
    expect(db.home_score).toBeNull();
    expect(db.away_score).toBeNull();
  });
});
