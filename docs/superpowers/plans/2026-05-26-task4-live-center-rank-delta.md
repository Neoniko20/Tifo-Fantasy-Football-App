# Task 4 — Live Center: rank_delta, players_playing, wm_gameweeks Realtime

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `rank_delta` and `players_playing` for every team in the Live Leaderboard, and react to `wm_gameweeks` status changes via Realtime.

**Architecture:** All changes are inside `app/wm/[id]/live/page.tsx`. The `loadLeaderboard()` function gets 2 new params (`fixturesData`, `tid`) and 3 new Supabase queries (snapshots, all lineups, player-nation map). rank_delta = snapshotRank − currentRank. players_playing = count of a team's starting_xi whose nation is currently "live". A new Realtime clause on `wm_gameweeks` triggers a full reload when GW status changes.

**Tech Stack:** Next.js 14 App Router, Supabase JS client, TypeScript strict

---

### Task 1: Extend loadLeaderboard — new params + queries

**Files:**
- Modify: `app/wm/[id]/live/page.tsx` — `loadLeaderboard()` signature + body + call sites

- [ ] **Step 1: Update function signature**

Change the function signature from:
```typescript
async function loadLeaderboard(
  gw: number, lid: string, teams: any[], myTId: string | null
)
```
to:
```typescript
async function loadLeaderboard(
  gw: number, lid: string, teams: any[], myTId: string | null,
  fixturesData: WMFixture[], tid: string
)
```

- [ ] **Step 2: Add 3 new parallel queries inside loadLeaderboard**

After the existing `pts` and `teamsWithTotal` queries, add:
```typescript
const [snapshotsRes, allLineupsRes] = await Promise.all([
  supabase
    .from("wm_gw_rank_snapshots")
    .select("team_id, rank")
    .eq("league_id", lid)
    .eq("gameweek", gw),
  supabase
    .from("team_lineups")
    .select("team_id, starting_xi")
    .in("team_id", teamIds)
    .eq("gameweek", gw),
]);

const allPlayerIds = [
  ...new Set(
    (allLineupsRes.data ?? []).flatMap((l: any) => (l.starting_xi as number[]) ?? [])
  ),
];

let playerNationMap: Record<number, string> = {};
if (allPlayerIds.length > 0) {
  const { data: nationMappings } = await supabase
    .from("wm_player_nations")
    .select("player_id, nation_id")
    .eq("tournament_id", tid)
    .in("player_id", allPlayerIds);
  for (const nm of (nationMappings ?? [])) playerNationMap[nm.player_id] = nm.nation_id;
}
```

- [ ] **Step 3: Build derived maps**

After the existing `totals` loop, add:
```typescript
const snapshotMap: Record<string, number> = {};
for (const s of (snapshotsRes.data ?? [])) snapshotMap[s.team_id] = s.rank;

const lineupMap: Record<string, number[]> = {};
for (const l of (allLineupsRes.data ?? [])) lineupMap[l.team_id] = (l.starting_xi as number[]) ?? [];

const liveNations = new Set(
  fixturesData
    .filter((f) => f.status === "live")
    .flatMap((f) => [f.home_nation_id, f.away_nation_id])
);
```

- [ ] **Step 4: Replace the rows map to compute rank_delta and players_playing**

Replace the existing rows construction block (the `.map((t: any) => ({...}))` that sets `rank_delta: 0, players_playing: 0`) with:

```typescript
// Build unsorted rows first
const unsortedRows = (teamsWithTotal ?? []).map((t: any) => ({
  team_id:               t.id,
  team_name:             t.name,
  gw_points:             Math.round((totals[t.id] ?? 0) * 10) / 10,
  total_points:          t.total_points ?? 0,
  is_my_team:            t.id === myTId,
  has_nation_eliminated: false,
  players_total:         (lineupMap[t.id] ?? []).length || 11,
}));

// Sort to determine current live rank
const sorted = [...unsortedRows].sort((a, b) =>
  b.gw_points !== a.gw_points
    ? b.gw_points - a.gw_points
    : b.total_points - a.total_points
);

const rows: LiveTeamRow[] = sorted.map((row, idx) => {
  const currentRank  = idx + 1;
  const snapshotRank = snapshotMap[row.team_id] ?? currentRank;
  const delta        = snapshotRank - currentRank;
  const xi           = lineupMap[row.team_id] ?? [];
  const playing      = xi.filter((pid) => liveNations.has(playerNationMap[pid])).length;
  return {
    ...row,
    rank_delta:      delta,
    players_playing: playing,
    players_total:   xi.length || 11,
  };
});
setLeaderboard(rows);
```

- [ ] **Step 5: Update call sites of loadLeaderboard**

In `loadAll()`, the existing call:
```typescript
await loadLeaderboard(gw.gameweek, leagueId, teamsRes.data, myTeam?.id ?? null);
```
becomes:
```typescript
await loadLeaderboard(
  gw.gameweek, leagueId, teamsRes.data, myTeam?.id ?? null,
  (fixtureRes.data ?? []) as WMFixture[], tid
);
```

---

### Task 2: Add wm_gameweeks to Realtime subscription

**Files:**
- Modify: `app/wm/[id]/live/page.tsx` — Realtime `useEffect`

- [ ] **Step 1: Add wm_gameweeks clause to existing channel**

Inside the existing `supabase.channel("wm-live-center")` chain (after the `wm_fixtures` listener, before `.subscribe()`), add:
```typescript
.on("postgres_changes",
  { event: "*", schema: "public", table: "wm_gameweeks", filter: `tournament_id=eq.${tournamentId}` },
  () => { if (user) loadAll(user.id); }
)
```

---

### Task 3: TypeScript check + commit

**Files:**
- `app/wm/[id]/live/page.tsx` (verified)

- [ ] **Step 1: Run TypeScript check**

```bash
cd /Users/nikoko/my-fantasy-app && npx tsc --noEmit 2>&1 | head -40
```
Expected: no errors on the modified file.

- [ ] **Step 2: Commit**

```bash
git add app/wm/\[id\]/live/page.tsx
git commit -m "feat(live-center): rank_delta, players_playing, wm_gameweeks realtime"
```

---

## QA Checklist

1. Start a GW → `gameweek-start` API called → `wm_gw_rank_snapshots` populated
2. Open Live Center → all `rank_delta = 0` (snapshot equals start rank)
3. Inject a stat_update → one team gets more GW points → leaderboard re-sorts → `rank_delta` shows ▲/▼
4. Set a fixture to `live` → `players_playing > 0` for teams with players from that nation
5. Finish GW via `gameweek-finish` API → `wm_gameweeks.status = finished` → Realtime triggers `loadAll` → Live Center re-renders with final state
6. No snapshot for a team → `rank_delta = 0` (fallback: `snapshotRank ?? currentRank`)
7. No lineup for a team → `players_playing = 0` (fallback: `lineupMap[id] ?? []`)
