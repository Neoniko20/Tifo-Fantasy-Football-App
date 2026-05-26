# WM Matchday Live Experience Polish — Implementation Plan (Phase C1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish `/wm/[id]/matchday` into a broadcast-style fixture view. Build `MatchCard` as a Tier-1 reusable component (memoized, lightweight, realtime-safe). Add `extra_status` to `wm_fixtures`. Wire Realtime score updates to the matchday page.

**Architecture:** New `MatchCard` component in `app/components/wm/` replaces inline fixture rows in `matchday/page.tsx`. `extra_status` DB column added. Existing `StatusDot` upgraded to pulse animation. Approximate elapsed time computed client-side.

**Tech Stack:** Next.js 14, Supabase Realtime, CSS keyframes, existing `wm-types.ts`.

**Prerequisite:** Phase A1 (Ingest Layer) must be complete — `extra_status` is set via `fixture.status_changed` events.

**Spec:** `docs/superpowers/specs/2026-05-20-wm-live-tournament-ux-design.md` §C1

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| DB migration | Run SQL | Add `extra_status` column to `wm_fixtures` |
| `lib/wm-types.ts` | Modify | Add `extra_status` to `WMFixture` type |
| `app/components/wm/MatchCard.tsx` | Create | **Tier-1** fixture card — memoized, realtime-safe |
| `app/wm/[id]/matchday/page.tsx` | Modify | Use `MatchCard`, add Realtime subscription |

---

## Task 1: DB Migration — `extra_status` column

- [ ] **Step 1: Run SQL in Supabase SQL Editor**

```sql
ALTER TABLE wm_fixtures
ADD COLUMN IF NOT EXISTS extra_status text;

-- Allowed values (enforced in application, not DB constraint):
-- null | 'half_time' | 'extra_time' | 'penalties' | 'delayed' | 'interrupted'
-- 'delayed' and 'interrupted' are prepared for API-Football but unused in V1 Simulator.

COMMENT ON COLUMN wm_fixtures.extra_status IS
  'Sub-status within live/finished. Values: half_time | extra_time | penalties | delayed | interrupted';
```

- [ ] **Step 2: Verify column exists**

In Supabase Table Editor → `wm_fixtures` → confirm `extra_status` column (type: text, nullable).

---

## Task 2: Update `WMFixture` type in `lib/wm-types.ts`

**Files:**
- Modify: `lib/wm-types.ts`

- [ ] **Step 1: Add `extra_status` to `WMFixture` interface**

Find:
```typescript
export interface WMFixture {
  ...
  api_fixture_id?: number | null;
  created_at?: string;
```

Add `extra_status` before `api_fixture_id`:
```typescript
  extra_status?: string | null;  // half_time | extra_time | penalties | delayed | interrupted
  api_fixture_id?: number | null;
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/nikoko/my-fantasy-app && node_modules/.bin/tsc --noEmit 2>&1 | tail -5
```

Expected: no output.

---

## Task 3: Tier-1 Component — `MatchCard`

**Files:**
- Create: `app/components/wm/MatchCard.tsx`

**Tier-1 requirements:** `React.memo`, props-only (no internal Supabase calls), CSS transitions, responsive across all contexts (Matchday list / Live Center strip / Bracket node).

- [ ] **Step 1: Create the file**

```tsx
"use client";
// MatchCard — Tier-1 WM fixture component.
// Used in: Matchday, Live Center FixtureStrip, KO-Bracket nodes.
// RULES: React.memo, no internal data fetching, CSS transitions only, no layout thrashing.

import React, { memo, useEffect, useState } from "react";
import type { WMFixture } from "@/lib/wm-types";

interface Props {
  fixture: WMFixture;
  homeNationName?: string;
  awayNationName?: string;
  homeNationFlag?: string | null;
  awayNationFlag?: string | null;
  /** Compact layout for FixtureStrip / Bracket nodes */
  compact?: boolean;
}

type DisplayStatus =
  | "scheduled" | "live" | "half_time" | "extra_time"
  | "penalties" | "finished" | "delayed" | "interrupted";

function getDisplayStatus(f: WMFixture): DisplayStatus {
  if (f.status === "finished") return "finished";
  if (f.status === "live") {
    if (f.extra_status === "half_time")   return "half_time";
    if (f.extra_status === "extra_time")  return "extra_time";
    if (f.extra_status === "penalties")   return "penalties";
    if (f.extra_status === "delayed")     return "delayed";
    if (f.extra_status === "interrupted") return "interrupted";
    return "live";
  }
  return "scheduled";
}

function getApproximateMinute(kickoff: string, extraStatus: string | null | undefined): string {
  // Client-side approximation only — no server sync, no drift correction (V1).
  const elapsed = (Date.now() - new Date(kickoff).getTime()) / 60000;
  if (extraStatus === "extra_time") return `${Math.min(120, Math.round(elapsed))}'`;
  return `${Math.min(90, Math.round(elapsed))}'`;
}

