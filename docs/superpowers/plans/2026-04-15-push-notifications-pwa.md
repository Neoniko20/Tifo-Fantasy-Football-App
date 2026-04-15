# Push Notifications & PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Web Push Notifications (VAPID + `web-push`) to the Tifo app — covering waiver results, trade results, gameweek status, draft events, and a dormant live-goals cron — with a Sleeper-style settings UI (global toggles + per-league drill-down).

**Architecture:** Push subscriptions are stored in Supabase (`push_subscriptions`). Notification preferences live in two JSONB tables (`user_notification_prefs`, `league_notification_prefs`). Server-side events call `sendPush()` from `lib/push.ts` directly; client-side events (trades, draft) POST to `/api/notifications/push-dispatch` which runs with service-role.

**Tech Stack:** `web-push` (npm), VAPID keys (generate once), next-pwa v5 `customWorkerDir: 'worker'`, Supabase service role client, Next.js App Router API routes, React client components with optimistic toggle updates.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `db/push_schema.sql` | DDL: 3 new tables + RLS |
| `worker/index.js` | Custom SW code: `push` + `notificationclick` handlers |
| `lib/push.ts` | `sendPush()` + `sendPushToLeague()` + VAPID init |
| `lib/notification-prefs.ts` | Type definitions + client-side prefs read/write helpers |
| `app/api/notifications/subscribe/route.ts` | POST: save PushSubscription to DB |
| `app/api/notifications/unsubscribe/route.ts` | POST: delete PushSubscription from DB |
| `app/api/notifications/push-dispatch/route.ts` | POST: authenticated client → server push relay |
| `app/components/PushSubscriptionManager.tsx` | Client: requestPermission + SW subscribe + POST |
| `app/account/notifications/page.tsx` | Global toggles + per-league navigation list |
| `app/account/notifications/[leagueId]/page.tsx` | Per-league toggle page |
| `app/api/cron/live-push/route.ts` | Dormant live goals/assists cron |

**Modified files:**

| Path | Change |
|---|---|
| `next.config.ts` | Add `customWorkerDir: 'worker'` to withPWA config |
| `app/account/page.tsx` | Remove inline notifications section; row navigates to `/account/notifications` |
| `app/api/process-waivers/route.ts` | Add `sendPush()` after each `notifyTeam()` call |
| `app/api/process-waivers-wm/route.ts` | Same as above |
| `lib/notifications.ts` | `insertNotification()` also POSTs to push-dispatch |
| `app/components/admin/GameweeksTab.tsx` | Call push-dispatch after `updateGWStatus` |
| `app/leagues/[id]/draft/page.tsx` | Call push-dispatch after human pick |

---

## Task 1: Install dependency + generate VAPID keys + DB schema

**Files:**
- Create: `db/push_schema.sql`

- [ ] **Step 1: Install web-push**

```bash
cd /Users/nikoko/my-fantasy-app
npm install web-push
npm install --save-dev @types/web-push
```

Expected: `web-push` appears in `package.json` dependencies.

- [ ] **Step 2: Generate VAPID key pair**

```bash
npx web-push generate-vapid-keys
```

Expected output (values will differ):
```
=======================================

Public Key:
BIgXVPnOAeBkXV9PzZfwXjBJ...

Private Key:
yL3Kt1...

=======================================
```

Copy both values — you'll need them in Step 3.

- [ ] **Step 3: Add env vars to `.env.local`**

Open `.env.local` and append:
```
VAPID_PUBLIC_KEY=<paste Public Key from Step 2>
VAPID_PRIVATE_KEY=<paste Private Key from Step 2>
VAPID_SUBJECT=mailto:admin@tifo.app
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<same as VAPID_PUBLIC_KEY>
LIVE_PUSH_ENABLED=false
```

Also add to Vercel project settings (Production + Preview environments).

- [ ] **Step 4: Create DB schema file**

Create `db/push_schema.sql`:

```sql
-- Push subscriptions (one per browser/device per user)
create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz default now()
);
create unique index on push_subscriptions(user_id, endpoint);
create index on push_subscriptions(user_id);

-- RLS
alter table push_subscriptions enable row level security;
create policy "Users manage own subscriptions"
  on push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Global notification preferences (one row per user)
create table user_notification_prefs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  prefs      jsonb not null default '{}',
  updated_at timestamptz default now()
);
alter table user_notification_prefs enable row level security;
create policy "Users manage own global prefs"
  on user_notification_prefs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Per-league notification preferences
create table league_notification_prefs (
  user_id    uuid not null references auth.users(id) on delete cascade,
  league_id  uuid not null references leagues(id) on delete cascade,
  prefs      jsonb not null default '{}',
  updated_at timestamptz default now(),
  primary key (user_id, league_id)
);
alter table league_notification_prefs enable row level security;
create policy "Users manage own league prefs"
  on league_notification_prefs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

- [ ] **Step 5: Run schema in Supabase**

Go to Supabase dashboard → SQL Editor → paste the content of `db/push_schema.sql` → Run.

Verify: three new tables appear in Table Editor: `push_subscriptions`, `user_notification_prefs`, `league_notification_prefs`.

- [ ] **Step 6: Commit**

```bash
git add db/push_schema.sql package.json package-lock.json
git commit -m "feat: add web-push dependency + DB schema for push notifications"
```

---

## Task 2: `lib/push.ts` — Core sending functions

**Files:**
- Create: `lib/push.ts`

- [ ] **Step 1: Create `lib/push.ts`**

```typescript
import webpush from 'web-push';
import { createServiceRoleClient } from '@/lib/supabase-server';

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
);

export type PushEvent =
  | 'waiver_approved' | 'waiver_rejected'
  | 'trade_accepted'  | 'trade_rejected'
  | 'gw_started'      | 'gw_finished'
  | 'draft_your_turn' | 'draft_pick_made'
  | 'chat_message'
  | 'live_goal'       | 'live_assist';

export type PushPayload = {
  title: string;
  body: string;
  link: string;
  icon?: string;
};

const DEFAULT_GLOBAL = {
  push_enabled: true,
  gw_start: true,
  gw_end: true,
  draft_your_turn: true,
  draft_pick_made: false,
};

const DEFAULT_LEAGUE = {
  enabled: true,
  waiver_results: true,
  trade_results: true,
  chat_messages: true,
  live_goals: false,
};

/**
 * Sends a push notification to all active subscriptions for a user.
 * Checks user + league prefs before sending.
 * Auto-deletes expired subscriptions (HTTP 410/404 from push service).
 */
