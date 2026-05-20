# WM Live-Turnier UX — Architektur & Produktplan

**Datum:** 2026-05-20
**Status:** Approved — bereit für Implementation Plans
**Branch:** feature/league-chat-dms

---

## Überblick

Der WM-Modus soll sich wie ein echtes Live-Turnier anfühlen: emotional, dynamisch, visuell, broadcast-artig.

Dieses Dokument beschreibt die Architektur und den Produktplan für **Phase B** des WM-Modus — ohne Premium-API-Football-Integration, aber mit vollständiger Vorbereitung für den späteren Austausch.

### Vier Seiten-Rollen (nach Abschluss)

| Route | Rolle | Stimmung |
|---|---|---|
| `/wm/[id]` | Liga-Zentrale (Hub) | ruhig, übersichtlich |
| `/wm/[id]/matchday` | Fixtures + Turnierstruktur | informativ, strukturiert |
| `/wm/[id]/live` | Fantasy Live-Center | broadcast, dramatisch |
| `/wm/[id]/admin` | Kontrollzentrum | operativ |

### Kerngrundsatz: Producer-agnostic Ingest Layer

Alle Daten-Produzenten (Simulator, Admin, später API-Football) schreiben über **denselben** zentralen Endpunkt. Kein Producer löst direkt Side Effects aus. Die UI liest ausschließlich aus Ergebnis-Tabellen über Supabase Realtime.

```
Producer (Simulator / Admin / API-Football)
    ↓
POST /api/wm/[id]/events
    ↓
① Validation + Auth (Owner-only)
② Normalization (IDs auflösen, Timestamps setzen)
③ DB Writes (wm_fixtures, wm_gameweek_points, wm_nations, ...)
④ Side Effects (System Messages, Nation-Check, Points-Rebuild-Trigger)
⑤ Audit Log → wm_event_log
    ↓
Supabase Realtime → UI liest aus Ergebnis-Tabellen
```

---

## Phase A — Fundament

### A1: Event Ingest Layer

**Neue Route:** `POST /api/wm/[id]/events`
**Auth:** Owner-only (identisch mit Recovery-Routen)

#### Event-Contract V1

```typescript
interface WMIngestEvent {
  type: WMEventType;
  tournament_id: string;
  gameweek?: number;
  payload: Record<string, unknown>;
  idempotency_key?: string;   // für Simulator + API-Football Sync
  source?: "simulator" | "admin" | "api_football";
}

type WMEventType =
  | "fixture.status_changed"       // scheduled → live → finished
  | "fixture.score_updated"        // home_score, away_score
  | "fixture.penalties_updated"    // penalties_home, penalties_away
  | "player.stat_update"           // goals, assists, minutes, cards, saves, clean_sheet
  | "gameweek.status_changed"      // upcoming → active → finished
  | "nation.eliminated"            // nach einem GW ausgeschieden
  | "gameweek.points_recalculated" // Punkte neu berechnet (triggert Live Center + Debug)
  | "auto_sub.applied"             // Auto-Sub durchgeführt (für Live Center + Chat)
  | "waiver.claim_processed"       // Waiver-Antrag genehmigt/abgelehnt (für Chat)
```

#### Side Effects pro Event-Typ

| Event | DB Write | Side Effect |
|---|---|---|
| `fixture.score_updated` | `wm_fixtures.home_score/away_score` | — |
| `fixture.status_changed` → `live` | `wm_fixtures.status` | System Message: Anpfiff |
| `fixture.status_changed` → `finished` | `wm_fixtures.status` | System Message: Abpfiff, Nation-Elimination-Check |
| `fixture.penalties_updated` | `wm_fixtures.penalties_home/away` | — |
| `player.stat_update` (Tor) | `wm_gameweek_points` (Zeile upsert) | System Message: Tor-Event |
| `nation.eliminated` | `wm_nations.eliminated_after_gameweek` | System Message: Nation aus |
| `auto_sub.applied` | `team_substitutions`, `team_lineups.starting_xi` | System Message: Auto-Sub |
| `waiver.claim_processed` | (bereits in waiver-flow) | System Message: Waiver |
| `gameweek.status_changed` → `finished` | `wm_gameweeks.status` | Auto-Sub-Readiness-Flag |
| `gameweek.points_recalculated` | (kein zusätzlicher Write) | System Message: Punkte aktualisiert |

#### Neue Tabelle: `wm_event_log`

