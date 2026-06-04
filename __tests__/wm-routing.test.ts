/**
 * WM routing unit tests
 *
 * Covers the three route-consistency requirements from the WM routing bug fix:
 *  A. Starting from a /wm/[id]/... pathname keeps BottomNav inside the WM route family.
 *  B. WM league overview "Aufstellung" links to /wm/[id]/lineup, not /leagues/[id]/lineup.
 *  C. extractLeagueInfo correctly detects WM vs. league routes.
 *
 * These are pure function tests — no React, no Supabase, no browser needed.
 */

import { describe, it, expect } from "vitest";
import { extractLeagueInfo, computeNavHrefs } from "@/lib/nav-utils";

const WM_ID  = "46f66d03-9270-4cee-b6b5-99f2f48ee61c";
const LG_ID  = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// ── extractLeagueInfo ─────────────────────────────────────────────────────────

describe("extractLeagueInfo", () => {
  it("detects WM route from /wm/[id]", () => {
    expect(extractLeagueInfo(`/wm/${WM_ID}`)).toEqual({ id: WM_ID, isWm: true });
  });

  it("detects WM route from /wm/[id]/lineup", () => {
    expect(extractLeagueInfo(`/wm/${WM_ID}/lineup`)).toEqual({ id: WM_ID, isWm: true });
  });

  it("detects WM route from /wm/[id]/matchday", () => {
    expect(extractLeagueInfo(`/wm/${WM_ID}/matchday`)).toEqual({ id: WM_ID, isWm: true });
  });

  it("detects WM route from /wm/[id]/waiver", () => {
    expect(extractLeagueInfo(`/wm/${WM_ID}/waiver`)).toEqual({ id: WM_ID, isWm: true });
  });

  it("detects WM route from /wm/[id]/draft", () => {
    expect(extractLeagueInfo(`/wm/${WM_ID}/draft`)).toEqual({ id: WM_ID, isWm: true });
  });

  it("detects WM route from /wm/[id]/live-center", () => {
    expect(extractLeagueInfo(`/wm/${WM_ID}/live-center`)).toEqual({ id: WM_ID, isWm: true });
  });

  it("detects normal league route from /leagues/[id]", () => {
    expect(extractLeagueInfo(`/leagues/${LG_ID}`)).toEqual({ id: LG_ID, isWm: false });
  });

  it("detects normal league route from /leagues/[id]/lineup", () => {
    expect(extractLeagueInfo(`/leagues/${LG_ID}/lineup`)).toEqual({ id: LG_ID, isWm: false });
  });

  it("returns null for home page /", () => {
    expect(extractLeagueInfo("/")).toBeNull();
  });

  it("returns null for /leagues list page", () => {
    expect(extractLeagueInfo("/leagues")).toBeNull();
  });

  it("returns null for /scores", () => {
    expect(extractLeagueInfo("/scores")).toBeNull();
  });
});

// ── computeNavHrefs — WM paths stay in /wm/... ───────────────────────────────

describe("computeNavHrefs — from WM path", () => {
  const wmPaths = [
    `/wm/${WM_ID}`,
    `/wm/${WM_ID}/lineup`,
    `/wm/${WM_ID}/matchday`,
    `/wm/${WM_ID}/waiver`,
    `/wm/${WM_ID}/draft`,
    `/wm/${WM_ID}/live-center`,
  ];

  for (const path of wmPaths) {
    it(`BottomNav Matchday stays inside /wm from ${path}`, () => {
      const { matchdayHref } = computeNavHrefs(path, null, false);
      expect(matchdayHref).toBe(`/wm/${WM_ID}/matchday`);
    });

    it(`BottomNav MyTeam (Aufstellung) links to /wm/[id]/lineup from ${path}`, () => {
      const { myTeamHref } = computeNavHrefs(path, null, false);
      expect(myTeamHref).toBe(`/wm/${WM_ID}/lineup`);
    });

    it(`BottomNav Leagues links to /wm/[id] from ${path}`, () => {
      const { leaguesHref } = computeNavHrefs(path, null, false);
      expect(leaguesHref).toBe(`/wm/${WM_ID}`);
    });
  }
});

// ── computeNavHrefs — normal league paths stay in /leagues/... ───────────────

describe("computeNavHrefs — from normal league path", () => {
  it("Matchday stays in /leagues from /leagues/[id]/lineup", () => {
    const { matchdayHref } = computeNavHrefs(`/leagues/${LG_ID}/lineup`, null, false);
    expect(matchdayHref).toBe(`/leagues/${LG_ID}/matchday`);
  });

  it("MyTeam links to /leagues/[id]/lineup from /leagues/[id]", () => {
    const { myTeamHref } = computeNavHrefs(`/leagues/${LG_ID}`, null, false);
    expect(myTeamHref).toBe(`/leagues/${LG_ID}/lineup`);
  });
});

// ── computeNavHrefs — stored WM context on non-league page ───────────────────

describe("computeNavHrefs — stored context fallback", () => {
  it("uses stored WM context when on home page /", () => {
    const { matchdayHref, myTeamHref } = computeNavHrefs("/", WM_ID, true);
    expect(matchdayHref).toBe(`/wm/${WM_ID}/matchday`);
    expect(myTeamHref).toBe(`/wm/${WM_ID}/lineup`);
  });

  it("URL-derived info overrides stored WM context when on a normal league page", () => {
    // URL says /leagues/... but stored says WM — URL wins
    const { matchdayHref } = computeNavHrefs(`/leagues/${LG_ID}/matchday`, WM_ID, true);
    expect(matchdayHref).toBe(`/leagues/${LG_ID}/matchday`);
  });

  it("URL-derived WM info overrides stored normal-league context", () => {
    const { matchdayHref } = computeNavHrefs(`/wm/${WM_ID}/matchday`, LG_ID, false);
    expect(matchdayHref).toBe(`/wm/${WM_ID}/matchday`);
  });

  it("falls back to /scores when no league context at all", () => {
    const { matchdayHref } = computeNavHrefs("/", null, false);
    expect(matchdayHref).toBe("/scores");
  });
});

// ── Regression: WM overview "Aufstellung" must not link to /leagues/... ──────

describe("Regression: WM overview Aufstellung link", () => {
  it("MyTeam href is /wm/[id]/lineup, NOT /leagues/[id]/lineup, when on /wm/[id]", () => {
    const { myTeamHref } = computeNavHrefs(`/wm/${WM_ID}`, null, false);
    expect(myTeamHref).not.toContain("/leagues/");
    expect(myTeamHref).toBe(`/wm/${WM_ID}/lineup`);
  });
});
