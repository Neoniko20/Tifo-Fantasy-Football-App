# Design: Push Notifications & PWA — Web Push Integration

**Datum:** 2026-04-15  
**Status:** Approved  
**Scope:** Web Push API (VAPID), Notification-Prefs, Service Worker, Event-Katalog, Live-Cron (dormant)

---

## Problem

Die App hat bereits In-App-Notifications via Supabase Realtime — aber diese funktionieren nur wenn die App offen ist. Browser-Push-Notifications (ankommen wenn App geschlossen ist) fehlen vollständig. Die bestehende Notification-Section im Account-Tab nutzt nur `localStorage` ohne echte Push-Funktionalität.

---

## Ziel

1. Echte Web Push Notifications via VAPID + `web-push`
2. Konfigurierbare Einstellungen: global + pro Liga (analog Sleeper)
3. Push bei: Waiver, Trade, Spieltag, Draft, Chat
4. Live-Cron für Tore/Assists — Infrastruktur vorhanden, Feature-Flag deaktiviert
5. Die bestehende localStorage-basierte Notification-Section ersetzen

---

## Architektur

### Datenfluss

```
Browser                    Server                    Push Service
  │                           │                           │
  ├─ requestPermission()      │                           │
  ├─ PushManager.subscribe()  │                           │
  │  → PushSubscription       │                           │
  ├── POST /api/notifications/subscribe ──────────────────│
  │                           │                           │
  │              Event (z.B. Waiver verarbeitet)          │
  │                           ├─ sendPush(userId, event)  │
  │                           ├── web-push.sendNotification() ─→
  │                           │                           │
  │◄── Push-Event ────────────────────────────────────────┤
  ├─ SW: push handler         │                           │
  ├─ showNotification()       │                           │
  └─ notificationclick → openWindow(link)                 │
```

### Neue Dateien

```
worker/
  index.js                          ← Custom SW: push + notificationclick handler
lib/
  push.ts                           ← sendPush() + web-push Init + VAPID Setup
  notification-prefs.ts             ← Prefs lesen/schreiben (Server + Client Helpers)
app/
  api/notifications/
    subscribe/route.ts              ← POST: PushSubscription speichern
    unsubscribe/route.ts            ← POST: Subscription löschen (bei Deaktivierung)
  account/notifications/
    page.tsx                        ← Globale Einstellungsseite + Liga-Liste
    [leagueId]/page.tsx             ← Pro-Liga-Einstellungen
  components/
    PushSubscriptionManager.tsx     ← Client: requestPermission + SW subscribe + POST
db/
  push_schema.sql                   ← 3 neue Tabellen (DDL)
```

### Geänderte Dateien

| Datei | Änderung |
|---|---|
| `app/account/page.tsx` | Notification-Section entfernen, Row bleibt als Link zu `/account/notifications` |
| `next.config.ts` | `customWorkerDir: 'worker'` ergänzen |
| `app/api/process-waivers/route.ts` | `sendPush()` nach Verarbeitung |
| `app/api/process-waivers-wm/route.ts` | `sendPush()` nach Verarbeitung |
| `app/components/admin/GameweeksTab.tsx` | `sendPush()` bei GW-Status-Änderung |
| Draft-API-Route | `sendPush()` nach jedem Pick |
| Chat-API-Route | `sendPush()` bei neuer Nachricht |

### Env-Vars (neu)

```
VAPID_PUBLIC_KEY=        # öffentlicher VAPID-Schlüssel (auch im Client)
VAPID_PRIVATE_KEY=       # privat, nur server-seitig
VAPID_SUBJECT=           # mailto:admin@tifo.app
NEXT_PUBLIC_VAPID_PUBLIC_KEY=  # identisch mit VAPID_PUBLIC_KEY, fürs Browser-Subscribe
LIVE_PUSH_ENABLED=false  # Feature-Flag für Live-Tor/Assist-Cron
```

---

## Datenbank

### `push_subscriptions`

