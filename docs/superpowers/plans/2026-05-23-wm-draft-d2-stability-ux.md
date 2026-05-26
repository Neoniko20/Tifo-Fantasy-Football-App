# WM Draft D2 — Stability + UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the WM draft with server-anchored timer and bot-safety fixes, then add targeted UX improvements (OnTheClock banner, PickAnnouncement overlay, DraftPlayerRow component, connection status, mobile defaults).

**Architecture:** DB gains `pick_started_at`; the pick API sets it on every advance; the client calculates `timeLeft = Date.now() - pick_started_at` on a 1s tick instead of accumulating a countdown. Three new presentational components are extracted from the 1078-line `page.tsx` without changing data-flow. Connection state is tracked via Supabase channel subscription callback and gates pick buttons when disconnected.

**Tech Stack:** Next.js 15 (App Router), Supabase (Realtime + postgres_changes), TypeScript, React 18, Tailwind + inline CSS vars (`var(--color-primary)` etc.), `PlayerCard` component

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `db/migrations/add_pick_started_at_to_draft_sessions.sql` | Create | Adds `pick_started_at TIMESTAMPTZ` column |
| `app/api/wm/[id]/draft/pick/route.ts` | Modify | Sets `pick_started_at`, idempotent slot check, user-friendly error messages |
| `app/wm/[id]/draft/page.tsx` | Modify | Timer rewrite, new state/refs, component wiring, connection tracking, mobile default, bot retry fix |
| `components/wm/draft/OnTheClock.tsx` | Create | "Who's picking" banner with timer; sticky on mobile |
| `components/wm/draft/PickAnnouncement.tsx` | Create | Pick overlay (1.2s), fires only on genuine new picks post-mount |
| `components/wm/draft/DraftPlayerRow.tsx` | Create | Extracted player row, 48px touch targets, disabled when disconnected |

---

## Task 1: DB Migration — add `pick_started_at`

**Files:**
- Create: `db/migrations/add_pick_started_at_to_draft_sessions.sql`

- [ ] **Step 1.1: Write migration file**

Create `db/migrations/add_pick_started_at_to_draft_sessions.sql`:

```sql
-- D2: Add server-side timer anchor to draft_sessions.
-- The pick API sets this to NOW() on every current_pick increment.
-- Clients calculate timeLeft = seconds_per_pick - (Date.now() - pick_started_at)
-- instead of running a local countdown, eliminating timer drift and refresh-reset.
ALTER TABLE draft_sessions
  ADD COLUMN IF NOT EXISTS pick_started_at TIMESTAMPTZ;
```

- [ ] **Step 1.2: Apply migration to local database**

```bash
cd /Users/nikoko/my-fantasy-app
supabase db push
```

Expected output: migration applied without errors. If `supabase db push` is not available, run directly:

```bash
psql "$DATABASE_URL" -f db/migrations/add_pick_started_at_to_draft_sessions.sql
```

- [ ] **Step 1.3: Verify column exists**

```bash
psql "$DATABASE_URL" -c "\d draft_sessions" | grep pick_started_at
```

Expected: a line like `pick_started_at | timestamp with time zone | ...`

- [ ] **Step 1.4: Commit**

```bash
git add db/migrations/add_pick_started_at_to_draft_sessions.sql
git commit -m "fix(db): add pick_started_at to draft_sessions for server-anchored timer"
```

---

## Task 2: Pick API — Idempotency + `pick_started_at` + User-Friendly Errors

**Files:**
- Modify: `app/api/wm/[id]/draft/pick/route.ts`

Three changes in a single edit:
1. User-friendly error messages (lines ~99, ~112, ~131)
2. Idempotent slot check after the optimistic lock (after line ~135)
3. Set `pick_started_at` in the `draft_sessions` update (line ~191)

- [ ] **Step 2.1: Update error message — "not your team" (line 99)**

Find:
```typescript
  if (!isOwner && pickingTeam.id !== userTeam?.id) {
    return NextResponse.json({ error: "Nicht dein Team" }, { status: 403 });
  }
```

Replace with:
```typescript
  if (!isOwner && pickingTeam.id !== userTeam?.id) {
    return NextResponse.json({ error: "Du bist gerade nicht dran" }, { status: 403 });
  }
```

- [ ] **Step 2.2: Update error message — player already drafted (lines 110–114)**

Find:
```typescript
  if (existingPick) {
    return NextResponse.json(
      { error: "Spieler bereits in dieser WM-Liga gedraftet" },
      { status: 409 },
    );
  }
```

