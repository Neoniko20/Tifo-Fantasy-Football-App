# WM Event Ingest Layer — Implementation Plan (Phase A1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `POST /api/wm/[id]/events` — the single, owner-gated entry point through which all data producers (Admin, Simulator, API-Football) write WM events into the database.

**Architecture:** Thin route handler → `lib/wm-ingest.ts` processing lib → DB writes → audit log. Route validates auth/ownership, lib handles all event-type logic. No producer bypasses this layer.

**Tech Stack:** Next.js 14 App Router, Supabase service_role client (`createServiceRoleClient`), existing `calculateWMGameweekPoints` from `lib/wm-points.ts`, existing WM types from `lib/wm-types.ts`.

**Spec:** `docs/superpowers/specs/2026-05-20-wm-live-tournament-ux-design.md` §A1

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/wm-types.ts` | Modify | Add `WMEventType`, `WMIngestEvent`, `ProcessedBy`, `IngestResult` |
| `lib/wm-ingest.ts` | Create | All event-processing logic, DB writes, audit log |
| `app/api/wm/[id]/events/route.ts` | Create | Thin POST handler — auth + ownership + delegate to lib |

---

## Task 1: DB Migration — `wm_event_log`

**Files:**
- Run SQL in Supabase dashboard (no migration file needed for this project)

- [ ] **Step 1: Run this SQL in Supabase SQL Editor**

```sql
CREATE TABLE IF NOT EXISTS wm_event_log (
  id                  uuid primary key default gen_random_uuid(),
  league_id           text not null,
  tournament_id       text not null,
  gameweek            int,
  event_type          text not null,
  payload             jsonb not null default '{}',
  source              text,
  idempotency_key     text unique,
  status              text not null default 'pending',
  error_message       text,
  processed_by        text,
  related_fixture_id  uuid,
  related_team_id     uuid,
  related_player_id   int,
  processed_at        timestamptz,
  created_at          timestamptz default now()
);

-- Indexes for debug/recovery queries
CREATE INDEX IF NOT EXISTS wm_event_log_league_gw
  ON wm_event_log(league_id, gameweek);
CREATE INDEX IF NOT EXISTS wm_event_log_source
  ON wm_event_log(source);
CREATE INDEX IF NOT EXISTS wm_event_log_status
  ON wm_event_log(status);

-- RLS: service_role only (no user-facing reads in V1)
ALTER TABLE wm_event_log ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Verify table exists**

In Supabase Table Editor confirm `wm_event_log` appears with all columns.

---

## Task 2: Types — extend `lib/wm-types.ts`

**Files:**
- Modify: `lib/wm-types.ts`

- [ ] **Step 1: Add event types at the end of `lib/wm-types.ts`**

```typescript
// ── Ingest Layer Types ─────────────────────────────────────────────────────────

export type WMEventType =
  | "fixture.status_changed"       // scheduled → live → finished
  | "fixture.score_updated"        // home_score, away_score
  | "fixture.penalties_updated"    // penalties_home, penalties_away
  | "player.stat_update"           // goals, assists, minutes, cards, saves, clean_sheet
  | "gameweek.status_changed"      // upcoming → active → finished
  | "nation.eliminated"            // nach einem GW ausgeschieden
  | "gameweek.points_recalculated" // Punkte neu berechnet — triggert Live Center
  | "auto_sub.applied"             // Auto-Sub durchgeführt — triggert Chat
  | "waiver.claim_processed";      // Waiver-Entscheidung — triggert Chat

export interface WMIngestEvent {
  type: WMEventType;
  version?: 1;               // Event-Schema-Version; immer 1 setzen für Zukunftssicherheit
  tournament_id: string;
  gameweek?: number;
  payload: Record<string, unknown>;
  idempotency_key?: string;  // Simulator + API-Football Sync
  source?: "simulator" | "admin" | "api_football";
}

export type ProcessedBy =
  | "ingest_api"
  | "simulator"
  | "recovery_job"
  | "manual_admin"
  | "api_football_sync";

export interface IngestResult {
  ok: boolean;
  event_id?: string;
  applied: string[];
  warnings: string[];
  error?: string;
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/nikoko/my-fantasy-app && node_modules/.bin/tsc --noEmit 2>&1 | tail -5
```

Expected: no output.

---

## Task 3: Processing Library — `lib/wm-ingest.ts`

**Files:**
- Create: `lib/wm-ingest.ts`

- [ ] **Step 1: Create the file**