```sql
create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz default now()
);
-- Ein User kann mehrere Subscriptions haben (Handy + Tablet)
create unique index on push_subscriptions(user_id, endpoint);
create index on push_subscriptions(user_id);
```

### `user_notification_prefs`

```sql
create table user_notification_prefs (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  prefs     jsonb not null default '{}',
  updated_at timestamptz default now()
);
```

**Prefs-Schema (JSONB):**
```typescript
type GlobalPrefs = {
  push_enabled: boolean;      // Master-Toggle
  gw_start: boolean;
  gw_end: boolean;
  draft_your_turn: boolean;
  draft_pick_made: boolean;
};
const DEFAULT_GLOBAL: GlobalPrefs = {
  push_enabled: true,
  gw_start: true,
  gw_end: true,
  draft_your_turn: true,
  draft_pick_made: false,
};
```

### `league_notification_prefs`

```sql
create table league_notification_prefs (
  user_id    uuid not null references auth.users(id) on delete cascade,
  league_id  uuid not null references leagues(id) on delete cascade,
  prefs      jsonb not null default '{}',
  updated_at timestamptz default now(),
  primary key (user_id, league_id)
);
```

**Prefs-Schema (JSONB):**
```typescript
type LeaguePrefs = {
  enabled: boolean;           // Master für diese Liga
  waiver_results: boolean;
  trade_results: boolean;
  chat_messages: boolean;
  live_goals: boolean;        // nur wirksam wenn LIVE_PUSH_ENABLED=true
};
const DEFAULT_LEAGUE: LeaguePrefs = {
  enabled: true,
  waiver_results: true,
  trade_results: true,
  chat_messages: true,
  live_goals: false,
};
```

**RLS-Policies:** User darf nur eigene Rows lesen/schreiben.

---

## Service Worker (`worker/index.js`)

next-pwa v5 liest `worker/index.js` automatisch ein und bundled es in den generierten `sw.js`. Keine manuelle SW-Registrierung nötig.

```javascript
// Push-Event: Notification anzeigen
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const { title, body, link, icon } = event.data.json();
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: icon || '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      data: { link: link || '/' },
      vibrate: [200, 100, 200],
    })
  );
});

// Klick auf Notification: App öffnen oder fokussieren
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
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

---

## `lib/push.ts` — Zentrale Sendefunktion

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

/**
 * Sendet eine Push-Notification an alle aktiven Subscriptions eines Users.
 * Prüft vorher ob der User diesen Event-Typ aktiviert hat.
 * Löscht automatisch abgelaufene Subscriptions (410 Gone).
 */
export async function sendPush(
  userId: string,
  event: PushEvent,
  payload: PushPayload,
  leagueId?: string,
): Promise<void> {
  const supabase = createServiceRoleClient();

  // Prefs prüfen
  const { data: globalPrefs } = await supabase
    .from('user_notification_prefs')
    .select('prefs')
    .eq('user_id', userId)
    .maybeSingle();

  const gp = { ...DEFAULT_GLOBAL, ...(globalPrefs?.prefs ?? {}) };
  if (!gp.push_enabled) return;

  // Event-Typ gegen globale Prefs prüfen
  if (event === 'gw_started'      && !gp.gw_start)        return;
  if (event === 'gw_finished'     && !gp.gw_end)           return;
  if (event === 'draft_your_turn' && !gp.draft_your_turn)  return;
  if (event === 'draft_pick_made' && !gp.draft_pick_made)  return;

  // Liga-spezifische Prefs prüfen
  if (leagueId) {
    const { data: leaguePrefs } = await supabase
      .from('league_notification_prefs')
      .select('prefs')
      .eq('user_id', userId)
      .eq('league_id', leagueId)
      .maybeSingle();

    const lp = { ...DEFAULT_LEAGUE, ...(leaguePrefs?.prefs ?? {}) };
    if (!lp.enabled) return;
    if (event === 'waiver_approved' && !lp.waiver_results) return;
    if (event === 'waiver_rejected' && !lp.waiver_results) return;
    if (event === 'trade_accepted'  && !lp.trade_results)  return;
    if (event === 'trade_rejected'  && !lp.trade_results)  return;
    if (event === 'chat_message'    && !lp.chat_messages)  return;
    if ((event === 'live_goal' || event === 'live_assist') && !lp.live_goals) return;
  }

  // Alle Subscriptions des Users laden
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

  // Abgelaufene Subscriptions löschen
  if (expiredIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', expiredIds);
  }
}

const DEFAULT_GLOBAL = {
  push_enabled: true, gw_start: true, gw_end: true,
  draft_your_turn: true, draft_pick_made: false,
};

const DEFAULT_LEAGUE = {
  enabled: true, waiver_results: true, trade_results: true,
  chat_messages: true, live_goals: false,
};
```

