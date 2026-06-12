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
import { shouldScorePlayer, handleAutoSub, resolveStatUpdatePlayerId } from "@/lib/wm-ingest";
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

  // ── Vice-Captain auf der Bank ─────────────────────────────────────────────
  // Wenn der VC nicht in starting_xi ist, gibt shouldScorePlayer score=false zurück.
  // handlePlayerStatUpdate überspringt dann die gesamte VC-Logik — kein Acting-Captain.
  it("VC auf Bank → score=false, isCaptain=false (kein Acting-Captain möglich)", () => {
    const VC = 55;
    // VC ist NICHT in starting_xi — sitzt auf der Bank
    const r = shouldScorePlayer(VC, { captain_id: OTHER, starting_xi: [PLAYER, OTHER] });
    expect(r.score).toBe(false);
    expect(r.isCaptain).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. resolveStatUpdatePlayerId — API-Football ID Lookup
// ═══════════════════════════════════════════════════════════════════════════

/** Minimal mock Supabase for resolveStatUpdatePlayerId tests */
function makePlayerLookupMock(result: { id: number } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: result }),
        }),
      }),
    }),
  } as any;
}

describe("resolveStatUpdatePlayerId — API-Football ID Lookup", () => {
  it("player_id direkt → gibt lokale ID zurück ohne DB-Lookup", async () => {
    // supabase wird nie aufgerufen wenn player_id gesetzt
    const sb = { from: vi.fn() } as any;
    const result = await resolveStatUpdatePlayerId({ player_id: 42 }, sb);
    expect(result).toEqual({ id: 42 });
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("player_id hat Vorrang vor api_football_player_id (backward compat)", async () => {
    const sb = { from: vi.fn() } as any;
    const result = await resolveStatUpdatePlayerId(
      { player_id: 42, api_football_player_id: 99999 },
      sb,
    );
    expect(result).toEqual({ id: 42 });
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("api_football_player_id → findet lokalen Spieler und gibt dessen ID zurück", async () => {
    const sb = makePlayerLookupMock({ id: 730 }); // Courtois: api_id=730 → local id=730
    const result = await resolveStatUpdatePlayerId({ api_football_player_id: 730 }, sb);
    expect(result).toEqual({ id: 730 });
  });

  it("api_football_player_id unbekannt → warning unmapped_api_player", async () => {
    const sb = makePlayerLookupMock(null);
    const result = await resolveStatUpdatePlayerId({ api_football_player_id: 99999 }, sb);
    expect(result).toEqual({ warning: "unmapped_api_player:99999" });
  });

  it("weder player_id noch api_football_player_id → warning missing", async () => {
    const sb = { from: vi.fn() } as any;
    const result = await resolveStatUpdatePlayerId({}, sb);
    expect("warning" in result).toBe(true);
    if ("warning" in result) {
      expect(result.warning).toContain("missing");
    }
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("Test-Spieler (kein api_football_player_id) bleibt via player_id nutzbar", async () => {
    const sb = { from: vi.fn() } as any;
    // Test-Spieler haben lokale IDs 90001–90120 und keine api_football_player_id
    const result = await resolveStatUpdatePlayerId({ player_id: 90001 }, sb);
    expect(result).toEqual({ id: 90001 });
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("Idempotenz: gleicher Input → gleiches Ergebnis", async () => {
    const sb = makePlayerLookupMock({ id: 892 });
    const r1 = await resolveStatUpdatePlayerId({ api_football_player_id: 892 }, sb);
    const r2 = await resolveStatUpdatePlayerId({ api_football_player_id: 892 }, makePlayerLookupMock({ id: 892 }) );
    expect(r1).toEqual(r2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. handleAutoSub — Persistenzlogik mit Mock-Supabase
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Minimal chainable Supabase mock for handleAutoSub.
 *
 * Handles the exact call chains used inside handleAutoSub:
 *   team_lineups  : .select().eq().eq().maybeSingle()  and  .update().eq().eq() [awaited]
 *   team_substitutions : .select().eq()×4.maybeSingle()  and  .insert()
 *   league_messages    : .insert()  (via writeSystemMessage)
 */
function buildAutoSubMock(cfg: {
  lineup: { starting_xi: number[]; bench: number[] } | null;
  lineupUpdateError?: { message: string } | null;
  existingSub?: { id: string } | null;
  subInsertError?: { message: string } | null;
}) {
  const insertCalls: Array<{ table: string; data: unknown }> = [];
  const updateCalls: Array<{ table: string; data: unknown }> = [];

  function makeChain(opts: {
    selectData: unknown;
    updateError: { message: string } | null;
    insertError: { message: string } | null;
    table: string;
  }) {
    // Capture the last insert/update payload before settling
    let lastInsertData: unknown;
    let lastUpdateData: unknown;

    const chain: any = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "maybeSingle") {
            return () => Promise.resolve({ data: opts.selectData, error: null });
          }
          if (prop === "insert") {
            return (data: unknown) => {
              lastInsertData = data;
              insertCalls.push({ table: opts.table, data });
              return Promise.resolve({ error: opts.insertError ?? null });
            };
          }
          if (prop === "update") {
            return (data: unknown) => {
              lastUpdateData = data;
              updateCalls.push({ table: opts.table, data });
              return chain;
            };
          }
          if (prop === "then") {
            // Direct await on chain (e.g. after .update().eq().eq())
            return (fn: (v: unknown) => unknown) =>
              Promise.resolve({ error: opts.updateError ?? null }).then(fn);
          }
          // .select(), .eq(), .single() — all return the same chain
          return () => chain;
        },
      },
    );
    return chain;
  }

  const supabase: any = {
    from(table: string) {
      if (table === "team_lineups") {
        return makeChain({
          table,
          selectData: cfg.lineup,
          updateError: cfg.lineupUpdateError ?? null,
          insertError: null,
        });
      }
      if (table === "team_substitutions") {
        return makeChain({
          table,
          selectData: cfg.existingSub ?? null,
          updateError: null,
          insertError: cfg.subInsertError ?? null,
        });
      }
      // league_messages and any other table: silent success
      return makeChain({ table, selectData: null, updateError: null, insertError: null });
    },
    _insertCalls: insertCalls,
    _updateCalls: updateCalls,
  };

  return supabase;
}

/** Factory for a minimal auto_sub.applied event */
function makeAutoSubEvent(overrides: Partial<{
  gameweek: number | undefined;
  playerOutId: number;
  playerInId: number;
}> = {}): import("@/lib/wm-types").WMIngestEvent {
  // Use 'in' check so passing gameweek: undefined keeps it undefined (not defaulted)
  const gameweek   = "gameweek"   in overrides ? overrides.gameweek   : 3;
  const playerOutId = "playerOutId" in overrides ? overrides.playerOutId! : 10;
  const playerInId  = "playerInId"  in overrides ? overrides.playerInId!  : 20;
  return {
    type: "auto_sub.applied",
    tournament_id: "t-test",
    gameweek,
    source: "admin",
    idempotency_key: `test-autosub-${playerOutId}-${playerInId}`,
    payload: {
      team_id:         "team-1",
      team_name:       "Test FC",
      player_out_id:   playerOutId,
      player_out_name: `Spieler ${playerOutId}`,
      player_in_id:    playerInId,
      player_in_name:  `Spieler ${playerInId}`,
      reason:          "not_playing",
    },
  };
}

const LEAGUE = "league-1";
const LINEUP_WITH_PLAYER_OUT = { starting_xi: [10, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12], bench: [20, 22] };

describe("handleAutoSub — Persistenzlogik mit Mock-Supabase", () => {
  it("schreibt team_lineups UPDATE wenn player_out in starting_xi", async () => {
    const supa = buildAutoSubMock({ lineup: LINEUP_WITH_PLAYER_OUT });
    const { applied } = await handleAutoSub(LEAGUE, makeAutoSubEvent(), supa);

    expect(applied).toContain("team_lineups:starting_xi");
    const lineupUpdate = supa._updateCalls.find((c: any) => c.table === "team_lineups");
    expect(lineupUpdate).toBeDefined();
    // player 10 replaced by 20 in starting_xi
    expect(lineupUpdate!.data.starting_xi).toContain(20);
    expect(lineupUpdate!.data.starting_xi).not.toContain(10);
    // player 20 removed from bench (was subbed in)
    expect(lineupUpdate!.data.bench).not.toContain(20);
  });

  it("schreibt team_substitutions INSERT wenn kein Record existiert", async () => {
    const supa = buildAutoSubMock({ lineup: LINEUP_WITH_PLAYER_OUT, existingSub: null });
    const { applied } = await handleAutoSub(LEAGUE, makeAutoSubEvent(), supa);

    expect(applied).toContain("team_substitutions:auto_sub");
    const subInsert = supa._insertCalls.find((c: any) => c.table === "team_substitutions");
    expect(subInsert).toBeDefined();
    expect(subInsert!.data).toMatchObject({
      team_id:    "team-1",
      gameweek:   3,
      player_out: 10,
      player_in:  20,
      auto:       true,
    });
  });

  it("überspringt INSERT wenn team_substitutions-Record bereits existiert", async () => {
    const supa = buildAutoSubMock({
      lineup: LINEUP_WITH_PLAYER_OUT,
      existingSub: { id: "existing-sub-id" },
    });
    const { applied } = await handleAutoSub(LEAGUE, makeAutoSubEvent(), supa);

    expect(applied).not.toContain("team_substitutions:auto_sub");
    const subInsert = supa._insertCalls.find((c: any) => c.table === "team_substitutions");
    expect(subInsert).toBeUndefined();
  });

  it("doppelter Aufruf ist idempotent — kein zweiter INSERT bei existierendem Record", async () => {
    // Simulate second call: existingSub already present (as if first call succeeded)
    const supa = buildAutoSubMock({
      lineup: LINEUP_WITH_PLAYER_OUT,
      existingSub: { id: "already-written" },
    });
    const { applied, warnings } = await handleAutoSub(LEAGUE, makeAutoSubEvent(), supa);

    expect(warnings).toHaveLength(0);
    expect(applied).not.toContain("team_substitutions:auto_sub");
    expect(supa._insertCalls.filter((c: any) => c.table === "team_substitutions")).toHaveLength(0);
  });

  it("fehlende Lineup-Zeile crasht nicht — gibt lineup_not_found Warning", async () => {
    const supa = buildAutoSubMock({ lineup: null });
    const { applied, warnings } = await handleAutoSub(LEAGUE, makeAutoSubEvent(), supa);

    expect(warnings).toContain("lineup_not_found");
    expect(supa._updateCalls).toHaveLength(0);
    expect(supa._insertCalls.filter((c: any) => c.table === "team_substitutions")).toHaveLength(0);
  });

  it("fehlendes gameweek crasht nicht — gibt missing_gameweek Warning", async () => {
    const supa = buildAutoSubMock({ lineup: LINEUP_WITH_PLAYER_OUT });
    const { warnings } = await handleAutoSub(
      LEAGUE,
      makeAutoSubEvent({ gameweek: undefined }),
      supa,
    );

    expect(warnings).toContain("missing_gameweek");
    expect(supa._updateCalls).toHaveLength(0);
  });

  it("team_substitutions INSERT-Fehler gibt sub_insert_failed Warning — kein stiller Datenverlust", async () => {
    const supa = buildAutoSubMock({
      lineup: LINEUP_WITH_PLAYER_OUT,
      subInsertError: { message: "duplicate key value violates unique constraint" },
    });
    const { applied, warnings } = await handleAutoSub(LEAGUE, makeAutoSubEvent(), supa);

    expect(warnings).toContain("sub_insert_failed");
    expect(applied).not.toContain("team_substitutions:auto_sub");
    // Lineup update still happened — it is ground truth
    expect(applied).toContain("team_lineups:starting_xi");
  });
});
