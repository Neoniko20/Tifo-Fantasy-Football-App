# WM Real Player Mapping F1-B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the WM codebase to cleanly separate test players from real API-Football players — without importing any real players.

**Architecture:** Two new DB columns (`players.is_test_player`, `players.player_source`) and one tournament-level flag (`wm_tournaments.is_test_tournament`) replace all ID-range heuristics. A central `lib/wm-player-pool.ts` utility replaces every hardcoded `.gte("id",90001).lte("id",90200)` query. Four pages are updated to remove `team_name` string-match fallbacks now that `wm_player_nations` covers all test players.

**Tech Stack:** Supabase PostgreSQL (SQL Editor), Next.js 16, TypeScript, Supabase JS v2

**No real API-Football players are imported. No Premium API required. All existing test leagues and QA scripts remain fully functional.**

---

## File Map

| Action | Path | Purpose |
|---|---|---|
| Create | `db/migrations/f1b_m01_players_test_fields.sql` | ADD is_test_player, player_source + CHECK + indexes |
| Create | `db/migrations/f1b_m02_tournaments_test_flag.sql` | ADD is_test_tournament |
| Create | `db/migrations/f1b_m03a_backfill_test_players.sql` | UPDATE players SET flags for IDs 90001–90168 |
| Modify | `db/wm_player_nations_backfill.sql` | Extend to 90001–90168, add player_source='test' guard |
| Modify | `db/wm_test_players_seed.sql` | Add is_test_player=true, player_source='test' |
| Modify | `lib/wm-types.ts` | Add is_test_tournament to WMTournament |
| Create | `lib/wm-player-pool.ts` | isTestTournament() + getWmPlayerPool() |
| Modify | `app/wm/[id]/draft/page.tsx` | Replace C-01/C-02: ID ranges → isTestTournament |
| Modify | `app/components/lineup/MarketTab.tsx` | Replace C-03/C-04: hasTestPlayers → isTestTournament |
| Modify | `app/wm/[id]/waiver/page.tsx` | Remove C-05: team_name fallback in isEliminated |
| Modify | `app/wm/[id]/lineup/page.tsx` | Remove C-06: team_name fallback in isEliminated |
| Modify | `app/wm/[id]/admin/page.tsx` | Remove C-07/C-08: team_name fallbacks |

---

## Task 1: Create migration M-01 — players test fields

**Files:**
- Create: `db/migrations/f1b_m01_players_test_fields.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- F1-B M-01: Add is_test_player and player_source to players table
-- Safe to run multiple times (IF NOT EXISTS / idempotent).
-- After this migration, run M-03a to backfill existing test players.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS is_test_player BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS player_source  TEXT    NOT NULL DEFAULT 'api_football'
    CONSTRAINT players_source_check
    CHECK (player_source IN ('api_football', 'test', 'manual'));

CREATE INDEX IF NOT EXISTS idx_players_is_test ON players (is_test_player);
CREATE INDEX IF NOT EXISTS idx_players_source  ON players (player_source);
```

- [ ] **Step 2: Execute in Supabase SQL Editor**

Open the Supabase project → SQL Editor → paste the file content → Run.

Expected: no errors, `players` table gains two new columns with default values.

Verify:
```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'players'
  AND column_name IN ('is_test_player', 'player_source');
```
Expected: 2 rows. `is_test_player` = `boolean`, default `false`. `player_source` = `text`, default `'api_football'`.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/f1b_m01_players_test_fields.sql
git commit -m "feat(db): add is_test_player and player_source to players"
```

---

## Task 2: Create migration M-02 — tournaments test flag

**Files:**
- Create: `db/migrations/f1b_m02_tournaments_test_flag.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- F1-B M-02: Add is_test_tournament to wm_tournaments table
-- Default false: all existing tournaments start as real (non-test).
-- Mark existing test tournaments manually after running this (see Task 8).