```sql
CREATE TABLE wm_event_log (
  id                  uuid primary key default gen_random_uuid(),
  league_id           text not null,
  tournament_id       text not null,
  event_type          text not null,
  payload             jsonb not null default '{}',
  source              text,                   -- simulator | admin | api_football
  idempotency_key     text unique,            -- verhindert Doppel-Processing
  status              text default 'pending', -- pending | processed | failed
  error_message       text,
  processed_by        text,
  related_fixture_id  uuid,
  related_team_id     uuid,
  related_player_id   int,
  processed_at        timestamptz,
  created_at          timestamptz default now()
);

-- Indexes
CREATE INDEX wm_event_log_league_gw ON wm_event_log(league_id, event_type);
CREATE INDEX wm_event_log_source ON wm_event_log(source);
```

#### Antwort-Format

```typescript
// Erfolg
{ ok: true, event_id: string, applied: string[], warnings: string[] }

// Fehler
{ ok: false, error: string, event_type: string }
```

#### API-Football-Kompatibilität

Wenn API-Football später integriert wird, implementiert ein Sync-Job:
1. API-Football-Response normalisieren
2. `WMIngestEvent`-Objekte konstruieren
3. Dieselbe `/api/wm/[id]/events`-Route aufrufen

Kein anderer Code ändert sich. Der Ingest Layer ist der einzige Seam.

---

### A2: Tournament Simulator

**Prinzip:** Der Simulator ist ein Event-Producer, kein eigenes Parallel-System. Er erzeugt `WMIngestEvent`-Objekte und schickt sie durch den Ingest Layer.

**Neue Route:** `POST /api/wm/[id]/simulate`

```typescript
interface SimulateRequest {
  scope: "fixture" | "gameweek" | "tournament" | "reset";
  fixture_id?: string;
  gameweek?: number;
  seed?: number;
  dry_run?: boolean;   // Preview ohne DB-Writes
  force?: boolean;     // Überschreibt admin/api_football Events
  reset_scope?: "simulated_only" | "gameweek" | "tournament"; // default: simulated_only
}
```

#### Capabilities V1

| Capability | Beschreibung |
|---|---|
| `scope: "fixture"` | Ein Fixture simulieren — zufälliger Score, Spieler-Stats verteilen |
| `scope: "gameweek"` | Alle Fixtures eines GW durchspielen |
| `scope: "tournament"` | Alle GWs sequenziell, KO-Logik, bis Finale |
| `scope: "reset"` | Simulierte Daten zurücksetzen (nach `reset_scope`) |
| `dry_run: true` | Zeigt Events, betroffene Fixtures/Teams — kein DB-Write |
| `seed` | Deterministischer Zufallsgenerator für reproduzierbare Läufe |

#### Dry-Run Response

```typescript
{
  ok: true,
  dry_run: true,
  events_preview: WMIngestEvent[],  // was erzeugt würde
  affected_fixtures: string[],
  affected_teams: string[],
  estimated_point_changes: Array<{ team_id: string; delta: number }>
}
```

#### Source-Protection

Vor jedem Write prüft der Simulator `wm_event_log` auf Einträge mit `source IN ('admin', 'api_football')` für betroffene Fixtures. Wenn gefunden und `force !== true`:
- Bei `dry_run`: Warning in Response
- Bei normalem Run: Fehler, Fixture wird übersprungen

#### Reset-Scopes

- `simulated_only` (default): Nur `source = 'simulator'` Einträge entfernen
- `gameweek`: Alle Events/Scores eines GW zurücksetzen (unabhängig von source) — erfordert `window.confirm()` in Admin-UI
- `tournament`: Ganzes Turnier — erfordert doppeltes `window.confirm()`

#### Score-Generierung

```typescript
// WM-realistische Verteilung (Gruppenphase)
// 0 Tore: 28% | 1 Tor: 34% | 2 Tore: 24% | 3+ Tore: 14%
// ~30% Remis erlaubt in Gruppenphase
// KO-Phase: Remis → automatisch penalties_home/away generieren

function generateScore(
  phase: WMPhase,
  seed?: number
): { home: number; away: number; penalties_home?: number; penalties_away?: number }
```

#### Admin-UI: Neuer Tab "Simulator"

Im bestehenden Admin-Panel (`/wm/[id]/admin`):

```
[Tab: Simulator]

▸ Einzelnes Fixture simulieren
  Fixture wählen  → [Dry-Run ▶]  [Simulieren ▶]

▸ GW durchspielen
  GW-Selektor → [Dry-Run ▶]  [Alle Fixtures simulieren ▶]

▸ Komplettes Turnier
  Seed (optional): ___  → [Dry-Run ▶]  [Turnier simulieren ▶]

▸ Simulation zurücksetzen
  Scope: [Nur Simulator ▼]  → [Reset ▶]  ← window.confirm()
```