export async function sendPush(
  userId: string,
  event: PushEvent,
  payload: PushPayload,
  leagueId?: string,
): Promise<void> {
  const supabase = createServiceRoleClient();

  // Check global prefs
  const { data: globalRow } = await supabase
    .from('user_notification_prefs')
    .select('prefs')
    .eq('user_id', userId)
    .maybeSingle();

  const gp = { ...DEFAULT_GLOBAL, ...(globalRow?.prefs ?? {}) };
  if (!gp.push_enabled) return;

  if (event === 'gw_started'      && !gp.gw_start)       return;
  if (event === 'gw_finished'     && !gp.gw_end)          return;
  if (event === 'draft_your_turn' && !gp.draft_your_turn) return;
  if (event === 'draft_pick_made' && !gp.draft_pick_made) return;

  // Check league prefs
  if (leagueId) {
    const { data: leagueRow } = await supabase
      .from('league_notification_prefs')
      .select('prefs')
      .eq('user_id', userId)
      .eq('league_id', leagueId)
      .maybeSingle();

    const lp = { ...DEFAULT_LEAGUE, ...(leagueRow?.prefs ?? {}) };
    if (!lp.enabled) return;
    if (event === 'waiver_approved' && !lp.waiver_results) return;
    if (event === 'waiver_rejected' && !lp.waiver_results) return;
    if (event === 'trade_accepted'  && !lp.trade_results)  return;
    if (event === 'trade_rejected'  && !lp.trade_results)  return;
    if (event === 'chat_message'    && !lp.chat_messages)  return;
    if ((event === 'live_goal' || event === 'live_assist') && !lp.live_goals) return;
  }

  // Load all subscriptions for this user
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (!subs || subs.length === 0) return;

  const expiredIds: string[] = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          expiredIds.push(sub.id);
        }
      }
    })
  );

  if (expiredIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', expiredIds);
  }
}

/**
 * Sends a push notification to all users in a league.
 * Each user's own prefs are checked individually.
 */