ALTER TABLE wm_tournaments
  ADD COLUMN IF NOT EXISTS is_test_tournament BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 2: Execute in Supabase SQL Editor**

Expected: no errors.

Verify:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'wm_tournaments'
  AND column_name = 'is_test_tournament';
```
Expected: 1 row, `boolean`, default `false`.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/f1b_m02_tournaments_test_flag.sql
git commit -m "feat(db): add is_test_tournament to wm_tournaments"
```

---

## Task 3: Create migration M-03a — backfill test players

**Files:**
- Create: `db/migrations/f1b_m03a_backfill_test_players.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- F1-B M-03a: Backfill is_test_player and player_source for existing test players.
-- Uses ID range 90001–90168 — THIS IS THE LAST LEGITIMATE USE OF THIS RANGE.
-- After this runs, all queries must use is_test_player flag, never ID ranges.
-- Idempotent: WHERE clause prevents double-update.

UPDATE players
SET
  is_test_player = true,
  player_source  = 'test'
WHERE id BETWEEN 90001 AND 90168
  AND is_test_player = false;
```

- [ ] **Step 2: Execute in Supabase SQL Editor**

Expected: no errors.

Verify:
```sql
SELECT
  COUNT(*)                                        AS total,
  COUNT(*) FILTER (WHERE is_test_player = true)   AS flagged_true,
  COUNT(*) FILTER (WHERE player_source = 'test')  AS source_test,
  COUNT(*) FILTER (WHERE is_test_player = false)  AS still_false
FROM players
WHERE id BETWEEN 90001 AND 90168;
```
Expected: `total` = 168, `flagged_true` = 168, `source_test` = 168, `still_false` = 0.

Also verify no real players were accidentally flagged:
```sql
SELECT COUNT(*) FROM players
WHERE is_test_player = true AND id NOT BETWEEN 90001 AND 90168;
```
Expected: 0.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/f1b_m03a_backfill_test_players.sql
git commit -m "feat(db): backfill is_test_player for test players 90001-90168"
```

---

## Task 4: Update wm_player_nations_backfill.sql

The existing backfill only covers IDs 90001–90120 and uses an ID range. Update it to cover all 168 test players and use the new `player_source` flag.

**Files:**
- Modify: `db/wm_player_nations_backfill.sql`

- [ ] **Step 1: Update the backfill SQL**

Replace the entire file content with:

```sql
-- ═══════════════════════════════════════════════════════════════════
-- WM PLAYER NATIONS BACKFILL FOR TEST PLAYERS
-- Purpose: Populate wm_player_nations for all test players
-- Prerequisite: M-03a must have run (is_test_player/player_source set)
-- Previously covered only 90001-90120; now covers all player_source='test'
-- Idempotent: ON CONFLICT DO NOTHING — safe to run multiple times
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO wm_player_nations (tournament_id, player_id, nation_id)
SELECT DISTINCT
  n.tournament_id,
  p.id          AS player_id,
  n.id          AS nation_id
FROM players p
JOIN wm_nations n ON n.name = p.team_name
WHERE p.player_source = 'test'          -- replaces: id BETWEEN 90001 AND 90120
ON CONFLICT (tournament_id, player_id) DO NOTHING;
```

- [ ] **Step 2: Execute in Supabase SQL Editor**

Verify after running:
```sql
-- Every test player should have a wm_player_nations entry for each tournament
SELECT
  COUNT(DISTINCT p.id)  AS test_players_total,
  COUNT(pn.player_id)   AS players_with_nation_mapping
FROM players p
LEFT JOIN wm_player_nations pn ON pn.player_id = p.id
WHERE p.player_source = 'test'
GROUP BY 1;
```
Expected: `players_with_nation_mapping` ≥ `test_players_total` (each player may appear in multiple tournaments).

Also check for any test players missing a mapping:
```sql
SELECT p.id, p.name, p.team_name
FROM players p
WHERE p.player_source = 'test'
  AND p.id NOT IN (SELECT player_id FROM wm_player_nations);
