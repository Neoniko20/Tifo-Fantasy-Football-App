# WM Phase 2.2: Live Match Simulation

**Date:** 2026-05-15
**Status:** Approved
**Scope:** Fixture lifecycle management (scheduled → live → finished), score/penalty display, admin Spielplan-Tab

---

## Goal

Enable the full matchday cycle for WM mode:
1. Admin sets fixture scores and status via a new "Spielplan" tab in the WM admin
2. Matchday page reflects live/finished states in real time (on next load)
3. Points calculation remains a separate manual step (existing Spieltage tab — unchanged)

`wm_fixtures` is the single source of truth for match state. No parallel mock states.

---

## Architecture

```
Admin (Spielplan Tab)
  └─ PATCH /api/wm/fixtures/[fixtureId]
        ├─ auth: verify session + league ownership
        └─ writes: status, home_score, away_score, penalties_home, penalties_away
              └─ wm_fixtures (DB)
                    └─ read by: Matchday Page (no cache, direct Supabase query)
```

No intermediate state. Matchday page always reads fresh from DB on load and on GW switch.

---

## Database Migration

File: `docs/sql/wm_fixtures_add_penalties.sql`

```sql
alter table wm_fixtures
  add column if not exists penalties_home integer check (penalties_home >= 0),
  add column if not exists penalties_away integer check (penalties_away >= 0);
```

- Both columns nullable (null = no penalty shootout)
- Check constraint enforces non-negative values
- No new tables, no schema changes elsewhere

---

## API: PATCH /api/wm/fixtures/[fixtureId]

File: `app/api/wm/fixtures/[fixtureId]/route.ts`

### Auth & Authorization

1. Extract JWT from `Authorization: Bearer <token>` header
2. Call `supabase.auth.getUser(token)` — reject 401 if invalid
3. Look up fixture → get `tournament_id`
4. Look up `wm_league_settings` where `tournament_id` matches → get `league_id`
5. Look up `leagues` where `id = league_id` → check `owner_id == user.id` — reject 403 if not owner
6. Confirm fixture's `tournament_id` matches the resolved tournament — reject 404 if not found

### Input Validation

| Field | Type | Rules |
|-------|------|-------|
| `status` | string | required, one of `scheduled \| live \| finished` |
| `home_score` | integer \| null | optional, >= 0; required if `status = finished` |
| `away_score` | integer \| null | optional, >= 0; required if `status = finished` |
| `penalties_home` | integer \| null | optional, >= 0; only meaningful if status = finished |
| `penalties_away` | integer \| null | optional, >= 0 |

- `status = scheduled` → scores may be null
- `status = live` → scores optional (may be null at kickoff, updated during match)
- `status = finished` → `home_score` and `away_score` must be non-null integers

### Response

```json
{ "ok": true, "fixture": { ...updatedRow } }
```

Errors: `{ "ok": false, "error": "..." }` with appropriate HTTP status.

### Client Usage

The admin Spielplan tab calls this endpoint per fixture on "Speichern" click.
"Alle speichern" iterates only over dirty fixtures (those whose fields were changed).

---

## Admin: Spielplan Tab

File: `app/wm/[id]/admin/page.tsx`

### Tab Registration

```typescript
type AdminTab = "general" | "points" | "waiver" | "autosubs" | "nations" | "fixtures" | "debug";

{ id: "fixtures", label: "Spielplan" }  // inserted before "debug"
```

### State

```typescript
const [fixtureGW, setFixtureGW]       = useState<number>(1);
const [fixtures, setFixtures]          = useState<WMFixture[]>([]);
const [fixtureEdits, setFixtureEdits]  = useState<Record<string, Partial<WMFixture>>>({});
const [fixtureSaving, setFixtureSaving] = useState<Record<string, boolean>>({});
```

`fixtureEdits` is a map of `fixtureId → changed fields`. Only dirty records are sent on "Alle speichern".

### Data Loading

On tab activation (or GW switch): query `wm_fixtures` joined with `home_nation` and `away_nation` for the resolved `tournament_id` and selected `fixtureGW`.

### UI Layout (mobile-first, max-w-xl)

