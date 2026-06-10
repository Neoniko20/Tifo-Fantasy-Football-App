/**
 * WM 2026 ingest unit tests
 *
 * Covers:
 *  1. Position mapping (POS_MAP logic from the ingest script)
 *  2. Pagination termination logic
 *  3. Draft pool filtering uses is_test_player flag (not ID ranges)
 *  4. 48-team schema has round_of_32 and 8 gameweeks
 *
 * All tests are pure/deterministic — no real Supabase connections.
 */

import { describe, it, expect, vi } from "vitest";
import { shouldScorePlayer } from "@/lib/wm-ingest";
import fs from "fs";
import path from "path";

// ═══════════════════════════════════════════════════════════════════════════
// 1. Position mapping
// ═══════════════════════════════════════════════════════════════════════════

// Inline mirror of POS_MAP from scripts/ingest-wm-2026-api-football.ts
const POS_MAP: Record<string, string> = {
  Goalkeeper: "GK",
  Defender:   "DF",
  Midfielder: "MF",
  Attacker:   "FW",
  Forward:    "FW",
};

function mapPosition(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (POS_MAP[raw]) return POS_MAP[raw];
  const lower = raw.toLowerCase();
  if (lower.includes("goal") || lower.includes("keeper")) return "GK";
  if (lower.includes("defend") || lower.includes("back"))  return "DF";
  if (lower.includes("mid"))                               return "MF";
  if (lower.includes("attack") || lower.includes("forward") || lower.includes("striker")) return "FW";
  return null;
}