```
Expected: 0 rows. If any appear, check that `wm_nations.name` matches `players.team_name` exactly.

- [ ] **Step 3: Commit**

```bash
git add db/wm_player_nations_backfill.sql
git commit -m "fix(db): extend wm_player_nations backfill to all test players"
```

---

## Task 5: Update wm_test_players_seed.sql

The seed must be idempotent after M-01. Add the two new columns so re-seeding from scratch always produces correctly flagged rows.

**Files:**
- Modify: `db/wm_test_players_seed.sql`

- [ ] **Step 1: Update the INSERT statement header**

Find this line in `db/wm_test_players_seed.sql` (line 10):
```sql
INSERT INTO players (id, name, position, team_name, nationality, photo_url, api_team_id, rating, fpts, goals, assists)
```

Replace with:
```sql
INSERT INTO players (id, name, position, team_name, nationality, photo_url, api_team_id, rating, fpts, goals, assists, is_test_player, player_source)
```

- [ ] **Step 2: Update each VALUES row**

Every row currently ends with a number like `, 0, 1),`. Add `, true, 'test'` before the closing paren on every row.

For example, change:
```sql
  (90001, 'WM Test GK 1 (GER)',  'GK', 'Germany',      'German',      NULL, NULL, 7.2,  54.0,  0, 1),
```
To:
```sql
  (90001, 'WM Test GK 1 (GER)',  'GK', 'Germany',      'German',      NULL, NULL, 7.2,  54.0,  0, 1, true, 'test'),
```

Do this for all 168 rows (90001–90168).

- [ ] **Step 3: Update the ON CONFLICT clause**

Find at the end of the file:
```sql
ON CONFLICT (id) DO NOTHING;
```

Replace with:
```sql
ON CONFLICT (id) DO UPDATE SET
  is_test_player = true,
  player_source  = 'test';
```

This ensures re-running the seed also fixes any rows that were previously missing the flags.

- [ ] **Step 4: Update the header comment**

Find at line 7:
```
-- IDs: 90001-90120 (reservierter Test-Bereich, kein Konflikt mit API-Daten)
```

Replace with:
```
-- IDs: 90001-90168 (reservierter Test-Bereich)
-- WICHTIG: ID-Range ist kein Sicherheits-Guard mehr. Schutz läuft über
--          is_test_player=true und player_source='test'.
```

- [ ] **Step 5: Verify the seed is still idempotent**

Run it in Supabase SQL Editor. Expected: no errors, all 168 rows updated/inserted.

```sql
SELECT COUNT(*), COUNT(*) FILTER (WHERE is_test_player = true), COUNT(*) FILTER (WHERE player_source = 'test')
FROM players WHERE id BETWEEN 90001 AND 90168;
```
Expected: 168 / 168 / 168.

- [ ] **Step 6: Commit**

```bash
git add db/wm_test_players_seed.sql
git commit -m "fix(db): add is_test_player and player_source to test player seed"
```

---

## Task 6: Update WMTournament type

**Files:**
- Modify: `lib/wm-types.ts`

- [ ] **Step 1: Add is_test_tournament to WMTournament interface**

Open `lib/wm-types.ts`. Find the `WMTournament` interface (lines 12–20):

```typescript
export interface WMTournament {
  id: string;
  name: string;
  season: number;
  api_league_id?: number;
  start_date: string;
  end_date: string;
  status: WMStatus;
}
```

Replace with:

```typescript
export interface WMTournament {
  id: string;
  name: string;
  season: number;
  api_league_id?: number;
  start_date: string;
  end_date: string;
  status: WMStatus;
  is_test_tournament: boolean;
}
```

- [ ] **Step 2: Verify TypeScript still compiles**

```bash
cd /Users/nikoko/my-fantasy-app && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors related to `WMTournament`. Any pre-existing errors are acceptable.

- [ ] **Step 3: Commit**

```bash
git add lib/wm-types.ts
git commit -m "feat(types): add is_test_tournament to WMTournament"
```