```
GW Selector: [GW1] [GW2] [GW3] ... (scrollable, same style as Spieltage tab)

Per fixture row (rounded-2xl card):
  ┌─────────────────────────────────────────┐
  │ [Heim-Nation]    vs    [Gast-Nation]    │
  │                                         │
  │ Score:  [home] : [away]                 │
  │ Elfm.:  [pen_home] : [pen_away]        │
  │                                         │
  │ Status: [Geplant] [Live] [Fertig]      │
  │                              [Speichern]│
  └─────────────────────────────────────────┘

[Alle speichern] (bottom, only if fixtureEdits has entries)
```

- Score inputs: `type="number" min="0"` width ~48px, centered
- Penalty inputs: same, below score row, greyed placeholder "–"
- Status buttons: 3-button group, active state uses `var(--color-primary)` background
- "Speichern" per row: disabled if no edits for that fixture
- "Alle speichern": iterates dirty fixtureEdits, sends PATCH per changed fixture

### Dirty-Tracking

On any field change: `setFixtureEdits(prev => ({ ...prev, [fixtureId]: { ...prev[fixtureId], [field]: value } }))`

After successful save of a fixture: remove it from `fixtureEdits` and update `fixtures` local state (no refetch needed).

---

## Matchday Page: Penalties Display

File: `app/wm/[id]/matchday/page.tsx`

### Score Display Change

Current: shows `home_score : away_score` for live/finished fixtures.

New: if `penalties_home != null`, append penalty line below score:

```
  1 : 1
(n.E. 4 : 2)
```

Implementation: in the score block of each fixture card, after the main score row:

```tsx
{(isFinished || isLive) && fixture.penalties_home != null && (
  <p className="text-[8px] text-center mt-0.5 font-black"
     style={{ color: "var(--color-muted)" }}>
    n.E. {fixture.penalties_home} : {fixture.penalties_away ?? "?"}
  </p>
)}
```

No other changes to matchday page.

---

## WMFixture Type Extension

File: `lib/wm-types.ts`

Add to `WMFixture` interface:
```typescript
penalties_home?: number | null;
penalties_away?: number | null;
```

---

## Points Flow (unchanged)

Phase 2.2 does NOT change the points calculation flow. The existing sequence remains:

1. **Spielplan Tab** — Admin sets fixture `status: finished` + scores
2. **Spieltage Tab** — Admin enters per-player stats (goals, assists, minutes…)
3. **"Punkte berechnen"** — existing button triggers `calculateWMGameweekPoints()`, upserts to `wm_gameweek_points`, updates `teams.total_points`
4. **Standings** — main league page reads `teams.total_points` on next load

No automation. No trigger. Manual separation is intentional.

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Create | `docs/sql/wm_fixtures_add_penalties.sql` | ALTER TABLE migration |
| Modify | `lib/wm-types.ts` | Add penalties fields to WMFixture |
| Create | `app/api/wm/fixtures/[fixtureId]/route.ts` | PATCH endpoint with auth |
| Modify | `app/wm/[id]/admin/page.tsx` | Add "fixtures" tab + Spielplan UI |
| Modify | `app/wm/[id]/matchday/page.tsx` | n.E. display |

---

## Test Sequence

After implementation, verify the full cycle:

```sql
-- 1. Check fixture before
SELECT id, status, home_score, away_score FROM wm_fixtures WHERE gameweek = 1 LIMIT 1;

-- 2. After admin sets Live + score 1:0
SELECT status, home_score, away_score FROM wm_fixtures WHERE id = '<id>';
-- expected: status='live', home_score=1, away_score=0

-- 3. After admin sets Finished + score 1:1 + penalties 4:2
SELECT status, home_score, away_score, penalties_home, penalties_away FROM wm_fixtures WHERE id = '<id>';
-- expected: status='finished', home_score=1, away_score=1, penalties_home=4, penalties_away=2
```

Matchday page: reload → card shows "Beendet", score "1 : 1", penalty line "n.E. 4 : 2".

---

## Constraints

- `penalties_home`/`penalties_away` are display-only. No scoring logic reads them.
- `wm_fixtures` is never written from the client directly — always via the PATCH API.
- Admin page already gates behind `isOwner` check. PATCH endpoint adds server-side re-verification.
- No mock states, no frontend-only score overrides.
