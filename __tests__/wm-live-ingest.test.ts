/**
 * Tests für lib/wm-live-ingest.ts
 *
 * Fokus: pure Transformer-Helpers — mapAfStatToPayload, makeIngestIdempotencyKey,
 * isFixtureRelevant, afetch (retry cap).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  afetch,
  mapAfStatToPayload,
  makeIngestIdempotencyKey,
  isFixtureRelevant,
  type AfFixturePlayerEntry,
} from "@/lib/wm-live-ingest";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePlayerEntry(overrides: Partial<AfFixturePlayerEntry["statistics"][0]> = {}): AfFixturePlayerEntry {
  const base: AfFixturePlayerEntry["statistics"][0] = {
    games:    { minutes: 90, position: "M", captain: false, substitute: false },
    goals:    { total: 1, conceded: 0, assists: 1, saves: 0 },
    shots:    { total: 3, on: 2 },
    passes:   { total: 45, key: 3, accuracy: "89" },
    tackles:  { total: 2, blocks: 1, interceptions: 1 },
    dribbles: { attempts: 2, success: 1 },
    cards:    { yellow: 0, red: 0 },
  };
  const merged = { ...base, ...overrides };
  return {
    player: { id: 276, name: "Test Player" },
    statistics: [merged],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. mapAfStatToPayload
// ═══════════════════════════════════════════════════════════════════════════

describe("mapAfStatToPayload — API-Football → PlayerStatUpdatePayload", () => {
  it("setzt api_football_player_id aus player.id", () => {
    const result = mapAfStatToPayload(makePlayerEntry());
    expect(result.api_football_player_id).toBe(276);
  });

  it("mappt vollständige Stats korrekt", () => {
    const result = mapAfStatToPayload(makePlayerEntry());
    expect(result.minutes).toBe(90);
    expect(result.goals).toBe(1);
    expect(result.assists).toBe(1);
    expect(result.shots_on).toBe(2);
    expect(result.key_passes).toBe(3);
    expect(result.pass_accuracy).toBe(89);
    expect(result.dribbles).toBe(1);
    expect(result.tackles).toBe(2);
    expect(result.interceptions).toBe(1);
    expect(result.saves).toBe(0);
    expect(result.yellow_cards).toBe(0);
    expect(result.red_cards).toBe(0);
  });

  it("pass_accuracy als String wird korrekt zu Zahl geparst", () => {
    const result = mapAfStatToPayload(makePlayerEntry({ passes: { total: 40, key: 2, accuracy: "73" } }));
    expect(result.pass_accuracy).toBe(73);
  });

  it("pass_accuracy als Zahl wird korrekt übernommen", () => {
    const result = mapAfStatToPayload(makePlayerEntry({ passes: { total: 40, key: 2, accuracy: 73 } }));
    expect(result.pass_accuracy).toBe(73);
  });

  it("null-Felder werden sicher zu 0 gemappt (nicht crash)", () => {
    const entry = makePlayerEntry({
      goals:    { total: null, conceded: null, assists: null, saves: null },
      shots:    { total: null, on: null },
      passes:   { total: null, key: null, accuracy: null },
      tackles:  { total: null, blocks: null, interceptions: null },
      dribbles: { attempts: null, success: null },
      cards:    { yellow: null, red: null },
    });
    const result = mapAfStatToPayload(entry);
    expect(result.goals).toBe(0);
    expect(result.assists).toBe(0);
    expect(result.shots_on).toBe(0);
    expect(result.key_passes).toBe(0);
    expect(result.pass_accuracy).toBe(0);
    expect(result.dribbles).toBe(0);
    expect(result.tackles).toBe(0);
    expect(result.interceptions).toBe(0);
    expect(result.saves).toBe(0);
    expect(result.yellow_cards).toBe(0);
    expect(result.red_cards).toBe(0);
  });

  it("leere statistics-Array → gibt nur api_football_player_id zurück, kein Crash", () => {
    const entry: AfFixturePlayerEntry = { player: { id: 99, name: "Unknown" }, statistics: [] };
    const result = mapAfStatToPayload(entry);
    expect(result.api_football_player_id).toBe(99);
    expect(result.goals).toBeUndefined();
  });

  // Clean sheet logic
  it("Torwart (G) mit 0 Gegentoren und 90 min → clean_sheet true", () => {
    const result = mapAfStatToPayload(makePlayerEntry({
      games: { minutes: 90, position: "G", captain: false, substitute: false },
      goals: { total: 0, conceded: 0, assists: 0, saves: 5 },
    }));
    expect(result.clean_sheet).toBe(true);
  });

  it("Torwart (G) mit 1 Gegentor → clean_sheet false", () => {
    const result = mapAfStatToPayload(makePlayerEntry({
      games: { minutes: 90, position: "G", captain: false, substitute: false },
      goals: { total: 0, conceded: 1, assists: 0, saves: 3 },
    }));
    expect(result.clean_sheet).toBe(false);
  });

  it("Abwehrspieler (D) mit 0 Gegentoren und 90 min → clean_sheet true", () => {
    const result = mapAfStatToPayload(makePlayerEntry({
      games: { minutes: 90, position: "D", captain: false, substitute: false },
      goals: { total: 0, conceded: 0, assists: 0, saves: 0 },
    }));
    expect(result.clean_sheet).toBe(true);
  });

  it("Mittelfeldspieler (M) mit 0 Gegentoren und 90 min → clean_sheet true", () => {
    const result = mapAfStatToPayload(makePlayerEntry({
      games: { minutes: 90, position: "M", captain: false, substitute: false },
      goals: { total: 1, conceded: 0, assists: 0, saves: 0 },
    }));
    expect(result.clean_sheet).toBe(true);
  });

  it("Mittelfeldspieler (M) mit 1 Gegentor → clean_sheet false", () => {
    const result = mapAfStatToPayload(makePlayerEntry({
      games: { minutes: 90, position: "M", captain: false, substitute: false },
      goals: { total: 0, conceded: 1, assists: 0, saves: 0 },
    }));
    expect(result.clean_sheet).toBe(false);
  });

  it("Stürmer (F) mit 0 Gegentoren → clean_sheet false (FW erhält keine CS-Punkte)", () => {
    const result = mapAfStatToPayload(makePlayerEntry({
      games: { minutes: 90, position: "F", captain: false, substitute: false },
      goals: { total: 2, conceded: 0, assists: 0, saves: 0 },
    }));
    expect(result.clean_sheet).toBe(false);
  });

  it("Torwart mit 0 Minuten → clean_sheet false (nicht gespielt)", () => {
    const result = mapAfStatToPayload(makePlayerEntry({
      games: { minutes: 0, position: "G", captain: false, substitute: true },
      goals: { total: 0, conceded: 0, assists: 0, saves: 0 },
    }));
    expect(result.clean_sheet).toBe(false);
  });

  it("keine player_id in Payload — player_id bleibt undefined", () => {
    const result = mapAfStatToPayload(makePlayerEntry());
    expect(result.player_id).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. makeIngestIdempotencyKey
// ═══════════════════════════════════════════════════════════════════════════

describe("makeIngestIdempotencyKey — hour-bucketed idempotency key", () => {
  it("erzeugt erwartetes Format mit poll-Hour", () => {
    const key = makeIngestIdempotencyKey(12345, 276, "2026-06-15T20");
    expect(key).toBe("fixture:12345:player:276:poll:2026-06-15T20");
  });

  it("enthält kein :v1 mehr", () => {
    const key = makeIngestIdempotencyKey(12345, 276, "2026-06-15T20");
    expect(key).not.toContain(":v1");
  });

  it("gleiche Fixture/Player/gleiche Stunde → gleicher Key (Duplikate werden geblockt)", () => {
    const k1 = makeIngestIdempotencyKey(1001, 500, "2026-06-15T18");
    const k2 = makeIngestIdempotencyKey(1001, 500, "2026-06-15T18");
    expect(k1).toBe(k2);
  });

  it("gleiche Fixture/Player/neue Stunde → anderer Key (neue Stats werden verarbeitet)", () => {
    const k1 = makeIngestIdempotencyKey(1001, 500, "2026-06-15T18");
    const k2 = makeIngestIdempotencyKey(1001, 500, "2026-06-15T19");
    expect(k1).not.toBe(k2);
  });

  it("unterschiedliche fixture-IDs → unterschiedliche Keys", () => {
    expect(makeIngestIdempotencyKey(1, 500, "2026-06-15T18")).not.toBe(makeIngestIdempotencyKey(2, 500, "2026-06-15T18"));
  });

  it("unterschiedliche player-IDs → unterschiedliche Keys", () => {
    expect(makeIngestIdempotencyKey(1001, 1, "2026-06-15T18")).not.toBe(makeIngestIdempotencyKey(1001, 2, "2026-06-15T18"));
  });

  it("default pollHour entspricht aktueller UTC-Stunde", () => {
    const expectedHour = new Date().toISOString().slice(0, 13);
    const key = makeIngestIdempotencyKey(1, 1);
    expect(key).toContain(`poll:${expectedHour}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. isFixtureRelevant
// ═══════════════════════════════════════════════════════════════════════════

describe("isFixtureRelevant — Fixture-Filter für Live-Polling", () => {
  const now = new Date("2026-06-15T18:00:00Z").getTime();

  it("status=live → immer relevant", () => {
    expect(isFixtureRelevant("live", "2026-06-15T17:00:00Z", now)).toBe(true);
  });

  it("status=finished, kickoff vor 2h → relevant (innerhalb 3h-Fenster)", () => {
    const kickoff = new Date("2026-06-15T15:50:00Z").toISOString(); // ~2h 10min her
    expect(isFixtureRelevant("finished", kickoff, now)).toBe(true);
  });

  it("status=finished, kickoff vor 4h → nicht relevant (außerhalb 3h-Fenster)", () => {
    const kickoff = new Date("2026-06-15T14:00:00Z").toISOString();
    expect(isFixtureRelevant("finished", kickoff, now)).toBe(false);
  });

  it("status=scheduled → nicht relevant", () => {
    expect(isFixtureRelevant("scheduled", "2026-06-16T12:00:00Z", now)).toBe(false);
  });

  it("ungültiger kickoff-String → nicht relevant (kein Crash)", () => {
    expect(isFixtureRelevant("finished", "nicht-ein-datum", now)).toBe(false);
  });

  it("custom windowMs wird respektiert", () => {
    const kickoff = new Date("2026-06-15T16:30:00Z").toISOString(); // 1h 30min her
    expect(isFixtureRelevant("finished", kickoff, now, 60 * 60 * 1000)).toBe(false); // 1h Fenster
    expect(isFixtureRelevant("finished", kickoff, now, 2 * 60 * 60 * 1000)).toBe(true); // 2h Fenster
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. afetch — 429 Retry Cap
// ═══════════════════════════════════════════════════════════════════════════

describe("afetch — bounded 429 retry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeResponse(status: number, headers: Record<string, string> = {}, body: any = {}): Response {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k: string) => headers[k] ?? null },
      json: async () => body,
    } as unknown as Response;
  }

  it("gibt JSON zurück bei erfolgreicher Antwort", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(makeResponse(200, {}, { ok: true })));
    const result = await afetch("/fixtures?id=1", "key123");
    expect(result).toEqual({ ok: true });
  });

  it("wirft nach maxRetries=1 bei dauerhaftem 429", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValue(makeResponse(429, { "retry-after": "0" })));
    await expect(afetch("/fixtures?id=1", "key", 1)).rejects.toThrow("rate-limited after 1 retries");
  });

  it("wirft nach Standard maxRetries=3 bei dauerhaftem 429", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValue(makeResponse(429, { "retry-after": "0" })));
    await expect(afetch("/fixtures?id=1", "key")).rejects.toThrow("rate-limited after 3 retries");
    // 4 Calls: attempt 0,1,2,3 — wirft beim letzten
    expect((fetch as any).mock.calls.length).toBe(4);
  });

  it("retry erfolgreich wenn zweiter Call 200 liefert", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(makeResponse(429, { "retry-after": "0" }))
      .mockResolvedValueOnce(makeResponse(200, {}, { data: "ok" })));
    const result = await afetch("/fixtures?id=1", "key");
    expect(result).toEqual({ data: "ok" });
    expect((fetch as any).mock.calls.length).toBe(2);
  });

  it("wirft sofort bei anderen HTTP-Fehlern (nicht 429)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(makeResponse(500)));
    await expect(afetch("/fixtures?id=1", "key")).rejects.toThrow("HTTP 500");
  });

  it("API-Key wird nicht in der Fehlermeldung geloggt", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValue(makeResponse(429, { "retry-after": "0" })));
    await expect(afetch("/fixtures?id=1", "SECRET_KEY", 0)).rejects.toThrow(
      expect.not.stringContaining("SECRET_KEY"),
    );
  });
});