---

## Task 7: Create lib/wm-player-pool.ts

This is the central utility that replaces all ID-range test checks. Both `draft/page.tsx` and `MarketTab.tsx` will import from here.

**Files:**
- Create: `lib/wm-player-pool.ts`

- [ ] **Step 1: Write the file**

```typescript
// ═══════════════════════════════════════════════════════════════════
// TIFO — WM PLAYER POOL UTILITIES
// Replaces all .gte("id",90001).lte("id",90200) test-mode checks.
// Single source of truth for player pool scoping by tournament type.
// ═══════════════════════════════════════════════════════════════════

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns whether a tournament uses test players.
 *
 * Replaces: supabase.from("players").select("id").gte("id",90001).lte("id",90120).limit(1)
 *
 * Test tournament  → true  → pool: players WHERE is_test_player = true
 * Real tournament  → false → pool: players WHERE is_test_player = false
 */
export async function isTestTournament(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("wm_tournaments")
    .select("is_test_tournament")
    .eq("id", tournamentId)
    .single();
  return data?.is_test_tournament ?? false;
}

/**
 * Returns the player pool for a WM tournament filtered by tournament type.
 *
 * - Test tournament  → only players WHERE is_test_player = true
 * - Real tournament  → only players WHERE is_test_player = false
 *
 * Replaces: if (hasTestPlayers) query.gte("id",90001).lte("id",90200).in("team_name", ...)
 *
 * @param nationNames  Optional array of nation names to filter by (team_name).
 *                     Pass undefined or [] to skip nation filter.
 * @param extraSelect  Optional Supabase select string. Defaults to "*".
 */
export async function getWmPlayerPool(
  supabase: SupabaseClient,
  tournamentId: string,
  options: {
    nationNames?: string[];
    position?: string;
    select?: string;
    orderBy?: { column: string; ascending: boolean };
    limit?: number;
  } = {},
): Promise<Array<Record<string, unknown>>> {
  const testFlag = await isTestTournament(supabase, tournamentId);

  let query = supabase
    .from("players")
    .select(options.select ?? "*")
    .eq("is_test_player", testFlag);

  if (options.nationNames && options.nationNames.length > 0) {
    query = query.in("team_name", options.nationNames);
  }
  if (options.position) {
    query = query.eq("position", options.position);
  }

  const col = options.orderBy?.column ?? "fpts";
  const asc = options.orderBy?.ascending ?? false;
  query = query.order(col, { ascending: asc, nullsFirst: false });

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data } = await query;
  return (data ?? []) as Array<Record<string, unknown>>;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/nikoko/my-fantasy-app && npx tsc --noEmit 2>&1 | grep "wm-player-pool" | head -10
```

Expected: no errors referencing `wm-player-pool.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/wm-player-pool.ts
git commit -m "feat(lib): add wm-player-pool utility — replaces ID-range test checks"
```

---

## Task 8: Fix draft/page.tsx — C-01 and C-02

Replace the two ID-range blocks (lines 233–248) with `isTestTournament` from the new lib.

**Files:**
- Modify: `app/wm/[id]/draft/page.tsx`

- [ ] **Step 1: Add the import**

At the top of `app/wm/[id]/draft/page.tsx`, find the existing imports and add:

```typescript
import { isTestTournament } from "@/lib/wm-player-pool";
```

- [ ] **Step 2: Replace the test-check block in loadPlayers()**

Find this block (lines 233–248):

```typescript
    // 2. Prüfen ob Testspieler (IDs 90001–90120) existieren.
    // Wenn ja, nur diese laden — verhindert dass Club-Spieler mit nationalem
    // team_name (z.B. Salah/Egypt, Palmer/England) im Draft-Pool auftauchen.
    const { data: testCheck } = await supabase
      .from("players")
      .select("id")
      .gte("id", 90001)
      .lte("id", 90120)
      .limit(1);

    let query = supabase.from("players").select("*").order("fpts", { ascending: false });
    if (testCheck && testCheck.length > 0) {
      query = query.gte("id", 90001).lte("id", 90200).in("team_name", nationNames);
    } else {
      query = query.in("team_name", nationNames);
    }
```

