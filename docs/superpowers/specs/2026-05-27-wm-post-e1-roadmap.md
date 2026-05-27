# WM Post-E1 Roadmap

**Datum:** 2026-05-27  
**Status:** Spezifikation — keine Implementierung  
**Branch:** `main` (nach Merge von `feature/wm-live-scoring`)

---

## Architektur-Analyse: Aktueller Stand

### Was produktionsreif ist

| System | Route / Datei | Zustand |
|---|---|---|
| Draft (D2) | `app/wm/[id]/draft/` | ✅ Stabil |
| Lineup-Save | `POST /api/wm/[id]/lineup` | ✅ 17 Validierungen |
| Waiver | `POST /api/cron/process-waivers-wm` | ✅ Cron 05:00 UTC |
| Auto-Subs | `POST /api/wm/[id]/auto-subs` | ✅ live-sub.ts |
| Ingest Layer | `POST /api/wm/[id]/events` | ✅ 9 Event-Typen |
| Matchday UI | `app/wm/[id]/matchday/` | ✅ MatchCard + KO-Bracket |
| Live Scoring | `lib/wm-ingest.ts` | ✅ total_points sync |
| GW-Start API | `POST /api/wm/[id]/gameweek-start` | ✅ Snapshot + status |
| GW-Finish API | `POST /api/wm/[id]/gameweek-finish` | ✅ Atomic + idempotent |
| Live Center | `app/wm/[id]/live/` | ✅ rank_delta, players_playing |
| Admin | `app/wm/[id]/admin/page.tsx` | ⚠️ Partiell (siehe Lücken) |

### Kritische Lücken

**L1 — Admin umgeht E1-APIs (KRITISCH)**  
`updateGameweekStatus()` in `admin/page.tsx` (Zeile 669) macht ein direktes Supabase-Update auf `wm_gameweeks` — schreibt **keinen** Rang-Snapshot, rebuilt **keine** `total_points`, schickt **keine** System Message. Die neuen E1-APIs werden im Admin noch nicht aufgerufen.

**L2 — Keine echten Spieler-IDs**  
`players.id` enthält Test-IDs (90001–90120). Die Tabelle hat `api_team_id` aber **kein** `api_player_id`-Feld. Ohne API-Football-Spieler-ID können echte Statistiken nicht zugeordnet werden.

**L3 — Kein wm_event_log-Viewer**  
Der `wm_event_log` ist befüllt, aber nirgends im Admin sichtbar. Fehler-Events (`status = 'error'`) werden nicht angezeigt.

**L4 — Lineup-Deadline nur API-seitig**  
Die Deadline wird in der Route (`/api/wm/[id]/lineup`) geprüft, aber im Admin gibt es keine UI zum Setzen/Ändern der Deadline — nur das DB-Feld existiert.

**L5 — Kein Multi-User QA je durchgeführt**  
Realtime-Verhalten bei 2+ gleichzeitigen Clients, Disconnect/Reconnect, doppelte GW-Starts nie systematisch getestet.

---

## Empfohlene Reihenfolge

```
F0 (Hardening, 1–2 Tage)
  ↓ Pflicht vor echten Usern
F1 (Real Data, 2–3 Tage)
  ↓ Pflicht vor WM-Kick-off
F2 (Admin Control Center, 3–4 Tage)
  ↓ Parallel zu F1 möglich (unabhängige Datei)
F3 (Polish, nach Turnier-Start)
```

**Sofort:** F0 — L1 (Admin-API-Fix) ist Pre-Production-Blocker.  
**Vor Kick-off:** F1 — ohne echte Spieler-IDs laufen keine echten Punkte.  
**Kann warten:** F3 — rein kosmetisch, kein Gameplay-Einfluss.

---

## Phase F0 — Tournament Simulation Week / Hardening

**Ziel:** Einen vollständigen Mini-Turnier-Durchlauf mit Testdaten durchführen, kritische Lücken im Admin beheben, Chaos-Tests dokumentieren.

**Aufwand:** 1–2 Tage  
**Risiko:** MITTEL — Chaos-Tests können Bugs aufdecken, die Fixes benötigen

### Nicht-Scope F0