export async function sendPushToLeague(
  leagueId: string,
  event: PushEvent,
  payload: PushPayload,
  excludeUserId?: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data: teams } = await supabase
    .from('teams')
    .select('owner_id')
    .eq('league_id', leagueId);

  const userIds = (teams ?? [])
    .map((t: any) => t.owner_id as string)
    .filter((id) => id && id !== excludeUserId);

  await Promise.allSettled(
    userIds.map((userId) => sendPush(userId, event, payload, leagueId))
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no TypeScript errors in `lib/push.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/push.ts
git commit -m "feat: add lib/push.ts with sendPush + sendPushToLeague"
```

---

## Task 3: `lib/notification-prefs.ts` — Prefs types + client helpers

**Files:**
- Create: `lib/notification-prefs.ts`

These helpers are used by the settings UI pages to read and write prefs from the client side using the user's own Supabase session (not service role).

- [ ] **Step 1: Create `lib/notification-prefs.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ──────────────────────────────────────────────────────────────────

export type GlobalPrefs = {
  push_enabled: boolean;
  gw_start: boolean;
  gw_end: boolean;
  draft_your_turn: boolean;
  draft_pick_made: boolean;
};

export type LeaguePrefs = {
  enabled: boolean;
  waiver_results: boolean;
  trade_results: boolean;
  chat_messages: boolean;
  live_goals: boolean;
};

export const DEFAULT_GLOBAL: GlobalPrefs = {
  push_enabled: true,
  gw_start: true,
  gw_end: true,
  draft_your_turn: true,
  draft_pick_made: false,
};

export const DEFAULT_LEAGUE: LeaguePrefs = {
  enabled: true,
  waiver_results: true,
  trade_results: true,
  chat_messages: true,
  live_goals: false,
};

// ── Client-side read/write (uses user session) ─────────────────────────────

export async function getGlobalPrefs(supabase: SupabaseClient): Promise<GlobalPrefs> {
  const { data } = await supabase
    .from('user_notification_prefs')
    .select('prefs')
    .maybeSingle();
  return { ...DEFAULT_GLOBAL, ...(data?.prefs ?? {}) };
}

export async function setGlobalPrefs(
  supabase: SupabaseClient,
  prefs: Partial<GlobalPrefs>,
): Promise<void> {
  const { data: existing } = await supabase
    .from('user_notification_prefs')
    .select('prefs')
    .maybeSingle();
  const merged = { ...DEFAULT_GLOBAL, ...(existing?.prefs ?? {}), ...prefs };
  await supabase
    .from('user_notification_prefs')
    .upsert({ prefs: merged, updated_at: new Date().toISOString() });
}

export async function getLeaguePrefs(
  supabase: SupabaseClient,
  leagueId: string,
): Promise<LeaguePrefs> {
  const { data } = await supabase
    .from('league_notification_prefs')
    .select('prefs')
    .eq('league_id', leagueId)
    .maybeSingle();
  return { ...DEFAULT_LEAGUE, ...(data?.prefs ?? {}) };
}

export async function setLeaguePrefs(
  supabase: SupabaseClient,
  leagueId: string,
  prefs: Partial<LeaguePrefs>,
): Promise<void> {
  const { data: existing } = await supabase
    .from('league_notification_prefs')
    .select('prefs')
    .eq('league_id', leagueId)
    .maybeSingle();
  const merged = { ...DEFAULT_LEAGUE, ...(existing?.prefs ?? {}), ...prefs };
  await supabase
    .from('league_notification_prefs')
    .upsert({ league_id: leagueId, prefs: merged, updated_at: new Date().toISOString() });
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/notification-prefs.ts
git commit -m "feat: add lib/notification-prefs.ts with prefs types + client helpers"
```

---

## Task 4: Service Worker + next.config.ts

**Files:**
- Create: `worker/index.js`
- Modify: `next.config.ts`

next-pwa v5 reads `worker/index.js` (the `customWorkerDir` directory), bundles it into the generated `sw.js`. The file is plain JS (not TypeScript) because it runs in the SW context.

- [ ] **Step 1: Create `worker/` directory and `worker/index.js`**

```javascript
// worker/index.js
// This file is merged into the generated service worker by next-pwa.
// It adds Web Push handlers alongside the existing Workbox caching.

// Push event: display notification
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Tifo', body: event.data.text(), link: '/' };
  }

  const { title, body, link, icon } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: icon || '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      data: { link: link || '/' },
      vibrate: [200, 100, 200],
    })
  );
});

// Notification click: navigate to the linked page
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(link);
            return client.focus();
          }
        }
        return clients.openWindow(link);
      })
  );
});
```

- [ ] **Step 2: Check which icon files exist**

```bash
ls /Users/nikoko/my-fantasy-app/public/icons/
```

If `icon-192x192.png` doesn't exist but a similar file does (e.g., `icon-192.png`), update the `icon` path in `worker/index.js` to match. Same for the badge icon — use the smallest available icon (72×72 or similar).

- [ ] **Step 3: Add `customWorkerDir` to `next.config.ts`**

Open `next.config.ts`. The current withPWA config is:

```typescript
const withPWA = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  fallbacks: {
    document: "/offline",
  },
  runtimeCaching: [ ... ],
});
```

Add `customWorkerDir: 'worker'` so the full config becomes:

```typescript
const withPWA = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  customWorkerDir: 'worker',
  fallbacks: {
    document: "/offline",
  },
  runtimeCaching: [ /* leave unchanged */ ],
});
```

- [ ] **Step 4: Verify build compiles cleanly**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds, no errors about the worker file. (The SW won't be generated in dev mode — that's expected.)

- [ ] **Step 5: Commit**

```bash
git add worker/index.js next.config.ts
git commit -m "feat: add custom SW push/notificationclick handlers + customWorkerDir"
```

---

## Task 5: API Routes — subscribe + unsubscribe

**Files:**
- Create: `app/api/notifications/subscribe/route.ts`
- Create: `app/api/notifications/unsubscribe/route.ts`

- [ ] **Step 1: Create subscribe route**

Create `app/api/notifications/subscribe/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createServiceRoleClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  // Authenticate caller
  const supabaseAuth = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const { endpoint, p256dh, auth } = body ?? {};
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ ok: false, error: 'endpoint, p256dh, auth required' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id:    user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: req.headers.get('user-agent') ?? undefined,
      },
      { onConflict: 'user_id,endpoint' }
    );

  if (error) {
    console.error('[push/subscribe]', error.message);
    return NextResponse.json({ ok: false, error: 'db error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create unsubscribe route**

Create `app/api/notifications/unsubscribe/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createServiceRoleClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const supabaseAuth = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const { endpoint } = body ?? {};
  if (!endpoint) {
    return NextResponse.json({ ok: false, error: 'endpoint required' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', endpoint);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add app/api/notifications/subscribe/route.ts app/api/notifications/unsubscribe/route.ts
git commit -m "feat: add push subscribe/unsubscribe API routes"
```

---

## Task 6: API Route — push-dispatch

**Files:**
- Create: `app/api/notifications/push-dispatch/route.ts`

This route lets authenticated client-side code trigger push notifications when there's no dedicated server-side flow (trades, draft, GW status from admin UI). It accepts a union of event shapes and fans out to `sendPush` or `sendPushToLeague`.

- [ ] **Step 1: Create push-dispatch route**

Create `app/api/notifications/push-dispatch/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { sendPush, sendPushToLeague, type PushPayload } from '@/lib/push';

type DispatchBody =
  | { event: 'trade_accepted' | 'trade_rejected'; userId: string; payload: PushPayload; leagueId: string }
  | { event: 'draft_your_turn'; userId: string; payload: PushPayload; leagueId: string }
  | { event: 'draft_pick_made'; leagueId: string; payload: PushPayload; excludeUserId?: string }
  | { event: 'gw_started' | 'gw_finished'; gwId: string; payload: PushPayload }
  | { event: 'chat_message'; leagueId: string; payload: PushPayload; excludeUserId?: string };

export async function POST(req: NextRequest) {
  // Must be authenticated
  const supabaseAuth = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body: DispatchBody = await req.json().catch(() => null);
  if (!body?.event) {
    return NextResponse.json({ ok: false, error: 'event required' }, { status: 400 });
  }

  try {
    switch (body.event) {
      case 'trade_accepted':
      case 'trade_rejected':
      case 'draft_your_turn':
        await sendPush(body.userId, body.event, body.payload, body.leagueId);
        break;

      case 'draft_pick_made':
      case 'chat_message':
        await sendPushToLeague(body.leagueId, body.event, body.payload, body.excludeUserId);
        break;

      case 'gw_started':
      case 'gw_finished': {
        // Look up which leagues are active for this GW
        const supabase = createServiceRoleClient();
        const { data: gw } = await supabase
          .from('liga_gameweeks')
          .select('active_leagues')
          .eq('id', body.gwId)
          .maybeSingle();

        const leagueKeys: string[] = gw?.active_leagues ?? [];
        if (leagueKeys.length === 0) break;

        // Get league IDs by matching league key/name (active_leagues stores keys)
        const { data: leagues } = await supabase
          .from('leagues')
          .select('id')
          .in('key', leagueKeys);

        await Promise.allSettled(
          (leagues ?? []).map((l: any) =>
            sendPushToLeague(l.id, body.event, body.payload)
          )
        );
        break;
      }

      default:
        return NextResponse.json({ ok: false, error: 'unknown event' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('[push-dispatch]', err?.message);
    return NextResponse.json({ ok: false, error: 'send failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

> **Note on GW dispatch:** `liga_gameweeks.active_leagues` stores league keys (e.g., `"bundesliga"`, `"premier_league"`), not UUIDs. Check the actual column type/values in Supabase. If it stores UUIDs directly, remove the `leagues` lookup and call `sendPushToLeague` with those IDs directly. If it stores league names/keys, verify the `leagues` table has a `key` column — adjust the `.in('key', leagueKeys)` query to match the real column name.

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add app/api/notifications/push-dispatch/route.ts
git commit -m "feat: add push-dispatch API route for client-side push events"
```

---

## Task 7: `PushSubscriptionManager.tsx`

**Files:**
- Create: `app/components/PushSubscriptionManager.tsx`

Client component used on the notifications settings page to subscribe/unsubscribe from push.

- [ ] **Step 1: Create `PushSubscriptionManager.tsx`**

```tsx
'use client';

import { useState, useEffect } from 'react';

type Props = {
  onStatusChange?: (active: boolean) => void;
};

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;

export default function PushSubscriptionManager({ onStatusChange }: Props) {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  const isIOS = typeof navigator !== 'undefined' &&
    /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = typeof window !== 'undefined' &&
    ('standalone' in window.navigator
      ? (window.navigator as any).standalone
      : window.matchMedia('(display-mode: standalone)').matches);

  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    setPermission(Notification.permission);

    if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          const isActive = !!sub;
          setSubscribed(isActive);
          onStatusChange?.(isActive);
        });
      });
    }
  }, []);

  async function subscribe() {
    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return;

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const json = sub.toJSON();
      await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          p256dh:   json.keys?.p256dh,
          auth:     json.keys?.auth,
        }),
      });

      setSubscribed(true);
      onStatusChange?.(true);
    } catch (err) {
      console.error('[PushSubscriptionManager] subscribe failed:', err);
    } finally {
      setLoading(false);
    }
  }

  async function unsubscribe() {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/notifications/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      onStatusChange?.(false);
    } catch (err) {
      console.error('[PushSubscriptionManager] unsubscribe failed:', err);
    } finally {
      setLoading(false);
    }
  }

  // iOS not installed as PWA
  if (isIOS && !isStandalone) {
    return (
      <div className="rounded-2xl p-4"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--color-border)' }}>
        <p className="text-xs font-black mb-1" style={{ color: 'var(--color-text)' }}>
          Push-Benachrichtigungen
        </p>
        <p className="text-[9px]" style={{ color: 'var(--color-muted)' }}>
          Auf iPhone/iPad nur verfügbar wenn die App installiert ist.
          Tippe auf <strong>Teilen</strong> → <strong>Zum Home-Bildschirm</strong>.
        </p>
      </div>
    );
  }

  if (typeof Notification === 'undefined') {
    return (
      <div className="rounded-2xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--color-border)' }}>
        <p className="text-[9px]" style={{ color: 'var(--color-muted)' }}>
          Dein Browser unterstützt keine Push-Benachrichtigungen.
        </p>
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <div className="rounded-2xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--color-border)' }}>
        <p className="text-xs font-black mb-1" style={{ color: 'var(--color-error)' }}>Push blockiert</p>
        <p className="text-[9px]" style={{ color: 'var(--color-muted)' }}>
          Bitte in den Browser-Einstellungen unter Benachrichtigungen für diese Seite erlauben.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-4 flex items-center justify-between"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--color-border)' }}>
      <div>
        <p className="text-xs font-black" style={{ color: 'var(--color-text)' }}>
          Push-Benachrichtigungen
        </p>
        <p className="text-[9px] mt-0.5" style={{ color: subscribed ? 'var(--color-success)' : 'var(--color-muted)' }}>
          {subscribed ? 'Aktiv auf diesem Gerät' : 'Nicht aktiviert'}
        </p>
      </div>
      <button
        onClick={subscribed ? unsubscribe : subscribe}
        disabled={loading}
        className="px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
        style={{
          background: subscribed ? 'var(--color-border)' : 'var(--color-primary)',
          color: subscribed ? 'var(--color-text)' : 'var(--bg-page)',
          opacity: loading ? 0.6 : 1,
        }}>
        {loading ? '...' : subscribed ? 'Deaktivieren' : 'Aktivieren'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add app/components/PushSubscriptionManager.tsx
git commit -m "feat: add PushSubscriptionManager client component"
```

---

## Task 8: Global notifications settings page

**Files:**
- Create: `app/account/notifications/page.tsx`

The global settings page: push manager at top, global toggles (GW, Draft), and a list of the user's leagues linking to per-league settings.

- [ ] **Step 1: Create `app/account/notifications/page.tsx`**

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import PushSubscriptionManager from '@/app/components/PushSubscriptionManager';
import {
  getGlobalPrefs,
  setGlobalPrefs,
  type GlobalPrefs,
  DEFAULT_GLOBAL,
} from '@/lib/notification-prefs';

type League = { id: string; name: string };

// Toggle row component (reused on both settings pages)
function ToggleRow({
  label,
  desc,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-2xl"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--color-border)', opacity: disabled ? 0.4 : 1 }}>
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-xs font-black" style={{ color: 'var(--color-text)' }}>{label}</p>
        {desc && <p className="text-[9px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{desc}</p>}
      </div>
      <button
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="flex-shrink-0 relative w-10 h-5 rounded-full transition-all"
        style={{ background: checked ? 'var(--color-primary)' : 'var(--color-border)' }}>
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
          style={{
            background: checked ? 'var(--bg-page)' : 'var(--color-muted)',
            left: checked ? 'calc(100% - 18px)' : '2px',
          }}
        />
      </button>
    </div>
  );
}

export default function NotificationsPage() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<GlobalPrefs>(DEFAULT_GLOBAL);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const globalPrefs = await getGlobalPrefs(supabase);
      setPrefs(globalPrefs);

      // Load user's leagues
      const { data: user } = await supabase.auth.getUser();
      if (user.user) {
        const { data: teams } = await supabase
          .from('teams')
          .select('league_id, leagues(id, name)')
          .eq('owner_id', user.user.id);
        const leagueList = (teams ?? [])
          .map((t: any) => t.leagues)
          .filter(Boolean) as League[];
        setLeagues(leagueList);
      }
      setLoading(false);
    }
    load();
  }, []);

  async function toggle(key: keyof GlobalPrefs, value: boolean) {
    const updated = { ...prefs, [key]: value };
    setPrefs(updated); // optimistic
    await setGlobalPrefs(supabase, { [key]: value });
  }

  const disabled = !prefs.push_enabled;

  return (
    <main className="flex min-h-screen flex-col pb-24" style={{ background: 'var(--bg-page)', paddingTop: 16 }}>
      <div className="max-w-[480px] mx-auto w-full px-4">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6 pt-2">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 flex items-center justify-center rounded-xl"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--color-border)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="text-sm font-black uppercase tracking-widest" style={{ color: 'var(--color-text)' }}>
            Benachrichtigungen
          </h1>
        </div>

        {loading ? (
          <p className="text-[9px] text-center mt-8" style={{ color: 'var(--color-muted)' }}>Laden...</p>
        ) : (
          <div className="space-y-6">

            {/* Push manager (subscribe/unsubscribe) */}
            <section>
              <p className="text-[8px] font-black uppercase tracking-widest mb-2 px-1"
                style={{ color: 'var(--color-muted)' }}>Push</p>
              <PushSubscriptionManager
                onStatusChange={(active) => toggle('push_enabled', active)}
              />
            </section>

            {/* Global toggles */}
            <section>
              <p className="text-[8px] font-black uppercase tracking-widest mb-2 px-1"
                style={{ color: 'var(--color-muted)' }}>Global</p>
              <div className="space-y-2">
                <ToggleRow
                  label="Spieltag-Start"
                  checked={prefs.gw_start}
                  onChange={(v) => toggle('gw_start', v)}
                  disabled={disabled}
                />
                <ToggleRow
                  label="Spieltag-Ende"
                  checked={prefs.gw_end}
                  onChange={(v) => toggle('gw_end', v)}
                  disabled={disabled}
                />
                <ToggleRow
                  label="Draft: Du bist dran"
                  checked={prefs.draft_your_turn}
                  onChange={(v) => toggle('draft_your_turn', v)}
                  disabled={disabled}
                />
                <ToggleRow
                  label="Draft: Spieler gepickt"
                  desc="Benachrichtigung bei jedem Pick in deinen Ligen"
                  checked={prefs.draft_pick_made}
                  onChange={(v) => toggle('draft_pick_made', v)}
                  disabled={disabled}
                />
              </div>
            </section>

            {/* Per-league navigation */}
            {leagues.length > 0 && (
              <section>
                <p className="text-[8px] font-black uppercase tracking-widest mb-2 px-1"
                  style={{ color: 'var(--color-muted)' }}>Ligen</p>
                <div className="space-y-2">
                  {leagues.map((league) => (
                    <button
                      key={league.id}
                      onClick={() => router.push(`/account/notifications/${league.id}`)}
                      className="w-full flex items-center justify-between p-4 rounded-2xl text-left"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--color-border)' }}>
                      <span className="text-xs font-black" style={{ color: 'var(--color-text)' }}>
                        {league.name}
                      </span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        style={{ color: 'var(--color-muted)' }}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  ))}
                </div>
              </section>
            )}

          </div>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add app/account/notifications/page.tsx
git commit -m "feat: add global notifications settings page"
```

---

## Task 9: Per-league notifications settings page

**Files:**
- Create: `app/account/notifications/[leagueId]/page.tsx`

- [ ] **Step 1: Create `app/account/notifications/[leagueId]/page.tsx`**

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  getLeaguePrefs,
  setLeaguePrefs,
  type LeaguePrefs,
  DEFAULT_LEAGUE,
} from '@/lib/notification-prefs';

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-2xl"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--color-border)', opacity: disabled ? 0.4 : 1 }}>
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-xs font-black" style={{ color: 'var(--color-text)' }}>{label}</p>
        {desc && <p className="text-[9px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{desc}</p>}
      </div>
      <button
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="flex-shrink-0 relative w-10 h-5 rounded-full transition-all"
        style={{ background: checked ? 'var(--color-primary)' : 'var(--color-border)' }}>
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
          style={{
            background: checked ? 'var(--bg-page)' : 'var(--color-muted)',
            left: checked ? 'calc(100% - 18px)' : '2px',
          }}
        />
      </button>
    </div>
  );
}

export default function LeagueNotificationsPage() {
  const router = useRouter();
  const { leagueId } = useParams<{ leagueId: string }>();
  const [prefs, setPrefs] = useState<LeaguePrefs>(DEFAULT_LEAGUE);
  const [leagueName, setLeagueName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [leaguePrefs, leagueRow] = await Promise.all([
        getLeaguePrefs(supabase, leagueId),
        supabase.from('leagues').select('name').eq('id', leagueId).maybeSingle(),
      ]);
      setPrefs(leaguePrefs);
      setLeagueName(leagueRow.data?.name ?? '');
      setLoading(false);
    }
    load();
  }, [leagueId]);

  async function toggle(key: keyof LeaguePrefs, value: boolean) {
    const updated = { ...prefs, [key]: value };
    setPrefs(updated); // optimistic
    await setLeaguePrefs(supabase, leagueId, { [key]: value });
  }

  const masterDisabled = !prefs.enabled;

  return (
    <main className="flex min-h-screen flex-col pb-24" style={{ background: 'var(--bg-page)', paddingTop: 16 }}>
      <div className="max-w-[480px] mx-auto w-full px-4">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6 pt-2">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 flex items-center justify-center rounded-xl"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--color-border)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="text-sm font-black uppercase tracking-widest truncate" style={{ color: 'var(--color-text)' }}>
            {leagueName || 'Liga'}
          </h1>
        </div>

        {loading ? (
          <p className="text-[9px] text-center mt-8" style={{ color: 'var(--color-muted)' }}>Laden...</p>
        ) : (
          <div className="space-y-6">

            {/* Master toggle */}
            <ToggleRow
              label="Liga-Benachrichtigungen"
              desc="Alle Benachrichtigungen für diese Liga"
              checked={prefs.enabled}
              onChange={(v) => toggle('enabled', v)}
            />

            {/* Event-specific toggles */}
            <section>
              <p className="text-[8px] font-black uppercase tracking-widest mb-2 px-1"
                style={{ color: 'var(--color-muted)' }}>Ergebnisse</p>
              <div className="space-y-2">
                <ToggleRow
                  label="Waiver-Ergebnisse"
                  checked={prefs.waiver_results}
                  onChange={(v) => toggle('waiver_results', v)}
                  disabled={masterDisabled}
                />
                <ToggleRow
                  label="Trade-Ergebnisse"
                  checked={prefs.trade_results}
                  onChange={(v) => toggle('trade_results', v)}
                  disabled={masterDisabled}
                />
              </div>
            </section>

            <section>
              <p className="text-[8px] font-black uppercase tracking-widest mb-2 px-1"
                style={{ color: 'var(--color-muted)' }}>Chat</p>
              <ToggleRow
                label="Chat-Nachrichten"
                checked={prefs.chat_messages}
                onChange={(v) => toggle('chat_messages', v)}
                disabled={masterDisabled}
              />
            </section>

            <section>
              <p className="text-[8px] font-black uppercase tracking-widest mb-2 px-1"
                style={{ color: 'var(--color-muted)' }}>Live</p>
              <ToggleRow
                label="Tore & Assists"
                desc="Benachrichtigung wenn deine aufgestellten Spieler treffen (erfordert Live-Modus)"
                checked={prefs.live_goals}
                onChange={(v) => toggle('live_goals', v)}
                disabled={masterDisabled}
              />
            </section>

          </div>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add "app/account/notifications/[leagueId]/page.tsx"
git commit -m "feat: add per-league notifications settings page"
```

---

## Task 10: Update `app/account/page.tsx`

**Files:**
- Modify: `app/account/page.tsx`

Remove the inline notifications sub-section. The row navigates to `/account/notifications` via Next.js router instead.

- [ ] **Step 1: Add `useRouter` import**

At the top of `app/account/page.tsx`, add the router import (check if it's already imported):

```typescript
import { useRouter } from 'next/navigation';
```

Inside the component, add:
```typescript
const router = useRouter();
```

- [ ] **Step 2: Remove the notifications sub-section**

Find and delete the entire block:
```typescript
if (section === "notifications") return (
  <SubSection title="Benachrichtigungen" onBack={() => setSection("main")}>
    ...
  </SubSection>
);
```
(This spans from `if (section === "notifications") return (` to the matching closing `);` — approximately lines 256–315 in the current file.)

- [ ] **Step 3: Remove notifications-related state + functions**

Delete these items (they're only needed for the old inline section):

- `const [notifPermission, setNotifPermission] = useState(...)` 
- `const [notifs, setNotifs] = useState<NotifSettings>(...)` 
- The `NOTIF_LABELS` constant array at the top
- The `type NotifSettings = { ... }` type
- The `requestPushPermission()` function
- The `toggleNotif()` function
- The `useEffect` that calls `setNotifPermission(Notification.permission)`

Also remove `"notifications"` from the section type union:
```typescript
// Before:
const [section, setSection] = useState<"main" | "username" | "email" | "password" | "notifications">("main");
// After:
const [section, setSection] = useState<"main" | "username" | "email" | "password">("main");
```

- [ ] **Step 4: Update the SettingsRow to navigate**

Find the `SettingsRow` for push notifications in the main view (currently around line 392):

```tsx
<SettingsRow
  label="Push-Benachrichtigungen"
  value={notifPermission === "granted" ? "Aktiviert" : notifPermission === "denied" ? "Blockiert" : "Nicht aktiviert"}
  valueColor={notifPermission === "granted" ? "var(--color-success)" : notifPermission === "denied" ? "var(--color-error)" : "var(--color-muted)"}
  onClick={() => setSection("notifications")}
/>
```

Replace with:

```tsx
<SettingsRow
  label="Push-Benachrichtigungen"
  value="Einstellungen"
  onClick={() => router.push('/account/notifications')}
/>
```

- [ ] **Step 5: Verify build + lint**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
npm run lint 2>&1 | grep -E "error|warning" | head -20
```

Fix any TypeScript errors from removed variables.

- [ ] **Step 6: Commit**

```bash
git add app/account/page.tsx
git commit -m "refactor: route account/page.tsx push row to /account/notifications"
```

---

## Task 11: Wire waivers — `process-waivers/route.ts`

**Files:**
- Modify: `app/api/process-waivers/route.ts`

Add `sendPush()` calls right next to each existing `notifyTeam()` call. The waiver route uses `createServiceRoleClient()` already so `sendPush` works without any setup changes.

- [ ] **Step 1: Add sendPush import**

At the top of `app/api/process-waivers/route.ts`, add:

```typescript
import { sendPush } from '@/lib/push';
```

- [ ] **Step 2: Add push to approved waivers (priority-based)**

Find the approved block in `processByPriority` (around line 295–315):

```typescript
const userId = await getTeamUserId(teamId);
if (userId) {
  await notifyTeam(userId, leagueId, "waiver_result",
    "Waiver genehmigt! ✅",
    `${pInName} gehört jetzt zu deinem Kader${pOutName ? ` (${pOutName} entlassen)` : ""}.`,
    `/leagues/${leagueId}/waiver`
  );
}
```

Add push right after the `notifyTeam` call (still inside the `if (userId)` block):

```typescript
const userId = await getTeamUserId(teamId);
if (userId) {
  await notifyTeam(userId, leagueId, "waiver_result",
    "Waiver genehmigt! ✅",
    `${pInName} gehört jetzt zu deinem Kader${pOutName ? ` (${pOutName} entlassen)` : ""}.`,
    `/leagues/${leagueId}/waiver`
  );
  await sendPush(userId, 'waiver_approved', {
    title: '✅ Waiver genehmigt',
    body: `${pInName} gehört jetzt zu deinem Kader${pOutName ? ` (${pOutName} entlassen)` : ''}.`,
    link: `/leagues/${leagueId}/waiver`,
  }, leagueId);
}
```

- [ ] **Step 3: Add push to all rejected waiver calls**

There are multiple rejected paths in both `processByPriority` and `processByFaab`. For each `notifyTeam(userId, leagueId, "waiver_result", "Waiver abgelehnt", ...)` block, add a `sendPush` call right after:

```typescript
if (userId) {
  await notifyTeam(userId, leagueId, "waiver_result",
    "Waiver abgelehnt",
    `Dein Claim für ${pName} wurde abgelehnt — höhere Priorität.`,
    `/leagues/${leagueId}/waiver`
  );
  await sendPush(userId, 'waiver_rejected', {
    title: '❌ Waiver abgelehnt',
    body: `Dein Claim für ${pName} wurde abgelehnt.`,
    link: `/leagues/${leagueId}/waiver`,
  }, leagueId);
}
```

Do the same for all other rejection points (player not on wire, roster full, insufficient FAAB). The body text can be simplified to `Dein Claim für ${pName} wurde abgelehnt.` for all rejections, or match the `notifyTeam` body for consistency.

- [ ] **Step 4: Mirror changes in `app/api/process-waivers-wm/route.ts`**

Open `app/api/process-waivers-wm/route.ts`. It has the same pattern (also uses `createServiceRoleClient()`). Add the same `import { sendPush } from '@/lib/push'` and the same `sendPush()` calls next to each `notifyTeam()` call. The link pattern will use `/leagues/${leagueId}/waiver` or `/wm/${leagueId}/waiver` — check the existing link in that file's `notifyTeam` calls and use the same base path.

- [ ] **Step 5: Verify build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 6: Commit**

```bash
git add app/api/process-waivers/route.ts app/api/process-waivers-wm/route.ts
git commit -m "feat: wire sendPush into process-waivers for waiver approved/rejected events"
```

---

## Task 12: Wire GW status changes in `GameweeksTab.tsx`

**Files:**
- Modify: `app/components/admin/GameweeksTab.tsx`

`updateGWStatus` is a client-side function in the admin component. It updates Supabase directly. After a successful status change to `active` or `finished`, call push-dispatch.

- [ ] **Step 1: Find `updateGWStatus` in `GameweeksTab.tsx`**

Locate the `updateGWStatus` function (currently around line 232). It looks like:

```typescript
async function updateGWStatus(gwId: string, status: string, gwNum?: number) {
  // ...supabase update...
  const eventLabel =
    status === "active"   ? "gw_started"  :
    status === "finished" ? "gw_finished" : "gw_status_changed";

  if (status === "active" && onGWSelect) onGWSelect(gwNum);
```

- [ ] **Step 2: Add push-dispatch call after successful GW status update**

After the Supabase update and the existing logic, add a fire-and-forget call to push-dispatch. Only fire for `active` and `finished` status — not for `upcoming`:

```typescript
async function updateGWStatus(gwId: string, status: string, gwNum?: number) {
  const { error } = await supabase
    .from('liga_gameweeks')
    .update({ status })
    .eq('id', gwId);

  if (error) {
    // existing error handling (toast, return)
    return;
  }

  if (status === 'active' && onGWSelect) onGWSelect(gwNum);

  // Push notification for GW status changes
  if (status === 'active' || status === 'finished') {
    const event = status === 'active' ? 'gw_started' : 'gw_finished';
    const title = status === 'active'
      ? `▶ Spieltag ${gwNum ?? ''} gestartet`
      : `■ Spieltag ${gwNum ?? ''} beendet`;
    const body = status === 'active'
      ? 'Die Spieltag-Wertung läuft!'
      : 'Der Spieltag ist abgeschlossen.';

    fetch('/api/notifications/push-dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        gwId,
        payload: { title, body, link: '/' },
      }),
    }).catch((err) => console.warn('[push-dispatch] GW push failed:', err));
  }

  // existing reload/refresh logic
}
```

Make sure the `fetch` call is fire-and-forget (not `await`) — admin shouldn't be blocked by push.

- [ ] **Step 3: Verify the `liga_gameweeks` table structure**

In the push-dispatch route (Task 6), the GW event handler queries `liga_gameweeks.active_leagues` and then looks up leagues by key. Verify the `active_leagues` column and how leagues are referenced in `liga_gameweeks`:

```bash
# In Supabase SQL Editor, run:
# select active_leagues from liga_gameweeks limit 3;
# and check if active_leagues contains UUIDs or string keys
```

If `active_leagues` contains UUIDs directly (not keys), update the push-dispatch route's `gw_started`/`gw_finished` handler:

```typescript
// If active_leagues stores UUIDs:
const leagueIds: string[] = gw?.active_leagues ?? [];
await Promise.allSettled(
  leagueIds.map((id) => sendPushToLeague(id, body.event, body.payload))
);

// Remove the secondary `leagues` table lookup entirely.
```

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/GameweeksTab.tsx
git commit -m "feat: wire GW status push via push-dispatch in GameweeksTab"
```

---

## Task 13: Enhance `lib/notifications.ts` — trade push

**Files:**
- Modify: `lib/notifications.ts`

`insertNotification()` is called for all trade events (proposed, accepted, rejected, cancelled). It uses the client-side Supabase. After inserting the in-app notification, POST to push-dispatch for the events that should also send a push (`trade_accepted`, `trade_rejected`).

- [ ] **Step 1: Update `insertNotification()` to also call push-dispatch**

In `lib/notifications.ts`, update `insertNotification`:

```typescript
async function insertNotification(args: CreateArgs): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const actorId = auth.user?.id ?? null;

  // Don't notify yourself.
  if (actorId && actorId === args.userId) return;

  const { error } = await supabase.from("notifications").insert({
    user_id:   args.userId,
    actor_id:  actorId,
    league_id: args.leagueId,
    kind:      args.kind,
    title:     args.title,
    body:      args.body  ?? null,
    link:      args.link  ?? null,
    metadata:  args.metadata ?? {},
  });
  if (error) console.warn("[notifications] insert failed:", error.message);

  // Also send push for trade results
  if (args.kind === "trade_accepted" || args.kind === "trade_rejected") {
    const pushEvent = args.kind === "trade_accepted" ? "trade_accepted" : "trade_rejected";
    fetch("/api/notifications/push-dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event:    pushEvent,
        userId:   args.userId,
        leagueId: args.leagueId,
        payload: {
          title: args.title,
          body:  args.body ?? "",
          link:  args.link ?? `/leagues/${args.leagueId}/trades`,
        },
      }),
    }).catch((err) => console.warn("[push-dispatch] trade push failed:", err));
  }
}
```

The `fetch` is fire-and-forget — trade accept/reject UX shouldn't wait on push.

- [ ] **Step 2: Verify build + lint**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add lib/notifications.ts
git commit -m "feat: fire push-dispatch from insertNotification for trade_accepted/rejected"
```