Replace with:
```typescript
  if (existingPick) {
    return NextResponse.json(
      { error: "Spieler bereits gedraftet — wähle einen anderen" },
      { status: 409 },
    );
  }
```

- [ ] **Step 2.3: Update error message — optimistic lock mismatch (lines 130–135)**

Find:
```typescript
  // Optimistic-Lock: Pick-Nummer muss stimmen
  if (session.current_pick !== pick) {
    return NextResponse.json(
      { error: `Pick-Nummer veraltet (erwartet ${session.current_pick}, erhalten ${pick})` },
      { status: 409 },
    );
  }
```

Replace with:
```typescript
  // Optimistic-Lock: Pick-Nummer muss stimmen
  if (session.current_pick !== pick) {
    return NextResponse.json(
      { error: "Zu langsam — dieser Slot wurde bereits vergeben" },
      { status: 409 },
    );
  }
```

- [ ] **Step 2.4: Add idempotent slot check (after the optimistic lock block, before line ~137)**

After the optimistic lock block, add this new block (insert between the optimistic lock check and the `// ── 7. WM-Turnier-ID auflösen` comment):

```typescript
  // ── 6b. Idempotency: if this pick slot already exists, return success silently.
  // Prevents duplicate DB writes when two browser tabs call triggerBot() simultaneously.
  const { data: existingSlotPick } = await supabase
    .from("draft_picks")
    .select("id")
    .eq("draft_session_id", session.id)
    .eq("pick_number", pick)
    .maybeSingle();

  if (existingSlotPick) {
    const nextPick = pick + 1;
    const finished = nextPick >= session.total_picks;
    return NextResponse.json({ ok: true, nextPick, finished });
  }
```

- [ ] **Step 2.5: Set `pick_started_at` in the draft_sessions update (line ~191)**

Find:
```typescript
  await supabase
    .from("draft_sessions")
    .update({ current_pick: nextPick, status: newStatus })
    .eq("id", session.id);
```

Replace with:
```typescript
  await supabase
    .from("draft_sessions")
    .update({
      current_pick: nextPick,
      status: newStatus,
      pick_started_at: finished ? null : new Date().toISOString(),
    })
    .eq("id", session.id);
```

- [ ] **Step 2.6: Verify TypeScript compiles**

