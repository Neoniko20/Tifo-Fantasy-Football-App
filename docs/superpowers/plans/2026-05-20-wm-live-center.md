# WM Fantasy Live Center — Implementation Plan (Phase B1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/wm/[id]/live` — a dedicated broadcast-style page showing live GW points, leaderboard, active fixtures, player statuses, and an event feed. Read-only. Realtime via 3 Supabase channels with 10s polling fallback on disconnect.

**Architecture:** 7 focused components in `/app/components/wm/` + new page at `/app/wm/[id]/live/page.tsx`. Initial parallel data load, then 3 Realtime channels for incremental updates. Hub gets a live-banner link.

**Tech Stack:** Next.js 14, Supabase Realtime (`supabase.channel`), existing `supabase` client from `lib/supabase.ts`, existing TIFO design tokens.

**Prerequisite:** Phase A1 (Ingest Layer) must be complete — live data flows from `wm_gameweek_points` and `wm_fixtures`.

**Spec:** `docs/superpowers/specs/2026-05-20-wm-live-tournament-ux-design.md` §B1

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `app/components/wm/LiveStatusBanner.tsx` | Create | GW status header + progress |
| `app/components/wm/LiveTickerStrip.tsx` | Create | Breaking-bar: last important event |
| `app/components/wm/MyGWCard.tsx` | Create | My team's GW points, captain, VC |
| `app/components/wm/LiveLeaderboard.tsx` | Create | All teams ranked by GW points |
| `app/components/wm/FixtureStrip.tsx` | Create | Row of fixture score cards |
| `app/components/wm/PlayerStatusGrid.tsx` | Create | My XI players + status + points |
| `app/components/wm/LiveEventFeed.tsx` | Create | Chronological system message stream |
| `app/wm/[id]/live/page.tsx` | Create | Page — data loading, Realtime, layout |
| `app/wm/[id]/page.tsx` | Modify | Add live-banner when activeGW exists |

---

## Task 1: Component — `LiveStatusBanner`

**Files:**
- Create: `app/components/wm/LiveStatusBanner.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";
import React from "react";

interface Props {
  gwNumber: number;
  fixturesTotal: number;
  fixturesFinished: number;
  realtimeStatus: "connected" | "disconnected";
  onRefresh?: () => void;
}

export function LiveStatusBanner({ gwNumber, fixturesTotal, fixturesFinished, realtimeStatus, onRefresh }: Props) {
  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-center justify-between px-4 py-3 rounded-xl"
        style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--color-primary)" }} />
          <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>
            GW{gwNumber} läuft
          </p>
          <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            {fixturesFinished}/{fixturesTotal} Spiele beendet
          </span>
        </div>
        {realtimeStatus === "disconnected" && (
          <button onClick={onRefresh}
            className="text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg"
            style={{ background: "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))", color: "var(--color-error)", border: "1px solid color-mix(in srgb, var(--color-error) 30%, transparent)" }}>
            Verbindung unterbrochen — Neu laden
          </button>
        )}
      </div>
    </div>
  );
}
```

---

## Task 2: Component — `LiveTickerStrip`

**Files:**
- Create: `app/components/wm/LiveTickerStrip.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";
import React, { useEffect, useState } from "react";

interface TickerEvent {
  text: string;
  priority: "high" | "medium" | "low";
  id: string;
}

interface Props {
  events: TickerEvent[];
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

export function LiveTickerStrip({ events }: Props) {
  const [visible, setVisible] = useState(false);
  const top = [...events].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])[0];

  useEffect(() => {
    if (!top) return;
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, [top?.id]);

  if (!top) return null;

  const accent =
    top.priority === "high" ? "var(--color-error)"
    : top.priority === "medium" ? "var(--color-primary)"
    : "var(--color-muted)";

  return (
    <div className="w-full px-4 py-2 rounded-xl overflow-hidden transition-opacity duration-300"
      style={{
        background: `color-mix(in srgb, ${accent} 10%, var(--bg-card))`,
        border: `1px solid color-mix(in srgb, ${accent} 30%, var(--color-border))`,
        opacity: visible ? 1 : 0,
      }}>
      <p className="text-[9px] font-black truncate" style={{ color: accent }}>
        {top.text}
      </p>
    </div>
  );
}
```

---

## Task 3: Component — `MyGWCard`