Replace with:

```typescript
    // 2. Player-Pool nach Tournament-Typ filtern.
    // Test-Tournament → is_test_player=true, Real-Tournament → is_test_player=false.
    // Keine ID-Range-Filter. Schutz läuft über is_test_player Flag.
    const testFlag = await isTestTournament(supabase, settingsData.tournament_id);

    let query = supabase
      .from("players")
      .select("*")
      .eq("is_test_player", testFlag)
      .in("team_name", nationNames)
      .order("fpts", { ascending: false });
```

- [ ] **Step 3: Verify no remaining ID-range filters in draft/page.tsx**

```bash
grep -n "gte.*90001\|lte.*90120\|lte.*90200\|BETWEEN 90" /Users/nikoko/my-fantasy-app/app/wm/[id]/draft/page.tsx
```

Expected: no output.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/nikoko/my-fantasy-app && npx tsc --noEmit 2>&1 | grep "draft/page" | head -10
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add "app/wm/[id]/draft/page.tsx"
git commit -m "fix(draft): replace ID-range test check with is_test_player flag"
```

---

## Task 9: Fix MarketTab.tsx — C-03 and C-04

Replace `hasTestPlayers` with `isTestTournament` in `app/components/lineup/MarketTab.tsx`.

**Files:**
- Modify: `app/components/lineup/MarketTab.tsx`

- [ ] **Step 1: Add the import**

At the top of `app/components/lineup/MarketTab.tsx`, add:

```typescript
import { isTestTournament } from "@/lib/wm-player-pool";
```

- [ ] **Step 2: Update the wmMode ref type (line 132)**

Find:
```typescript
  const wmMode    = useRef<{ nationNames: string[]; hasTestPlayers: boolean } | null>(null);
```

Replace with:
```typescript
  const wmMode    = useRef<{ nationNames: string[]; isTestTournament: boolean } | null>(null);
```

- [ ] **Step 3: Replace the test-check in init() (lines 176–184)**

Find:
```typescript
        const [nationsRes, testCheckRes] = await Promise.all([
          supabase.from("wm_nations").select("name").eq("tournament_id", wmSettings.tournament_id),
          supabase.from("players").select("id").gte("id", 90001).lte("id", 90120).limit(1),
        ]);
        const nationNames = (nationsRes.data ?? []).map((n: any) => n.name as string);
        wmMode.current = {
          nationNames,
          hasTestPlayers: (testCheckRes.data?.length ?? 0) > 0,
        };
```

Replace with:
```typescript
        const [nationsRes, testFlag] = await Promise.all([
          supabase.from("wm_nations").select("name").eq("tournament_id", wmSettings.tournament_id),
          isTestTournament(supabase, wmSettings.tournament_id),
        ]);
        const nationNames = (nationsRes.data ?? []).map((n: any) => n.name as string);
        wmMode.current = {
          nationNames,
          isTestTournament: testFlag,
        };
```

- [ ] **Step 4: Replace the query filter (lines 290–296)**

Find:
```typescript
    // WM-Filter: nur Spieler passender Nationen, im Testbetrieb nur IDs 90001–90200
    if (wmMode.current) {
      const { nationNames, hasTestPlayers } = wmMode.current;
      if (hasTestPlayers) {
        query = query.gte("id", 90001).lte("id", 90200).in("team_name", nationNames);
      } else {
        query = query.in("team_name", nationNames);
      }
    }
```

Replace with:
```typescript
    // WM-Filter: nur Spieler passender Nationen, gefiltert nach Tournament-Typ.
    // is_test_player=true für Test-Turniere, false für echte Turniere.
    if (wmMode.current) {
      const { nationNames, isTestTournament: testFlag } = wmMode.current;
      query = query.eq("is_test_player", testFlag).in("team_name", nationNames);
    }