```bash
cd /Users/nikoko/my-fantasy-app
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (or only pre-existing unrelated errors).

- [ ] **Step 2.7: Commit**

```bash
git add app/api/wm/\[id\]/draft/pick/route.ts
git commit -m "fix(draft-api): idempotent picks, pick_started_at, user-friendly errors"
```

---

## Task 3: Timer Logic Rewrite — Server-Anchored

**Files:**
- Modify: `app/wm/[id]/draft/page.tsx` (lines 351–363)

Replace the old accumulated-countdown `useEffect` with a `Date.now() - pick_started_at` calculation.

- [ ] **Step 3.1: Replace timer useEffect (lines 351–363)**

Find this block:
```typescript
  useEffect(() => {
    if (!draftSession || draftSession.status !== "active") return;
    const secs = draftSession.seconds_per_pick || 0;
    if (secs === 0) { setTimeLeft(0); return; }
    setTimeLeft(secs);
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [draftSession?.current_pick, draftSession?.status]);
```

Replace with:
```typescript
  useEffect(() => {
    if (!draftSession || draftSession.status !== "active") {
      setTimeLeft(0);
      return;
    }
    const secs: number = draftSession.seconds_per_pick ?? 0;
    if (secs === 0) {
      setTimeLeft(0);
      return;
    }
    const pickStartedAt: string | null = draftSession.pick_started_at ?? null;
    const calc = (): number => {
      if (!pickStartedAt) return secs; // fallback: column not yet set (pre-migration sessions)
      const elapsed = Math.floor((Date.now() - new Date(pickStartedAt).getTime()) / 1000);
      return Math.max(0, secs - elapsed);
    };
    setTimeLeft(calc());
    const interval = setInterval(() => setTimeLeft(calc()), 1000);
    return () => clearInterval(interval);
  }, [draftSession?.pick_started_at, draftSession?.seconds_per_pick, draftSession?.status]);
```

Key differences:
- Depends on `pick_started_at` (resets when server sets a new timestamp) instead of `current_pick`
- `calc()` always computes fresh from `Date.now() - pickStartedAt` — no drift accumulation
- Fallback to `secs` when `pick_started_at` is null (handles sessions started before migration)

- [ ] **Step 3.2: Verify TypeScript compiles**

```bash
cd /Users/nikoko/my-fantasy-app
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 3.3: Manual smoke test**

Start dev server if not running: `npm run dev`

1. Open draft page in two browser tabs
2. Start a draft with timer (e.g. 60s)
3. Verify both tabs show identical (or ±1s) countdown
4. Reload one tab mid-countdown — verify it shows the correct remaining time, not the full 60s

- [ ] **Step 3.4: Commit**

```bash
git add app/wm/\[id\]/draft/page.tsx
git commit -m "fix(draft): server-anchored timer via pick_started_at — eliminates drift and refresh-reset"
```

---

## Task 4: `OnTheClock.tsx` Component

**Files:**
- Create: `components/wm/draft/OnTheClock.tsx`
- Modify: `app/wm/[id]/draft/page.tsx` (insert component below header)

- [ ] **Step 4.1: Create `components/wm/draft/` directory and component**

```bash
mkdir -p /Users/nikoko/my-fantasy-app/components/wm/draft
```

Create `components/wm/draft/OnTheClock.tsx`:

```typescript
"use client";

type Props = {
  currentTeamName: string | null;
  isMyTurn: boolean;
  timeLeft: number;
  secondsPerPick: number;
  pickNumber: number;   // 0-indexed (draftSession.current_pick)
  totalPicks: number;
  isConnected: boolean;
};

export function OnTheClock({
  currentTeamName,
  isMyTurn,
  timeLeft,
  secondsPerPick,
  pickNumber,
  totalPicks,
  isConnected,
}: Props) {
  const noLimit = secondsPerPick === 0;
  const timerDisplay = noLimit ? "∞" : `${timeLeft}s`;
  const timerColor = noLimit
    ? "var(--color-primary)"
    : timeLeft > 30
    ? "var(--color-success)"
    : timeLeft > 10
    ? "var(--color-primary)"
    : "var(--color-error)";

  return (
    <div
      className="md:hidden"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "var(--bg-page)",
        borderBottom: "1px solid var(--color-border)",
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {isMyTurn ? (
          <p
            className="font-black text-sm truncate"
            style={{ color: "var(--color-primary)" }}
          >
            Du bist dran 🏆
          </p>
        ) : (
          <p
            className="font-black text-sm truncate"
            style={{ color: "var(--color-text)" }}
          >
            {currentTeamName ?? "—"} pickt...
          </p>
        )}
        <p
          className="text-[9px] font-black uppercase tracking-widest"
          style={{ color: "var(--color-muted)" }}
        >
          Pick {pickNumber + 1} / {totalPicks}
        </p>
      </div>

      <div
        className="font-black text-2xl leading-none flex-shrink-0"
        style={{
          color: timerColor,
          animation:
            !noLimit && timeLeft <= 10 && timeLeft > 0
              ? "pulse 1s ease-in-out infinite"
              : undefined,
        }}
      >
        {timerDisplay}
      </div>

      {!isConnected && (
        <div
          className="text-[8px] font-black flex-shrink-0"
          style={{ color: "var(--color-error)" }}
        >
          ⏳
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4.2: Insert `<OnTheClock />` into page.tsx**

In `app/wm/[id]/draft/page.tsx`, find the line that starts the body section (after the header `</div>` and before the `{/* Body: board + player list */}` comment):

```typescript
      {/* Body: board + player list */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
```

Insert `<OnTheClock />` between the header close and the body div. Find the exact closing of the header div (the line with `</div>` after `<UserBadge .../>` block), then insert after it:

```typescript
      {draftSession.status === "active" && (
        <OnTheClock
          currentTeamName={currentTeam?.name ?? null}
          isMyTurn={isMyTurn}
          timeLeft={timeLeft}
          secondsPerPick={draftSession.seconds_per_pick ?? 0}
          pickNumber={draftSession.current_pick}
          totalPicks={draftSession.total_picks}
          isConnected={true}
        />
      )}
```

Note: `isConnected={true}` is a placeholder — Task 7.3 replaces it with the real state value.

- [ ] **Step 4.3: Add import to page.tsx**

Add at the top of the imports in `app/wm/[id]/draft/page.tsx`:
```typescript
import { OnTheClock } from "@/components/wm/draft/OnTheClock";
```

- [ ] **Step 4.4: Verify TypeScript compiles**

```bash
cd /Users/nikoko/my-fantasy-app
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 4.5: Manual smoke test on mobile viewport**

In browser DevTools, set viewport to 375×812 (iPhone). Verify:
- `OnTheClock` banner appears below the header
- It shows the correct team name and timer
- It is `position: sticky; top: 0` (stays visible when scrolling)
- On desktop (≥768px) it is hidden (`md:hidden`)

- [ ] **Step 4.6: Commit**

```bash
git add components/wm/draft/OnTheClock.tsx app/wm/\[id\]/draft/page.tsx
git commit -m "feat(draft): OnTheClock sticky banner for mobile — who's picking + timer"
```

---

## Task 5: `PickAnnouncement.tsx` + Page Wiring

**Files:**
- Create: `components/wm/draft/PickAnnouncement.tsx`
- Modify: `app/wm/[id]/draft/page.tsx` (new state/refs, modified `loadPicks`, `showPickAnnouncement` helper)

- [ ] **Step 5.1: Create `components/wm/draft/PickAnnouncement.tsx`**

```typescript
"use client";

export type AnnouncedPick = {
  playerName: string;
  playerPhoto: string;
  position: string;
  teamName: string;
  isOwnPick: boolean;
};

type Props = {
  pick: AnnouncedPick | null;
  visible: boolean;
};

export function PickAnnouncement({ pick, visible }: Props) {
  if (!visible || !pick) return null;

  return (
    <>
      <style>{`
        @keyframes pickSlideIn {
          from { opacity: 0; transform: translate(-50%, calc(-50% - 16px)); }
          to   { opacity: 1; transform: translate(-50%, -50%); }
        }
      `}</style>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 200,
          background: "rgba(0,0,0,0.35)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 201,
          background: "var(--bg-card)",
          border: `2px solid ${pick.isOwnPick ? "var(--color-primary)" : "var(--color-border)"}`,
          borderRadius: 20,
          padding: "28px 36px",
          textAlign: "center",
          boxShadow: "0 12px 48px rgba(0,0,0,0.4)",
          animation: "pickSlideIn 0.2s ease-out",
          minWidth: 240,
          maxWidth: 320,
          pointerEvents: "none",
        }}
      >
        {pick.playerPhoto && (
          <img
            src={pick.playerPhoto}
            alt={pick.playerName}
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              objectFit: "cover",
              marginBottom: 14,
              border: `2px solid ${pick.isOwnPick ? "var(--color-primary)" : "var(--color-border)"}`,
            }}
          />
        )}
        <p
          className="font-black truncate"
          style={{
            fontSize: pick.isOwnPick ? 20 : 17,
            color: "var(--color-text)",
            marginBottom: 6,
          }}
        >
          {pick.playerName}
        </p>
        <p
          className="text-xs font-black uppercase tracking-widest truncate"
          style={{ color: "var(--color-muted)" }}
        >
          {pick.position} · {pick.teamName}
        </p>
        {pick.isOwnPick && (
          <p
            className="text-[10px] font-black uppercase tracking-widest mt-2"
            style={{ color: "var(--color-primary)" }}
          >
            Dein Pick ✓
          </p>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 5.2: Add new state and refs to page.tsx**

In `app/wm/[id]/draft/page.tsx`, add these declarations alongside the existing state/refs (after line ~76 where `accessTokenRef` is):

```typescript
  // PickAnnouncement state
  const [announcedPick, setAnnouncedPick] = useState<AnnouncedPick | null>(null);
  const [announcementVisible, setAnnouncementVisible] = useState(false);
  const initialLoadDoneRef = useRef(false);
  const prevPicksLengthRef = useRef(0);
  const myTeamRef = useRef<any>(null);
  const announcementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Also add a ref sync for `myTeam` (alongside the other ref-sync useEffects at lines 78–82):
```typescript
  useEffect(() => { myTeamRef.current = myTeam; }, [myTeam]);
```

Add cleanup for announcement timer in the existing cleanup useEffect (after line ~101):
```typescript
      if (announcementTimerRef.current) clearTimeout(announcementTimerRef.current);
```

- [ ] **Step 5.3: Add `showPickAnnouncement` helper to page.tsx**

Add this function alongside the other helper functions (e.g. after `totalRounds`):

```typescript
  function showPickAnnouncement(pick: any) {
    const team = teamsRef.current.find((t: any) => t.id === pick.team_id);
    if (!team) return;
    setAnnouncedPick({
      playerName: pick.players?.name ?? "?",
      playerPhoto: pick.players?.photo_url ?? "",
      position: pick.players?.position ?? "",
      teamName: team.name,
      isOwnPick: team.id === myTeamRef.current?.id,
    });
    setAnnouncementVisible(true);
    if (announcementTimerRef.current) clearTimeout(announcementTimerRef.current);
    announcementTimerRef.current = setTimeout(() => setAnnouncementVisible(false), 1200);
  }
```

- [ ] **Step 5.4: Modify `loadPicks` to support announcement gating**

Find the existing `loadPicks` function:
```typescript
  async function loadPicks(sessionId: string) {
    const { data: picks } = await supabase
      .from("draft_picks")
      .select("*, players(name, photo_url, position, team_name, fpts)")
      .eq("draft_session_id", sessionId)
      .order("pick_number");
    setDraftPicks(picks || []);
    draftPicksRef.current = picks || [];
    return picks || [];
  }
```

Replace with:
```typescript
  async function loadPicks(sessionId: string, options: { skipAnnouncement?: boolean } = {}) {
    const { data: picks } = await supabase
      .from("draft_picks")
      .select("*, players(name, photo_url, position, team_name, fpts)")
      .eq("draft_session_id", sessionId)
      .order("pick_number");
    const result = picks || [];

    // Only fire pick announcement for genuine new picks after initial load
    if (
      !options.skipAnnouncement &&
      initialLoadDoneRef.current &&
      result.length > prevPicksLengthRef.current
    ) {
      const latestPick = result[result.length - 1];
      if (latestPick) showPickAnnouncement(latestPick);
    }
    prevPicksLengthRef.current = result.length;

    setDraftPicks(result);
    draftPicksRef.current = result;
    return result;
  }
```

- [ ] **Step 5.5: Mark initial load and set `initialLoadDoneRef`**

In `loadAll`, find the initial `loadPicks` call (around line 141):
```typescript
      await loadPicks(session.id);
```

Replace with:
```typescript
      await loadPicks(session.id, { skipAnnouncement: true });
      initialLoadDoneRef.current = true;
```

- [ ] **Step 5.6: Add import and render `<PickAnnouncement />` in page.tsx**

Add import at the top:
```typescript
import { PickAnnouncement, type AnnouncedPick } from "@/components/wm/draft/PickAnnouncement";
```

In the JSX return of the active draft section (inside the `<main>` element, before the closing `</main>`), add:
```typescript
      <PickAnnouncement pick={announcedPick} visible={announcementVisible} />
```

- [ ] **Step 5.7: Verify TypeScript compiles**

```bash
cd /Users/nikoko/my-fantasy-app
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 5.8: Manual smoke test**

1. Run draft, make a pick.
2. Verify overlay appears for ~1.2s with player photo, name, position, team.
3. Reload page. Verify overlay does NOT fire for existing picks.
4. Reconnect test: disconnect network for 5s during draft, reconnect. Verify overlay only fires once (for the pick that happened while disconnected, if any) — not multiple times.

- [ ] **Step 5.9: Commit**

```bash
git add components/wm/draft/PickAnnouncement.tsx app/wm/\[id\]/draft/page.tsx
git commit -m "feat(draft): PickAnnouncement overlay — 1.2s pick moment, guarded against initial/reconnect load"
```

---

## Task 6: `DraftPlayerRow.tsx` + Page Wiring

**Files:**
- Create: `components/wm/draft/DraftPlayerRow.tsx`
- Modify: `app/wm/[id]/draft/page.tsx` (replace inline player row JSX)

The current inline player row (lines 1040–1070) uses `PlayerCard`. We extract it into a component with a proper `isConnected` prop.

- [ ] **Step 6.1: Create `components/wm/draft/DraftPlayerRow.tsx`**

```typescript
"use client";

import { PlayerCard } from "@/components/PlayerCard";

type DraftPlayer = {
  id: number;
  name: string;
  photo_url: string;
  position: string;
  team_name: string;
  goals: number;
  assists: number;
  fpts: number;
};

type Nation = {
  name: string;
  code?: string;
  flag_url?: string;
  group_letter?: string;
};

type Props = {
  player: DraftPlayer;
  nation: Nation | undefined;
  posColor: string | undefined;
  isMyTurn: boolean;
  isConnected: boolean;
  onPick: (playerId: number) => void;
};

export function DraftPlayerRow({
  player,
  nation,
  posColor,
  isMyTurn,
  isConnected,
  onPick,
}: Props) {
  const canPick = isMyTurn && isConnected;

  return (
    <div
      onClick={() => canPick && onPick(player.id)}
      className="flex items-center gap-2 p-2 transition-all"
      style={{
        borderBottom: "1px solid var(--color-border)",
        opacity: canPick ? 1 : 0.4,
        cursor: canPick ? "pointer" : "not-allowed",
        background: "transparent",
        minHeight: 48,
      }}
      onMouseEnter={(e) => {
        if (canPick)
          (e.currentTarget as HTMLElement).style.background =
            "var(--bg-elevated)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <PlayerCard
        player={player}
        posColor={posColor}
        size={32}
        nationFlagUrl={nation?.flag_url}
      />
      <div className="flex-1 min-w-0">
        <p
          className="text-xs font-black truncate"
          style={{ color: "var(--color-text)" }}
        >
          {player.name}
        </p>
        <p className="text-[8px] truncate" style={{ color: "var(--color-muted)" }}>
          {nation?.code || player.team_name}
          {nation?.group_letter && (
            <span style={{ color: "var(--color-border)" }}>
              {" · "}Gr.{nation.group_letter}
            </span>
          )}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p
          className="text-xs font-black"
          style={{ color: "var(--color-primary)" }}
        >
          {player.fpts?.toFixed(0)}
        </p>
        <span
          className="text-[7px] font-black px-1 rounded-sm"
          style={{
            background: posColor ? posColor + "20" : "var(--color-border)",
            color: posColor || "var(--color-muted)",
          }}
        >
          {player.position}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 6.2: Replace inline player row in page.tsx**

Find the inline player row block (lines ~1036–1071):
```typescript
          <div className="flex-1 overflow-y-auto">
            {availablePlayers.slice(0, 150).map(p => {
              const posColor = POS_COLOR[p.position];
              const nation = nations.find((n: any) => n.name === p.team_name);
              return (
                <div key={p.id}
                  onClick={() => isMyTurn && pickPlayer(p.id)}
                  className="flex items-center gap-2 p-2 transition-all"
                  style={{
                    borderBottom: "1px solid var(--color-border)",
                    opacity: isMyTurn ? 1 : 0.4,
                    cursor: isMyTurn ? "pointer" : "not-allowed",
                    background: "transparent",
                  }}
                  onMouseEnter={e => { if (isMyTurn) (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  <PlayerCard player={p} posColor={posColor} size={32} nationFlagUrl={nation?.flag_url} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black truncate" style={{ color: "var(--color-text)" }}>{p.name}</p>
                    <p className="text-[8px] truncate" style={{ color: "var(--color-muted)" }}>
                      {nation?.code || p.team_name}
                      {nation?.group_letter && <span style={{ color: "var(--color-border)" }}> · Gr.{nation.group_letter}</span>}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-black" style={{ color: "var(--color-primary)" }}>{p.fpts?.toFixed(0)}</p>
                    <span className="text-[7px] font-black px-1 rounded-sm"
                      style={{
                        background: posColor ? posColor + "20" : "var(--color-border)",
                        color: posColor || "var(--color-muted)",
                      }}>
                      {p.position}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
```

Replace with:
```typescript
          <div className="flex-1 overflow-y-auto">
            {availablePlayers.slice(0, 150).map((p) => (
              <DraftPlayerRow
                key={p.id}
                player={p}
                nation={nations.find((n: any) => n.name === p.team_name)}
                posColor={POS_COLOR[p.position]}
                isMyTurn={isMyTurn}
                isConnected={true}
                onPick={pickPlayer}
              />
            ))}
          </div>
```

Note: `isConnected={true}` is a placeholder — Task 7.3 replaces it with the real state value.

- [ ] **Step 6.3: Add import to page.tsx**

```typescript
import { DraftPlayerRow } from "@/components/wm/draft/DraftPlayerRow";
```

- [ ] **Step 6.4: Verify TypeScript compiles**

```bash
cd /Users/nikoko/my-fantasy-app
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 6.5: Manual smoke test — tap targets**

In mobile DevTools viewport (375×812):
1. Verify each player row is ≥ 48px tall.
2. Tap a row — verify `pickPlayer` is called (or disabled state is correct).
3. Verify the visual appearance matches the old player list.

- [ ] **Step 6.6: Commit**

```bash
git add components/wm/draft/DraftPlayerRow.tsx app/wm/\[id\]/draft/page.tsx
git commit -m "feat(draft): DraftPlayerRow component — 48px touch targets, isConnected-aware"
```

---

## Task 7: Connection Status Badge + Disconnect UX

**Files:**
- Modify: `app/wm/[id]/draft/page.tsx`

Wire `isConnected` state, update `subscribeToRealtime`, add badge to header, replace `true` placeholders from Tasks 4/6, add disconnect hint above player list.

- [ ] **Step 7.1: Add `isConnected` state to page.tsx**

Add alongside other `useState` declarations (around line ~63):
```typescript
  const [isConnected, setIsConnected] = useState(true);
```

- [ ] **Step 7.2: Update `subscribeToRealtime` to track channel status**

Find the existing `subscribeToRealtime` function:
```typescript
  function subscribeToRealtime(sessionId: string) {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    const channel = supabase
      .channel("wm-draft-" + leagueId + "-" + Date.now())
      .on("postgres_changes",
        { event: "*", schema: "public", table: "draft_sessions", filter: `id=eq.${sessionId}` },
        async (payload) => {
          const newSession = payload.new as any;
          setDraftSession(newSession);
          draftSessionRef.current = newSession;
          const picks = await loadPicks(sessionId);
          if (isOwnerRef.current && newSession.status === "active") {
            triggerBot(newSession, picks, teamsRef.current, userIdRef.current);
          }
        }
      )
      .subscribe();
    channelRef.current = channel;
  }
```

Replace with:
```typescript
  function subscribeToRealtime(sessionId: string) {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    const channel = supabase
      .channel("wm-draft-" + leagueId + "-" + Date.now())
      .on("postgres_changes",
        { event: "*", schema: "public", table: "draft_sessions", filter: `id=eq.${sessionId}` },
        async (payload) => {
          const newSession = payload.new as any;
          setDraftSession(newSession);
          draftSessionRef.current = newSession;
          const picks = await loadPicks(sessionId);
          if (isOwnerRef.current && newSession.status === "active") {
            triggerBot(newSession, picks, teamsRef.current, userIdRef.current);
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
      });
    channelRef.current = channel;
  }
```

- [ ] **Step 7.3: Replace `isConnected={true}` placeholders with real state**

In page.tsx, find the two placeholder occurrences added in Tasks 4 and 6:

1. In `<OnTheClock />`:
```typescript
          isConnected={true}
```
Replace with:
```typescript
          isConnected={isConnected}
```

2. In `<DraftPlayerRow />`:
```typescript
                isConnected={true}
```
Replace with:
```typescript
                isConnected={isConnected}
```

- [ ] **Step 7.4: Add connection badge to the header**

In page.tsx, find the header `<div className="flex justify-between items-center ...">`. Add a connection badge inside the right-side controls div (after the `<UserBadge .../>` line):

Find:
```typescript
          <UserBadge teamName={myTeam?.name} />
        </div>
      </div>
```

Replace with:
```typescript
          <UserBadge teamName={myTeam?.name} />
          <span
            className="text-[8px] font-black"
            style={{ color: isConnected ? "var(--color-success)" : "var(--color-error)" }}
            title={isConnected ? "Verbunden" : "Verbindung wird wiederhergestellt..."}
          >
            {isConnected ? "⚡" : "⏳"}
          </span>
        </div>
      </div>
```

- [ ] **Step 7.5: Add disconnect hint above the player list**

Find the player picker section opening (around line ~996):
```typescript
        {/* Bottom/Right: Player picker */}
        <div className="flex-1 min-h-0 md:flex-none md:w-64 flex flex-col flex-shrink-0 border-t md:border-t-0 md:border-l"
          style={{ borderColor: "var(--color-border)" }}>
          <div className="p-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
            <p className="text-[8px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-border)" }}>
              {availablePlayers.length} verfügbar · {players.length} WM-Spieler
            </p>
```

After the opening of that `<div className="p-3 ...">` block, add the disconnect hint:
```typescript
            {!isConnected && (
              <p
                className="text-[9px] font-black text-center mb-2 py-1 px-2 rounded-lg"
                style={{
                  background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))",
                  color: "var(--color-error)",
                  border: "1px solid color-mix(in srgb, var(--color-error) 30%, transparent)",
                }}
              >
                Verbindung wird wiederhergestellt…
              </p>
            )}
```

- [ ] **Step 7.6: Verify TypeScript compiles**

```bash
cd /Users/nikoko/my-fantasy-app
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 7.7: Manual smoke test — connection status**

1. Open draft, verify `⚡` badge shows (green)
2. In browser DevTools → Network tab → set "Offline"
3. Verify badge switches to `⏳` (red)
4. Verify player rows become greyed out (opacity 0.4, not clickable)
5. Verify "Verbindung wird wiederhergestellt…" hint appears
6. Re-enable network. Verify badge returns to `⚡` and rows are interactive again.

- [ ] **Step 7.8: Commit**

```bash
git add app/wm/\[id\]/draft/page.tsx
git commit -m "feat(draft): connection status badge + disabled picks when disconnected"
```

---

## Task 8: Mobile Defaults + Bot Retry Fix + Final Wiring

**Files:**
- Modify: `app/wm/[id]/draft/page.tsx`

Three final changes: default view to list on mobile, fix bot retry to only retry on 5xx (not 409), verify overall integration.

- [ ] **Step 8.1: Default view to `"list"` on mobile**

Find the `view` useState initialization:
```typescript
  const [view, setView] = useState<"board" | "list">("board");
```

Replace with:
```typescript
  const [view, setView] = useState<"board" | "list">(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "list" : "board"
  );
```

This uses a lazy initializer so it only runs once on mount. On mobile (<768px) the player list is the default; on desktop the board is the default. User can still switch manually via the Board/Kader buttons.

- [ ] **Step 8.2: Fix bot retry — only retry on 5xx, not on 409**

Find the bot's error handling in `triggerBot` (around line ~333):
```typescript
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Bot pick error:", err.error || res.status);
        // Retry after 3s so bot doesn't get permanently stuck on transient errors
        setTimeout(() => {
          const s = draftSessionRef.current;
          if (s?.status === "active") {
            triggerBot(s, draftPicksRef.current, teamsRef.current, userIdRef.current);
          }
        }, 3000);
        return;
      }
```

Replace with:
```typescript
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Bot pick error:", err.error || res.status);
        // Only retry on server errors (5xx) or network failures.
        // 409 means pick conflict or optimistic lock mismatch — the next Realtime
        // event will trigger triggerBot() again when current_pick advances.
        if (res.status >= 500) {
          setTimeout(() => {
            const s = draftSessionRef.current;
            if (s?.status === "active") {
              triggerBot(s, draftPicksRef.current, teamsRef.current, userIdRef.current);
            }
          }, 3000);
        }
        return;
      }
```

- [ ] **Step 8.3: Verify TypeScript compiles (final)**

```bash
cd /Users/nikoko/my-fantasy-app
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 8.4: Full integration QA**

Run the dev server: `npm run dev`

**Timer QA:**
- [ ] Open draft in two browser windows → both show same countdown (±1s)
- [ ] Reload one window mid-countdown → shows correct remaining time, not full value
- [ ] Unlimited timer (0s) → shows `∞` in both windows
- [ ] After pick is made → timer resets correctly in both windows

**Bot double-trigger QA:**
- [ ] Open draft as owner in two tabs
- [ ] Start draft with bot teams
- [ ] Watch console and DB — no duplicate `draft_picks` rows for the same `pick_number`
- [ ] Each bot pick fires once, no 409 retry loops

**Error feedback QA:**
- [ ] Simulate "not your turn": two players try to pick simultaneously → slower one sees toast "Zu langsam — dieser Slot wurde bereits vergeben"
- [ ] Draft finished session: try to submit a pick → sees "Kein aktiver Draft"

**PickAnnouncement QA:**
- [ ] Reload page with existing picks → no overlay fires
- [ ] Make a pick → overlay fires for 1.2s with player photo, name, team
- [ ] Own pick → overlay shows "Dein Pick ✓" and uses primary color border

**OnTheClock QA:**
- [ ] On mobile viewport: banner is visible and sticky below header
- [ ] Shows correct team name and timer
- [ ] On desktop: banner is hidden (`md:hidden`)

**Connection badge QA:**
- [ ] `⚡` shows when connected
- [ ] `⏳` shows when DevTools offline
- [ ] Player rows disabled when offline, re-enabled on reconnect

**Mobile default view QA:**
- [ ] Open draft on mobile viewport → player list is shown by default (not board)
- [ ] Board button still works (user can switch)
- [ ] Desktop opens to board view

- [ ] **Step 8.5: Commit**

```bash
git add app/wm/\[id\]/draft/page.tsx
git commit -m "feat(draft): mobile list default, bot retry fix (5xx only), D2 integration complete"
```

---

## P2 / Future Work Notes (not in this plan)

These are documented here for easy pickup:

- **Pick-Queue:** `wm_draft_queue` table + drag-and-drop UI + auto-pick from queue. Own spec required.
- **Board Mobile UX:** Board view hidden by default on mobile in D2. Full mobile board (condensed cells + horizontal scroll) is a separate task.
- **Draft Recap Page:** Post-draft team overview, own spec.
- **Sound/Audio:** Explicitly out of scope.

---

## Summary

| Task | What | Commit tag |
|------|------|-----------|
| 1 | DB migration: `pick_started_at` | `fix(db)` |
| 2 | API: idempotency + `pick_started_at` + errors | `fix(draft-api)` |
| 3 | Timer rewrite: `Date.now() - pick_started_at` | `fix(draft)` |
| 4 | `OnTheClock.tsx` + page wiring | `feat(draft)` |
| 5 | `PickAnnouncement.tsx` + page wiring | `feat(draft)` |
| 6 | `DraftPlayerRow.tsx` + page wiring | `feat(draft)` |
| 7 | Connection badge + disconnect UX | `feat(draft)` |
| 8 | Mobile default + bot retry fix + QA | `feat(draft)` |

**Estimated effort:** 1–1.5 days · 8 commits · ~3 new files · 2 modified files · 1 migration