**Files:**
- Create: `app/components/wm/MyGWCard.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";
import React from "react";

interface Props {
  teamName: string;
  gwPoints: number;
  totalPoints: number;
  captainName?: string;
  captainPoints?: number;
  vcName?: string;
  autoSubsCount?: number;
  hasEliminatedPlayer?: boolean;
}

export function MyGWCard({
  teamName, gwPoints, totalPoints, captainName, captainPoints,
  vcName, autoSubsCount, hasEliminatedPlayer,
}: Props) {
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid color-mix(in srgb, var(--color-primary) 40%, var(--color-border))" }}>
      <div className="px-4 pt-4 pb-3">
        <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
          {teamName}
        </p>
        <div className="flex items-end gap-3">
          <span className="text-3xl font-black" style={{ color: "var(--color-text)" }}>
            {gwPoints.toFixed(1)}
          </span>
          <span className="text-[9px] font-black mb-1" style={{ color: "var(--color-muted)" }}>
            pts dieser GW
          </span>
          <span className="text-[9px] font-black mb-1 ml-auto" style={{ color: "var(--color-muted)" }}>
            Gesamt: {totalPoints.toFixed(1)}
          </span>
        </div>
      </div>
      <div className="px-4 pb-3 flex flex-wrap gap-2">
        {captainName && (
          <span className="text-[8px] font-black px-2 py-1 rounded-full"
            style={{ background: "color-mix(in srgb, var(--color-primary) 15%, var(--bg-page))", color: "var(--color-primary)" }}>
            C: {captainName} {captainPoints !== undefined ? `(${captainPoints.toFixed(1)}pt)` : ""}
          </span>
        )}
        {vcName && (
          <span className="text-[8px] font-black px-2 py-1 rounded-full"
            style={{ background: "var(--bg-page)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
            VC: {vcName}
          </span>
        )}
        {(autoSubsCount ?? 0) > 0 && (
          <span className="text-[8px] font-black px-2 py-1 rounded-full"
            style={{ background: "color-mix(in srgb, var(--color-info) 15%, var(--bg-page))", color: "var(--color-info)" }}>
            🔄 {autoSubsCount} Auto-Sub{autoSubsCount! > 1 ? "s" : ""}
          </span>
        )}
        {hasEliminatedPlayer && (
          <span className="text-[8px] font-black px-2 py-1 rounded-full"
            style={{ background: "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))", color: "var(--color-error)" }}>
            ⚠ Eliminierter Spieler
          </span>
        )}
      </div>
    </div>
  );
}
```

---

## Task 4: Component — `LiveLeaderboard`

**Files:**
- Create: `app/components/wm/LiveLeaderboard.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";
import React, { memo } from "react";

export interface LiveTeamRow {
  team_id: string;
  team_name: string;
  gw_points: number;
  total_points: number;
  rank_delta: number;
  players_playing: number;
  players_total: number;
  is_my_team: boolean;
  has_nation_eliminated: boolean;
}

interface Props {
  rows: LiveTeamRow[];
}

export const LiveLeaderboard = memo(function LiveLeaderboard({ rows }: Props) {
  const sorted = [...rows].sort((a, b) => b.gw_points - a.gw_points);
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Live Rangliste
        </p>
      </div>
      {sorted.map((row, i) => (
        <div key={row.team_id}
          className="flex items-center px-4 py-3 gap-2"
          style={{
            borderBottom: i < sorted.length - 1 ? "1px solid var(--color-border)" : undefined,
            background: row.is_my_team
              ? "color-mix(in srgb, var(--color-primary) 5%, var(--bg-card))" : undefined,
          }}>
          {/* Rank */}
          <span className="text-[10px] font-black w-4 text-right flex-shrink-0"
            style={{ color: "var(--color-muted)" }}>{i + 1}</span>
          {/* Delta */}
          <span className="text-[7px] font-black w-5 text-right flex-shrink-0"
            style={{ color: row.rank_delta > 0 ? "var(--color-success)" : row.rank_delta < 0 ? "var(--color-error)" : "transparent" }}>
            {row.rank_delta > 0 ? `▲${row.rank_delta}` : row.rank_delta < 0 ? `▼${Math.abs(row.rank_delta)}` : "–"}
          </span>
          {/* Name + status */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black truncate"
              style={{ color: row.is_my_team ? "var(--color-primary)" : "var(--color-text)" }}>
              {row.team_name}
              {row.is_my_team && <span className="ml-1 text-[7px] font-normal" style={{ color: "var(--color-muted)" }}>· Du</span>}
            </p>
            <p className="text-[8px]" style={{ color: "var(--color-muted)" }}>
              {row.players_playing}/{row.players_total} aktiv
              {row.has_nation_eliminated && <span style={{ color: "var(--color-error)" }}> · ⚠ eliminiert</span>}
            </p>
          </div>
          {/* GW pts */}
          <span className="text-sm font-black flex-shrink-0"
            style={{ color: row.is_my_team ? "var(--color-primary)" : "var(--color-text)" }}>
            {row.gw_points.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
});
```

