# WM Draft D2 — Stability + UX Design

**Date:** 2026-05-23  
**Status:** Approved  
**Scope:** Option B — Stability + targeted UX improvements  
**Phase:** D2 (follows D1 QA ✅)

---

## 1. Goal

Make the WM draft stable-first and noticeably more premium — without a complete redesign. The reference bar is Sleeper's draft room: clear "on the clock" moment, instant pick announcements, reliable timer, works well on mobile. No new draft modes, no audio, no pick-queue, no full component migration.

---

## 2. Current Problems Being Solved

### P0 — Correctness

| Problem | Root Cause |
|---------|------------|
| Timer drift between clients | `timeLeft` is counted down purely client-side; each browser starts independently when Realtime delivers the update |
| Timer resets on refresh | No server timestamp to anchor to — client always starts from `seconds_per_pick` |
| Bot fires from multiple tabs | `botRunningRef` is per-instance; two open tabs = two bot triggers; both hit the API |
| Silent pick failures | No user-visible feedback when pick fails (duplicate player, wrong turn, stale `current_pick`) |

### P1 — UX

| Problem | Impact |
|---------|--------|
| No "on the clock" component | User has to scan to find who's picking — confusion on mobile |
| No pick announcement moment | Picks just appear in the board with no event feeling |
| Mobile board unusable | Snake board is too wide to navigate on phone |
| No connection status | User can't tell if Realtime disconnected |
| Tap areas too small on mobile | Player rows sized for desktop hover, not touch |

---

## 3. What Is NOT In D2

The following are explicitly out of scope. Document them here so they're easy to pick up later:

- **Pick-Queue** — let users pre-queue picks; this is a separate feature requiring `wm_draft_queue` table, drag-and-drop UI, and Realtime sync. Plan as a standalone spec after D2 ships.
- **Draft Recap Page** — post-draft team overview; low urgency.
- **Sound / Audio** — no audio cues of any kind.
- **Confetti / celebratory animations** — out of scope for D2.
- **Full Snake Board Redesign** — board layout stays as-is. Mobile board UX is improved by hiding it (defaulting to list view) rather than rebuilding it.
- **New Draft Modes** — no changes to snake/linear logic.
- **Full page.tsx migration** — `page.tsx` stays the Realtime + state controller. We extract 3 presentational components but do not restructure the data-flow.

---

## 4. Architecture

### 4.1 Timer — Server-Anchored

**New DB field:**
```sql
ALTER TABLE draft_sessions
  ADD COLUMN pick_started_at TIMESTAMPTZ;
```

**How it works:**

The pick API sets `pick_started_at = NOW()` every time it increments `current_pick`. The client no longer maintains its own countdown — it calculates remaining time from the server value:

```
timeLeft = max(0, seconds_per_pick - floor((now - pick_started_at) / 1000))
```

This calculation runs in a `useEffect` that ticks every second. On reconnect or refresh, the client immediately gets the correct remaining time by reading `draftSession.pick_started_at` from the DB.

**Timer display thresholds (unchanged):**
- > 30s → green
- 10–30s → blue  
- < 10s → red + pulse animation
- 0 (unlimited) → "∞"

### 4.2 Bot Double-Trigger Prevention

**Problem:** `botRunningRef` is per browser instance. Two owner tabs → two `triggerBot()` calls → two API requests.

**Fix:** The API already has an optimistic lock (`current_pick` must match). We extend this to be fully idempotent:

```
If a draft_pick already exists for (draft_session_id, pick_number):
  → return { ok: true, nextPick: pick+1, finished: ... }  // silent success
  → do NOT return 409 / error
```

This way the second bot's API call succeeds but writes nothing new. No data corruption, no error-triggered retry loop.

Additionally: bot retry logic is narrowed — only retry on network errors (fetch failed, 5xx), not on optimistic lock mismatch or pick-already-exists.

### 4.3 Error Feedback

When a human pick fails, show a Toast with a specific message:

| API response | Toast |
|-------------|-------|
| `current_pick` mismatch | "Zu langsam — jemand anderes hat bereits gepickt" |
| Player already drafted | "Spieler bereits gedraftet — wähle einen anderen" |
| Not your turn | "Du bist gerade nicht dran" |
| Generic / 5xx | "Pick fehlgeschlagen — bitte erneut versuchen" |

Toast duration: 4s, dismissible. Uses existing `ToastProvider`.

### 4.4 Component Extraction (Minimal)

Three components extracted from `page.tsx` — purely presentational, no new logic:

**`components/wm/draft/OnTheClock.tsx`**
- Shows: Avatar/team name of picking team, timer countdown, position in round ("Pick 7 / Runde 2")
- Sticky at top on mobile (`position: sticky; top: 0`)
- Highlight if it's the current user's turn ("Du bist dran 🏆" vs. "X ist dran")
- ~80 lines

**`components/wm/draft/PickAnnouncement.tsx`**
- Overlay that appears for ~1.2s when a new pick lands (via `draftPicks.length` change)
- Shows: player photo, player name, team that picked, position badge
- Own picks: slightly larger / different accent color (not confetti — just visual weight)
- Pure CSS transition (`opacity` + `translateY`), no external library
- ~70 lines

**`components/wm/draft/DraftPlayerRow.tsx`**
- Extracted from inline JSX in `page.tsx`
- Renders a single player row: photo, name, position badge, nation flag, stats, pick button
- Tap area: min 48px height for mobile
- Props: `player`, `isPicked`, `isMyTurn`, `onPick`
- ~60 lines