const STATUS_LABEL: Record<DisplayStatus, string> = {
  scheduled:   "Geplant",
  live:        "Live",
  half_time:   "Halbzeit",
  extra_time:  "n.V.",
  penalties:   "Elfm.",
  finished:    "Abpfiff",
  delayed:     "Verzögert",
  interrupted: "Unterbrochen",
};

const STATUS_COLOR: Record<DisplayStatus, string> = {
  scheduled:   "var(--color-muted)",
  live:        "var(--color-primary)",
  half_time:   "var(--color-warning, #f59e0b)",
  extra_time:  "var(--color-primary)",
  penalties:   "var(--color-primary)",
  finished:    "var(--color-success)",
  delayed:     "var(--color-warning, #f59e0b)",
  interrupted: "var(--color-error)",
};

export const MatchCard = memo(function MatchCard({
  fixture, homeNationName, awayNationName, homeNationFlag, awayNationFlag, compact,
}: Props) {
  const ds = getDisplayStatus(fixture);
  const isLive = ds === "live" || ds === "extra_time" || ds === "penalties";
  const statusColor = STATUS_COLOR[ds];

  // Elapsed minute — updates every 60s when live
  const [minute, setMinute] = useState(() =>
    isLive ? getApproximateMinute(fixture.kickoff, fixture.extra_status) : ""
  );
  useEffect(() => {
    if (!isLive) { setMinute(""); return; }
    setMinute(getApproximateMinute(fixture.kickoff, fixture.extra_status));
    const interval = setInterval(() => {
      setMinute(getApproximateMinute(fixture.kickoff, fixture.extra_status));
    }, 60_000);
    return () => clearInterval(interval);
  }, [isLive, fixture.kickoff, fixture.extra_status]);

  // Penalties display: "3–2 n.E."
  const penaltiesDisplay =
    fixture.penalties_home != null && fixture.penalties_away != null
      ? `(${fixture.penalties_home}–${fixture.penalties_away} n.E.)`
      : null;

  const kickoffTime = new Date(fixture.kickoff).toLocaleTimeString("de-DE", {
    hour: "2-digit", minute: "2-digit",
  });
  const kickoffDate = new Date(fixture.kickoff).toLocaleDateString("de-DE", {
    weekday: "short", day: "2-digit", month: "2-digit",
  });

  if (compact) {
    // Compact variant: used in FixtureStrip and Bracket nodes
    return (
      <div className="flex items-center gap-2 px-3 py-2"
        style={{ background: "var(--bg-card)", borderRadius: 8 }}>
        {/* Live dot */}
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isLive ? "animate-pulse" : ""}`}
          style={{ background: statusColor }} />
        {/* Home */}
        <div className="flex items-center gap-1 flex-1 justify-end">
          {homeNationFlag && <img src={homeNationFlag} alt="" className="w-4 h-3 object-cover rounded-sm" />}
          <span className="text-[10px] font-black truncate" style={{ color: "var(--color-text)" }}>
            {homeNationName ?? "?"}
          </span>
        </div>
        {/* Score */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-xs font-black w-4 text-center transition-all duration-300"
            style={{ color: isLive ? "var(--color-primary)" : "var(--color-text)" }}>
            {fixture.home_score ?? "–"}
          </span>
          <span className="text-[8px]" style={{ color: "var(--color-muted)" }}>:</span>
          <span className="text-xs font-black w-4 text-center transition-all duration-300"
            style={{ color: isLive ? "var(--color-primary)" : "var(--color-text)" }}>
            {fixture.away_score ?? "–"}
          </span>
        </div>
        {/* Away */}
        <div className="flex items-center gap-1 flex-1">
          <span className="text-[10px] font-black truncate" style={{ color: "var(--color-text)" }}>
            {awayNationName ?? "?"}
          </span>
          {awayNationFlag && <img src={awayNationFlag} alt="" className="w-4 h-3 object-cover rounded-sm" />}
        </div>
        {/* Status label */}
        <span className="text-[7px] font-black uppercase tracking-widest flex-shrink-0 w-10 text-right"
          style={{ color: statusColor }}>
          {isLive ? minute : STATUS_LABEL[ds]}
        </span>
      </div>
    );
  }

  // Full variant: used in Matchday list
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: `1px solid ${isLive ? "color-mix(in srgb, var(--color-primary) 30%, var(--color-border))" : "var(--color-border)"}` }}>
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? "animate-pulse" : ""}`}
            style={{ background: statusColor }} />
          <span className="text-[8px] font-black uppercase tracking-widest"
            style={{ color: statusColor }}>
            {STATUS_LABEL[ds]}
            {isLive && minute && ` · ${minute}`}
          </span>
        </div>
        <span className="text-[7px]" style={{ color: "var(--color-muted)" }}>
          {ds === "scheduled" ? `${kickoffDate} · ${kickoffTime}` : ""}
        </span>
      </div>
      {/* Teams + Score */}
      <div className="flex items-center px-4 py-4 gap-3">
        {/* Home */}
        <div className="flex-1 flex items-center gap-2 justify-end">
          {homeNationFlag && (
            <img src={homeNationFlag} alt={homeNationName} className="w-6 h-4 object-cover rounded-sm" />
          )}
          <span className="text-sm font-black truncate" style={{ color: "var(--color-text)" }}>
            {homeNationName ?? "?"}
          </span>
        </div>
        {/* Score */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-2xl font-black transition-all duration-300"
            style={{ color: isLive ? "var(--color-primary)" : "var(--color-text)", minWidth: 24, textAlign: "center" }}>
            {fixture.home_score ?? "–"}
          </span>
          <span className="text-sm" style={{ color: "var(--color-muted)" }}>:</span>
          <span className="text-2xl font-black transition-all duration-300"
            style={{ color: isLive ? "var(--color-primary)" : "var(--color-text)", minWidth: 24, textAlign: "center" }}>
            {fixture.away_score ?? "–"}
          </span>
        </div>
        {/* Away */}
        <div className="flex-1 flex items-center gap-2">
          <span className="text-sm font-black truncate" style={{ color: "var(--color-text)" }}>
            {awayNationName ?? "?"}
          </span>
          {awayNationFlag && (
            <img src={awayNationFlag} alt={awayNationName} className="w-6 h-4 object-cover rounded-sm" />
          )}
        </div>
      </div>
      {/* Penalties */}
      {penaltiesDisplay && (
        <div className="px-4 pb-3 text-center">
          <span className="text-[9px] font-black" style={{ color: "var(--color-muted)" }}>
            {penaltiesDisplay}
          </span>
        </div>
      )}
    </div>
  );
});
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/nikoko/my-fantasy-app && node_modules/.bin/tsc --noEmit 2>&1 | tail -5
```

Expected: no output.

---

## Task 4: Update `matchday/page.tsx` — use MatchCard + add Realtime

**Files:**
- Modify: `app/wm/[id]/matchday/page.tsx`

- [ ] **Step 1: Add MatchCard import**

At the top of the file, add:
```typescript
import { MatchCard } from "@/app/components/wm/MatchCard";
```

- [ ] **Step 2: Add nation lookup maps**

In the component, after fixtures are loaded, build lookup maps (add to state or compute from nations data):

```typescript
// Add to state
const [nations, setNations] = useState<any[]>([]);