---

## API-Routes

### `POST /api/notifications/subscribe`

```typescript
// Body: { endpoint, p256dh, auth }
// Upsert in push_subscriptions (user_id aus Auth-Token)
```

### `POST /api/notifications/unsubscribe`

```typescript
// Body: { endpoint }
// Löscht Subscription für diesen User + Endpoint
```

### Hilfsfunktion `sendPushToLeague(leagueId, event, payload)`

Für Events die alle User einer Liga betreffen (GW-Start, Draft-Pick, Chat):

```typescript
// lib/push.ts
export async function sendPushToLeague(
  leagueId: string,
  event: PushEvent,
  payload: PushPayload,
  excludeUserId?: string,   // z.B. Chat-Absender ausschließen
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data: teams } = await supabase
    .from('teams')
    .select('owner_id')
    .eq('league_id', leagueId);

  const userIds = (teams || [])
    .map((t: any) => t.owner_id)
    .filter((id: string) => id && id !== excludeUserId);

  await Promise.allSettled(
    userIds.map((userId: string) => sendPush(userId, event, payload, leagueId))
  );
}
```

---

## UI: Notification Settings

### Konto-Seite (`app/account/page.tsx`)

Die bestehende Notifications-SubSection wird **entfernt**. Der bestehende Row "Push-Benachrichtigungen" bleibt, navigiert aber jetzt zu `/account/notifications` (Next.js Router) statt zur internen Section.

Der Row zeigt den Status:
- `"Nicht aktiviert"` → grau
- `"Aktiv"` → grün (wenn `Notification.permission === "granted"` und mind. 1 Subscription in DB)
- `"Blockiert"` → rot (wenn `Notification.permission === "denied"`)

### Globale Einstellungsseite (`app/account/notifications/page.tsx`)

```
← Zurück    Benachrichtigungen

PUSH
  [PushSubscriptionManager]
  ← Zeigt Status + Aktivieren/Deaktivieren Button
  
  Wenn iOS & nicht standalone: 
  "Installiere die App (Teilen → Zum Home-Bildschirm) um Push zu aktivieren"

GLOBAL
  Spieltag-Start              ●
  Spieltag-Ende               ●
  Draft: Du bist dran         ●
  Draft: Spieler gepickt      ○

LIGEN
  [Liga-Name]                 ›     ← je eine Row pro Liga des Users
  [Liga-Name]                 ›
```

Toggles deaktiviert (gedimmt) wenn push_enabled = false.

### Pro-Liga-Seite (`app/account/notifications/[leagueId]/page.tsx`)

```
← Zurück    [Liga-Name]

Liga-Benachrichtigungen aktivieren  ●

ERGEBNISSE
  Waiver-Ergebnisse          ●
  Trade-Ergebnisse           ●

LIVE
  Tore & Assists             ○
  (nur sichtbar wenn waiverEnabled oder liga_settings.live_enabled)

CHAT
  Chat-Nachrichten           ●
```

Alle Toggles sofort in DB gespeichert (kein Speichern-Button, optimistisches Update).

### `PushSubscriptionManager.tsx` (Client-Komponente)