### 4.5 Connection Status Badge

Supabase channels expose `.state` (`SUBSCRIBED`, `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`).

A small badge in the top-right of the draft UI reads the channel state via a `useState` updated in the `.subscribe()` callback:

- `SUBSCRIBED` → `⚡ Live` (green dot, subtle)
- anything else → `⏳ Verbinde...` (amber dot, slightly more prominent)

No auto-reconnect logic added — Supabase handles this. The badge is purely informational.

### 4.6 Mobile UX

No layout redesign. Targeted improvements only:

- **Default view:** `view` state initializes to `"list"` on mobile (`window.innerWidth < 768`), `"board"` on desktop. User can still switch manually.
- **`OnTheClock` banner:** `position: sticky; top: 0; z-index: 50` on mobile so the "who's picking" info never scrolls out of view.
- **`DraftPlayerRow` tap areas:** `min-height: 48px`, `padding: 12px 16px` — meets touch target guidelines.
- **Player filter chips:** Already horizontal scroll — no change needed.
- **Board view on mobile:** Not rebuilt. Remains available if user switches to it manually, but is not the default.

---

## 5. Data Flow

```
Human clicks player
  → pickPlayer(id) in page.tsx
  → POST /api/wm/[id]/draft/pick
    → validate (current_pick, auth, not already drafted)
    → INSERT draft_picks
    → INSERT wm_squad_players
    → UPDATE draft_sessions SET current_pick = +1, pick_started_at = NOW()
    → if finished: UPDATE leagues SET status = 'active'
  → Realtime fires → page.tsx callback
    → setDraftSession(new)
    → loadPicks()
    → if owner: triggerBot()
    → PickAnnouncement shows for 1.2s
  → Timer useEffect recalculates from pick_started_at
```

Bot flow is identical but triggered from `triggerBot()` instead of user click.

---

## 6. Database Migration

One migration file: `db/migrations/add_pick_started_at_to_draft_sessions.sql`

```sql
-- Add server-side timer anchor to draft_sessions
ALTER TABLE draft_sessions
  ADD COLUMN IF NOT EXISTS pick_started_at TIMESTAMPTZ;

-- Backfill existing active sessions with current time
-- (in practice no active sessions during migration)
UPDATE draft_sessions
  SET pick_started_at = NOW()
  WHERE pick_started_at IS NULL AND status = 'active';
```

No other schema changes.

---

## 7. Files Changed

| File | Change Type | Notes |
|------|-------------|-------|
| `db/migrations/add_pick_started_at_to_draft_sessions.sql` | New | Adds `pick_started_at` column |
| `app/api/wm/[id]/draft/pick/route.ts` | Modified | Sets `pick_started_at`, adds idempotent pick check, better error codes |
| `app/wm/[id]/draft/page.tsx` | Modified | Timer logic rewrite, import 3 new components, connection badge state, mobile view default, toast on pick failure |
| `components/wm/draft/OnTheClock.tsx` | New | "On the clock" banner, sticky on mobile |
| `components/wm/draft/PickAnnouncement.tsx` | New | Pick announcement overlay |
| `components/wm/draft/DraftPlayerRow.tsx` | New | Extracted player row, 48px touch targets |

Total: 3 new files, 3 modified files, 1 migration.

---

## 8. Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `pick_started_at` NULL for existing sessions | Low | Migration backfills active sessions; client falls back to `seconds_per_pick` if NULL |
| Timer calculation off by 1s (rounding) | Low | `Math.floor` + clamp to 0 |
| Idempotent pick breaks existing flow | Very Low | Only changes behavior when pick already exists — rare, currently errors |
| `PickAnnouncement` fires on initial load | Low | Gate on `draftPicks.length > prevLength.current`, skip on mount |
| Component extraction breaks existing layout | Low | Presentational only — no logic moved, same props as inline JSX |
| Mobile default view wrong on tablets | Low | Threshold 768px covers most cases; user can switch manually |

**Overall risk: Low–Medium**

---

## 9. Out of Scope — Future Work

### Pick-Queue (Post-D2)
User can pre-queue 2–3 picks. Requires:
- `wm_draft_queue` table: `(team_id, player_id, priority, created_at)`
- Queue panel UI component
- Auto-pick from queue when timer expires
- Realtime sync of queue (private to each user)
- Own spec and plan

### Board Mobile UX (Post-D2)  
Board view on mobile is hidden by default in D2, not rebuilt. A proper mobile board would need a horizontal scroll + condensed cell design. Low priority given list view works well.

### Draft Recap Page (Post-D2)
Post-draft screen showing each team's picks organized by position. Separate spec.

---

## 10. Success Criteria

- [ ] Timer shows identical value (±1s) across two clients
- [ ] After page refresh, timer shows correct remaining time (not full value)
- [ ] Two owner tabs do not produce duplicate picks
- [ ] Failed picks show a user-readable toast with specific reason
- [ ] `OnTheClock` correctly identifies current picker and shows timer
- [ ] `PickAnnouncement` shows for ~1.2s on every new pick, not on mount
- [ ] Mobile view defaults to list, `OnTheClock` is sticky
- [ ] `DraftPlayerRow` tap targets ≥ 48px height
- [ ] Connection badge shows `⚡ Live` when subscribed, `⏳ Verbinde...` otherwise
- [ ] TypeScript compiles without errors
- [ ] `page.tsx` line count reduced (target: ≤ 900 lines)