```

- [ ] **Step 5: Verify no remaining ID-range filters in MarketTab.tsx**

```bash
grep -n "gte.*90001\|lte.*90120\|lte.*90200\|hasTestPlayers" /Users/nikoko/my-fantasy-app/app/components/lineup/MarketTab.tsx
```

Expected: no output.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /Users/nikoko/my-fantasy-app && npx tsc --noEmit 2>&1 | grep "MarketTab" | head -10
```

Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add app/components/lineup/MarketTab.tsx
git commit -m "fix(market): replace ID-range test check with is_test_player flag"
```

---

## Task 10: Fix waiver/page.tsx — C-05

Remove the `team_name` string-match fallback in `isEliminated()`. The `playerNationMap` is already populated via `wm_player_nations` — the fallback is now dead code after M-03a.

**Files:**
- Modify: `app/wm/[id]/waiver/page.tsx`

- [ ] **Step 1: Remove the team_name fallback (lines 245–248)**

Find in `isEliminated()`:
```typescript
    // TODO remove fallback after real WM player import
    const nation = nations.find(n => n.name === player.team_name);
    if (!nation?.eliminated_after_gameweek) return false;
    return currentGW > nation.eliminated_after_gameweek;
```

Replace with:
```typescript
    // No team_name fallback: all players have wm_player_nations entries after M-03a.
    return false;
```

The full `isEliminated()` function after the change:
```typescript
  function isEliminated(player: any): boolean {
    if (player.id in playerNationMap) {
      const mapped = playerNationMap[player.id];
      if (!mapped?.eliminated_after_gameweek) return false;
      return currentGW > mapped.eliminated_after_gameweek;
    }
    // No team_name fallback: all players have wm_player_nations entries after M-03a.
    return false;
  }
```

- [ ] **Step 2: Verify no team_name nation lookup in isEliminated**

```bash
grep -n "nations.find.*team_name\|team_name.*nations.find" /Users/nikoko/my-fantasy-app/app/wm/[id]/waiver/page.tsx
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "app/wm/[id]/waiver/page.tsx"
git commit -m "fix(waiver): remove team_name fallback in isEliminated"
```

---

## Task 11: Fix lineup/page.tsx — C-06

Same pattern as waiver: `playerNationMap` already uses `wm_player_nations`, the `team_name` fallback is dead after M-03a.

**Files:**
- Modify: `app/wm/[id]/lineup/page.tsx`

- [ ] **Step 1: Remove the team_name fallback (lines 226–229)**

Find in `isEliminated()`:
```typescript
    // TODO remove fallback after real WM player import
    const nation = nations.find(n => n.name === player.team_name);
    if (!nation?.eliminated_after_gameweek) return false;
    return gameweek > nation.eliminated_after_gameweek;
```

Replace with:
```typescript
    // No team_name fallback: all players have wm_player_nations entries after M-03a.
    return false;
```

The full `isEliminated()` function after the change:
```typescript
  function isEliminated(player: Player): boolean {
    if (player.id in playerNationMap) {
      const mapped = playerNationMap[player.id];
      if (!mapped?.eliminated_after_gameweek) return false;
      return gameweek > mapped.eliminated_after_gameweek;
    }
    // No team_name fallback: all players have wm_player_nations entries after M-03a.
    return false;
  }
```

- [ ] **Step 2: Verify**

```bash
grep -n "nations.find.*team_name\|team_name.*nations.find" /Users/nikoko/my-fantasy-app/app/wm/[id]/lineup/page.tsx
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "app/wm/[id]/lineup/page.tsx"
git commit -m "fix(lineup): remove team_name fallback in isEliminated"
```

---

## Task 12: Fix admin/page.tsx — C-07 and C-08

Two identical fallbacks in `admin/page.tsx` — both already have a `playerNationMap` primary path.

**Files:**
- Modify: `app/wm/[id]/admin/page.tsx`

- [ ] **Step 1: Fix C-07 (line 395)**

Find:
```typescript
          // FK-based lookup; falls back to string match for pre-migration players
          const playerNation = (playerId in playerNationMap)
            ? playerNationMap[playerId]
            : nations.find(n => n.name === player.team_name) // TODO remove fallback after real WM player import
              ?? null;