---

## Task 14: Wire draft push in `app/leagues/[id]/draft/page.tsx`

**Files:**
- Modify: `app/leagues/[id]/draft/page.tsx`

Picks are done client-side. After a human pick is confirmed and `draft_sessions.current_pick` advances, send two push events:
1. `draft_pick_made` → to all league users (so they see who was picked)
2. `draft_your_turn` → to the next picker (if they're a real user, not a bot)

- [ ] **Step 1: Create a helper function at the top of the component file**

Add this helper near the top of `draft/page.tsx` (outside the component, after imports):

```typescript
async function sendDraftPush(
  leagueId: string,
  pickedPlayerName: string,
  pickerTeamName: string,
  nextPickerUserId: string | null,
  nextPickNumber: number,
  excludeUserId: string,
) {
  // 1. Notify all league users about the pick
  fetch('/api/notifications/push-dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'draft_pick_made',
      leagueId,
      excludeUserId,
      payload: {
        title: '📋 Spieler gepickt',
        body: `${pickerTeamName} nimmt ${pickedPlayerName}`,
        link: `/leagues/${leagueId}/draft`,
      },
    }),
  }).catch(() => {});

  // 2. Notify the next picker if they're a real user
  if (nextPickerUserId) {
    fetch('/api/notifications/push-dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'draft_your_turn',
        userId: nextPickerUserId,
        leagueId,
        payload: {
          title: '🎯 Du bist dran!',
          body: `Pick ${nextPickNumber + 1} — Dein Zug`,
          link: `/leagues/${leagueId}/draft`,
        },
      }),
    }).catch(() => {});
  }
}
```

- [ ] **Step 2: Call `sendDraftPush` after human picks**

Find the human pick handler (the function that calls `supabase.from("draft_picks").insert(...)` followed by `supabase.from("draft_sessions").update({ current_pick: nextPick })`). It's around line 425 in the current file.

After the `draft_sessions` update succeeds, add:

```typescript
// After updating draft_sessions.current_pick:
const nextPick = draftSession.current_pick + 1;
// ... existing update ...

// Get picked player name + next picker user_id for push
const { data: playerData } = await supabase
  .from('players')
  .select('name')
  .eq('id', pickedPlayerId)
  .maybeSingle();

const orderedTeams = /* existing teams order from component state */;
const nextTeam = orderedTeams[nextPick % orderedTeams.length];

sendDraftPush(
  leagueId,
  playerData?.name ?? 'Spieler',
  currentTeam?.name ?? 'Team',
  nextTeam?.user_id ?? null,
  nextPick,
  user?.id ?? '',
);
```

> **Note:** Adapt `pickedPlayerId`, `currentTeam`, `orderedTeams` to the actual variable names used in the draft page. The draft page manages `draftSession`, `teams`, and the pick number in state — use those. The player ID comes from whatever variable holds the selected player when the pick button is pressed.

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add "app/leagues/[id]/draft/page.tsx"
git commit -m "feat: send draft_pick_made + draft_your_turn push from draft page"
```

---

## Task 15: Live cron — dormant

**Files:**
- Create: `app/api/cron/live-push/route.ts`

This route exists but does nothing when `LIVE_PUSH_ENABLED=false`. Infrastructure is ready; activation is just an env var change.

- [ ] **Step 1: Create `app/api/cron/live-push/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { sendPush } from '@/lib/push';

export async function GET(req: NextRequest) {
  // Auth check (Vercel cron or manual with CRON_SECRET)
  const authHeader = req.headers.get('authorization') || '';
  const expected   = `Bearer ${process.env.CRON_SECRET ?? ''}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Feature flag — dormant until LIVE_PUSH_ENABLED=true
  if (process.env.LIVE_PUSH_ENABLED !== 'true') {
    return NextResponse.json({ ok: false, reason: 'disabled' });
  }

  const supabase = createServiceRoleClient();

  // Check if any GW is currently active (avoid running during off-weeks)
  const { data: activeGW } = await supabase
    .from('liga_gameweeks')
    .select('id')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!activeGW) {
    return NextResponse.json({ ok: true, skipped: 'no active gameweek' });
  }

  // Fetch all live fixtures from API-Football
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'API_FOOTBALL_KEY not set' }, { status: 500 });
  }

  const res = await fetch('https://v3.football.api-sports.io/fixtures?live=all', {
    headers: { 'x-apisports-key': apiKey },
  });
  const json = await res.json() as any;
  const fixtures = json.response ?? [];

  // Collect all goals/assists from live events
  type LiveEvent = { fixtureId: number; playerId: number; type: 'goal' | 'assist'; teamId: number };
  const events: LiveEvent[] = [];

  for (const fixture of fixtures) {
    for (const event of (fixture.events ?? [])) {
      if (event.type === 'Goal' && event.player?.id) {
        events.push({ fixtureId: fixture.fixture.id, playerId: event.player.id, type: 'goal', teamId: event.team?.id });
      }
      if (event.assist?.id) {
        events.push({ fixtureId: fixture.fixture.id, playerId: event.assist.id, type: 'assist', teamId: event.team?.id });
      }
    }
  }

  if (events.length === 0) {
    return NextResponse.json({ ok: true, events: 0 });
  }

  // Check live_push_cache to avoid re-sending already-notified events
  const cacheKeys = events.map((e) => `${e.fixtureId}:${e.playerId}:${e.type}`);
  const { data: cached } = await supabase
    .from('live_push_cache')
    .select('cache_key')
    .in('cache_key', cacheKeys);

  const cachedSet = new Set((cached ?? []).map((r: any) => r.cache_key));
  const newEvents = events.filter((e) => !cachedSet.has(`${e.fixtureId}:${e.playerId}:${e.type}`));

  if (newEvents.length === 0) {
    return NextResponse.json({ ok: true, events: 0, reason: 'all cached' });
  }

  // For each new event: find users with this player in their active starting XI
  let notified = 0;
  for (const event of newEvents) {
    const { data: squads } = await supabase
      .from('squad_players')
      .select('team_id, teams(owner_id, league_id)')
      .eq('player_id', event.playerId)
      .eq('in_starting_xi', true); // adjust column name to match actual schema

    for (const squad of (squads ?? [])) {
      const team = (squad as any).teams;
      if (!team?.owner_id || !team?.league_id) continue;

      await sendPush(team.owner_id, event.type === 'goal' ? 'live_goal' : 'live_assist', {
        title: event.type === 'goal' ? '⚽ Tor!' : '🎯 Assist!',
        body: `Spieler-ID ${event.playerId}`, // TODO: replace with player name lookup
        link: `/leagues/${team.league_id}`,
      }, team.league_id);
      notified++;
    }
  }

  // Cache processed events
  if (newEvents.length > 0) {
    await supabase.from('live_push_cache').insert(
      newEvents.map((e) => ({ cache_key: `${e.fixtureId}:${e.playerId}:${e.type}` }))
    );
  }

  return NextResponse.json({ ok: true, events: newEvents.length, notified });
}
```

> **`live_push_cache` table**: Create this in Supabase when activating the live push feature. Minimal schema:
> ```sql
> create table live_push_cache (
>   cache_key text primary key,
>   created_at timestamptz default now()
> );
> -- Clean up old entries with a scheduled job or TTL:
> -- delete from live_push_cache where created_at < now() - interval '24 hours';
> ```
> This table does NOT need to be created now — the cron is dormant and won't run until `LIVE_PUSH_ENABLED=true`.

> **`in_starting_xi` column**: Adjust `squad_players` query to use the actual column name for starting XI status. If it's a different column (e.g., `is_starting`, `starting`), update accordingly.

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Fix any type errors (the `live_push_cache` table doesn't exist yet — TypeScript may complain about unknown table names depending on how Supabase types are generated; use `as any` casts if needed).

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/live-push/route.ts
git commit -m "feat: add dormant live-push cron (LIVE_PUSH_ENABLED=false)"
```

---

## Task 16: End-to-end smoke test

Manual verification steps before shipping.

- [ ] **Step 1: Build in production mode**

```bash
npm run build
```

Expected: clean build, no errors.

- [ ] **Step 2: Test subscribe flow**

1. Open the app locally (`npm run dev` won't register SW — deploy to Vercel preview or use `NODE_ENV=production npm start`)
2. Go to `/account/notifications`
3. Tap "Aktivieren" — browser should show permission prompt
4. Allow notifications
5. Verify in Supabase: `push_subscriptions` table should have a new row for your user

- [ ] **Step 3: Test push sending**

In Supabase SQL Editor, manually fire a test push:

```sql
-- Get your subscription details
select endpoint, p256dh, auth from push_subscriptions where user_id = auth.uid() limit 1;
```

Then trigger a waiver run in the admin panel — you should receive a push notification when a waiver is processed.

Or test directly by calling the subscribe endpoint with curl and then manually triggering process-waivers from the admin UI.

- [ ] **Step 4: Test settings persistence**

1. Toggle off "Spieltag-Start" on `/account/notifications`
2. Reload the page
3. Verify the toggle stays off (prefs persisted to `user_notification_prefs`)
4. Toggle on "Trade-Ergebnisse" on a per-league page
5. Reload — verify persists

- [ ] **Step 5: Verify iOS hint**

Open on iPhone Safari (not installed as PWA). The `PushSubscriptionManager` should show the "Installiere die App" hint instead of the Aktivieren button.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: push notifications & PWA — complete implementation"
```

---

## Notes for future work

- **Chat push**: The chat feature doesn't exist yet (`href: null` in the nav). When chat is implemented, call `push-dispatch` with `event: 'chat_message'` from the chat send handler — the infrastructure is already in place.
- **Live push activation**: Set `LIVE_PUSH_ENABLED=true` in Vercel env. Create the `live_push_cache` table (DDL in Task 15). Add a Vercel cron entry to trigger `/api/cron/live-push` every 2 minutes during match days. Refine the player name lookup (currently logs player ID).
- **`process-waivers-wm/route.ts`**: May use `/wm/${leagueId}/waiver` as the link path — check the existing `notifyTeam` calls for the correct path pattern.
