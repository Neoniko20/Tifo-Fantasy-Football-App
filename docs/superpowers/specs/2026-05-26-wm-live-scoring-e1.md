# E1 — WM Live Scoring & Gameweek Engine

**Datum:** 2026-05-26  
**Branch:** `feature/wm-live-scoring`  
**Status:** Spec — bereit für Implementierung  
**Option:** B (Live Scoring + Leaderboard Movement)

---

## 1. Ziel

Die WM soll sich wie ein echtes Live Fantasy System anfühlen. Wenn ein Spieler ein Tor schiesst, sehen alle Liga-Teilnehmer sofort ihre aktualisierten Punkte und ihre aktuelle Tabellenposition im Live Center. Wenn ein Spieltag endet, wird die Gesamttabelle automatisch und sauber abgeschlossen.

---

## 2. Nicht-Scope (E1)

- Keine API-Football-Integration (Statistiken werden manuell via Ingest eingegeben)
- Keine Push Notifications (bestehende Push-Infrastruktur bleibt unverändert)
- Keine neuen Draft-Features
- Kein `projected_total` / "was wäre wenn"-Berechnung
- Kein automatisches GW-Ende auf Basis von Fixture-Status
- Kein VC-Fallback-Fix im Ingest (bleibt P2, separater Task)
- Keine neue Scoring Engine — `calculateWMGameweekPoints()` bleibt unverändert

---

## 3. Architektur-Überblick

```
Admin / Simulator
  └→ POST /api/wm/[id]/events  (player.stat_update)
       └→ processIngestEvent()
            └→ handlePlayerStatUpdate()
                 ├→ UPSERT wm_gameweek_points  [idempotent, existing]
                 └→ UPDATE teams.total_points  [NEU — E1 Task 1]

Realtime (Supabase)
  wm_gameweek_points → Live Center full-reload inkl. total_points  [existing, erweitert]
  wm_gameweeks       → Live Center reload bei GW-Status-Änderung  [NEU — E1 Task 4]
  (kein separater teams-Realtime nötig)

GW-Start (Admin setzt status → active)
  └→ POST /api/wm/[id]/gameweek-start  [NEU — E1 Task 2]
       └→ UPSERT wm_gw_rank_snapshots  (aktueller Rang aller Teams)

GW-Finish (Admin-Button)
  └→ POST /api/wm/[id]/gameweek-finish  [NEU — E1 Task 3]
       ├→ Rebuild total_points für alle Teams (final)
       ├→ UPDATE wm_gameweeks.status = 'finished'
       └→ system message: GW-Zusammenfassung

Live Center Page
  ├→ gw_points: SUM(wm_gameweek_points) live  [existing]
  ├→ total_points: aus teams (Realtime-subscribed)  [NEU — E1 Task 4]
  ├→ rank_delta: current_rank - snapshot_rank  [NEU — E1 Task 4]
  └→ players_playing: client-berechnet aus liveNations × starting_xi  [NEU — E1 Task 4]
```

---

## 4. DB-Migrationen

### 4.1 Neue Tabelle: `wm_gw_rank_snapshots`

Speichert den Rang jedes Teams zu Beginn eines Spieltags. Wird beim GW-Start geschrieben und danach nicht mehr verändert.

```sql
CREATE TABLE IF NOT EXISTS public.wm_gw_rank_snapshots (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  league_id     uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  gameweek      integer NOT NULL,
  team_id       uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rank          integer NOT NULL,
  total_points  numeric(8,1) NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (league_id, gameweek, team_id)
);

-- RLS: Sichtbar für Liga-Mitglieder, schreibbar nur per service role
ALTER TABLE public.wm_gw_rank_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "league members can read gw rank snapshots"
  ON public.wm_gw_rank_snapshots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = wm_gw_rank_snapshots.league_id
        AND lm.user_id = auth.uid()
    )
  );
```

**Keine weiteren Migrationen nötig.** `wm_gameweek_points`, `teams.total_points`, `wm_gameweeks.status` existieren bereits.

---

## 5. Datenfluss: Live-Punkte Update

### Trigger: `player.stat_update` Event

```
1. handlePlayerStatUpdate() [lib/wm-ingest.ts]
   a. Berechne GWStats aus Event-Payload
   b. Finde alle Teams in dieser Liga die den Spieler haben
   c. Für jedes Team:
      i.  calculateWMGameweekPoints() → points
      ii. UPSERT wm_gameweek_points ON CONFLICT (team_id, player_id, gameweek)
   d. [NEU] Für jedes betroffene Team:
      i.  SELECT SUM(points) FROM wm_gameweek_points WHERE team_id = X
          (nur GWs bis einschliesslich current GW)
      ii. UPDATE teams SET total_points = SUM WHERE id = X

2. Supabase Realtime feuert auf teams-Tabelle
3. Live Center empfängt Update → aktualisiert total_points in UI
```

**Warum total_points auf teams und nicht live berechnen?**  
Live Center summiert bereits `wm_gameweek_points` für `gw_points`. Für `total_points` (alle GWs) wäre eine separate Query nötig — direkt auf `teams.total_points` ist einfacher, Realtime-trigerbar und konsistent mit der bestehenden Architektur.