```typescript
// lib/wm-ingest.ts
// Central event-processing library for the WM Ingest Layer.
// All producers (Admin, Simulator, API-Football) use this.
// No route handler logic here — pure processing.

import { createServiceRoleClient } from "@/lib/supabase-server";
import { calculateWMGameweekPoints } from "@/lib/wm-points";
import type {
  WMIngestEvent, WMEventType, ProcessedBy, IngestResult,
  WMNation, Position,
} from "@/lib/wm-types";
import type { GWStats } from "@/lib/wm-points";

// ── Main entry point ──────────────────────────────────────────────────────────

export async function processIngestEvent(
  leagueId: string,
  event: WMIngestEvent,
  processedBy: ProcessedBy = "ingest_api",
): Promise<IngestResult> {
  const supabase = createServiceRoleClient();
  const applied: string[] = [];
  const warnings: string[] = [];

  // 1. Idempotency check — if same idempotency_key already exists, return early
  if (event.idempotency_key) {
    const { data: existing } = await supabase
      .from("wm_event_log")
      .select("id, status")
      .eq("idempotency_key", event.idempotency_key)
      .maybeSingle();
    if (existing) {
      return { ok: true, event_id: existing.id, applied: [], warnings: ["idempotent:already_processed"] };
    }
  }

  // 2. Write to audit log (status: pending)
  const { data: logEntry, error: logError } = await supabase
    .from("wm_event_log")
    .insert({
      league_id:      leagueId,
      tournament_id:  event.tournament_id,
      gameweek:       event.gameweek ?? null,
      event_type:     event.type,
      payload:        event.payload,
      source:         event.source ?? "admin",
      idempotency_key: event.idempotency_key ?? null,
      status:         "pending",
      processed_by:   processedBy,
    })
    .select("id")
    .single();

  if (logError || !logEntry) {
    return {
      ok: false, applied: [], warnings: [],
      error: "Failed to write event log: " + (logError?.message ?? "unknown"),
    };
  }

  const eventId = logEntry.id as string;

  try {
    // 3. Dispatch to handler
    const result = await dispatchEvent(leagueId, event, supabase);
    applied.push(...result.applied);
    warnings.push(...result.warnings);

    // 4. Mark processed
    await supabase
      .from("wm_event_log")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("id", eventId);

    return { ok: true, event_id: eventId, applied, warnings };

  } catch (e: any) {
    await supabase
      .from("wm_event_log")
      .update({ status: "failed", error_message: e.message })
      .eq("id", eventId);
    return { ok: false, event_id: eventId, applied, warnings, error: e.message };
  }
}

// ── Event dispatcher ──────────────────────────────────────────────────────────

async function dispatchEvent(
  leagueId: string,
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<{ applied: string[]; warnings: string[] }> {
  switch (event.type) {
    case "fixture.score_updated":     return handleScoreUpdated(event, supabase);
    case "fixture.status_changed":    return handleFixtureStatus(event, supabase);
    case "fixture.penalties_updated": return handlePenaltiesUpdated(event, supabase);
    case "player.stat_update":        return handlePlayerStatUpdate(leagueId, event, supabase);
    case "gameweek.status_changed":   return handleGameweekStatus(event, supabase);
    case "nation.eliminated":         return handleNationEliminated(event, supabase);
    // Side-effect-only events (system messages added in Phase B2)
    case "gameweek.points_recalculated":
    case "auto_sub.applied":
    case "waiver.claim_processed":
      return { applied: [`event_logged:${event.type}`], warnings: [] };
    default:
      return { applied: [], warnings: [`unknown_event_type:${(event as any).type}`] };
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleScoreUpdated(
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const { fixture_id, home_score, away_score } = event.payload as {
    fixture_id: string; home_score: number; away_score: number;
  };
  const { error } = await supabase
    .from("wm_fixtures")
    .update({ home_score, away_score })
    .eq("id", fixture_id);
  if (error) throw new Error("fixture score update failed: " + error.message);
  return { applied: ["wm_fixtures.score"], warnings: [] };
}

async function handleFixtureStatus(
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const { fixture_id, status, extra_status } = event.payload as {
    fixture_id: string;
    status: "scheduled" | "live" | "finished";
    extra_status?: string | null;
  };
  const update: Record<string, unknown> = { status };
  if (extra_status !== undefined) update.extra_status = extra_status;
  const { error } = await supabase
    .from("wm_fixtures").update(update).eq("id", fixture_id);
  if (error) throw new Error("fixture status update failed: " + error.message);
  return { applied: ["wm_fixtures.status"], warnings: [] };
}

async function handlePenaltiesUpdated(
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const { fixture_id, penalties_home, penalties_away } = event.payload as {
    fixture_id: string; penalties_home: number; penalties_away: number;
  };
  const { error } = await supabase
    .from("wm_fixtures")
    .update({ penalties_home, penalties_away })
    .eq("id", fixture_id);
  if (error) throw new Error("penalties update failed: " + error.message);
  return { applied: ["wm_fixtures.penalties"], warnings: [] };
}

async function handleGameweekStatus(
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const { gameweek, status } = event.payload as {
    gameweek?: number; status: "upcoming" | "active" | "finished";
  };
  const gw = gameweek ?? event.gameweek;
  if (!gw) throw new Error("gameweek required for gameweek.status_changed");
  const { error } = await supabase
    .from("wm_gameweeks")
    .update({ status })
    .eq("tournament_id", event.tournament_id)
    .eq("gameweek", gw);
  if (error) throw new Error("gameweek status update failed: " + error.message);
  return { applied: ["wm_gameweeks.status"], warnings: [] };
}

async function handleNationEliminated(
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const { nation_id, eliminated_after_gameweek } = event.payload as {
    nation_id: string; eliminated_after_gameweek: number;
  };
  const { error } = await supabase
    .from("wm_nations")
    .update({ eliminated_after_gameweek })
    .eq("id", nation_id);
  if (error) throw new Error("nation elimination failed: " + error.message);
  return { applied: ["wm_nations.eliminated_after_gameweek"], warnings: [] };
}

async function handlePlayerStatUpdate(
  leagueId: string,
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const applied: string[] = [];
  const warnings: string[] = [];

  const p = event.payload as {
    player_id: number;
    goals?: number; assists?: number; minutes?: number;
    shots_on?: number; key_passes?: number; pass_accuracy?: number;
    dribbles?: number; tackles?: number; interceptions?: number;
    saves?: number; yellow_cards?: number; red_cards?: number;
    clean_sheet?: boolean;
  };

  const gw = event.gameweek;
  if (!gw) {
    warnings.push("gameweek missing — player.stat_update skipped");
    return { applied, warnings };
  }

  // Lookup player position
  const { data: player } = await supabase
    .from("players").select("position").eq("id", p.player_id).maybeSingle();

  // Lookup player nation for this tournament
  const { data: playerNationRow } = await supabase
    .from("wm_player_nations")
    .select("wm_nations(*)")
    .eq("player_id", p.player_id)
    .eq("tournament_id", event.tournament_id)
    .maybeSingle();
  const nation = (playerNationRow?.wm_nations as WMNation | null) ?? null;

  // Find all teams in this league that have this player
  const { data: squadEntries } = await supabase
    .from("wm_squad_players")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("player_id", p.player_id);

  if (!squadEntries?.length) {
    warnings.push(`player ${p.player_id} not in any squad in league ${leagueId}`);
    return { applied, warnings };
  }

  // Load league scoring rules (once)
  const { data: settings } = await supabase
    .from("wm_league_settings").select("scoring_rules").eq("league_id", leagueId).maybeSingle();

  const stats: GWStats = {
    position: ((player?.position as Position) ?? "MF"),
    goals:          p.goals ?? 0,
    assists:        p.assists ?? 0,
    minutes:        p.minutes ?? 0,
    shots_on:       p.shots_on ?? 0,
    key_passes:     p.key_passes ?? 0,
    pass_accuracy:  p.pass_accuracy ?? 0,
    dribbles:       p.dribbles ?? 0,
    tackles:        p.tackles ?? 0,
    interceptions:  p.interceptions ?? 0,
    saves:          p.saves ?? 0,
    yellow_cards:   p.yellow_cards ?? 0,
    red_cards:      p.red_cards ?? 0,
    clean_sheet:    p.clean_sheet ?? false,
  };

  for (const entry of squadEntries) {
    // Check if player is captain this GW for this team
    const { data: lineup } = await supabase
      .from("team_lineups")
      .select("captain_id")
      .eq("team_id", entry.team_id)
      .eq("gameweek", gw)
      .maybeSingle();
    const isCaptain = lineup?.captain_id === p.player_id;

    const result = calculateWMGameweekPoints(stats, nation, gw, isCaptain, settings?.scoring_rules);

    const { error } = await supabase
      .from("wm_gameweek_points")
      .upsert({
        team_id:      entry.team_id,
        player_id:    p.player_id,
        gameweek:     gw,
        league_id:    leagueId,
        points:       result.points,
        goals:        p.goals ?? 0,
        assists:      p.assists ?? 0,
        minutes:      p.minutes ?? 0,
        shots_on:     p.shots_on ?? 0,
        key_passes:   p.key_passes ?? 0,
        tackles:      p.tackles ?? 0,
        saves:        p.saves ?? 0,
        yellow_cards: p.yellow_cards ?? 0,
        red_cards:    p.red_cards ?? 0,
        clean_sheet:  p.clean_sheet ?? false,
        nation_active: result.nation_active,
        is_captain:   isCaptain,
      }, { onConflict: "team_id,player_id,gameweek" });

    if (error) {
      warnings.push(`upsert failed for team ${entry.team_id}: ${error.message}`);
    } else {
      applied.push(`wm_gameweek_points:${entry.team_id}:${p.player_id}`);
    }
  }

  return { applied, warnings };
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/nikoko/my-fantasy-app && node_modules/.bin/tsc --noEmit 2>&1 | tail -10
```