#### V1 Nicht-Scope (bewusst ausgeschlossen)

- Kein Transfer/Waiver-Simulation
- Keine Spieler-Verletzungen
- Kein Minuten-Timeline (Tor in Minute 67)
- Keine automatische Waiver-Simulation

Lib: `lib/wm-simulator.ts` — enthält Score-Generierung und Event-Builder, keine DB-Calls.

---

## Phase B — Nutzer-Features

### B1: Fantasy Live Center `/wm/[id]/live`

**Neue Route.** Eigenständiges Layout, das sich bewusst vom ruhigen Hub unterscheidet.

#### Design-Grundsätze

- **Read-only** für normale User — keine Schreiboperationen
- **Realtime-first** — 3 Supabase-Channels, manuelle Fallback-Option bei Verbindungsabbruch
- **Mobile-first** — single-column, optimiert für 320px+
- **Fixture-agnostisch** — funktioniert mit manuell eingegebenen und simulierten Daten gleichermaßen

#### Seitenstruktur

```
/wm/[id]/live
├── [1] Live Ticker Strip         ← letzter wichtiger Event als Breaking-Bar
├── [2] GW Status Banner          ← "GW3 läuft · 5/8 Spiele beendet"
├── [3] My Points Card            ← Meine GW-Punkte, Captain, VC, Auto-Sub
├── [4] Live Leaderboard          ← Alle Teams sortiert nach GW-Punkten
├── [5] Active Fixtures Strip     ← MatchCards der laufenden/fertigen Fixtures
├── [6] My Players Grid           ← Meine XI + Bench, Status + Einzelpunkte
└── [7] Event Feed                ← chronologischer System-Messages-Stream
```

**Desktop (≥768px):** My Points Card + Leaderboard nebeneinander, 2-Spalten-Grid.

#### Live Ticker Strip (Bereich 1)

Single-line Breaking-Bar, fade-in-Transition bei neuem Event.

Priority-Reihenfolge: `nation.eliminated` > `player.stat_update` (Tor) > `auto_sub.applied` > Rest

```
⚽ Spieler X trifft für Deutschland · GW3
→ Auto-Sub bei Team Y: Müller → Havertz
🚩 Nation ausgeschieden: Japan nach GW3
```

Kein Scrollen, kein Archiv — nur der aktuellste relevante Event.

#### Datenquellen + Realtime

```typescript
// Initial load (parallel)
const [leaderboard, fixtures, myLineup, nations, messages] = await Promise.all([
  fetchAllTeamsGWPoints(leagueId, gw),    // wm_gameweek_points + teams
  fetchActiveFixtures(tournamentId, gw),  // wm_fixtures
  fetchMyLineup(teamId, gw),              // team_lineups + wm_squad_players
  fetchNationStatus(tournamentId),        // wm_nations
  fetchRecentMessages(leagueId, 20),      // league_messages
])

// 3 Realtime Channels
supabase.channel('wm-live-center')
  .on('postgres_changes',
    { table: 'wm_gameweek_points', filter: `league_id=eq.${leagueId}` },
    (payload) => updateLeaderboardAndMyPlayers(payload.new)
  )
  .on('postgres_changes',
    { table: 'wm_fixtures', filter: `tournament_id=eq.${tournamentId}` },
    (payload) => updateFixtureStrip(payload.new)
  )
  .on('postgres_changes',
    { table: 'league_messages', filter: `league_id=eq.${leagueId}` },
    (payload) => prependToEventFeed(payload.new)
  )
  .subscribe()
```

**Fehlerbehandlung Realtime:**
```typescript
.on('system', { event: 'disconnect' }, () => {
  setRealtimeStatus('disconnected')
  // zeigt Banner: "Verbindung unterbrochen — [Neu laden]"
})
```

#### Leaderboard-Datenmodell

```typescript
interface LiveTeamRow {
  team_id: string;
  team_name: string;
  gw_points: number;           // Summe wm_gameweek_points.points für diesen GW
  total_points: number;        // teams.total_points (season)
  rank_delta: number;          // +1 / -2 / 0 vs. letzter Stand (animierbar)
  players_playing: number;     // Spieler in aktiven Fixtures
  players_total: number;       // Spieler im XI
  captain_points: number;      // Captain-Beitrag
  has_nation_eliminated: boolean;
  is_my_team: boolean;
}
```

