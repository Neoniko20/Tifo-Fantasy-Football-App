# WM System Messages — Implementation Plan (Phase B2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire system messages as side effects in the Ingest Layer — each relevant event type auto-posts to `league_messages` with idempotency, throttling, and a SIM badge for simulator-sourced messages.

**Architecture:** Extend `lib/wm-ingest.ts` with a `sendSystemMessageForEvent()` helper called after each DB write. Idempotency via `${event_id}:system_message` key stored in `wm_event_log`. SIM badge rendered in `MessageBubble.tsx`.

**Tech Stack:** Existing `POST /api/leagues/[id]/system-message` route, `lib/chat.ts`, `app/components/chat/MessageBubble.tsx`.

**Prerequisite:** Phase A1 (Ingest Layer) complete.

**Spec:** `docs/superpowers/specs/2026-05-20-wm-live-tournament-ux-design.md` §B2

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/wm-ingest.ts` | Modify | Add `sendSystemMessageForEvent()`, call after each handler |
| `app/components/chat/MessageBubble.tsx` | Modify | Render SIM badge when `metadata.source === "simulator"` |

---

## Task 1: System Message Helper in `lib/wm-ingest.ts`

**Files:**
- Modify: `lib/wm-ingest.ts`

- [ ] **Step 1: Add message templates and throttle config at the top of the file**

After the imports, add:

```typescript
// ── System Message Config ─────────────────────────────────────────────────────

interface SystemMessageMeta {
  event_type: string;
  priority: "high" | "medium" | "low";
  source: string;
  related_fixture_id?: string;
  related_team_id?: string;
  related_player_id?: number;
  related_nation_id?: string;
  ticker_text?: string;
  icon?: string;
}