Expected: no output. If you see errors about `wm_player_nations` or `wm_squad_players` having no `.eq("league_id")`, adjust the query — check the actual table schema in Supabase.

---

## Task 4: Route Handler — `app/api/wm/[id]/events/route.ts`

**Files:**
- Create: `app/api/wm/[id]/events/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// app/api/wm/[id]/events/route.ts
// Thin POST handler. All logic lives in lib/wm-ingest.ts.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { processIngestEvent } from "@/lib/wm-ingest";
import type { WMIngestEvent } from "@/lib/wm-types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: { user } } = await anonClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });

  // ── Ownership ─────────────────────────────────────────────────────────────
  const supabase = createServiceRoleClient();
  const { data: league, error: leagueError } = await supabase
    .from("leagues").select("owner_id").eq("id", leagueId).single();
  if (leagueError || !league)
    return NextResponse.json({ error: "Liga nicht gefunden" }, { status: 404 });
  if (league.owner_id !== user.id)
    return NextResponse.json({ error: "Kein Zugriff — nur Liga-Owner" }, { status: 403 });

  // ── Parse body ────────────────────────────────────────────────────────────
  let event: WMIngestEvent;
  try {
    event = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger Request-Body (kein JSON)" }, { status: 400 });
  }

  if (!event?.type || !event?.tournament_id) {
    return NextResponse.json(
      { error: "Pflichtfelder fehlen: type, tournament_id" },
      { status: 400 },
    );
  }

  // ── Process ───────────────────────────────────────────────────────────────
  const result = await processIngestEvent(leagueId, event, "ingest_api");

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json(result);
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/nikoko/my-fantasy-app && node_modules/.bin/tsc --noEmit 2>&1 | tail -10
```