**Update-Strategie:** Inkrementell — bei `wm_gameweek_points`-Update nur betroffene Team-Zeile neu berechnen, kein Full-Refetch.

#### My Players Grid

Jede Spieler-Karte:
- Name + Position + Nationalflagge
- GW-Punkte (animiert bei Update)
- Status-Indikator:
  - `🟢 Spielt gerade` — Nation in aktivem Fixture
  - `✅ Fertig` — Fixture beendet
  - `⏳ Noch nicht gespielt`
  - `❌ Nation eliminiert`
- Captain-Badge (C / VC)
- Auto-Sub-Indikator (wenn Einwechslung erfolgt)
- `~` Prefix bei Punkten wenn `status === 'playing'` — kein komplexes Prediction-System

**Projected Points V1:** Ehrlich + simpel. `~` nur als visueller Hinweis, keine numerische Hochrechnung. Kein `~` bei eliminierten Spielern.

#### Hub-Integration

```tsx
{activeGW && (
  <Link href={`/wm/${leagueId}/live`}>
    <div className="live-banner">
      <span className="live-dot animate-pulse" />
      GW{activeGW.gameweek} läuft — Live Center →
    </div>
  </Link>
)}
```

#### Empty State

Wenn kein aktiver GW:
```tsx
<EmptyState
  title="Kein Spieltag aktiv"
  description="Das Live Center öffnet wenn ein Gameweek startet."
  action={{ label: "Spielplan ansehen", href: `/wm/${leagueId}/matchday` }}
/>
```

#### Neue Komponenten (`/app/components/wm/`)

| Komponente | Beschreibung |
|---|---|
| `LiveLeaderboard.tsx` | Rangliste mit Rank-Delta-Animationen |
| `MyGWCard.tsx` | Meine GW-Punkte, Captain, VC, Auto-Sub-Status |
| `FixtureStrip.tsx` | Horizontale/vertikale MatchCard-Liste |
| `PlayerStatusGrid.tsx` | Meine Spieler + Status + Punkte |
| `LiveEventFeed.tsx` | Chronologischer System-Messages-Stream |
| `LiveStatusBanner.tsx` | GW-Status-Header |
| `LiveTickerStrip.tsx` | Breaking-Bar oben |

---

### B2: System Messages & Notifications

#### Architektur

System Messages entstehen ausschließlich als **Side Effect im Ingest Layer**.

```
Ingest Layer → Side Effect Handler → POST /api/leagues/[id]/system-message
                                           ↓
                                    league_messages (Realtime)
                                           ↓
                               LiveEventFeed + ChatDock + LiveTickerStrip
```

#### Message-Templates

| Trigger-Event | Template | Priorität |
|---|---|---|
| `nation.eliminated` | 🚩 **{Nation}** nach GW{n} ausgeschieden | hoch |
| `player.stat_update` (Tor) | ⚽ **{Spieler}** trifft für {Nation} · GW{n} | mittel |
| `auto_sub.applied` | 🔄 Auto-Sub bei **{Team}**: {out} → {in} | mittel |
| `waiver.claim_processed` (approved) | ✅ **{Team}** holt {Spieler} per Waiver | mittel |
| `fixture.status_changed` → live | 🟢 Anpfiff: **{Nation A}** vs **{Nation B}** | niedrig |
| `fixture.status_changed` → finished | 🏁 Abpfiff: **{A}** {score} **{B}** | niedrig |
| `gameweek.points_recalculated` | 📊 GW{n} Punkte aktualisiert | niedrig |

#### Message-Metadata

```typescript
interface SystemMessageMetadata {
  event_type: WMEventType;
  priority: "high" | "medium" | "low";
  source: "simulator" | "admin" | "api_football";
  related_fixture_id?: string;
  related_team_id?: string;
  related_player_id?: number;
  related_nation_id?: string;
  ticker_text?: string;   // kurze Version für LiveTickerStrip
  icon?: string;
}
```

#### SIM-Badge

Messages mit `source === "simulator"` erhalten in `MessageBubble.tsx` ein kleines gedimmtes `SIM`-Label.

```tsx
{metadata?.source === "simulator" && (
  <span className="sim-badge">SIM</span>
)}
```

- Gleiche Position im Feed
- Kein Layout-Bruch
- Visuell klar unterscheidbar von echten Events

#### Throttling

