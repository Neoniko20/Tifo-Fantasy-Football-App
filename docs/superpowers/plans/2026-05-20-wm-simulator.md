# WM Tournament Simulator — Implementation Plan (Phase A2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Internal dev/demo tool that generates realistic WM tournament data by producing `WMIngestEvent` objects and sending them through the existing Ingest Layer — no parallel data path.

**Architecture:** `lib/wm-simulator.ts` (pure logic, seeded PRNG, no DB calls) → `POST /api/wm/[id]/simulate` (orchestrator, calls processIngestEvent for each event) → new "Simulator" tab in admin page.

**Tech Stack:** `lib/wm-ingest.ts` (Phase A1), `lib/wm-types.ts`, Next.js 14, existing admin page pattern.

**Prerequisite:** Phase A1 (Ingest Layer) must be complete and committed.

**Spec:** `docs/superpowers/specs/2026-05-20-wm-live-tournament-ux-design.md` §A2

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/wm-simulator.ts` | Create | Seeded PRNG, score generation, event building — pure, no DB |
| `app/api/wm/[id]/simulate/route.ts` | Create | Orchestrator: loads fixtures/players, calls simulator lib, sends events |
| `app/wm/[id]/admin/page.tsx` | Modify | New "Simulator" tab with dry-run + execute UI |

---

## Task 1: Simulator Library — `lib/wm-simulator.ts`

**Files:**
- Create: `lib/wm-simulator.ts`

- [ ] **Step 1: Create the file**

```typescript
// lib/wm-simulator.ts
// Pure simulation logic — no Supabase calls, no side effects.
// All randomness goes through the seeded RNG for reproducibility.

import type { WMIngestEvent, WMPhase } from "@/lib/wm-types";

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────

export type SimRng = () => number;