Expected: no output.

- [ ] **Step 3: Smoke test — fixture score update**

In terminal, replace `<LEAGUE_ID>`, `<TOURNAMENT_ID>`, `<FIXTURE_ID>`, `<TOKEN>` with real values from your local dev:

```bash
curl -X POST http://localhost:3000/api/wm/<LEAGUE_ID>/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "type": "fixture.score_updated",
    "version": 1,
    "tournament_id": "<TOURNAMENT_ID>",
    "gameweek": 1,
    "source": "admin",
    "payload": {
      "fixture_id": "<FIXTURE_ID>",
      "home_score": 2,
      "away_score": 1
    }
  }'
```

Expected response:
```json
{ "ok": true, "event_id": "...", "applied": ["wm_fixtures.score"], "warnings": [] }
```

Verify in Supabase: `wm_fixtures` row has updated score, `wm_event_log` has `status: "processed"`.

- [ ] **Step 4: Commit**

```bash
cd /Users/nikoko/my-fantasy-app && git add \
  lib/wm-types.ts \
  lib/wm-ingest.ts \
  "app/api/wm/[id]/events/route.ts" \
  && git commit -m "feat(wm-ingest): Event Ingest Layer — POST /api/wm/[id]/events

- WMIngestEvent, WMEventType, ProcessedBy types in wm-types.ts
- lib/wm-ingest.ts: processIngestEvent + 6 event handlers
- wm_event_log audit trail with idempotency
- Player stat update calculates points via calculateWMGameweekPoints

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