```typescript
const THROTTLE_RULES = {
  "fixture.status_changed": { debounce_ms: 0 },       // immer senden
  "nation.eliminated":       { debounce_ms: 0 },       // immer senden
  "player.stat_update":      { max_per_gw: 20 },       // max 20 Tor-Messages pro GW
  "auto_sub.applied":        { debounce_ms: 5000 },    // 5s Cooldown pro Team
  "waiver.claim_processed":  { debounce_ms: 0 },       // immer senden
}
```

Verhindert Chat-Spam bei Simulator-Turnier-Runs.

#### Push Notifications

Bestehende `PushSubscriptionManager`-Infra wird genutzt. V1: nur `priority: "high"` Events triggern Push (= `nation.eliminated`).

**Kein `wm_notification_prefs` in V1.** User-spezifische Notification-Einstellungen kommen als separates Feature in V2.

---

## Phase C — Polish & Visual

### C1: Matchday Live Experience Polish

**Betroffene Seite:** `/wm/[id]/matchday` (bestehend)

**Grundsatz:** Matchday bleibt fixture-zentriert. Kein Fantasy-Leaderboard, keine Spielerpunkte, kein Chat. Das gehört ins Live Center.

#### Neue Zentral-Komponente: `MatchCard`

`/app/components/wm/MatchCard.tsx` — wird überall verwendet:
- `/wm/[id]/matchday` (Haupt-Fixture-Liste)
- Live Center `FixtureStrip`
- KO-Bracket Match-Nodes
- Optional: Hub-Preview-Karte

Match-Stati:

```
[Geplant]   FRA vs GER   14:00
[🔴 LIVE]   FRA  2 – 1  GER   67'  ← approximierte Zeit
[✅ FERTIG] FRA  2 – 1  GER   Abpfiff
[🔴 LIVE]   FRA  1 – 1  GER   n.V. 98'
[🔴 LIVE]   FRA  1 – 1  GER   Elfm. (3–2)
[⏸ DELAYED] FRA vs GER   Verzögert
```

#### Neues Feld: `wm_fixtures.extra_status`

```sql
ALTER TABLE wm_fixtures
ADD COLUMN extra_status text;
-- Erlaubte Werte: null | 'half_time' | 'extra_time' | 'penalties' | 'delayed' | 'interrupted'
```

`delayed` und `interrupted` sind für V1-Simulator nicht nötig, aber für spätere API-Football-Kompatibilität vorgesehen (API-Football liefert diese Zustände).

#### Live-Spielzeit

```typescript
// Approximiert aus kickoff-Timestamp + status
function getApproximateMinute(kickoff: string, extraStatus: string | null): string {
  const elapsed = (Date.now() - new Date(kickoff).getTime()) / 60000;
  if (extraStatus === 'extra_time') return `${Math.min(120, Math.round(elapsed))}'`;
  return `${Math.min(90, Math.round(elapsed))}'`;
}
```

**Wichtig:** Diese Spielzeit ist in V1 nur clientseitig approximiert. Kein Anspruch auf exakte Minute, kein Server-Drift-Correction-System. Bewusste Entscheidung — exakte Spielzeiten kommen mit API-Football.

#### Erweiterungen

- **Score-Transition:** CSS `@keyframes countUp` bei Score-Änderung
- **Pulsing Live Dot:** `StatusDot` visuell verbessern (bereits vorhanden)
- **Penalties Display:** `(n.E. 3–2)` unter Score bei KO-Remis

---

### C2: KO-Bracket

**Platzierung:** Neuer Tab `"Bracket"` innerhalb `/wm/[id]/matchday`.
**Read-only:** Kein Admin-Input, kein Drag-and-Drop, kein manuelles Setzen von Siegern.

#### Datenmodell

Kein neues Schema. Bracket leitet sich vollständig aus vorhandenen Daten ab:

```typescript
interface BracketMatch {
  fixture?: WMFixture;       // null wenn noch nicht angesetzt
  home_nation?: WMNation;
  away_nation?: WMNation;
  placeholder?: string;      // z.B. "Sieger Gruppe A" wenn Fixture noch nicht existiert
  winner?: WMNation;         // null = noch offen
  is_live: boolean;
}
```

#### Siegerlogik

```typescript
function getWinner(fixture: WMFixture): WMNation | null {
  if (fixture.status !== 'finished') return null;
  // Penalties überschreibt Draw
  if (fixture.penalties_home !== null && fixture.penalties_away !== null) {
    return fixture.penalties_home > fixture.penalties_away
      ? fixture.home_nation!
      : fixture.away_nation!;
  }
  // Normaler Score
  if (fixture.home_score! > fixture.away_score!) return fixture.home_nation!;
  if (fixture.away_score! > fixture.home_score!) return fixture.away_nation!;
  return null; // Remis, noch offen (sollte in KO nicht vorkommen)
}
```

#### Platzhalter-Logik (Future-Aware)

Wenn ein KO-Fixture noch nicht existiert (z.B. Achtelfinale, Gruppenphase läuft noch):

```
[Sieger Gruppe A]  vs  [Zweiter Gruppe B]
         TBD