```

Replace with:
```typescript
          const playerNation = playerNationMap[playerId] ?? null;
```

- [ ] **Step 2: Fix C-08 (line 1275)**

Find:
```typescript
              const nation = (player_id in playerNationMap)
                ? playerNationMap[player_id]
                : nations.find(n => n.name === p.team_name) // TODO remove fallback after real WM player import
                  ?? null;
```

Replace with:
```typescript
              const nation = playerNationMap[player_id] ?? null;
```

- [ ] **Step 3: Verify no remaining TODO fallbacks in admin page**

```bash
grep -n "TODO remove fallback\|nations.find.*team_name" /Users/nikoko/my-fantasy-app/app/wm/[id]/admin/page.tsx
```

Expected: no output.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/nikoko/my-fantasy-app && npx tsc --noEmit 2>&1 | grep "admin/page" | head -10
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add "app/wm/[id]/admin/page.tsx"
git commit -m "fix(admin): remove team_name fallbacks in points calc and squad display"
```

---

## Task 13: Manual step M-03b — mark test tournaments

This step cannot be automated — it requires identifying which existing `wm_tournaments` rows are test tournaments.

**Files:** None (Supabase SQL Editor only)

- [ ] **Step 1: List all existing tournaments**

Run in Supabase SQL Editor:
```sql
SELECT id, name, season, status, is_test_tournament
FROM wm_tournaments
ORDER BY created_at;
```

- [ ] **Step 2: Identify test tournaments**

Any tournament whose leagues use test players (IDs 90001–90168) must be marked. Cross-reference:
```sql
SELECT DISTINCT
  t.id,
  t.name,
  t.is_test_tournament,
  COUNT(DISTINCT sp.player_id) AS test_players_in_squads
FROM wm_tournaments t
JOIN wm_league_settings wls ON wls.tournament_id = t.id
JOIN wm_squad_players sp ON sp.tournament_id = t.id
JOIN players p ON p.id = sp.player_id AND p.player_source = 'test'
GROUP BY t.id, t.name, t.is_test_tournament
ORDER BY t.name;
```

Any tournament with `test_players_in_squads > 0` is a test tournament.

- [ ] **Step 3: Mark test tournaments**

For each test tournament identified, run:
```sql
UPDATE wm_tournaments
SET is_test_tournament = true
WHERE id = '<tournament-uuid>';
```

- [ ] **Step 4: Verify the split is clean**

```sql
SELECT
  is_test_tournament,
  COUNT(*) AS tournament_count,
  STRING_AGG(name, ', ' ORDER BY name) AS names
FROM wm_tournaments
GROUP BY is_test_tournament;
```

Expected: at least one `true` row (existing test tournament) and optionally `false` rows.

Also verify no real players appear in test tournaments:
```sql
SELECT COUNT(*) FROM wm_squad_players sp
JOIN wm_league_settings wls ON wls.league_id = sp.league_id
JOIN wm_tournaments t ON t.id = wls.tournament_id
JOIN players p ON p.id = sp.player_id
WHERE t.is_test_tournament = true AND p.is_test_player = false;
```
Expected: 0.

---

## Task 14: Full QA verification

Run all existing QA scripts and verify the player pool separation works end-to-end.

**Files:** None (verification only)

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/nikoko/my-fantasy-app && npm run dev
```

Wait for `ready - started server on http://localhost:3000`.

- [ ] **Step 2: Verify no ID-range filters remain anywhere**