export function createRng(seed?: number): SimRng {
  if (seed === undefined) return Math.random;
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Weighted random ───────────────────────────────────────────────────────────

function weightedPick<T>(rng: SimRng, items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ── Score generation ──────────────────────────────────────────────────────────

export interface SimScore {
  home: number;
  away: number;
  penalties_home?: number;
  penalties_away?: number;
}

export function generateScore(phase: WMPhase, rng: SimRng): SimScore {
  // WM-realistic goal distribution
  const homeGoals = weightedPick(rng, [0, 1, 2, 3, 4], [0.28, 0.34, 0.24, 0.10, 0.04]);
  const awayGoals = weightedPick(rng, [0, 1, 2, 3, 4], [0.28, 0.34, 0.24, 0.10, 0.04]);

  const isKO = phase !== "group";
  if (isKO && homeGoals === awayGoals) {
    // KO: must have a winner — generate penalties
    const penHome = Math.floor(rng() * 6); // 0–5
    // penAway must differ from penHome (simple: offset by 1-3)
    const penAway = (penHome + 1 + Math.floor(rng() * 3)) % 6;
    return { home: homeGoals, away: awayGoals, penalties_home: penHome, penalties_away: penAway };
  }

  return { home: homeGoals, away: awayGoals };
}

// ── Player stats generation ───────────────────────────────────────────────────

export interface PlayerStatsSim {
  player_id: number;
  goals: number;
  assists: number;
  minutes: number;
  shots_on: number;
  key_passes: number;
  pass_accuracy: number;
  dribbles: number;
  tackles: number;
  interceptions: number;
  saves: number;
  yellow_cards: number;
  red_cards: number;
  clean_sheet: boolean;
}

export function generatePlayerStats(
  playerIds: number[],
  score: SimScore,
  rng: SimRng,
): PlayerStatsSim[] {
  if (playerIds.length === 0) return [];

  const totalGoals = score.home + score.away;
  const stats: PlayerStatsSim[] = playerIds.map((id) => ({
    player_id: id,
    goals: 0,
    assists: 0,
    minutes: weightedPick(rng, [0, 45, 60, 75, 90], [0.05, 0.10, 0.10, 0.15, 0.60]),
    shots_on: 0,
    key_passes: Math.floor(rng() * 3),
    pass_accuracy: 60 + Math.floor(rng() * 35),
    dribbles: Math.floor(rng() * 3),
    tackles: Math.floor(rng() * 3),
    interceptions: Math.floor(rng() * 2),
    saves: 0,
    yellow_cards: rng() < 0.08 ? 1 : 0,
    red_cards: rng() < 0.01 ? 1 : 0,
    clean_sheet: score.home === 0 || score.away === 0,
  }));

  // Distribute goals and assists among players who played ≥45 min
  const eligible = stats.filter((s) => s.minutes >= 45);
  if (eligible.length === 0) return stats;

  for (let g = 0; g < totalGoals; g++) {
    const scorer = eligible[Math.floor(rng() * eligible.length)];
    scorer.goals += 1;
    scorer.shots_on += 1 + Math.floor(rng() * 2);
    // ~70% chance of an assist
    if (rng() < 0.70) {
      const assisters = eligible.filter((s) => s !== scorer);
      if (assisters.length > 0) {
        assisters[Math.floor(rng() * assisters.length)].assists += 1;
      }
    }
  }

  return stats;
}

// ── Event builders ────────────────────────────────────────────────────────────

export interface SimFixture {
  id: string;
  home_nation_id: string;
  away_nation_id: string;
  gameweek: number;
  stage: WMPhase;
}

export function buildFixtureEvents(
  fixture: SimFixture,
  score: SimScore,
  playerStats: PlayerStatsSim[],
  tournamentId: string,
  idempotencyPrefix: string,
): WMIngestEvent[] {
  const events: WMIngestEvent[] = [];
  const key = (suffix: string) => `${idempotencyPrefix}:${fixture.id}:${suffix}`;

  // 1. Fixture live
  events.push({
    type: "fixture.status_changed",
    version: 1,
    tournament_id: tournamentId,
    gameweek: fixture.gameweek,
    source: "simulator",
    idempotency_key: key("status:live"),
    payload: { fixture_id: fixture.id, status: "live" },
  });

  // 2. Score update
  events.push({
    type: "fixture.score_updated",
    version: 1,
    tournament_id: tournamentId,
    gameweek: fixture.gameweek,
    source: "simulator",
    idempotency_key: key("score"),
    payload: { fixture_id: fixture.id, home_score: score.home, away_score: score.away },
  });

  // 3. Penalties (if any)
  if (score.penalties_home !== undefined) {
    events.push({
      type: "fixture.penalties_updated",
      version: 1,
      tournament_id: tournamentId,
      gameweek: fixture.gameweek,
      source: "simulator",
      idempotency_key: key("penalties"),
      payload: {
        fixture_id: fixture.id,
        penalties_home: score.penalties_home,
        penalties_away: score.penalties_away,
      },
    });
  }

  // 4. Player stats
  for (const ps of playerStats) {
    events.push({
      type: "player.stat_update",
      version: 1,
      tournament_id: tournamentId,
      gameweek: fixture.gameweek,
      source: "simulator",
      idempotency_key: key(`player:${ps.player_id}`),
      payload: { ...ps },
    });
  }

  // 5. Fixture finished
  events.push({
    type: "fixture.status_changed",
    version: 1,
    tournament_id: tournamentId,
    gameweek: fixture.gameweek,
    source: "simulator",
    idempotency_key: key("status:finished"),
    payload: { fixture_id: fixture.id, status: "finished" },
  });

  return events;
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/nikoko/my-fantasy-app && node_modules/.bin/tsc --noEmit 2>&1 | tail -5
```

Expected: no output.

---

## Task 2: Simulate Route — `app/api/wm/[id]/simulate/route.ts`

**Files:**
- Create: `app/api/wm/[id]/simulate/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// app/api/wm/[id]/simulate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { processIngestEvent } from "@/lib/wm-ingest";
import {
  createRng, generateScore, generatePlayerStats, buildFixtureEvents,
  type SimFixture,
} from "@/lib/wm-simulator";
import type { WMIngestEvent } from "@/lib/wm-types";

interface SimulateRequest {
  scope: "fixture" | "gameweek" | "tournament" | "reset";
  fixture_id?: string;
  gameweek?: number;
  seed?: number;
  dry_run?: boolean;
  force?: boolean;
  reset_scope?: "simulated_only" | "gameweek" | "tournament";
  typed_confirmation?: string; // required for reset_scope: "tournament"
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;

  // ── Auth + Ownership ──────────────────────────────────────────────────────
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: { user } } = await anonClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });

  const supabase = createServiceRoleClient();
  const { data: league } = await supabase
    .from("leagues").select("owner_id").eq("id", leagueId).single();
  if (!league) return NextResponse.json({ error: "Liga nicht gefunden" }, { status: 404 });
  if (league.owner_id !== user.id)
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: SimulateRequest;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Ungültiger Request-Body" }, { status: 400 }); }

  // ── Reset scope ───────────────────────────────────────────────────────────
  if (body.scope === "reset") {
    return handleReset(body, leagueId, supabase);
  }

  // ── Load WM settings ──────────────────────────────────────────────────────
  const { data: wmSettings } = await supabase
    .from("wm_league_settings").select("tournament_id").eq("league_id", leagueId).maybeSingle();
  if (!wmSettings?.tournament_id)
    return NextResponse.json({ error: "Kein WM-Turnier für diese Liga" }, { status: 400 });
  const tournamentId = wmSettings.tournament_id;

  // ── Load fixtures ─────────────────────────────────────────────────────────
  let fixtureQuery = supabase
    .from("wm_fixtures")
    .select("id, gameweek, stage, home_nation_id, away_nation_id, status")
    .eq("tournament_id", tournamentId);

  if (body.scope === "fixture" && body.fixture_id) {
    fixtureQuery = fixtureQuery.eq("id", body.fixture_id);
  } else if (body.scope === "gameweek" && body.gameweek) {
    fixtureQuery = fixtureQuery.eq("gameweek", body.gameweek);
  }
  // scope: "tournament" → all fixtures

  const { data: fixtures } = await fixtureQuery;
  if (!fixtures?.length)
    return NextResponse.json({ ok: true, message: "Keine Fixtures gefunden", events_preview: [] });

  // ── Source protection (skip fixtures with admin/api_football events) ──────
  const affectedFixtureIds = fixtures.map((f: any) => f.id);
  let protectedFixtures: string[] = [];

  if (!body.force) {
    const { data: protectedLogs } = await supabase
      .from("wm_event_log")
      .select("related_fixture_id")
      .in("related_fixture_id", affectedFixtureIds)
      .in("source", ["admin", "api_football"]);
    protectedFixtures = [...new Set((protectedLogs || []).map((l: any) => l.related_fixture_id))];
  }

  const rng = createRng(body.seed);
  const idempotencyRun = `sim-${Date.now()}-${body.seed ?? "rnd"}`;

  // ── Build all events ──────────────────────────────────────────────────────
  const allEvents: WMIngestEvent[] = [];
  const skippedFixtures: string[] = [];
  const warnings: string[] = [];

  for (const fixture of fixtures as SimFixture[]) {
    if (protectedFixtures.includes(fixture.id)) {
      skippedFixtures.push(fixture.id);
      warnings.push(`fixture ${fixture.id} has admin/api_football events — skipped (use force:true to override)`);
      continue;
    }

    const score = generateScore(fixture.stage as any, rng);

    // Load players in this league who are from home/away nations
    const { data: squadPlayers } = await supabase
      .from("wm_squad_players")
      .select("player_id")
      .eq("league_id", leagueId);
    const allPlayerIds = (squadPlayers || []).map((p: any) => p.player_id as number);

    // Get players from home/away nation
    const { data: nationPlayers } = await supabase
      .from("wm_player_nations")
      .select("player_id")
      .eq("tournament_id", tournamentId)
      .in("nation_id", [fixture.home_nation_id, fixture.away_nation_id])
      .in("player_id", allPlayerIds.length > 0 ? allPlayerIds : [-1]);

    const playerIds = (nationPlayers || []).map((p: any) => p.player_id as number);
    const stats = generatePlayerStats(playerIds, score, rng);

    const events = buildFixtureEvents(fixture, score, stats, tournamentId, idempotencyRun);
    allEvents.push(...events);
  }

  // ── Dry run: return preview without writing ────────────────────────────────
  if (body.dry_run) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      events_preview: allEvents,
      affected_fixtures: affectedFixtureIds.filter((id: string) => !skippedFixtures.includes(id)),
      skipped_fixtures: skippedFixtures,
      warnings,
    });
  }

  // ── Execute: send each event through the Ingest Layer ─────────────────────
  const results: Array<{ event_type: string; ok: boolean; error?: string }> = [];

  for (const event of allEvents) {
    const result = await processIngestEvent(leagueId, event, "simulator");
    results.push({ event_type: event.type, ok: result.ok, error: result.error });
    if (!result.ok) warnings.push(`event ${event.type} failed: ${result.error}`);
  }

  return NextResponse.json({
    ok: true,
    executed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    skipped_fixtures: skippedFixtures,
    warnings,
  });
}