const THROTTLE_RULES: Partial<Record<string, { max_per_gw?: number; debounce_ms?: number }>> = {
  "fixture.status_changed": {},          // always send
  "nation.eliminated":      {},          // always send
  "player.stat_update":     { max_per_gw: 20 },
  "auto_sub.applied":       { debounce_ms: 5000 },
  "waiver.claim_processed": {},          // always send
  "gameweek.points_recalculated": {},
};
```

- [ ] **Step 2: Add `sendSystemMessageForEvent()` function**

Add this function before `processIngestEvent`:

```typescript
async function sendSystemMessageForEvent(
  leagueId: string,
  eventId: string,
  eventType: string,
  content: string,
  meta: SystemMessageMeta,
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<void> {
  // Idempotency: one message per event
  const idempotencyKey = `${eventId}:system_message`;
  const { data: existing } = await supabase
    .from("wm_event_log")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing) return; // already sent

  // Throttle: max_per_gw check for player.stat_update
  const rule = THROTTLE_RULES[eventType];
  if (rule?.max_per_gw) {
    const { count } = await supabase
      .from("league_messages")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueId)
      .contains("metadata", { event_type: eventType })
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if ((count ?? 0) >= rule.max_per_gw) return;
  }

  // Send via existing system-message route
  // We call the service role client directly (not HTTP) to avoid auth complexity
  await supabase
    .from("league_messages")
    .insert({
      league_id:  leagueId,
      sender_id:  null,
      team_id:    null,
      content,
      kind:       "system",
      metadata:   meta,
    });

  // Mark idempotency key as used (reuse event_log with a synthetic entry)
  await supabase.from("wm_event_log").update({}).eq("id", eventId); // no-op for timing
  // Simpler: just store the idempotency key in a separate dedicated insert
  // Note: the unique constraint on wm_event_log.idempotency_key handles dedup
}
```

> **Implementation note:** The above directly inserts into `league_messages` using the service role client (which already bypasses RLS). This avoids an internal HTTP call. The idempotency is enforced by trying to insert a record with the same `idempotency_key` — the `UNIQUE` constraint on `wm_event_log.idempotency_key` will reject it. For the message idempotency key specifically, store it as a second `wm_event_log` row with `event_type = "system_message_sent"`:

Replace the `sendSystemMessageForEvent` function with this cleaner version:

```typescript
async function sendSystemMessageForEvent(
  leagueId: string,
  eventId: string,
  eventType: string,
  content: string,
  meta: SystemMessageMeta,
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<void> {
  const idempotencyKey = `${eventId}:system_message`;

  // Throttle: max_per_gw
  const rule = THROTTLE_RULES[eventType];
  if (rule?.max_per_gw) {
    const { count } = await supabase
      .from("league_messages")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueId)
      .contains("metadata", { event_type: eventType })
      .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    if ((count ?? 0) >= rule.max_per_gw) return;
  }

  // Idempotency: attempt to insert a sentinel log row — unique key prevents duplicates
  const { error: dedupeError } = await supabase.from("wm_event_log").insert({
    league_id:       leagueId,
    tournament_id:   meta.related_fixture_id ?? "system",
    event_type:      "system_message_sent",
    idempotency_key: idempotencyKey,
    source:          meta.source,
    status:          "processed",
    processed_at:    new Date().toISOString(),
    processed_by:    "ingest_api",
  });

  // If the idempotency_key already exists, dedupeError is a unique constraint error — skip
  if (dedupeError?.code === "23505") return; // duplicate key
  if (dedupeError) {
    console.warn("[system-message] idempotency insert failed:", dedupeError.message);
    // Continue anyway — better to send a possible duplicate than silence
  }

  await supabase.from("league_messages").insert({
    league_id:  leagueId,
    sender_id:  null,
    team_id:    null,
    content,
    kind:       "system",
    metadata:   meta,
  });
}
```

- [ ] **Step 3: Call `sendSystemMessageForEvent` from each handler**

In `dispatchEvent`, after each handler call, add message sending. Modify the switch to call messages:

```typescript
async function dispatchEvent(
  leagueId: string,
  event: WMIngestEvent,
  supabase: ReturnType<typeof createServiceRoleClient>,
  eventId: string,         // ← add this parameter
): Promise<{ applied: string[]; warnings: string[] }> {
  const src = event.source ?? "admin";

  switch (event.type) {
    case "fixture.score_updated": {
      const r = await handleScoreUpdated(event, supabase);
      return r;
    }
    case "fixture.status_changed": {
      const r = await handleFixtureStatus(event, supabase);
      const p = event.payload as any;
      if (p.status === "live") {
        await sendSystemMessageForEvent(
          leagueId, eventId, event.type,
          `🟢 Anpfiff läuft`,
          { event_type: event.type, priority: "low", source: src,
            related_fixture_id: p.fixture_id, ticker_text: "🟢 Anpfiff", icon: "🟢" },
          supabase,
        ).catch(() => {}); // non-fatal
      } else if (p.status === "finished") {
        await sendSystemMessageForEvent(
          leagueId, eventId, event.type,
          `🏁 Abpfiff`,
          { event_type: event.type, priority: "low", source: src,
            related_fixture_id: p.fixture_id, ticker_text: "🏁 Abpfiff", icon: "🏁" },
          supabase,
        ).catch(() => {});
      }
      return r;
    }
    case "fixture.penalties_updated":
      return handlePenaltiesUpdated(event, supabase);

    case "player.stat_update": {
      const r = await handlePlayerStatUpdate(leagueId, event, supabase);
      const p = event.payload as any;
      if ((p.goals ?? 0) > 0) {
        // Look up player name for message
        const { data: pl } = await supabase
          .from("players").select("name").eq("id", p.player_id).maybeSingle();
        const name = pl?.name ?? `Spieler #${p.player_id}`;
        const gwLabel = event.gameweek ? ` · GW${event.gameweek}` : "";
        await sendSystemMessageForEvent(
          leagueId, eventId, event.type,
          `⚽ ${name} trifft${gwLabel}`,
          { event_type: event.type, priority: "medium", source: src,
            related_player_id: p.player_id,
            ticker_text: `⚽ ${name}${gwLabel}`, icon: "⚽" },
          supabase,
        ).catch(() => {});
      }
      return r;
    }
    case "gameweek.status_changed":
      return handleGameweekStatus(event, supabase);

    case "nation.eliminated": {
      const r = await handleNationEliminated(event, supabase);
      const p = event.payload as any;
      const { data: nation } = await supabase
        .from("wm_nations").select("name").eq("id", p.nation_id).maybeSingle();
      const name = nation?.name ?? p.nation_id;
      await sendSystemMessageForEvent(
        leagueId, eventId, event.type,
        `🚩 ${name} nach GW${event.gameweek ?? p.eliminated_after_gameweek} ausgeschieden`,
        { event_type: event.type, priority: "high", source: src,
          related_nation_id: p.nation_id,
          ticker_text: `🚩 ${name} ausgeschieden`, icon: "🚩" },
        supabase,
      ).catch(() => {});
      return r;
    }
    case "auto_sub.applied": {
      const p = event.payload as any;
      const gwLabel = event.gameweek ? `GW${event.gameweek}` : "";
      await sendSystemMessageForEvent(
        leagueId, eventId, event.type,
        `🔄 Auto-Sub ${gwLabel}`,
        { event_type: event.type, priority: "medium", source: src,
          related_team_id: p.team_id,
          ticker_text: `🔄 Auto-Sub ${gwLabel}`, icon: "🔄" },
        supabase,
      ).catch(() => {});
      return { applied: [`event_logged:${event.type}`], warnings: [] };
    }
    case "waiver.claim_processed": {
      const p = event.payload as any;
      if (p.status === "approved") {
        await sendSystemMessageForEvent(
          leagueId, eventId, event.type,
          `✅ Waiver: Anspruch genehmigt`,
          { event_type: event.type, priority: "medium", source: src,
            related_team_id: p.team_id,
            ticker_text: "✅ Waiver genehmigt", icon: "✅" },
          supabase,
        ).catch(() => {});
      }
      return { applied: [`event_logged:${event.type}`], warnings: [] };
    }
    case "gameweek.points_recalculated": {
      const p = event.payload as any;
      await sendSystemMessageForEvent(
        leagueId, eventId, event.type,
        `📊 GW${event.gameweek ?? p.gameweek} Punkte aktualisiert`,
        { event_type: event.type, priority: "low", source: src,
          ticker_text: `📊 GW${event.gameweek} Punkte`, icon: "📊" },
        supabase,
      ).catch(() => {});
      return { applied: [`event_logged:${event.type}`], warnings: [] };
    }
    default:
      return { applied: [], warnings: [`unknown_event_type:${(event as any).type}`] };
  }
}
```

- [ ] **Step 4: Update `processIngestEvent` to pass `eventId` to `dispatchEvent`**

In `processIngestEvent`, change the dispatch call from:
```typescript
    const result = await dispatchEvent(leagueId, event, supabase);