**Realtime-Safety:**  
`wm_gameweek_points` upsert ist idempotent (`ON CONFLICT (team_id, player_id, gameweek)`). Concurrent stat_updates für denselben Spieler überschreiben sich sicher — letzter Write gewinnt, was korrekt ist (neueste Stats).

---

## 6. Datenfluss: GW-Start & Rank Snapshot

### Trigger: Admin setzt GW auf `active`

Aktuell: `updateGameweekStatus()` im Admin schreibt nur `wm_gameweeks.status`. 

**E1-Änderung:** Admin-Button ruft neue API:

```
POST /api/wm/[id]/gameweek-start
  body: { gameweek: number }

Server:
  1. Auth-Check (Owner)
  2. UPDATE wm_gameweeks SET status = 'active' WHERE gameweek = N
  3. Lade alle Teams der Liga mit total_points
  4. Berechne aktuellen Rang (ORDER BY total_points DESC)
  5. UPSERT wm_gw_rank_snapshots (league_id, gameweek, team_id, rank, total_points)
     ON CONFLICT (league_id, gameweek, team_id) DO UPDATE (idempotent)
  6. Return: { ok: true, snapshot_count: N }
```

**Idempotenz:** Admin kann GW mehrfach auf `active` setzen (z.B. nach Fehler) — Snapshot wird überschrieben mit dem neuesten Stand. Korrekt, da der Snapshot immer den Startpunkt des GW abbilden soll.

---

## 7. rank_delta Mechanik

### Berechnung (Client-Side, Live Center)

```
rank_delta = snapshot_rank - current_rank

Beispiel:
  Rang bei GW-Start: 3  (snapshot_rank)
  Aktueller Rang:    1  (current_rank, berechnet live aus sortiertem Leaderboard)
  rank_delta = 3 - 1 = +2  (zwei Plätze gewonnen → grün, ▲)

  rank_delta = 0   → grau, kein Icon
  rank_delta > 0   → grün, ▲ N
  rank_delta < 0   → rot, ▼ N
```

### Ablauf im Live Center

```
1. loadAll() lädt wm_gw_rank_snapshots für aktives GW
   → Map: team_id → snapshot_rank

2. Leaderboard-Rows werden nach gw_points + total_points sortiert
   → aktueller Rang = Index + 1 in sortierter Liste

3. rank_delta = snapshots[team_id] - current_rank
   (falls kein Snapshot vorhanden → delta = 0, kein Icon)

4. Bei Realtime-Update → Leaderboard neu sortieren → deltas neu berechnen
   (keine extra DB-Query nötig — Snapshot wurde initial geladen)
```

**Kein Server-Round-Trip für rank_delta.** Snapshot einmal laden, delta client-seitig berechnen. Das ist korrekt und günstig.

---

## 8. players_playing Berechnung

**Definition:** Anzahl Spieler im starting_xi eines Teams, deren Nation gerade ein Live-Fixture hat.

**Berechnung (Client-Side, Live Center):**

```
liveNations = Set(fixture.home_nation_id, fixture.away_nation_id)
              für alle fixtures mit status = 'live'

playerNationMap = { player_id → nation_id }
  (bereits geladen via wm_player_nations JOIN)

players_playing(team) =
  starting_xi.filter(playerId =>
    liveNations.has(playerNationMap[playerId])
  ).length
```

**Datenbedarf:** `starting_xi` pro Team muss im Live Center geladen werden. Aktuell wird `starting_xi` nur für das eigene Team geladen (`loadMyPlayers`). E1 erweitert das auf alle Teams.

**Kein neuer DB-Column nötig.** Reine Client-Berechnung aus bereits vorhandenen Daten.

---

## 9. Datenfluss: GW-Finish Flow

### Trigger: Admin klickt "Spieltag abschliessen"

```
POST /api/wm/[id]/gameweek-finish
  body: { gameweek: number }

Server (atomar, sequenziell):
  1. Auth-Check (Owner)
  2. Prüfe: wm_gameweeks.status !== 'finished' (Guard gegen Doppel-Klick)
  3. Lade alle Teams der Liga
  4. Für jedes Team:
     a. SELECT SUM(points) FROM wm_gameweek_points
        WHERE team_id = X (alle GWs)
     b. UPDATE teams SET total_points = SUM WHERE id = X
  5. UPDATE wm_gameweeks SET status = 'finished' WHERE gameweek = N
  6. Berechne Top-Scorer des GW:
     a. SELECT team_id, SUM(points) AS gw_total
        FROM wm_gameweek_points
        WHERE league_id = X AND gameweek = N
        GROUP BY team_id ORDER BY gw_total DESC LIMIT 1
     b. Hole team_name für winner
  7. Schreibe system message: GW-Abschluss
  8. Return: { ok: true, teams_updated: N, winner: { team_name, gw_points } }
```

**Atomar:** Schritte 4–5 passieren in einem Request. Kein partieller Zustand möglich — falls Request fehlschlägt, bleibt GW auf `active` und Admin kann retry (Recovery via rebuild-points API bleibt verfügbar).

