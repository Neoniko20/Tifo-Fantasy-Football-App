# WM KO-Bracket — Implementation Plan (Phase C2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Bracket" tab to `/wm/[id]/matchday` showing the KO tournament tree. Mobile: vertical stage sections. Desktop: SVG bracket. Fully derived from existing `wm_fixtures` + `wm_nations` data — no new schema, read-only.

**Architecture:** `TournamentBracket` component with memoized `buildBracketFromFixtures()` helper. Mobile uses expandable stage sections, desktop uses CSS Grid + SVG `<line>` connectors. `getWinner()` respects penalties. Placeholders shown for unscheduled fixtures.

**Tech Stack:** React, `useMemo`, SVG, existing `WMFixture`/`WMNation` types, `MatchCard` (Phase C1 — must be complete).

**Prerequisite:** Phase C1 (MatchCard) must be complete.

**Spec:** `docs/superpowers/specs/2026-05-20-wm-live-tournament-ux-design.md` §C2

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `app/components/wm/TournamentBracket.tsx` | Create | Full bracket component — mobile + desktop, memoized |
| `app/wm/[id]/matchday/page.tsx` | Modify | Add "Bracket" tab, render `TournamentBracket` |

---

## Task 1: `TournamentBracket` Component

**Files:**
- Create: `app/components/wm/TournamentBracket.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";
// TournamentBracket — read-only KO tournament visualization.
// No admin input, no drag-and-drop, no manual winner selection.
// Bracket structure memoized — only rebuilds when fixtures/nations change.

import React, { memo, useMemo, useState } from "react";
import type { WMFixture, WMNation, WMStage } from "@/lib/wm-types";
import { MatchCard } from "@/app/components/wm/MatchCard";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BracketMatch {
  fixture?: WMFixture;
  home_nation?: WMNation;
  away_nation?: WMNation;
  placeholder_home?: string;   // "Sieger Gruppe A" etc. when fixture not yet scheduled
  placeholder_away?: string;
  winner?: WMNation;           // null = not yet decided
  is_live: boolean;
}

interface BracketRound {
  stage: WMStage;
  label: string;
  matches: BracketMatch[];
}

// ── Stage config ──────────────────────────────────────────────────────────────

const KO_STAGES: WMStage[] = ["round_of_32", "round_of_16", "quarter", "semi", "final"];

const STAGE_LABEL: Record<WMStage, string> = {
  group:        "Gruppenphase",
  round_of_32:  "Sechzehntelfinale",
  round_of_16:  "Achtelfinale",
  quarter:      "Viertelfinale",
  semi:         "Halbfinale",
  final:        "Finale",
};

// Expected match counts per stage (WM 32 teams)
const STAGE_MATCH_COUNT: Partial<Record<WMStage, number>> = {
  round_of_32: 16,
  round_of_16: 8,
  quarter:     4,
  semi:        2,
  final:       1,
};

// ── Winner logic ──────────────────────────────────────────────────────────────
// Explicitly documented per spec:
// 1. If penalties_home/away are set → penalties winner takes precedence over Draw
// 2. Otherwise home_score > away_score or vice versa
// 3. Returns null if still open (scheduled, live, or genuine draw without penalties)

function getWinner(fixture: WMFixture, nations: WMNation[]): WMNation | null {
  if (fixture.status !== "finished") return null;

  const home = nations.find(n => n.id === fixture.home_nation_id);
  const away = nations.find(n => n.id === fixture.away_nation_id);

  // Penalties override draw
  if (fixture.penalties_home != null && fixture.penalties_away != null) {
    if (fixture.penalties_home > fixture.penalties_away) return home ?? null;
    if (fixture.penalties_away > fixture.penalties_home) return away ?? null;
    return null; // shouldn't happen but handled
  }

  // Normal score
  const hs = fixture.home_score ?? 0;
  const as_ = fixture.away_score ?? 0;
  if (hs > as_) return home ?? null;
  if (as_ > hs) return away ?? null;
  return null; // draw — should only occur in group phase
}

// ── Bracket builder (memoized input) ──────────────────────────────────────────

function buildBracketFromFixtures(
  fixtures: WMFixture[],
  nations: WMNation[],
): BracketRound[] {
  const nationMap: Record<string, WMNation> = {};
  for (const n of nations) nationMap[n.id] = n;

  const rounds: BracketRound[] = [];

  for (const stage of KO_STAGES) {
    const stageFixtures = fixtures.filter(f => f.stage === stage);
    const expectedCount = STAGE_MATCH_COUNT[stage] ?? 0;

    const matches: BracketMatch[] = stageFixtures.map(f => ({
      fixture: f,
      home_nation:    nationMap[f.home_nation_id],
      away_nation:    nationMap[f.away_nation_id],
      winner:         getWinner(f, nations),
      is_live:        f.status === "live",
    }));

    // Pad with placeholder slots up to expectedCount
    const placeholdersNeeded = Math.max(0, expectedCount - matches.length);
    for (let i = 0; i < placeholdersNeeded; i++) {
      matches.push({
        placeholder_home: "Noch nicht bekannt",
        placeholder_away: "Noch nicht bekannt",
        is_live: false,
      });
    }

    if (matches.length > 0) {
      rounds.push({ stage, label: STAGE_LABEL[stage], matches });
    }
  }

  return rounds;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  fixtures: WMFixture[];
  nations: WMNation[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export const TournamentBracket = memo(function TournamentBracket({ fixtures, nations }: Props) {
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});

  // Memoize bracket structure — only recalculate when fixtures/nations change
  const rounds = useMemo(
    () => buildBracketFromFixtures(fixtures, nations),
    [fixtures, nations],
  );

  const nationNames: Record<string, string> = useMemo(() => {
    const m: Record<string, string> = {};
    for (const n of nations) m[n.id] = n.name;
    return m;
  }, [nations]);

  const nationFlags: Record<string, string | undefined> = useMemo(() => {
    const m: Record<string, string | undefined> = {};
    for (const n of nations) m[n.id] = n.flag_url ?? undefined;
    return m;
  }, [nations]);

  function toggleStage(stage: string) {
    setExpandedStages(prev => ({ ...prev, [stage]: !prev[stage] }));
  }

  if (rounds.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-[9px]" style={{ color: "var(--color-muted)" }}>
          Noch keine KO-Runden-Fixtures vorhanden
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rounds.map(round => {
        const isExpanded = expandedStages[round.stage] !== false; // default open
        return (
          <div key={round.stage} className="rounded-xl overflow-hidden"
            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            {/* Stage header — tappable to expand/collapse */}
            <button
              className="w-full flex items-center justify-between px-4 py-3"
              style={{ borderBottom: isExpanded ? "1px solid var(--color-border)" : "none" }}
              onClick={() => toggleStage(round.stage)}>
              <p className="text-[9px] font-black uppercase tracking-widest"
                style={{ color: "var(--color-muted)" }}>
                {round.label}
              </p>
              <div className="flex items-center gap-2">
                {round.matches.some(m => m.is_live) && (
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ background: "var(--color-primary)" }} />
                )}
                <span className="text-[8px]" style={{ color: "var(--color-muted)" }}>
                  {isExpanded ? "▲" : "▼"}
                </span>
              </div>
            </button>

            {/* Matches */}
            {isExpanded && (
              <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {round.matches.map((match, i) => {
                  // Placeholder (fixture not yet scheduled)
                  if (!match.fixture) {
                    return (
                      <div key={i} className="px-4 py-3 flex items-center gap-3">
                        <div className="flex-1 text-right">
                          <span className="text-[9px]" style={{ color: "var(--color-muted)" }}>
                            {match.placeholder_home ?? "Noch nicht bekannt"}
                          </span>
                        </div>
                        <span className="text-[8px] px-2" style={{ color: "var(--color-border)" }}>vs</span>
                        <div className="flex-1">
                          <span className="text-[9px]" style={{ color: "var(--color-muted)" }}>
                            {match.placeholder_away ?? "Noch nicht bekannt"}
                          </span>
                        </div>
                      </div>
                    );
                  }

                  // Actual fixture — use MatchCard (Tier-1 component)
                  return (
                    <div key={match.fixture.id} className="px-3 py-2">
                      <MatchCard
                        fixture={match.fixture}
                        homeNationName={match.home_nation?.name ?? nationNames[match.fixture.home_nation_id]}
                        awayNationName={match.away_nation?.name ?? nationNames[match.fixture.away_nation_id]}
                        homeNationFlag={match.home_nation?.flag_url ?? nationFlags[match.fixture.home_nation_id]}
                        awayNationFlag={match.away_nation?.flag_url ?? nationFlags[match.fixture.away_nation_id]}
                        compact
                      />
                      {/* Winner indicator */}
                      {match.winner && (
                        <p className="text-[7px] font-black uppercase tracking-widest text-center mt-1"
                          style={{ color: "var(--color-success)" }}>
                          Weiter: {match.winner.name}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
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

## Task 2: Add "Bracket" Tab to Matchday Page

**Files:**
- Modify: `app/wm/[id]/matchday/page.tsx`

- [ ] **Step 1: Add import**

```typescript
import { TournamentBracket } from "@/app/components/wm/TournamentBracket";
```

- [ ] **Step 2: Add tab state**

The matchday page currently shows fixtures grouped by stage. Add a tab to switch between "Fixtures" and "Bracket" views:

Find where the page's main state is declared (around the top of the component) and add:
```typescript
const [activeTab, setActiveTab] = useState<"fixtures" | "bracket">("fixtures");
```

- [ ] **Step 3: Add tab switcher UI**

Find the top of the rendered content (after the GW selector or page header) and add:

```tsx
{/* Tab switcher: Fixtures / Bracket */}
<div className="flex gap-1.5 mb-3">
  {(["fixtures", "bracket"] as const).map(t => (
    <button key={t} onClick={() => setActiveTab(t)}
      className="px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
      style={{
        background: activeTab === t ? "var(--color-primary)" : "var(--bg-card)",
        color:      activeTab === t ? "var(--bg-page)" : "var(--color-muted)",
        border:     "1px solid var(--color-border)",
      }}>
      {t === "fixtures" ? "Spielplan" : "Bracket"}
    </button>
  ))}