```
to:
```typescript
    const result = await dispatchEvent(leagueId, event, supabase, eventId);
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd /Users/nikoko/my-fantasy-app && node_modules/.bin/tsc --noEmit 2>&1 | tail -5
```

Expected: no output.

---

## Task 2: SIM Badge in `MessageBubble.tsx`

**Files:**
- Modify: `app/components/chat/MessageBubble.tsx`

- [ ] **Step 1: Read the current file to understand structure**

```bash
head -60 /Users/nikoko/my-fantasy-app/app/components/chat/MessageBubble.tsx
```

- [ ] **Step 2: Find where message content/metadata is rendered and add SIM badge**

Locate the spot where `msg.content` is rendered. After the content/timestamp, add:

```tsx
{/* SIM badge — visible only for simulator-sourced system messages */}
{msg.kind === "system" && (msg.metadata as any)?.source === "simulator" && (
  <span
    className="inline-block ml-1.5 px-1 rounded text-[6px] font-black uppercase align-middle"
    style={{
      background: "var(--bg-elevated)",
      color: "var(--color-muted)",
      border: "1px solid var(--color-border)",
      opacity: 0.7,
    }}>
    SIM
  </span>
)}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/nikoko/my-fantasy-app && node_modules/.bin/tsc --noEmit 2>&1 | tail -5
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd /Users/nikoko/my-fantasy-app && git add \
  lib/wm-ingest.ts \
  "app/components/chat/MessageBubble.tsx" \
  && git commit -m "feat(wm-system-messages): auto system messages from Ingest Layer

- sendSystemMessageForEvent() with idempotency + throttle
- Messages for: goal, nation eliminated, auto sub, waiver, fixtures, GW recalc
- SIM badge in MessageBubble for simulator-sourced messages
- Non-fatal: message failures never block event processing

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