```

Platzhalter-Text kommt aus Stage-Mapping-Tabelle oder wird generisch generiert.

#### Mobile vs. Desktop

- **Mobile (default):** Vertikale Stage-Sections, jede Stage expandierbar. Kein erzwungenes Mini-Bracket — wäre auf kleinen Screens unlesbar.
- **Desktop (≥768px):** Horizontales SVG-Bracket mit `<line>`-Verbindungen. Keine externe Bibliothek — simples CSS-Grid + SVG.

---

## Gesamtübersicht: Neue Artefakte

### Neue Tabellen

| Tabelle | Phase | Beschreibung |
|---|---|---|
| `wm_event_log` | A1 | Audit-Trail aller Ingest-Events |

### Neues Feld

| Tabelle | Feld | Phase |
|---|---|---|
| `wm_fixtures` | `extra_status text` | C1 |

### Neue API-Routen

| Route | Phase | Beschreibung |
|---|---|---|
| `POST /api/wm/[id]/events` | A1 | Zentraler Ingest Layer |
| `POST /api/wm/[id]/simulate` | A2 | Tournament Simulator |

### Neue Seiten

| Route | Phase | Beschreibung |
|---|---|---|
| `/wm/[id]/live` | B1 | Fantasy Live Center |

### Neue Komponenten (`/app/components/wm/`)

| Komponente | Phase | Beschreibung |
|---|---|---|
| `LiveLeaderboard.tsx` | B1 | GW-Rangliste mit Animationen |
| `MyGWCard.tsx` | B1 | Meine Punkte + Captain + VC |
| `FixtureStrip.tsx` | B1 | Fixture-Karten horizontal/vertikal |
| `PlayerStatusGrid.tsx` | B1 | Meine Spieler + Live-Status |
| `LiveEventFeed.tsx` | B1 | System-Messages-Stream |
| `LiveStatusBanner.tsx` | B1 | GW-Status-Header |
| `LiveTickerStrip.tsx` | B1 | Breaking-Bar oben |
| `MatchCard.tsx` | C1 | Zentrale Fixture-Karte (überall) |
| `TournamentBracket.tsx` | C2 | KO-Bracket Mobile + Desktop |

### Modifikationen bestehender Dateien

| Datei | Phase | Was ändert sich |
|---|---|---|
| `app/wm/[id]/admin/page.tsx` | A2 | Neuer "Simulator"-Tab |
| `app/wm/[id]/page.tsx` | B1 | Live-Banner wenn active GW |
| `app/wm/[id]/matchday/page.tsx` | C1+C2 | MatchCard, Bracket-Tab |
| `app/components/chat/MessageBubble.tsx` | B2 | SIM-Badge für simulator-source |
| `lib/wm-types.ts` | A1+C1 | `WMEventType`, `extra_status` |

---

## Nicht-Scope (bewusst ausgeschlossen)

- Keine API-Football-Integration in dieser Phase
- Kein `wm_notification_prefs` (V2)
- Kein Live-Minuten-Timeline (Tor in Minute 67) — kommt mit API-Football
- Kein Drag-and-Drop im Bracket
- Keine manuelle Siegerwahl im Bracket
- Keine Transfer/Waiver-Simulation im Simulator
- Kein Drift-Correction für Live-Spielzeit
- Keine komplexen Projected-Points-Algorithmen (V1: ~ Indikator)
- Kein Fantasy-Leaderboard in `/matchday` — gehört ins Live Center

---

## Bau-Reihenfolge

```
Phase A1: Ingest Layer          ← Fundament, alles hängt daran
Phase A2: Tournament Simulator  ← Datengenerator für alle nachfolgenden Features
Phase B1: Fantasy Live Center   ← Wichtigste Nutzerseite
Phase B2: System Messages       ← Macht Events emotional sichtbar
Phase C1: Matchday Polish       ← MatchCard + extra_status + Score-Animation
Phase C2: KO-Bracket            ← Visuelles Highlight
```