- Keine neuen Features
- Keine UI-Redesigns
- Keine echten API-Football-Daten
- Keine Push Notification Tests

---

### F0-Task 1 — Admin: E1-APIs verdrahten (L1-Fix)

**Ziel:** `updateGameweekStatus` durch Calls auf die E1-APIs ersetzen.

**Datei:** `app/wm/[id]/admin/page.tsx` — Funktion `updateGameweekStatus()` (Zeile 669)

**Problem heute:**
```typescript
// Direkt auf DB — bypasses rank snapshot, total_points rebuild, system message
await supabase.from("wm_gameweeks").update({ status }).eq("id", gw.id);
```

**Fix:**
```typescript
async function updateGameweekStatus(gwNum: number, status: "upcoming" | "active" | "finished") {
  if (status === "active") {
    // gameweek-start: writes rank snapshot + sets status
    const res = await fetch(`/api/wm/${leagueId}/gameweek-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
      body: JSON.stringify({ gameweek: gwNum }),
    });
    if (!res.ok) { toast("GW-Start fehlgeschlagen", "error"); return; }
    toast(`GW ${gwNum} gestartet — Snapshot geschrieben`, "success");
  } else if (status === "finished") {
    // gameweek-finish: rebuilds total_points + sets status + system message
    const res = await fetch(`/api/wm/${leagueId}/gameweek-finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
      body: JSON.stringify({ gameweek: gwNum }),
    });
    if (!res.ok) { toast("GW-Finish fehlgeschlagen", "error"); return; }
    toast(`GW ${gwNum} abgeschlossen`, "success");
  } else {
    // upcoming: direktes Zurücksetzen OK (nur für Admin-Recovery)
    await supabase.from("wm_gameweeks").update({ status }).eq("id", gw.id);
    toast(`GW ${gwNum} → upcoming gesetzt`, "info");
  }
  setGameweeks(prev => prev.map(g => g.gameweek === gwNum ? { ...g, status } : g));
}
```

**Auth-Voraussetzung:** Session-Token über `supabase.auth.getSession()` laden und im Header mitschicken (analog zu anderen fetch-Calls in der Seite).

**QA:** Nach Fix: GW starten → wm_gw_rank_snapshots prüfen → GW finishen → total_points prüfen → System Message im Chat prüfen.

---

### F0-Task 2 — Mini-Turnier E2E Durchlauf (Testprotokoll)

**Ziel:** Vollständigen WM-Ablauf mit 4 Testteams dokumentieren und Bugs erfassen.

**Reihenfolge:**

```
1. Liga erstellen (WM-Modus)
2. Draft starten → 4 Teams ziehen je 15 Spieler
3. Lineup setzen für alle 4 Teams (GW1)
4. Admin: Fixtures GW1 auf "scheduled" setzen
5. Admin: GW1 starten → gameweek-start API → Snapshot prüfen
6. Admin: 2–3 Fixtures auf "live" setzen
7. Simulator: GW1 Fixture-by-Fixture simulieren
8. Live Center öffnen: rank_delta, players_playing beobachten
9. Admin: Auto-Subs auslösen
10. Admin: GW1 finishen → gameweek-finish API → total_points prüfen
11. KO-Bracket Tab prüfen
12. Waiver-Fenster öffnen → Claims einreichen
13. Waiver-Cron simulieren (Admin: "Waiver ausführen")
14. GW2 wiederholen
15. Finale simulieren
```

**Verifikations-SQL nach jedem Schritt:**

```sql
-- Nach GW-Start:
SELECT gameweek, status FROM wm_gameweeks WHERE tournament_id = '<TID>' ORDER BY gameweek;
SELECT count(*) FROM wm_gw_rank_snapshots WHERE league_id = '<LID>' AND gameweek = 1;

-- Nach Simulator:
SELECT t.name, SUM(gp.points) AS gw_pts
FROM teams t JOIN wm_gameweek_points gp ON gp.team_id = t.id
WHERE t.league_id = '<LID>' AND gp.gameweek = 1
GROUP BY t.name ORDER BY gw_pts DESC;

-- Nach GW-Finish:
SELECT name, total_points FROM teams WHERE league_id = '<LID>' ORDER BY total_points DESC;
SELECT content FROM league_messages WHERE league_id = '<LID>' AND kind = 'system' ORDER BY created_at DESC LIMIT 3;

-- Nach Waiver:
SELECT player_id, status FROM wm_waiver_claims WHERE league_id = '<LID>' ORDER BY created_at DESC LIMIT 5;
```

**Ergebnis:** Bugliste mit Severity (P0/P1/P2).

---

### F0-Task 3 — Multi-Device / Multi-User Tests

**Setup:** 2 Browser-Fenster (Chrome + Safari oder Inkognito), 1 Mobile (Simulator oder echtes Gerät).

**Szenarien:**

| # | Szenario | Erwartetes Verhalten |
|---|---|---|
| M1 | Owner in Tab A + User in Tab B → Owner startet GW | Tab B: Live Center aktualisiert ohne Reload |
| M2 | User öffnet Live Center → WLAN-Trennung für 30s → Reconnect | Soft-Polling greift (10s), nach Reconnect Realtime wiederhergestellt |
| M3 | 2 Tabs als Owner → GW zweimal starten (Idempotenz-Test) | Zweiter Call: `already_finished: false` aber kein doppelter Snapshot |
| M4 | Mobile (375px) → Live Center öffnen | rank_delta + players_playing lesbar, kein Layout-Overflow |
| M5 | Owner auf Mobile → GW finishen | Toast sichtbar, Leaderboard aktualisiert |
| M6 | User auf Mobile → Lineup nach Deadline ändern | 409-Fehler, Toast erklärt Problem |

**Protokoll:** Screenshot bei Fehler, Browser-Console-Errors notieren.

---

### F0-Task 4 — Admin Chaos Testing

**Szenarien:**

| # | Test | Erwartetes Verhalten |
|---|---|---|
| C1 | GW zweimal starten (doppelter gameweek-start) | Idempotent: Snapshot wird refresht, kein 500 |
| C2 | GW finishen ohne active GW (status=upcoming) | 409 oder sinnvoller Error, kein Datenverlust |
| C3 | stat_update POST auf finished GW | Event verarbeitet, Punkte werden geschrieben — kein Blocking (by design) |
| C4 | Lineup-Änderung nach Deadline via Admin-API | 409 mit `deadline_passed` — Admin-Route prüfen |
| C5 | Identisches Ingest-Event 3× senden (idempotency_key gleich) | Nur erstes verarbeitet, 2+3 → `status=duplicate` |
| C6 | Simulator + manueller stat_update gleichzeitig | Kein Race Condition, letzter Write gewinnt (UPSERT) |
| C7 | GW-Finish → sofort nochmals GW-Finish | `already_finished: true`, keine zweite System Message |
| C8 | 50 stat_updates in 5s (Batch) | Alle verarbeitet, total_points korrekt — kein Deadlock |

**Verifikation C5:**
```sql
SELECT idempotency_key, count(*), array_agg(status)
FROM wm_event_log
WHERE league_id = '<LID>'
GROUP BY idempotency_key HAVING count(*) > 1;
-- Erwartung: leeres Ergebnis (kein Duplikat verarbeitet)
```

---

### F0-Task 5 — Regression-Testliste (nach F0)

Nach dem Durchlauf wird eine Regression-Liste gepflegt:

```
REG-01: GW-Start schreibt Snapshot (F0-Task 1)
REG-02: GW-Finish rebuilt total_points korrekt (E1-QA)
REG-03: Idempotenz GW-Start/Finish (E1-QA Block 6)
REG-04: players_playing > 0 bei live Fixtures (E1-QA Block 5)
REG-05: rank_delta ≠ 0 nach Punkte-Änderung (E1-QA Block 4)
REG-06: Realtime-Update ohne Seitenreload (F0 M1)
REG-07: Soft-Polling bei Disconnect (F0 M2)
REG-08: Waiver-Cron verarbeitet Claims (bestehendes System)
REG-09: Auto-Sub schreibt team_substitutions (bestehendes System)
REG-10: Lineup-Deadline-409 bei verspäteter Änderung (F0 C4)
```

---

## Phase F1 — Real Player Mapping / Real Data Readiness

**Ziel:** Das System von Test-IDs auf echte API-Football-Spieler vorbereiten.

**Aufwand:** 2–3 Tage  
**Risiko:** HOCH — DB-Migration, bestehende Draft/Lineup-Daten betroffen

### Nicht-Scope F1

- Kein Live-Sync mit API-Football während laufendem GW
- Keine automatische Kader-Aktualisierung
- Kein Premium-API-Endpunkt (Echtzeit-Statistiken)
- Kein Spieler-Fotos-Import

---

### F1-Analyse: Aktueller Spieler-Datensatz

**`players`-Tabelle (aktuell):**
```
id (integer, PK — Test-IDs 90001–90120 für WM-Testdaten)
name, position, nationality, photo_url
api_team_id   ← API-Football TEAM ID (vorhanden!)
team_name     ← String — gefährlich, sollte nicht für Routing genutzt werden
api_league_id ← Liga-ID (z.B. FIFA WC = 1)
```

**Fehlendes Feld:** `api_player_id` (integer) — API-Football Player ID. Ohne dieses Feld kann ein eingehender `player.stat_update`-Event (mit API-Football player_id) nicht auf einen `players`-Eintrag gemappt werden.

**`wm_player_nations`:**
```
player_id (integer) → players.id
nation_id (uuid)    → wm_nations.id
tournament_id (uuid)
```

**`wm_nations`:**
```
api_team_id (integer) ← API-Football Team ID für die Nationalmannschaft
name, code            ← z.B. "Germany", "GER"
```

---

### F1-Task 1 — DB-Migration: api_player_id zu players

```sql
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS api_player_id integer UNIQUE;

CREATE INDEX IF NOT EXISTS idx_players_api_player_id
  ON public.players (api_player_id);
```

**Wichtig:** `UNIQUE` — ein API-Football-Spieler kommt genau einmal vor.  
**Ohne diese Migration:** Alle F1-Tasks danach nicht ausführbar.

---

### F1-Task 2 — Import-Script: API-Football → players

**Datei (neu):** `scripts/import-wm-players.mjs`

**Ablauf:**
```
1. GET /v3/players?league=1&season=2026&page=N  (API-Football WC-Kader)
2. Für jeden Spieler:
   a. player.id → api_player_id
   b. player.statistics[0].team.id → api_team_id
   c. player.nationality → nationality
   d. player.name → name
   e. player.statistics[0].games.position → position
3. UPSERT INTO players ON CONFLICT (api_player_id)
4. Lookup: wm_nations WHERE api_team_id = <team_id> → nation_id
5. UPSERT INTO wm_player_nations (tournament_id, player_id, nation_id)
```

**Rate-Limiting:** API-Football Free Tier = 100 Calls/Tag. WM hat ~32 Nationen × ~26 Spieler = ~832 Spieler. Import über mehrere Tage oder mit Paid Plan.

**Fallback bei fehlendem nation_id:**
```javascript
if (!nationId) {
  console.warn(`Kein Nation-Match für team_id ${apiTeamId} (${playerName})`);
  unmappedPlayers.push({ api_player_id, name, api_team_id });
}
// Spieler wird ohne wm_player_nations-Eintrag gespeichert — Live Center ignoriert ihn (players_playing=0 für diese Spieler)
```

**Output:** `import-report.json` mit Statistiken + `unmapped-players.json` für manuelle Nachbearbeitung.

---

### F1-Task 3 — Validierungs-Script

**Datei (neu):** `scripts/validate-wm-data.mjs`

**Prüfungen:**
```
V1: Alle wm_nations haben api_team_id != null
V2: Jede Nation hat mindestens 11 Spieler in wm_player_nations
V3: Keine Spieler in wm_player_nations ohne players-Eintrag (orphan)
V4: Kein team_name-String als einziger Identifikator (Warnung falls player.team_name != nation.name)
V5: Alle api_player_id sind eindeutig (duplikat-check)
V6: Position ist immer "GK"|"DF"|"MF"|"FW"
```

**Erwartetes Output:**
```
✅ V1: 32/32 Nationen mit api_team_id
✅ V2: 32/32 Nationen mit ≥11 Spielern (Ø 26.2)
✅ V3: 0 Orphan-Spieler
⚠️  V4: 3 Spieler haben team_name-Mismatch (manuelle Prüfung)
✅ V5: 832 eindeutige api_player_id
✅ V6: alle Positionen valide
```

---

### F1-Task 4 — Ingest-Layer: api_player_id Routing

**Datei:** `lib/wm-ingest.ts` — Funktion `handlePlayerStatUpdate()` (Zeile 258)

**Aktuell:**
```typescript
// Lookup via players.id (integer, direkt aus Event-Payload)
const { data: player } = await supabase.from("players").select("id").eq("id", payload.player_id);
```

**Nach F1:**
```typescript
// Payload enthält api_player_id (API-Football ID)
// Lookup: api_player_id → players.id
const { data: player } = await supabase
  .from("players")
  .select("id, position")
  .eq("api_player_id", payload.player_id)  // payload.player_id = API-Football player ID
  .maybeSingle();
if (!player) {
  // Spieler noch nicht importiert — Event loggen, kein Crash
  await logEvent(leagueId, "player_not_found", { api_player_id: payload.player_id });
  return;
}
```

**Breaking Change:** Dieser Fix verändert das Event-Schema. Alle bestehenden Test-Events nutzen direkte `players.id` (90001–90120). Nach Migration nutzen echte Events `api_player_id`.  
**Lösung:** Beide Lookups parallel unterstützen während Übergangsphase:
```typescript
// Erst api_player_id, dann id (Fallback für Testdaten)
const { data: player } = await supabase.from("players")
  .select("id, position")
  .or(`api_player_id.eq.${payload.player_id},id.eq.${payload.player_id}`)
  .maybeSingle();
```

---

### F1-Task 5 — Draft-Pool Anpassung

**Datei:** `app/wm/[id]/draft/` + Draft-API

**Aktuell:** Draft-Pool filtert Test-IDs (90001–90120) heraus über Hardcode-Guard in `loadPlayers()`.

**Nach F1:** Guard durch echte Feld-Prüfung ersetzen:
```typescript
// Alt (Hardcode):
.not("id", "in", `(${TEST_PLAYER_IDS.join(",")})`)

// Neu (semantisch):
.eq("api_league_id", WM_API_LEAGUE_ID)  // nur WM-Kader
.not("api_player_id", "is", null)       // nur gemappte Spieler
```

**QA:** Draft-Pool zeigt ausschließlich echte WM-Spieler, keine Duplikate, Positionen korrekt.

---

### F1-Task 6 — Nation-Elimination: String-Abhängigkeit entfernen

**Risiko:** Aktuell kann Code nationId über `wm_nations.name` oder `wm_nations.code` statt über `wm_nations.id` suchen. Das bricht bei Schreibvarianten (z.B. "Germany" vs. "Deutschland").

**Scan:**
```bash
grep -rn "nation\.name\|nation\.code\|nationName" app/ lib/ --include="*.ts" --include="*.tsx"
```

**Fix:** Alle String-basierten Nation-Lookups durch UUID-basierte ersetzen.

---

### F1-DB-Migrationsliste

| Migration | SQL |
|---|---|
| api_player_id Spalte | `ALTER TABLE players ADD COLUMN IF NOT EXISTS api_player_id integer UNIQUE` |
| Index für Lookup-Speed | `CREATE INDEX idx_players_api_player_id ON players (api_player_id)` |

---

### F1-QA-Plan (benötigt echte Daten)

```
Q1: Import-Report zeigt 0 Fehler für alle 32 Nationen
Q2: Validierungs-Script: V1–V6 alle grün
Q3: Ingest-Event mit echtem api_player_id → wm_gameweek_points Eintrag
Q4: Live Center zeigt players_playing > 0 bei echtem Live-Fixture
Q5: Draft-Pool: 832 Spieler, gefiltert nach Position, keine Test-IDs
Q6: Waiver-Pool: dieselben 832 Spieler verfügbar
Q7: Lineup: Spieler aus verschiedenen Nationen pickbar
Q8: Auto-Sub: Spieler mit eliminierter Nation wird korrekt ersetzt
```

---

## Phase F2 — WM Admin Control Center

**Ziel:** Die bestehende Admin-Seite um GW-Start/Finish-Controls, Event-Log-Viewer und Daten-Integrität-Checks erweitern. Bestehende 1967-Zeilen-Seite wird aufgeteilt.

**Aufwand:** 3–4 Tage  
**Risiko:** NIEDRIG bis MITTEL — additive Änderungen, keine DB-Migration nötig

### Nicht-Scope F2

- Kein Redesign der bestehenden Tabs (nur Ergänzungen)
- Kein User-Management
- Keine E-Mail-Notifications
- Kein Multi-Liga-Admin (jede Liga hat eigenen Admin)

---

### F2-Analyse: Bestehende Admin-Tabs

| Tab | Inhalt | Aktion |
|---|---|---|
| `general` | Liga-Settings, Tournament-Status | Bleibt, kein Change |
| `points` (Spieltage) | GW-Status, Punkt-Rebuild, Auto-Subs | **Erweitern**: GW-Start/Finish-Buttons via E1-APIs |
| `waiver` | Waiver-Settings, manueller Run | Bleibt |
| `autosubs` | Auto-Sub-Trigger | Bleibt |
| `recovery` | Rebuild-Points, Rebuild-Waiver | Bleibt |
| `nations` | Ausscheidungen setzen | Bleibt |
| `fixtures` | Fixture-Status editieren, Scores | Erweitern: Deadline-Control |
| `simulator` | Fixture/GW/Tournament simulieren | Bleibt |
| `debug` | diverse Debug-Infos | Erweitern: Event-Log |

**Neue Tabs:**
- `eventlog` — wm_event_log Viewer
- `integrity` — Data Integrity Checks

---

### F2-Task 1 — Datei-Aufteilung (admin/page.tsx → Tabs-Architektur)

**Problem:** 1967 Zeilen in einer Datei. Schwer wartbar.

**Plan:** Tab-Inhalte in eigene Komponenten auslagern:

```
app/wm/[id]/admin/
  page.tsx                    ← Scaffold: State, loadAll(), Tab-Navigation (~300 Zeilen)
  tabs/
    PointsTab.tsx             ← GW-Status, Start/Finish, Punkt-Rebuild
    FixturesTab.tsx           ← Fixture-Editor, Deadline-Controls
    SimulatorTab.tsx          ← Simulator + Reset
    EventLogTab.tsx           ← NEU: wm_event_log
    IntegrityTab.tsx          ← NEU: Data Integrity Checks
    WaiverTab.tsx             ← Waiver-Settings + Run
    AutoSubsTab.tsx           ← Auto-Sub-Controls
    RecoveryTab.tsx           ← Rebuild-Buttons
    NationsTab.tsx            ← Ausscheidungs-Controls
    GeneralTab.tsx            ← Liga-Allgemein
```

**Props-Interface (geteilt):**
```typescript
interface AdminTabProps {
  leagueId: string;
  tournamentId: string;
  gameweeks: WMGameweek[];
  selectedGW: number;
  onGWChange: (gw: number) => void;
  onReload: () => void;
  session: { access_token: string };
}
```

---

### F2-Task 2 — PointsTab: GW-Start/Finish Controls

**Datei (neu):** `app/wm/[id]/admin/tabs/PointsTab.tsx`

**Controls:**
```
[GW-Selector: ● GW1 ✓ GW2 ○ GW3 ...]

GW 1 — Gruppenphase Spieltag 1
Status: upcoming / active / finished

[▶ Spieltag starten]  → POST /api/wm/[id]/gameweek-start { gameweek: N }
  Disabled wenn: status = active | finished
  Loading-State + Toast: "GW 1 gestartet — Snapshot für 4 Teams"

[■ Spieltag abschließen] → POST /api/wm/[id]/gameweek-finish { gameweek: N }
  Disabled wenn: status ≠ active
  Confirmation Dialog: "GW 1 wirklich abschließen? total_points werden rebuilt."
  Loading-State + Toast: "GW 1 abgeschlossen — Winner: Bot 1 (24.2 Pkte)"

[↺ Zurück auf upcoming] → direktes Supabase Update (Admin-Recovery only)
  Nur sichtbar wenn: status = active | finished
  Requires typed confirmation: "RESET GW 1"

[⟳ Punkte neu berechnen] → POST /api/wm/[id]/rebuild-points
[▷ Auto-Subs ausführen]   → POST /api/wm/[id]/auto-subs
```

---

### F2-Task 3 — FixturesTab: Deadline-Controls

**Datei:** `app/wm/[id]/admin/tabs/FixturesTab.tsx`

**Neue Sektion:**
```
Lineup-Deadline (GW 1)
[datetime-local input]  aktuell: 2026-06-14 18:00 UTC
[Deadline setzen]       → UPDATE wm_gameweeks SET deadline = ? WHERE id = gwId
[Deadline löschen]      → UPDATE wm_gameweeks SET deadline = null
Status: "Deadline aktiv — noch 2h 34m"
```

---

### F2-Task 4 — EventLogTab (NEU)

**Datei (neu):** `app/wm/[id]/admin/tabs/EventLogTab.tsx`

**Inhalt:**
```
Filter: [alle | pending | processed | error | duplicate]  [GW: alle | 1 | 2 ...]
Refresh-Button

Tabelle:
Zeit | Event-Typ | Status | Spieler | Fixture | Fehler | Quelle

Fehler-Events werden rot hervorgehoben.
"Retry" Button bei status = error (sendet Event erneut an /api/wm/[id]/events)
```

**Query:**
```typescript
supabase.from("wm_event_log")
  .select("id, event_type, status, error_message, related_player_id, related_fixture_id, source, created_at, payload")
  .eq("league_id", leagueId)
  .order("created_at", { ascending: false })
  .limit(100)
```

---

### F2-Task 5 — IntegrityTab (NEU)

**Datei (neu):** `app/wm/[id]/admin/tabs/IntegrityTab.tsx`

**Checks (on-demand, "Prüfen" Button):**

```
[Prüfen] → führt alle Checks durch

✅ / ❌  Alle Teams haben Lineup für aktiven GW
✅ / ❌  total_points = SUM(wm_gameweek_points) für alle Teams
✅ / ❌  Kein Team hat mehr als 15 Spieler im Squad
✅ / ❌  Alle wm_player_nations haben gültige player_id (kein orphan)
✅ / ❌  Snapshot-Count = Team-Count für aktiven GW
⚠️  /✅  N Spieler ohne nation_id (werden nicht in players_playing gezählt)
✅ / ❌  wm_event_log: 0 unverarbeitete Error-Events (Status: error)
```

**Output:** Tabellarisch mit "Fix"-Button für automatisch behebbare Probleme (z.B. Rebuild-Trigger).

---

### F2-Task 6 — Realtime Health Indicator

**Datei:** `app/wm/[id]/admin/page.tsx` (Header)

**Design:** Kleiner Status-Chip im Admin-Header:
```
● Realtime verbunden          (grün)
◌ Realtime reconnecting...    (gelb, pulsierend)  
● Realtime getrennt           (rot)
```

Zeigt den Status des Admin-eigenen Supabase-Channels.

---

### F2-Task 7 — Destructive Actions: Typed Confirmation

**Pattern** für alle destruktiven Admin-Aktionen:

```typescript
// Vor jedem destruktiven Call:
const confirmed = await showTypedConfirmation(
  `Gib "${confirmationString}" ein um fortzufahren`,
  confirmationString
);
if (!confirmed) return;
```

**Betroffene Aktionen:**
- GW zurück auf "upcoming" setzen
- Tournament-Reset
- Simulator-Reset (scope: tournament)
- Rebuild-Points für gesamtes Turnier

---

### F2-DB-Migrationsliste

Keine neuen Tabellen nötig. Alle Features nutzen bestehende Tabellen.

---

### F2-QA-Plan

```
A1: GW-Start via Admin → Snapshot geschrieben (verify: wm_gw_rank_snapshots)
A2: GW-Finish via Admin → total_points rebuilt + System Message
A3: Event-Log zeigt Error-Events rot
A4: Retry bei Error-Event → Event neu verarbeitet
A5: Integrity-Check erkennt fehlende Lineups korrekt
A6: Typed Confirmation verhindert versehentlichen Reset
A7: Deadline-Setzen → Lineup-Route gibt 409 nach Deadline
A8: Admin-Tab-Aufteilung: TypeScript clean, keine Prop-Drilling-Fehler
```

---

## Phase F3 — Cinematic Polish

**Ziel:** Visuelles Erlebnis bei Schlüssel-Momenten verbessern.  
**Zeitpunkt:** Nach Turnier-Start, wenn Kernfunktionen stabil laufen.  
**Aufwand:** 2–3 Tage  
**Risiko:** NIEDRIG — rein UI, kein State-Einfluss

### Nicht-Scope F3

- Keine Gameplay-Änderungen
- Keine DB-Queries
- Kein Sound

### F3-Features (priorisiert)

| Priorität | Feature | Implementierung |
|---|---|---|
| P1 | Rank Rise/Fall Animation | CSS transform auf rank_delta Badge bei Update |
| P1 | GW Complete State | Voller Overlay in Live Center wenn GW finished |
| P2 | GOAL Overlay | Overlay bei `goal_scored`-Event im Live Event Feed |
| P2 | Score Animation | `home_score`/`away_score` Counter-Animation in FixtureStrip |
| P3 | Live Glow | Pulsierendes Border-Glow auf aktiven Fixtures |
| P3 | Rank Freeze Frame | kurzes Freeze bei Leaderboard-Umordnung |
| P4 | Floodlight Pulse | Hintergrund-Effekt im Live Center bei Tor-Event |
| P4 | Crowd Energy Bar | Abstraktes Aktivitäts-Meter basierend auf Event-Frequenz |

### F3-Dateien

```
app/components/wm/GoalOverlay.tsx        ← NEU
app/components/wm/GWCompleteState.tsx    ← NEU
app/wm/[id]/live/page.tsx               ← Animationen einbinden
app/components/wm/LiveLeaderboard.tsx   ← Rank-Delta Animation
app/components/wm/FixtureStrip.tsx      ← Score Animation
```

---

## Risiko-Matrix (Gesamt)

| Risiko | Phase | Wahrscheinlichkeit | Impact | Mitigation |
|---|---|---|---|---|
| Admin bypasses E1-APIs | F0-Task1 | Sicher (bestätigt) | HOCH | Sofortiger Fix |
| API-Football Rate Limit | F1 | HOCH (Free Tier) | MITTEL | Spread über mehrere Tage oder Paid Plan |
| Spieler-Namens-Mismatch | F1 | MITTEL | MITTEL | Validierungs-Script + manuelle Korrektur |
| Admin-Datei 1967 Zeilen | F2 | — | MITTEL | Schrittweise Aufteilung |
| Realtime Limits bei >10 User | F0 | NIEDRIG | MITTEL | Supabase Realtime Limits prüfen vor Launch |
| Deadline-Enforcement UI-Gap | F0 | SICHER | NIEDRIG | F2-Task3 schließt es |

---

## Empfehlung: Was als nächstes passiert

### Sofort (heute/morgen):
1. **F0-Task 1** — Admin updateGameweekStatus auf E1-APIs umstellen. Einziger P0-Bug in Produktionscode.
2. **F0-Task 2** — Mini-Turnier-Durchlauf manuell durchführen, Bugs dokumentieren.

### Diese Woche:
3. **F0-Tasks 3–5** — Chaos-Tests + Regression-Liste.
4. Basierend auf F0-Bugs: Fixes priorisieren.

### Vor WM-Kick-off (Anfang 2026):
5. **F1** — Spieler-Import sobald offizielle WM-Kader bekannt sind (ca. Mai 2026).
6. **F2** — Admin Control Center parallel zu F1 möglich.

### Nach Turnier-Start:
7. **F3** — Cinematic Polish wenn Kernloop stabil.

### Was warten kann:
- F3 vollständig (kein Gameplay-Impact)
- F2-Task 6 (Realtime Health) — nice-to-have
- Multi-Liga-Admin — erst wenn >1 Liga aktiv

---

*Spec erstellt: 2026-05-27 | Nächste Review: nach F0-Durchlauf*