**Guard gegen Doppel-Klick:** Wenn `status === 'finished'` → sofort `{ ok: true, already_finished: true }` zurückgeben ohne DB-Writes.

---

## 10. GW-Abschluss System Message

```
Format:
  "■ Spieltag {N} abgeschlossen — {TeamName} führt mit {X} Punkten!"

Meta:
  { type: "gw_finished", gameweek: N, winner_team_id: "...", gw_points: X }
```

Weitere optionale Messages (nur wenn sinnvoll, kein Over-Engineering):
- Kein "Team des GW" Bild-Card (P2)
- Kein individueller "Du hast X Punkte" Message (P2)

---

## 11. Realtime-Flows

### Live Center Subscriptions (erweitert)

```javascript
supabase.channel("wm-live-center")
  // Existing: GW-Punkte Update → reload gw_points + total_points (Full-Reload)
  // Full-Reload holt auch teams.total_points → kein separater teams-Realtime nötig
  .on("postgres_changes", { table: "wm_gameweek_points", filter: `league_id=eq.${leagueId}` },
    () => reloadLeaderboard()   // reloadLeaderboard() fetcht bereits teams.total_points
  )
  // Existing: Fixture Status Update → liveNations neu berechnen
  .on("postgres_changes", { table: "wm_fixtures", filter: `tournament_id=eq.${tournamentId}` },
    (payload) => updateFixture(payload.new)
  )
  // NEU: GW-Status-Änderung (z.B. → finished) → Leaderboard reload
  .on("postgres_changes", { table: "wm_gameweeks", filter: `tournament_id=eq.${tournamentId}` },
    () => reloadLeaderboard()
  )
```

**Warum kein Realtime auf `teams`:**  
`loadLeaderboard()` fetcht bereits `teams.select("id, name, total_points")`. Der `wm_gameweek_points`-Realtime triggert einen Full-Reload der auch `total_points` neu lädt — kein separater `teams`-Realtime nötig. GW-Finish-Updates werden über den `wm_gameweeks`-Realtime erkannt.

**Kein Realtime-Loop-Risiko:**  
- `reloadLeaderboard()` liest Daten, schreibt nichts
- Alle Trigger kommen vom Server → Client liest → kein Write-Read-Write-Zyklus

---

## 12. Failure & Recovery

| Szenario | Verhalten |
|----------|-----------|
| `handlePlayerStatUpdate` — `total_points` Update schlägt fehl | Warning im `applied`-Array, GW-Punkte wurden geschrieben — Recovery via `rebuild-points` API |
| `gameweek-finish` — Request bricht ab nach step 4, vor step 5 | `total_points` aktualisiert, GW bleibt `active` — Admin kann erneut abschliessen (idempotent) |
| Doppelter GW-Finish Klick | Guard auf `status === 'finished'` → no-op |
| Rank Snapshot fehlt | `rank_delta = 0`, kein Icon — kein Crash |
| `starting_xi` für Team nicht geladen | `players_playing = 0` — kein Crash |
| Concurrent `player.stat_update` für gleichen Spieler | `ON CONFLICT` upsert → letzter Write gewinnt (korrekt) |

---

## 13. Risiken

| Risiko | Wahrscheinlichkeit | Mitigation |
|--------|-------------------|------------|
| `total_points` wird doppelt updated (concurrent stat_updates) | Niedrig | Idempotent: SUM neu berechnet, nicht inkrementiert |
| Realtime auf `teams` feuert zu häufig bei vielen stat_updates | Mittel | Reload ist cheap (nur total_points + rank, keine Player-Queries) |
| GW-Finish wird vor vollständigen Statistiken ausgeführt | Mittel | Admin-Verantwortung; Recovery via `rebuild-points` API möglich |
| `wm_gw_rank_snapshots` fehlt für aktuellen GW (erster GW) | Niedrig | `rank_delta = 0` fallback, kein Error |

---

## 14. Reihenfolge der Implementierung

```
Task 1: total_points live update in handlePlayerStatUpdate
  → lib/wm-ingest.ts
  → Kein UI, keine Migration, sofort wirksam
  → Unblockiert: Live Center zeigt korrekte Werte

Task 2: gameweek-start API + Rank Snapshot
  → app/api/wm/[id]/gameweek-start/route.ts
  → DB Migration: wm_gw_rank_snapshots
  → Admin-Button verdrahten

Task 3: gameweek-finish API
  → app/api/wm/[id]/gameweek-finish/route.ts
  → Admin-Button verdrahten (ersetzt direktes DB-Write)
  → System Message

Task 4: Live Center — rank_delta, players_playing, Realtime
  → app/wm/[id]/live/page.tsx
  → Snapshot laden, delta berechnen
  → starting_xi aller Teams laden für players_playing
  → teams Realtime-Subscription ergänzen

Task 5: QA
  → Manuell: stat_update → Live Center Punkte check
  → Manuell: GW-Start → Snapshot check
  → Manuell: GW-Finish → total_points, status, system message
  → rank_delta Richtigkeit prüfen
```