</div>
```

- [ ] **Step 4: Wrap existing fixture list in tab condition + add Bracket view**

Wrap the existing fixture render block:
```tsx
{activeTab === "fixtures" && (
  // ... existing fixture render (MatchCards grouped by stage/GW) ...
)}

{activeTab === "bracket" && (
  <TournamentBracket
    fixtures={allFixtures}      // All fixtures (not just current GW)
    nations={nations}
  />
)}
```

`allFixtures` should include all KO-stage fixtures for the tournament. If the page currently only loads fixtures for the selected GW, add a separate load for all KO fixtures:

```typescript
// In loadAll():
const { data: koFixtures } = await supabase
  .from("wm_fixtures")
  .select("*, home_nation:home_nation_id(*), away_nation:away_nation_id(*)")
  .eq("tournament_id", tournamentId)
  .in("stage", ["round_of_32", "round_of_16", "quarter", "semi", "final"])
  .order("gameweek");

// Store in state:
const [allKOFixtures, setAllKOFixtures] = useState<WMFixture[]>([]);
// ...
setAllKOFixtures((koFixtures ?? []) as WMFixture[]);
```

Then pass `allKOFixtures` to `TournamentBracket`.

- [ ] **Step 5: Verify TypeScript**

```bash
cd /Users/nikoko/my-fantasy-app && node_modules/.bin/tsc --noEmit 2>&1 | tail -5
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd /Users/nikoko/my-fantasy-app && git add \
  "app/components/wm/TournamentBracket.tsx" \
  "app/wm/[id]/matchday/page.tsx" \
  && git commit -m "feat(wm-bracket): KO-Bracket tab in Matchday

- TournamentBracket: memoized buildBracketFromFixtures + useMemo SVG
- getWinner(): penalties override draw, explicit null for open matches
- Mobile: expandable stage sections (no forced mini-bracket)
- Placeholder slots for unscheduled KO fixtures
- Read-only — no admin input, no drag-and-drop, no manual winner

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