---

## Task 5: Components — `FixtureStrip` + `PlayerStatusGrid` + `LiveEventFeed`

**Files:**
- Create: `app/components/wm/FixtureStrip.tsx`
- Create: `app/components/wm/PlayerStatusGrid.tsx`
- Create: `app/components/wm/LiveEventFeed.tsx`

- [ ] **Step 1: Create `FixtureStrip.tsx`**

```tsx
"use client";
import React, { memo } from "react";
import type { WMFixture } from "@/lib/wm-types";

interface Props {
  fixtures: WMFixture[];
  nationNames: Record<string, string>;
  nationFlags: Record<string, string | undefined>;
}

export const FixtureStrip = memo(function FixtureStrip({ fixtures, nationNames, nationFlags }: Props) {
  if (!fixtures.length) return null;
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Aktive Fixtures
        </p>
      </div>
      <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
        {fixtures.map(f => {
          const isLive = f.status === "live";
          const isFinished = f.status === "finished";
          return (
            <div key={f.id} className="px-4 py-3 flex items-center gap-3">
              {/* Status dot */}
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isLive ? "animate-pulse" : ""}`}
                style={{ background: isLive ? "var(--color-primary)" : isFinished ? "var(--color-success)" : "var(--color-border)" }} />
              {/* Home */}
              <div className="flex-1 flex items-center gap-1.5 justify-end">
                {nationFlags[f.home_nation_id] && (
                  <img src={nationFlags[f.home_nation_id]} alt="" className="w-4 h-3 object-cover rounded-sm" />
                )}
                <span className="text-xs font-black truncate" style={{ color: "var(--color-text)" }}>
                  {nationNames[f.home_nation_id] ?? "?"}
                </span>
              </div>
              {/* Score */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-sm font-black w-5 text-center" style={{ color: isLive ? "var(--color-primary)" : "var(--color-text)" }}>
                  {f.home_score ?? "–"}
                </span>
                <span className="text-[8px]" style={{ color: "var(--color-muted)" }}>:</span>
                <span className="text-sm font-black w-5 text-center" style={{ color: isLive ? "var(--color-primary)" : "var(--color-text)" }}>
                  {f.away_score ?? "–"}
                </span>
              </div>
              {/* Away */}
              <div className="flex-1 flex items-center gap-1.5">
                <span className="text-xs font-black truncate" style={{ color: "var(--color-text)" }}>
                  {nationNames[f.away_nation_id] ?? "?"}
                </span>
                {nationFlags[f.away_nation_id] && (
                  <img src={nationFlags[f.away_nation_id]} alt="" className="w-4 h-3 object-cover rounded-sm" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
```

- [ ] **Step 2: Create `PlayerStatusGrid.tsx`**

```tsx
"use client";
import React, { memo } from "react";

export type PlayerLiveStatus = "playing" | "finished" | "upcoming" | "eliminated";

export interface PlayerLiveRow {
  player_id: number;
  player_name: string;
  position: string;
  nation_flag?: string;
  gw_points: number;
  status: PlayerLiveStatus;
  is_captain: boolean;
  is_vc: boolean;
  is_auto_subbed: boolean;
}

interface Props {
  players: PlayerLiveRow[];
}

const STATUS_CONFIG: Record<PlayerLiveStatus, { label: string; color: string }> = {
  playing:    { label: "Spielt", color: "var(--color-success)" },
  finished:   { label: "Fertig", color: "var(--color-muted)" },
  upcoming:   { label: "Ausstehend", color: "var(--color-info)" },
  eliminated: { label: "Eliminiert", color: "var(--color-error)" },
};

const POS_COLOR: Record<string, string> = {
  GK: "var(--color-primary)", DF: "var(--color-info)",
  MF: "var(--color-success)", FW: "var(--color-error)",
};

export const PlayerStatusGrid = memo(function PlayerStatusGrid({ players }: Props) {
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Meine Spieler
        </p>
      </div>
      <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
        {players.map(p => {
          const sc = STATUS_CONFIG[p.status];
          const isElim = p.status === "eliminated";
          return (
            <div key={p.player_id}
              className="flex items-center px-4 py-2.5 gap-2"
              style={{ opacity: isElim ? 0.5 : 1 }}>
              {/* Position badge */}
              <span className="text-[7px] font-black w-6 text-center flex-shrink-0"
                style={{ color: POS_COLOR[p.position] ?? "var(--color-muted)" }}>
                {p.position}
              </span>
              {/* Flag */}
              {p.nation_flag && (
                <img src={p.nation_flag} alt="" className="w-4 h-3 object-cover rounded-sm flex-shrink-0" />
              )}
              {/* Name */}
              <p className="flex-1 text-xs font-black truncate" style={{ color: "var(--color-text)" }}>
                {p.player_name}
                {p.is_captain && <span className="ml-1 text-[7px] px-1 rounded" style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>C</span>}
                {p.is_vc && <span className="ml-1 text-[7px] px-1 rounded" style={{ background: "var(--bg-elevated)", color: "var(--color-muted)" }}>VC</span>}
                {p.is_auto_subbed && <span className="ml-1 text-[7px]" style={{ color: "var(--color-info)" }}>🔄</span>}
              </p>
              {/* Status */}
              <span className="text-[7px] font-black uppercase tracking-widest flex-shrink-0"
                style={{ color: sc.color }}>{sc.label}</span>
              {/* Points */}
              <span className="text-xs font-black flex-shrink-0 w-10 text-right"
                style={{ color: p.gw_points > 0 ? "var(--color-text)" : "var(--color-muted)" }}>
                {p.status === "playing" ? "~" : ""}{p.gw_points.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
```

- [ ] **Step 3: Create `LiveEventFeed.tsx`**

```tsx
"use client";
import React, { memo } from "react";
import type { LeagueMessage } from "@/lib/chat";

interface Props {
  messages: LeagueMessage[];
}

export const LiveEventFeed = memo(function LiveEventFeed({ messages }: Props) {
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Event Feed
        </p>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {messages.length === 0 && (
          <p className="px-4 py-4 text-[9px] text-center" style={{ color: "var(--color-muted)" }}>
            Noch keine Events in dieser GW
          </p>
        )}
        {messages.map(msg => {
          const isSimulator = (msg.metadata as any)?.source === "simulator";
          const icon = (msg.metadata as any)?.icon ?? "•";
          return (
            <div key={msg.id} className="px-4 py-2.5 flex items-start gap-2"
              style={{ borderBottom: "1px solid var(--color-border)" }}>
              <span className="text-sm flex-shrink-0">{icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[9px]" style={{ color: "var(--color-text)" }}>
                  {msg.content}
                </p>
                <p className="text-[7px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                  {new Date(msg.created_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                  {isSimulator && (
                    <span className="ml-1.5 px-1 rounded text-[6px] font-black uppercase"
                      style={{ background: "var(--bg-elevated)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                      SIM
                    </span>
                  )}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
```

---

## Task 6: Page — `/wm/[id]/live/page.tsx`

**Files:**
- Create: `app/wm/[id]/live/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/app/components/ui/Spinner";
import { BottomNav } from "@/app/components/BottomNav";
import { LiveStatusBanner } from "@/app/components/wm/LiveStatusBanner";
import { LiveTickerStrip } from "@/app/components/wm/LiveTickerStrip";
import { MyGWCard } from "@/app/components/wm/MyGWCard";
import { LiveLeaderboard, type LiveTeamRow } from "@/app/components/wm/LiveLeaderboard";
import { FixtureStrip } from "@/app/components/wm/FixtureStrip";
import { PlayerStatusGrid, type PlayerLiveRow, type PlayerLiveStatus } from "@/app/components/wm/PlayerStatusGrid";
import { LiveEventFeed } from "@/app/components/wm/LiveEventFeed";
import type { WMFixture, WMGameweek, WMNation } from "@/lib/wm-types";
import type { LeagueMessage } from "@/lib/chat";

export default function LiveCenterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [loading, setLoading]               = useState(true);
  const [user, setUser]                     = useState<any>(null);
  const [myTeamId, setMyTeamId]             = useState<string | null>(null);
  const [activeGW, setActiveGW]             = useState<WMGameweek | null>(null);
  const [fixtures, setFixtures]             = useState<WMFixture[]>([]);
  const [leaderboard, setLeaderboard]       = useState<LiveTeamRow[]>([]);
  const [myPlayers, setMyPlayers]           = useState<PlayerLiveRow[]>([]);
  const [messages, setMessages]             = useState<LeagueMessage[]>([]);
  const [nations, setNations]               = useState<WMNation[]>([]);
  const [realtimeStatus, setRealtimeStatus] = useState<"connected" | "disconnected">("connected");
  const [tournamentId, setTournamentId]     = useState<string | null>(null);

  // ── Ticker events (derived from last 5 messages) ───────────────────────────
  const tickerEvents = messages.slice(0, 3).map(m => ({
    id: m.id,
    text: (m.metadata as any)?.ticker_text ?? m.content,
    priority: ((m.metadata as any)?.priority ?? "low") as "high" | "medium" | "low",
  }));

  // ── Initial load ───────────────────────────────────────────────────────────
  const loadAll = useCallback(async (userId: string) => {
    const { data: settings } = await supabase
      .from("wm_league_settings").select("tournament_id").eq("league_id", leagueId).maybeSingle();
    if (!settings?.tournament_id) { setLoading(false); return; }
    const tid = settings.tournament_id;
    setTournamentId(tid);

    const { data: myTeam } = await supabase
      .from("teams").select("id").eq("league_id", leagueId).eq("user_id", userId).maybeSingle();
    setMyTeamId(myTeam?.id ?? null);

    // All parallel
    const [gwRes, fixtureRes, teamsRes, nationsRes, messagesRes] = await Promise.all([
      supabase.from("wm_gameweeks").select("*").eq("tournament_id", tid)
        .in("status", ["active", "upcoming"]).order("gameweek").limit(1),
      supabase.from("wm_fixtures").select("*, home_nation:home_nation_id(*), away_nation:away_nation_id(*)")
        .eq("tournament_id", tid).in("status", ["live", "finished"]).order("kickoff"),
      supabase.from("teams").select("id, name").eq("league_id", leagueId),
      supabase.from("wm_nations").select("*").eq("tournament_id", tid),
      supabase.from("league_messages").select("*").eq("league_id", leagueId)
        .order("created_at", { ascending: false }).limit(50),
    ]);

    const gw = gwRes.data?.[0] ?? null;
    setActiveGW(gw);
    setFixtures((fixtureRes.data ?? []) as WMFixture[]);
    setNations((nationsRes.data ?? []) as WMNation[]);
    setMessages((messagesRes.data ?? []) as LeagueMessage[]);

    if (gw && teamsRes.data) {
      await loadLeaderboard(gw.gameweek, leagueId, teamsRes.data, myTeam?.id ?? null, (nationsRes.data ?? []) as WMNation[]);
      if (myTeam?.id) {
        await loadMyPlayers(myTeam.id, gw.gameweek, tid, (fixtureRes.data ?? []) as WMFixture[], (nationsRes.data ?? []) as WMNation[]);
      }
    }
    setLoading(false);
  }, [leagueId]);

  async function loadLeaderboard(
    gw: number, leagueId: string, teams: any[], myTeamId: string | null, nationsData: WMNation[]
  ) {
    const teamIds = teams.map((t: any) => t.id);
    if (!teamIds.length) return;
    const { data: pts } = await supabase
      .from("wm_gameweek_points").select("team_id, points").in("team_id", teamIds).eq("gameweek", gw);

    const totals: Record<string, number> = {};
    for (const row of (pts ?? [])) {
      totals[row.team_id] = (totals[row.team_id] ?? 0) + (row.points ?? 0);
    }
    const { data: teamsWithTotal } = await supabase
      .from("teams").select("id, name, total_points").in("id", teamIds);

    const rows: LiveTeamRow[] = (teamsWithTotal ?? []).map((t: any) => ({
      team_id:              t.id,
      team_name:            t.name,
      gw_points:            Math.round((totals[t.id] ?? 0) * 10) / 10,
      total_points:         t.total_points ?? 0,
      rank_delta:           0,
      players_playing:      0,
      players_total:        11,
      is_my_team:           t.id === myTeamId,
      has_nation_eliminated: false,
    }));
    setLeaderboard(rows);
  }

  async function loadMyPlayers(
    teamId: string, gw: number, tid: string,
    fixturesData: WMFixture[], nationsData: WMNation[]
  ) {
    const { data: lineup } = await supabase
      .from("team_lineups").select("starting_xi, captain_id, vice_captain_id")
      .eq("team_id", teamId).eq("gameweek", gw).maybeSingle();
    if (!lineup?.starting_xi?.length) return;

    const playerIds = lineup.starting_xi as number[];
    const { data: players } = await supabase
      .from("players").select("id, name, position").in("id", playerIds);
    const { data: pts } = await supabase
      .from("wm_gameweek_points").select("player_id, points")
      .eq("team_id", teamId).eq("gameweek", gw);
    const { data: nationMappings } = await supabase
      .from("wm_player_nations").select("player_id, nation_id").eq("tournament_id", tid).in("player_id", playerIds);

    const ptsMap: Record<number, number> = {};
    for (const p of (pts ?? [])) ptsMap[p.player_id] = p.points;
    const nationMap: Record<number, string> = {};
    for (const n of (nationMappings ?? [])) nationMap[n.player_id] = n.nation_id;
    const liveFixtureNations = new Set(fixturesData.filter(f => f.status === "live").flatMap(f => [f.home_nation_id, f.away_nation_id]));
    const finishedFixtureNations = new Set(fixturesData.filter(f => f.status === "finished").flatMap(f => [f.home_nation_id, f.away_nation_id]));

    const rows: PlayerLiveRow[] = (players ?? []).map((p: any) => {
      const nationId = nationMap[p.id];
      const nation = nationsData.find(n => n.id === nationId);
      const isElim = nation?.eliminated_after_gameweek != null && gw > (nation.eliminated_after_gameweek ?? 999);
      let status: PlayerLiveStatus = "upcoming";
      if (isElim) status = "eliminated";
      else if (nationId && liveFixtureNations.has(nationId)) status = "playing";
      else if (nationId && finishedFixtureNations.has(nationId)) status = "finished";

      return {
        player_id:   p.id,
        player_name: p.name,
        position:    p.position ?? "MF",
        gw_points:   ptsMap[p.id] ?? 0,
        status,
        is_captain:   lineup.captain_id === p.id,
        is_vc:        lineup.vice_captain_id === p.id,
        is_auto_subbed: false, // Phase B2 will wire this
        nation_flag:  nation?.flag_url ?? undefined,
      };
    });
    setMyPlayers(rows);
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
    });
  }, [loadAll]);

  // ── Realtime subscriptions ─────────────────────────────────────────────────
  useEffect(() => {
    if (!tournamentId || !activeGW) return;

    const channel = supabase.channel("wm-live-center")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "wm_gameweek_points", filter: `league_id=eq.${leagueId}` },
        () => { if (user) loadAll(user.id); }
      )
      .on("postgres_changes",
        { event: "*", schema: "public", table: "wm_fixtures", filter: `tournament_id=eq.${tournamentId}` },
        (payload) => {
          setFixtures(prev => prev.map(f => f.id === (payload.new as any).id ? { ...f, ...(payload.new as any) } : f));
        }
      )
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "league_messages", filter: `league_id=eq.${leagueId}` },
        (payload) => {
          setMessages(prev => [payload.new as LeagueMessage, ...prev].slice(0, 50));
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeStatus("connected");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setRealtimeStatus("disconnected");
      });

    return () => { supabase.removeChannel(channel); };
  }, [tournamentId, activeGW?.gameweek, leagueId, user]);

  // ── Soft-polling fallback (15s disconnect → 10s poll) ─────────────────────
  useEffect(() => {
    if (realtimeStatus !== "disconnected" || !user) return;
    const interval = setInterval(() => loadAll(user.id), 10_000);
    return () => clearInterval(interval);
  }, [realtimeStatus, user, loadAll]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <Spinner />
    </div>
  );

  if (!activeGW) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4"
      style={{ background: "var(--bg-page)" }}>
      <p className="text-sm font-black" style={{ color: "var(--color-text)" }}>Kein Spieltag aktiv</p>
      <p className="text-[9px]" style={{ color: "var(--color-muted)" }}>
        Das Live Center öffnet wenn ein Gameweek startet.
      </p>
      <Link href={`/wm/${leagueId}/matchday`}
        className="text-[9px] font-black uppercase tracking-widest px-4 py-2 rounded-xl"
        style={{ background: "var(--bg-card)", color: "var(--color-primary)", border: "1px solid var(--color-border)" }}>
        Spielplan ansehen →
      </Link>
      <BottomNav leagueId={leagueId} />
    </div>
  );

  const nationNames: Record<string, string> = {};
  const nationFlags: Record<string, string | undefined> = {};
  for (const n of nations) { nationNames[n.id] = n.name; nationFlags[n.id] = n.flag_url ?? undefined; }

  const fixturesFinished = fixtures.filter(f => f.status === "finished").length;
  const myTeamRow = leaderboard.find(r => r.is_my_team);
  const myCapPlayer = myPlayers.find(p => p.is_captain);
  const myVcPlayer = myPlayers.find(p => p.is_vc);

  return (
    <div className="min-h-screen pb-24" style={{ background: "var(--bg-page)" }}>
      <div className="max-w-xl mx-auto px-4 pt-4 space-y-3">

        {/* Live Ticker */}
        <LiveTickerStrip events={tickerEvents} />

        {/* GW Status */}
        <LiveStatusBanner
          gwNumber={activeGW.gameweek}
          fixturesTotal={fixtures.length}
          fixturesFinished={fixturesFinished}
          realtimeStatus={realtimeStatus}
          onRefresh={() => user && loadAll(user.id)}
        />

        {/* My Points */}
        {myTeamRow && (
          <MyGWCard
            teamName={myTeamRow.team_name}
            gwPoints={myTeamRow.gw_points}
            totalPoints={myTeamRow.total_points}
            captainName={myCapPlayer?.player_name}
            captainPoints={myCapPlayer ? myCapPlayer.gw_points * 2 : undefined}
            vcName={myVcPlayer?.player_name}
            hasEliminatedPlayer={myPlayers.some(p => p.status === "eliminated")}
          />
        )}

        {/* Leaderboard */}
        <LiveLeaderboard rows={leaderboard} />

        {/* Fixtures */}
        <FixtureStrip fixtures={fixtures} nationNames={nationNames} nationFlags={nationFlags} />

        {/* My Players */}
        {myPlayers.length > 0 && <PlayerStatusGrid players={myPlayers} />}

        {/* Event Feed */}
        <LiveEventFeed messages={messages} />

      </div>
      <BottomNav leagueId={leagueId} />
    </div>
  );
}
```

---

## Task 7: Hub Banner + TypeScript + Commit

**Files:**
- Modify: `app/wm/[id]/page.tsx`

- [ ] **Step 1: Add live banner to hub**

Find the hub page and locate the spot after the page header / before the first main content section. Add:

```tsx
{/* Live Center Banner — shown when active GW exists */}
{activeGW?.status === "active" && (
  <Link href={`/wm/${leagueId}/live`}
    className="flex items-center gap-2 px-4 py-3 rounded-xl"
    style={{
      background: "color-mix(in srgb, var(--color-primary) 12%, var(--bg-card))",
      border: "1px solid color-mix(in srgb, var(--color-primary) 40%, var(--color-border))",
    }}>
    <span className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ background: "var(--color-primary)" }} />
    <span className="text-xs font-black flex-1" style={{ color: "var(--color-primary)" }}>
      GW{activeGW.gameweek} läuft — Live Center →
    </span>
  </Link>
)}
```

Add `import Link from "next/link";` at the top if not already present.

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/nikoko/my-fantasy-app && node_modules/.bin/tsc --noEmit 2>&1 | tail -10
```

Expected: no output. Fix any type errors before committing.

- [ ] **Step 3: Commit**

```bash
cd /Users/nikoko/my-fantasy-app && git add \
  "app/components/wm/LiveStatusBanner.tsx" \
  "app/components/wm/LiveTickerStrip.tsx" \
  "app/components/wm/MyGWCard.tsx" \
  "app/components/wm/LiveLeaderboard.tsx" \
  "app/components/wm/FixtureStrip.tsx" \
  "app/components/wm/PlayerStatusGrid.tsx" \
  "app/components/wm/LiveEventFeed.tsx" \
  "app/wm/[id]/live/page.tsx" \
  "app/wm/[id]/page.tsx" \
  && git commit -m "feat(wm-live-center): Fantasy Live Center /wm/[id]/live

- 7 focused components in /app/components/wm/
- Live leaderboard, my points card, fixture strip, player grid, event feed
- 3 Realtime channels + 10s soft-polling fallback on disconnect
- LiveTickerStrip breaking-bar (priority: high > medium > low)
- Hub live-banner link when active GW exists
- Read-only, no writes from this page

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