describe("WM 2026 position mapping", () => {
  it('maps "Goalkeeper" → "GK"', () => {
    expect(mapPosition("Goalkeeper")).toBe("GK");
  });

  it('maps "Defender" → "DF"', () => {
    expect(mapPosition("Defender")).toBe("DF");
  });

  it('maps "Midfielder" → "MF"', () => {
    expect(mapPosition("Midfielder")).toBe("MF");
  });

  it('maps "Attacker" → "FW"', () => {
    expect(mapPosition("Attacker")).toBe("FW");
  });

  it('maps "Forward" → "FW"', () => {
    expect(mapPosition("Forward")).toBe("FW");
  });

  it("returns null for empty string", () => {
    expect(mapPosition("")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(mapPosition(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(mapPosition(undefined)).toBeNull();
  });

  it("falls back to fuzzy match for 'goalkeeper' (lowercase)", () => {
    expect(mapPosition("goalkeeper")).toBe("GK");
  });

  it("falls back to fuzzy match for 'centre-back'", () => {
    expect(mapPosition("centre-back")).toBe("DF");
  });

  it("returns null for completely unknown position string", () => {
    expect(mapPosition("Coach")).toBeNull();
  });

  it("ingest script file contains exact POS_MAP entries", () => {
    const scriptPath = path.join(
      process.cwd(),
      "scripts",
      "ingest-wm-2026-api-football.ts",
    );
    const src = fs.readFileSync(scriptPath, "utf-8");
    expect(src).toContain('Goalkeeper: "GK"');
    expect(src).toContain('Defender:   "DF"');
    expect(src).toContain('Midfielder: "MF"');
    expect(src).toContain('Attacker:   "FW"');
    expect(src).toContain('Forward:    "FW"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Pagination logic
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mimics the pagination loop from ingestPlayers in the ingest script:
 *   while (true) { ... if (currentPage >= totalPages) break; page++; }
 */
async function runPaginationLoop(
  fetchPage: (page: number) => Promise<{ paging: { current: number; total: number }; items: string[] }>,
): Promise<{ allItems: string[]; pagesFetched: number }> {
  let page = 1;
  const allItems: string[] = [];
  let pagesFetched = 0;

  while (true) {
    const json = await fetchPage(page);
    const currentPage = json.paging?.current ?? page;
    const totalPages  = json.paging?.total   ?? 1;

    allItems.push(...json.items);
    pagesFetched++;

    if (currentPage >= totalPages) break;
    page++;
  }

  return { allItems, pagesFetched };
}

describe("WM 2026 pagination logic", () => {
  it("fetches all pages when current < total (3 pages)", async () => {
    const fetchPage = vi.fn(async (page: number) => ({
      paging: { current: page, total: 3 },
      items: [`item-p${page}`],
    }));

    const { allItems, pagesFetched } = await runPaginationLoop(fetchPage);

    expect(pagesFetched).toBe(3);
    expect(allItems).toEqual(["item-p1", "item-p2", "item-p3"]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("stops correctly when current === total", async () => {
    const fetchPage = vi.fn(async (page: number) => ({
      paging: { current: page, total: page }, // single-page scenario for any page
      items: [`item-p${page}`],
    }));

    const { pagesFetched } = await runPaginationLoop(fetchPage);
    expect(pagesFetched).toBe(1);
  });

  it("stops immediately for single-page response (total: 1)", async () => {
    const fetchPage = vi.fn(async (_page: number) => ({
      paging: { current: 1, total: 1 },
      items: ["only-item"],
    }));

    const { allItems, pagesFetched } = await runPaginationLoop(fetchPage);
    expect(pagesFetched).toBe(1);
    expect(allItems).toEqual(["only-item"]);
  });

  it("stops when current > total (defensive: should not happen but safe)", async () => {
    // current=5, total=3 — loop should stop on the first call
    const fetchPage = vi.fn(async (_page: number) => ({
      paging: { current: 5, total: 3 },
      items: ["stale-item"],
    }));

    const { pagesFetched } = await runPaginationLoop(fetchPage);
    expect(pagesFetched).toBe(1);
  });

  it("collects items from every page", async () => {
    const fetchPage = vi.fn(async (page: number) => ({
      paging: { current: page, total: 2 },
      items: [`a${page}`, `b${page}`],
    }));

    const { allItems } = await runPaginationLoop(fetchPage);
    expect(allItems).toEqual(["a1", "b1", "a2", "b2"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Draft pool filter uses is_test_player flag
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Builds a chainable Supabase-mock that records which filter calls were made.
 */
function buildSupaMock(
  tournamentRows: Array<{ is_test_tournament: boolean }>,
  playerRows: Array<Record<string, unknown>> = [],
) {
  const calls: { method: string; args: unknown[] }[] = [];

  // Helper: chainable proxy that records calls and resolves with data at .then
  function makeChain(resolveWith: { data: unknown; error: null }): any {
    const chain: any = new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === "then") {
            // Make it thenable so "await chain" works
            return (onFulfilled: (v: unknown) => unknown) =>
              Promise.resolve(resolveWith).then(onFulfilled);
          }
          return (...args: unknown[]) => {
            calls.push({ method: prop, args });
            return chain;
          };
        },
      },
    );
    return chain;
  }

  const supabase: any = {
    from(table: string) {
      calls.push({ method: "from", args: [table] });
      if (table === "wm_tournaments") {
        return makeChain({ data: tournamentRows[0] ?? null, error: null });
      }
      if (table === "players") {
        return makeChain({ data: playerRows, error: null });
      }
      return makeChain({ data: null, error: null });
    },
    _calls: calls,
  };

  return supabase;
}

describe("WM draft pool filtering", () => {
  it("queries is_test_player=false for a real tournament", async () => {
    const { getWmPlayerPool } = await import("@/lib/wm-player-pool");

    const supa = buildSupaMock([{ is_test_tournament: false }]);
    await getWmPlayerPool(supa, "real-tournament-id");

    const eqCalls = supa._calls.filter((c: any) => c.method === "eq");
    const testPlayerCall = eqCalls.find(
      (c: any) => c.args[0] === "is_test_player",
    );

    expect(testPlayerCall).toBeDefined();
    expect(testPlayerCall!.args[1]).toBe(false);
  });

  it("queries is_test_player=true for a test tournament", async () => {
    const { getWmPlayerPool } = await import("@/lib/wm-player-pool");

    const supa = buildSupaMock([{ is_test_tournament: true }]);
    await getWmPlayerPool(supa, "test-tournament-id");

    const eqCalls = supa._calls.filter((c: any) => c.method === "eq");
    const testPlayerCall = eqCalls.find(
      (c: any) => c.args[0] === "is_test_player",
    );

    expect(testPlayerCall).toBeDefined();
    expect(testPlayerCall!.args[1]).toBe(true);
  });

  it("never calls .gte() (no ID-range filter)", async () => {
    const { getWmPlayerPool } = await import("@/lib/wm-player-pool");

    const supa = buildSupaMock([{ is_test_tournament: false }]);
    await getWmPlayerPool(supa, "real-tournament-id");

    const gteCalls = supa._calls.filter((c: any) => c.method === "gte");
    expect(gteCalls).toHaveLength(0);
  });

  it("never calls .lte() (no ID-range filter)", async () => {
    const { getWmPlayerPool } = await import("@/lib/wm-player-pool");

    const supa = buildSupaMock([{ is_test_tournament: false }]);
    await getWmPlayerPool(supa, "real-tournament-id");

    const lteCalls = supa._calls.filter((c: any) => c.method === "lte");
    expect(lteCalls).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. 48-team schema
// ═══════════════════════════════════════════════════════════════════════════

describe("WM 2026 48-team schema", () => {
  const schemaPath = path.join(process.cwd(), "db", "wm_schema.sql");
  let schema: string;

  try {
    schema = fs.readFileSync(schemaPath, "utf-8");
  } catch {
    schema = "";
  }

  it("schema file exists and is non-empty", () => {
    expect(schema.length).toBeGreaterThan(0);
  });

  it("contains round_of_32 phase (48-team new knockout round)", () => {
    expect(schema).toContain("round_of_32");
  });

  it("has exactly 8 gameweek insert rows (GW 1-8)", () => {
    // Count lines like: (t_id, N, '...', '...', '...')
    const matches = schema.match(/\(t_id,\s*\d+,\s*'[^']*',\s*'[^']*',\s*'[^']*'\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(8);
  });

  it("final is at gameweek 8 (not 7)", () => {
    // Find the line that has 'final' phase
    const finalLine = schema
      .split("\n")
      .find((line) => line.includes("'final'") && line.includes("t_id"));
    expect(finalLine).toBeDefined();
    expect(finalLine).toContain("8,");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. shouldScorePlayer — Starter-Filter für Punktevergabe
// ═══════════════════════════════════════════════════════════════════════════

describe("shouldScorePlayer — Starter-Filter", () => {
  const PLAYER = 42;
  const CAPTAIN = 42;
  const OTHER = 99;

  const lineup = (xi: number[], captain: number | null = null) => ({
    captain_id: captain,
    starting_xi: xi,
  });

  // ── kein Lineup ────────────────────────────────────────────────────────

  it("kein Lineup → score=false, reason=no_lineup", () => {
    const r = shouldScorePlayer(PLAYER, null);
    expect(r.score).toBe(false);
    expect(r.isCaptain).toBe(false);
    expect(r.reason).toBe("no_lineup");
  });

  // ── Starter erhält Punkte ──────────────────────────────────────────────

  it("Spieler in starting_xi → score=true", () => {
    const r = shouldScorePlayer(PLAYER, lineup([PLAYER, OTHER]));
    expect(r.score).toBe(true);
    expect(r.isCaptain).toBe(false);
  });

  // ── Bankspieler erhält keine Punkte ────────────────────────────────────

  it("Spieler nicht in starting_xi → score=false (Bankspieler)", () => {
    const r = shouldScorePlayer(PLAYER, lineup([OTHER, 77]));
    expect(r.score).toBe(false);
    expect(r.isCaptain).toBe(false);
    expect(r.reason).toBeUndefined();
  });

  it("leeres starting_xi → score=false für jeden Spieler", () => {
    const r = shouldScorePlayer(PLAYER, lineup([]));
    expect(r.score).toBe(false);
  });

  // ── Spieler im Squad aber nicht in starting_xi ─────────────────────────

  it("Spieler im Squad aber nicht in starting_xi → kein Score", () => {
    // Simuliert: wm_squad_players hat Spieler 42, aber Lineup hat ihn auf Bank
    const r = shouldScorePlayer(PLAYER, lineup([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
    expect(r.score).toBe(false);
  });

  // ── Captain-Multiplier nur für Starter ────────────────────────────────

  it("Captain in starting_xi → score=true, isCaptain=true", () => {
    const r = shouldScorePlayer(CAPTAIN, lineup([CAPTAIN, OTHER], CAPTAIN));
    expect(r.score).toBe(true);
    expect(r.isCaptain).toBe(true);
  });

  it("Captain auf Bank → score=false, kein 2x-Multiplier", () => {
    // Captain sitzt auf der Bank — nicht in starting_xi
    const r = shouldScorePlayer(CAPTAIN, lineup([OTHER, 77], CAPTAIN));
    expect(r.score).toBe(false);
    expect(r.isCaptain).toBe(false);
  });

  it("Starter aber nicht Captain → score=true, isCaptain=false", () => {
    // Captain ist ein anderer Spieler
    const r = shouldScorePlayer(PLAYER, lineup([PLAYER, OTHER], OTHER));
    expect(r.score).toBe(true);
    expect(r.isCaptain).toBe(false);
  });

  // ── Typen-Robustheit ──────────────────────────────────────────────────

  it("starting_xi mit gemischten Typen: Zahl-Match funktioniert", () => {
    // JSONB aus Supabase liefert numbers — sicherstellen dass Include funktioniert
    const r = shouldScorePlayer(42, lineup([10, 42, 99]));
    expect(r.score).toBe(true);
  });

  it("captain_id=null → isCaptain=false auch wenn Spieler Starter ist", () => {
    const r = shouldScorePlayer(PLAYER, lineup([PLAYER, OTHER], null));
    expect(r.score).toBe(true);
    expect(r.isCaptain).toBe(false);
  });

  it("starting_xi ist kein Array (z.B. null aus DB) → score=false", () => {
    const r = shouldScorePlayer(PLAYER, { captain_id: null, starting_xi: null });
    expect(r.score).toBe(false);
  });
});