```bash
grep -rn "gte.*90001\|lte.*90120\|lte.*90200\|BETWEEN 90001\|hasTestPlayers" \
  /Users/nikoko/my-fantasy-app/app/ \
  /Users/nikoko/my-fantasy-app/lib/ \
  --include="*.ts" --include="*.tsx"
```

Expected: **no output**. Any match is a regression — fix before continuing.

- [ ] **Step 3: Verify no TODO team_name fallbacks remain**

```bash
grep -rn "TODO remove fallback after real WM player import" \
  /Users/nikoko/my-fantasy-app/app/ \
  --include="*.tsx"
```

Expected: **no output**.

- [ ] **Step 4: Run E2E test script (test tournament)**

```bash
cd /Users/nikoko/my-fantasy-app && node scripts/qa-e2e-tournament.js 2>&1 | tail -20
```

Expected: all checks pass (33/33 or similar). The test tournament must still use test players.

- [ ] **Step 5: Verify test player pool in test tournament via SQL**

```sql
-- Test tournament should only show is_test_player=true players
SELECT t.name AS tournament, t.is_test_tournament, COUNT(pn.player_id) AS pooled_players,
       COUNT(*) FILTER (WHERE p.is_test_player = true)  AS test_players,
       COUNT(*) FILTER (WHERE p.is_test_player = false) AS real_players
FROM wm_tournaments t
JOIN wm_player_nations pn ON pn.tournament_id = t.id
JOIN players p ON p.id = pn.player_id
GROUP BY t.id, t.name, t.is_test_tournament
ORDER BY t.is_test_tournament DESC;
```

Expected: `is_test_tournament=true` rows have `real_players = 0`.

- [ ] **Step 6: Verify player pool API for test tournament**

Open browser → navigate to a test WM league draft page.
- Confirm test players appear (names like "WM Test GK 1 (GER)")
- Confirm no Liga players appear (no "Salah", "Palmer" etc.)
- Open browser DevTools → Network → find the players fetch → confirm response has `is_test_player: true`

- [ ] **Step 7: Final commit and tag**

```bash
git add -A
git status  # confirm only already-tracked files
git commit -m "chore(wm-f1b): QA verified — player pool separation complete"
```

---

## Rollback Procedure

If anything goes wrong after Task 3 (M-03a backfill):

```sql
-- Revert player flags (M-03a rollback):
UPDATE players
SET is_test_player = false, player_source = 'api_football'
WHERE id BETWEEN 90001 AND 90168;

-- Revert M-02:
ALTER TABLE wm_tournaments DROP COLUMN IF EXISTS is_test_tournament;

-- Revert M-01:
ALTER TABLE players DROP COLUMN IF EXISTS is_test_player;
ALTER TABLE players DROP COLUMN IF EXISTS player_source;
```

Code rollback: `git revert` each commit individually in reverse order, or `git reset --hard <sha-before-task-1>`.

---

## Completion Checklist

- [ ] M-01 executed: `players.is_test_player` + `players.player_source` exist
- [ ] M-02 executed: `wm_tournaments.is_test_tournament` exists
- [ ] M-03a executed: all 168 test players flagged
- [ ] `wm_player_nations` backfill covers all 168 test players
- [ ] `wm_test_players_seed.sql` includes new columns
- [ ] `WMTournament` type includes `is_test_tournament`
- [ ] `lib/wm-player-pool.ts` created with `isTestTournament` + `getWmPlayerPool`
- [ ] `draft/page.tsx` C-01/C-02 replaced
- [ ] `MarketTab.tsx` C-03/C-04 replaced
- [ ] `waiver/page.tsx` C-05 removed
- [ ] `lineup/page.tsx` C-06 removed
- [ ] `admin/page.tsx` C-07/C-08 removed
- [ ] M-03b: existing test tournaments manually marked `is_test_tournament=true`
- [ ] `grep` for ID-range filters returns empty
- [ ] `grep` for TODO fallbacks returns empty
- [ ] E2E test suite passes
- [ ] Test tournament shows only test players