Zuständig für:
1. `Notification.requestPermission()` beim ersten Aktivieren
2. `navigator.serviceWorker.ready` → `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`
3. POST an `/api/notifications/subscribe`
4. Bei Deaktivierung: `subscription.unsubscribe()` + POST an `/api/notifications/unsubscribe`
5. iOS-Detection: Hinweistext wenn `isIOS && !isStandalone`

---

## Event-Katalog (vollständig)

| Event | Ausgelöst in | `sendPush(userId, event, payload, leagueId?)` |
|---|---|---|
| Waiver genehmigt | `process-waivers`, `process-waivers-wm` | Pro betroffenem Team-Owner |
| Waiver abgelehnt | `process-waivers`, `process-waivers-wm` | Pro betroffenem Team-Owner |
| Trade angenommen | Trade-Accept-Route | Beide beteiligten User |
| Trade abgelehnt | Trade-Reject-Route | Antragsteller |
| Spieltag gestartet | `GameweeksTab.updateGWStatus → active` | Alle User der Liga |
| Spieltag beendet | `GameweeksTab.updateGWStatus → finished` | Alle User der Liga |
| Draft: Du bist dran | Draft-Pick-Advance-Route | Aktueller Picker |
| Draft: Spieler gepickt | Draft-Pick-Route | Alle User der Liga |
| Chat-Nachricht | Chat-API-Route | Alle User der Liga außer Absender |
| Live: Tor | Cron (dormant, `LIVE_PUSH_ENABLED=false`) | User dessen aufgestellter Spieler traf |
| Live: Assist | Cron (dormant, `LIVE_PUSH_ENABLED=false`) | User dessen aufgestellter Spieler auflegte |

**Payload-Beispiele:**

```typescript
// Waiver genehmigt
{ title: "✅ Waiver genehmigt", body: "Müller kommt zu deinem Team", link: "/leagues/{id}/waiver" }

// Du bist dran beim Draft
{ title: "🎯 Du bist dran!", body: "Liga Fumbletown — Pick 7", link: "/leagues/{id}/draft" }

// Chat-Nachricht
{ title: "💬 MaxMustermann", body: "Wer traut sich, Mbappé zu droppen?", link: "/leagues/{id}/chat" }

// Live Tor
{ title: "⚽ Tor! Müller", body: "Thomas Müller trifft für Bayern München", link: "/leagues/{id}" }
```

---

## Live-Cron (dormant)

**Datei:** `app/api/cron/live-push/route.ts`

- Liest `LIVE_PUSH_ENABLED` — gibt sofort `{ ok: false, reason: "disabled" }` zurück wenn `false`
- Wenn `true`: Fetch `https://v3.football.api-sports.io/fixtures?live=all`
- Vergleicht mit gecachten Events (Redis oder Supabase-Tabelle `live_push_cache`) um Duplikate zu vermeiden
- Für jeden neuen Goal/Assist: sucht alle User aller aktiven Ligen deren Starting-XI diesen Spieler enthält
- Ruft `sendPush()` für jeden betroffenen User auf
- Cron-Interval: alle 2 Minuten, nur aktiv wenn ein GW als `active` markiert ist

**Aktivierung:** `LIVE_PUSH_ENABLED=true` in env setzen — kein Code-Umbau nötig.

---

## Was sich nicht ändert

- Supabase Realtime In-App-Notifications (`NotificationsProvider`, `NotificationsDrawer`) bleiben unverändert
- `InstallPrompt.tsx` bleibt unverändert
- Kein neues DB-Schema für bestehende Notification-Tabelle
- Bestehende API-Routes bleiben weitgehend unverändert (nur `sendPush()` Call wird ergänzt)

---

## Nicht im Scope

- E-Mail-Notifications
- Push-Notifications für WM-Modul (separates Ticket)
- Notification-History / Gelesen-Status für Push (In-App-Notifications haben das bereits)
- Badge-Counter auf App-Icon (OS-abhängig, komplex)