// ── Reset handler ─────────────────────────────────────────────────────────────

async function handleReset(
  body: SimulateRequest,
  leagueId: string,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const resetScope = body.reset_scope ?? "simulated_only";

  // Tournament reset requires typed confirmation
  if (resetScope === "tournament") {
    if (body.typed_confirmation !== "RESET") {
      return NextResponse.json(
        { error: 'typed_confirmation "RESET" ist Pflicht für reset_scope: "tournament"' },
        { status: 400 },
      );
    }
    // Also check tournament is not locked (status: finished)
    const { data: settings } = await supabase
      .from("wm_league_settings").select("tournament_id").eq("league_id", leagueId).maybeSingle();
    if (settings?.tournament_id) {
      const { data: tournament } = await supabase
        .from("wm_tournaments").select("status").eq("id", settings.tournament_id).maybeSingle();
      if (tournament?.status === "finished") {
        return NextResponse.json(
          { error: "Turnier ist abgeschlossen — Reset nicht möglich" },
          { status: 409 },
        );
      }
    }
  }

  // Delete simulated event log entries
  let deleteQuery = supabase.from("wm_event_log").delete().eq("league_id", leagueId);
  if (resetScope === "simulated_only") {
    deleteQuery = deleteQuery.eq("source", "simulator");
  } else if (resetScope === "gameweek" && body.gameweek) {
    deleteQuery = deleteQuery.eq("gameweek", body.gameweek);
  }
  // tournament: delete all (no source filter)

  const { error } = await deleteQuery;
  if (error) return NextResponse.json({ error: "Reset fehlgeschlagen: " + error.message }, { status: 500 });

  return NextResponse.json({ ok: true, reset_scope: resetScope });
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/nikoko/my-fantasy-app && node_modules/.bin/tsc --noEmit 2>&1 | tail -5
```

Expected: no output.

---

## Task 3: Admin UI — Simulator Tab

**Files:**
- Modify: `app/wm/[id]/admin/page.tsx`

- [ ] **Step 1: Add "simulator" to AdminTab type and TABS array**

Find this line (around line 29):
```typescript
type AdminTab = "general" | "points" | "waiver" | "autosubs" | "recovery" | "nations" | "fixtures" | "debug";
```

Replace with:
```typescript
type AdminTab = "general" | "points" | "waiver" | "autosubs" | "recovery" | "nations" | "fixtures" | "simulator" | "debug";
```

Find the TABS array and add simulator before "debug":
```typescript
  { id: "simulator", label: "Simulator"     },
  { id: "debug",    label: "Debug"          },
```

- [ ] **Step 2: Add simulator state variables**

After `const [loadingDebug, setLoadingDebug] = useState(false);`, add:

```typescript
  const [simScope, setSimScope]                   = useState<"fixture" | "gameweek" | "tournament">("gameweek");
  const [simFixtureId, setSimFixtureId]           = useState("");
  const [simSeed, setSimSeed]                     = useState("");
  const [simDryRun, setSimDryRun]                 = useState(true);
  const [simRunning, setSimRunning]               = useState(false);
  const [simResult, setSimResult]                 = useState<any>(null);
  const [resetScope, setResetScope]               = useState<"simulated_only" | "gameweek" | "tournament">("simulated_only");
  const [resetTypedConfirm, setResetTypedConfirm] = useState("");
  const [resetting, setResetting]                 = useState(false);
```

- [ ] **Step 3: Add simulator handler functions**

Add after `loadDebugPoints`:

```typescript
  // ── Simulator ─────────────────────────────────────────────────────────────
  async function runSimulator() {
    if (simRunning) return;
    setSimRunning(true);
    setSimResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const body: Record<string, unknown> = {
        scope: simScope,
        dry_run: simDryRun,
        gameweek: selectedGW,
      };
      if (simScope === "fixture" && simFixtureId) body.fixture_id = simFixtureId;
      if (simSeed) body.seed = parseInt(simSeed, 10);

      const res = await fetch(`/api/wm/${leagueId}/simulate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setSimResult(data);
      if (data.ok && !simDryRun) {
        toast(`Simulator: ${data.executed ?? 0} Events ausgeführt`, "success");
      }
    } catch (e: any) { toast("Fehler: " + e.message, "error"); }
    setSimRunning(false);
  }

  async function runSimReset() {
    if (resetting) return;
    if (resetScope === "tournament") {
      if (resetTypedConfirm !== "RESET") {
        toast('Bitte "RESET" eintippen zum Bestätigen', "error");
        return;
      }
      if (!window.confirm("LETZTES WARNING: Alle simulierten Turnierdaten werden gelöscht. Fortfahren?")) return;
    } else {
      if (!window.confirm(`Simulation zurücksetzen (${resetScope})?`)) return;
    }
    setResetting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/wm/${leagueId}/simulate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          scope: "reset",
          reset_scope: resetScope,
          gameweek: selectedGW,
          typed_confirmation: resetTypedConfirm || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) toast(`Reset (${resetScope}) erfolgreich`, "success");
      else toast("Reset fehlgeschlagen: " + (data.error || "Unbekannt"), "error");
    } catch (e: any) { toast("Fehler: " + e.message, "error"); }
    setResetting(false);
    setResetTypedConfirm("");
  }
```

- [ ] **Step 4: Add Simulator tab render block**

Find the debug tab opening comment (`{/* ════════ TAB: DEBUG`) and insert before it:

```tsx
      {/* ════════════════════════════════
          TAB: SIMULATOR
      ════════════════════════════════ */}
      {tab === "simulator" && (
        <div className="w-full max-w-xl space-y-3">
          {GWSelector}

          {/* Scope + Seed */}
          <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Simulation konfigurieren</p>
            </div>
            <div className="px-4 py-4 space-y-3">
              {/* Scope */}
              <div>
                <p className="text-[8px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--color-muted)" }}>Scope</p>
                <div className="flex gap-1.5">
                  {(["fixture", "gameweek", "tournament"] as const).map(s => (
                    <button key={s} onClick={() => setSimScope(s)}
                      className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest"
                      style={{
                        background: simScope === s ? "var(--color-primary)" : "var(--bg-page)",
                        color: simScope === s ? "var(--bg-page)" : "var(--color-muted)",
                        border: "1px solid var(--color-border)",
                      }}>
                      {s === "fixture" ? "Fixture" : s === "gameweek" ? `GW${selectedGW}` : "Turnier"}
                    </button>
                  ))}
                </div>
              </div>
              {/* Fixture ID (only for scope:fixture) */}
              {simScope === "fixture" && (
                <div>
                  <p className="text-[8px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--color-muted)" }}>Fixture ID</p>
                  <input value={simFixtureId} onChange={e => setSimFixtureId(e.target.value)}
                    placeholder="uuid..."
                    className="w-full px-3 py-2 rounded-lg text-xs focus:outline-none"
                    style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
                </div>
              )}
              {/* Seed */}
              <div>
                <p className="text-[8px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--color-muted)" }}>Seed (optional — für reproduzierbare Läufe)</p>
                <input value={simSeed} onChange={e => setSimSeed(e.target.value)}
                  placeholder="z.B. 42"
                  className="w-full px-3 py-2 rounded-lg text-xs focus:outline-none"
                  style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
              </div>
              {/* Dry-run toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={simDryRun} onChange={e => setSimDryRun(e.target.checked)} />
                <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                  Dry-Run (Vorschau — kein DB-Write)
                </span>
              </label>
              {/* Run button */}
              <button onClick={runSimulator} disabled={simRunning}
                className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                style={{
                  background: simDryRun
                    ? "color-mix(in srgb, var(--color-info) 15%, var(--bg-page))"
                    : "color-mix(in srgb, var(--color-primary) 15%, var(--bg-page))",
                  color: simDryRun ? "var(--color-info)" : "var(--color-primary)",
                  border: `1px solid ${simDryRun ? "color-mix(in srgb, var(--color-info) 40%, transparent)" : "color-mix(in srgb, var(--color-primary) 40%, transparent)"}`,
                }}>
                {simRunning ? "Läuft..." : simDryRun ? "Dry-Run ▶" : "Simulieren ▶"}
              </button>
            </div>
          </div>

          {/* Result */}
          {simResult && (
            <div className="rounded-xl p-4 text-[8px] font-mono" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}>
              <pre className="overflow-x-auto">{JSON.stringify(simResult, null, 2)}</pre>
            </div>
          )}

          {/* Reset */}
          <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid color-mix(in srgb, var(--color-error) 30%, var(--color-border))" }}>
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Simulation zurücksetzen</p>
            </div>
            <div className="px-4 py-4 space-y-3">
              <div className="flex gap-1.5">
                {(["simulated_only", "gameweek", "tournament"] as const).map(s => (
                  <button key={s} onClick={() => setResetScope(s)}
                    className="px-2.5 py-1.5 rounded-lg text-[7px] font-black uppercase tracking-widest"
                    style={{
                      background: resetScope === s ? "color-mix(in srgb, var(--color-error) 20%, var(--bg-page))" : "var(--bg-page)",
                      color: resetScope === s ? "var(--color-error)" : "var(--color-muted)",
                      border: "1px solid var(--color-border)",
                    }}>
                    {s === "simulated_only" ? "Nur Sim" : s === "gameweek" ? `GW${selectedGW}` : "Turnier"}
                  </button>
                ))}
              </div>
              {resetScope === "tournament" && (
                <div>
                  <p className="text-[8px] mb-1.5" style={{ color: "var(--color-error)" }}>⚠ Bitte "RESET" eintippen:</p>
                  <input value={resetTypedConfirm} onChange={e => setResetTypedConfirm(e.target.value)}
                    placeholder="RESET"
                    className="w-full px-3 py-2 rounded-lg text-xs focus:outline-none"
                    style={{ background: "var(--bg-page)", border: "1px solid var(--color-error)", color: "var(--color-error)" }} />
                </div>
              )}
              <button onClick={runSimReset} disabled={resetting || (resetScope === "tournament" && resetTypedConfirm !== "RESET")}
                className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                style={{ background: "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))", color: "var(--color-error)", border: "1px solid color-mix(in srgb, var(--color-error) 40%, transparent)" }}>
                {resetting ? "Zurücksetzen..." : "Reset ▶"}
              </button>
            </div>
          </div>

        </div>
      )}
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd /Users/nikoko/my-fantasy-app && node_modules/.bin/tsc --noEmit 2>&1 | tail -5
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd /Users/nikoko/my-fantasy-app && git add \
  lib/wm-simulator.ts \
  "app/api/wm/[id]/simulate/route.ts" \
  "app/wm/[id]/admin/page.tsx" \
  && git commit -m "feat(wm-simulator): Tournament Simulator — dry-run, seed, source-protection

- lib/wm-simulator.ts: seeded PRNG, WM score distribution, player stats
- POST /api/wm/[id]/simulate: fixture/gameweek/tournament scope + reset
- Admin Simulator tab with dry-run toggle and RESET typed confirmation

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