// In loadAll, after loading fixtures, also load nations:
const { data: nationsData } = await supabase
  .from("wm_nations")
  .select("id, name, flag_url")
  .eq("tournament_id", tournamentId);
setNations(nationsData ?? []);
```

Build lookup maps as derived values (not state):
```typescript
const nationNames: Record<string, string> = {};
const nationFlags: Record<string, string | undefined> = {};
for (const n of nations) {
  nationNames[n.id] = n.name;
  nationFlags[n.id] = n.flag_url ?? undefined;
}
```

- [ ] **Step 3: Replace inline fixture rows with `MatchCard`**

Find the section that renders individual fixture rows (currently something like `<div key={f.id}>…score…</div>` patterns). Replace each inline fixture render with:

```tsx
<MatchCard
  key={f.id}
  fixture={f}
  homeNationName={nationNames[f.home_nation_id]}
  awayNationName={nationNames[f.away_nation_id]}
  homeNationFlag={nationFlags[f.home_nation_id]}
  awayNationFlag={nationFlags[f.away_nation_id]}
/>
```

- [ ] **Step 4: Add Realtime subscription for live score updates**

Add this `useEffect` after the data is loaded (requires `tournamentId` in state):

```typescript
useEffect(() => {
  if (!tournamentId) return;
  const channel = supabase
    .channel("wm-matchday-fixtures")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "wm_fixtures", filter: `tournament_id=eq.${tournamentId}` },
      (payload) => {
        setFixtures(prev =>
          prev.map(f => f.id === (payload.new as any).id ? { ...f, ...(payload.new as any) } : f)
        );
      },
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [tournamentId]);
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd /Users/nikoko/my-fantasy-app && node_modules/.bin/tsc --noEmit 2>&1 | tail -5
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd /Users/nikoko/my-fantasy-app && git add \
  lib/wm-types.ts \
  "app/components/wm/MatchCard.tsx" \
  "app/wm/[id]/matchday/page.tsx" \
  && git commit -m "feat(wm-matchday): MatchCard Tier-1 component + matchday Realtime polish

- wm_fixtures.extra_status column (half_time|extra_time|penalties|delayed|interrupted)
- MatchCard: React.memo, compact+full variants, CSS score transition, elapsed time
- Matchday page: uses MatchCard, Realtime score updates via postgres_changes
- extra_status intentionally approximated client-side (V1 — no server drift correction)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
