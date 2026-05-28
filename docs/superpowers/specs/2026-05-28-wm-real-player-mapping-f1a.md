# F1-A: WM Real Player Mapping — Architektur & Design

**Datum:** 2026-05-28
**Phase:** F1-A (Design only — keine Implementation, kein Import)
**Status:** Approved
**Scope:** Architektur für den Umstieg von synthetischen Testspielern auf echte API-Football-Spieler im WM Fantasy System

---

## Überblick

Das WM-System verwendet aktuell synthetische Testspieler (IDs 90001–90168) für QA, Chaos-Tests und lokale Entwicklung. F1-A definiert die Architektur, die es erlaubt, echte API-Football-WM-Spieler **parallel** zu den Testspielern einzuführen — ohne bestehende Test-Ligen, QA-Skripte oder Regression-Tests zu gefährden.

**F1-A ist reine Architektur- und Designarbeit. Es wird kein Code geändert, kein Import ausgeführt, kein Premium-API-Zugang vorausgesetzt.**

---

## Architektur-Invarianten

Diese Invarianten gelten ab F1-B unveränderlich für alle Code- und DB-Änderungen:

```
INVARIANT 1: wm_tournaments.is_test_tournament ist die Single Source of Truth
             für den Player-Pool eines Turniers. Kein Liga-Level-Override.

INVARIANT 2: wm_league_settings.is_test_mode wird NICHT eingeführt.
             Die Zugehörigkeit zu einem Tournament (via wm_league_settings.tournament_id)
             bestimmt den Player-Pool vollständig.

INVARIANT 3: ID-Ranges (90001–90168) dürfen nach dem einmaligen Backfill-UPDATE
             (M-03a) NIEMALS wieder als Filter- oder Sicherheitslogik verwendet werden.
             API-Football-IDs gehen weit über 90000 hinaus — ID-Range-Checks sind unsicher.

INVARIANT 4: players.team_name ist langfristig nur Display/Fallback, niemals Lookup-Quelle.
             Alle Player→Nation-Verknüpfungen laufen über wm_player_nations.

INVARIANT 5: wm_player_nations ist die primäre Player→Nation-Verknüpfungsquelle.
             String-basiertes Matching (team_name === nation.name) ist deprecated.

INVARIANT 6: players.id = API-Football player.id (Option A, konsistent mit Liga-Modus).
             Keine separate api_player_id-Spalte, solange API-Football einzige Quelle bleibt.
```

---

## Sektion 1: Schema-Änderungen

### 1a. players Tabelle — zwei neue Felder

```sql
-- Migration M-01
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS is_test_player BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS player_source  TEXT    NOT NULL DEFAULT 'api_football'
    CONSTRAINT players_source_check
    CHECK (player_source IN ('api_football', 'test', 'manual'));

CREATE INDEX IF NOT EXISTS idx_players_is_test ON players (is_test_player);
CREATE INDEX IF NOT EXISTS idx_players_source  ON players (player_source);
```

**Bedeutung der Felder:**

| Feld | Testspieler | Echte Spieler |
|---|---|---|
| `is_test_player` | `true` | `false` |
| `player_source` | `'test'` | `'api_football'` |

**`player_source` ist kein kosmetisches Feld.** Es wird genutzt für:
- Admin-Debugging (welcher Source hat diesen Spieler erzeugt?)
- Import-Audits (was kam aus welchem Provider?)
- Rollback-Operationen (`DELETE WHERE player_source='api_football' AND ...`)
- Analytics (Spieler-Herkunft über Zeit)
- Multi-Source-Imports (falls FBref, Statsbomb oder manuelle Quellen hinzukommen)

### 1b. wm_tournaments Tabelle — is_test_tournament Flag

```sql
-- Migration M-02
ALTER TABLE wm_tournaments
  ADD COLUMN IF NOT EXISTS is_test_tournament BOOLEAN NOT NULL DEFAULT false;
```

**Alle Leagues, die über `wm_league_settings.tournament_id` mit einem `is_test_tournament=true` Tournament verknüpft sind, sehen ausschließlich `is_test_player=true` Spieler.** Diese Trennlogik ergibt sich transitiv:

```
wm_league_settings.tournament_id
  → wm_tournaments.is_test_tournament
    → players WHERE is_test_player = [true/false]
```

### 1c. wm_league_settings — kein neues Feld

`wm_league_settings` erhält kein `is_test_mode`. Das Tournament ist die Single Source of Truth.

### 1d. Einmaliger Backfill

```sql
-- Migration M-03a: Testspieler markieren (automatisch, idempotent)
UPDATE players
SET is_test_player = true,
    player_source  = 'test'
WHERE id BETWEEN 90001 AND 90168
  AND is_test_player = false;

-- Migration M-03b: Test-Turniere markieren (MANUELL pro Tournament prüfen)
-- UPDATE wm_tournaments SET is_test_tournament = true WHERE id = '<uuid>';
-- Nicht automatisierbar — erfordert semantische Prüfung welche Turniere Test-Ligen haben.
```

**Wichtig:** M-03a ist der letzte legitime Einsatz der ID-Range 90001–90168 als Filter. Danach gilt INVARIANT 3.

### 1e. Rollback

```sql
-- M-01 Rollback:
ALTER TABLE players DROP COLUMN IF EXISTS is_test_player;
ALTER TABLE players DROP COLUMN IF EXISTS player_source;

-- M-02 Rollback:
ALTER TABLE wm_tournaments DROP COLUMN IF EXISTS is_test_tournament;
```

### 1f. Migrations-Reihenfolge

```
M-01 → M-02 → M-03a → M-03b (manuell)
```

Alle Migrationen sind nicht-destruktiv und rollbackbar. Bestehende Daten werden nicht gelöscht.

---

## Sektion 2: Datentrennung & Player-Pool-Architektur

### 2a. Trennprinzip

```
Tournament (is_test_tournament = true)  →  Player Pool: WHERE is_test_player = true
Tournament (is_test_tournament = false) →  Player Pool: WHERE is_test_player = false
```

### 2b. Zentrale Player-Pool-Query

Alle bestehenden ID-Range-Checks werden in F1-B durch diese zentrale Funktion ersetzt:

```typescript
// lib/wm-player-pool.ts  (wird in F1-B erstellt)
export async function getWmPlayerPool(
  supabase: SupabaseClient,
  tournamentId: string,
  nationNames: string[]
) {
  const { data: tournament } = await supabase
    .from('wm_tournaments')
    .select('is_test_tournament')
    .eq('id', tournamentId)
    .single();

  return supabase
    .from('players')
    .select('id, name, position, team_name, photo_url, rating')
    .eq('is_test_player', tournament.is_test_tournament)  // ← Guard, nie ID-Range
    .in('team_name', nationNames);
}
```

### 2c. Code-Audit: Hardcoded ID-Ranges (werden in F1-B entfernt)

| # | Datei | Zeile | Problem | Fix |
|---|---|---|---|---|
| C-01 | `app/wm/[id]/draft/page.tsx` | 239–240 | `.gte("id",90001).lte("id",90120)` Test-Erkennung | `is_test_player`-Flag |
| C-02 | `app/wm/[id]/draft/page.tsx` | 245 | `.gte("id",90001).lte("id",90200)` Player Pool | `getWmPlayerPool()` |
| C-03 | `app/components/lineup/MarketTab.tsx` | 178 | `.gte("id",90001).lte("id",90120)` Test-Erkennung | `is_test_player`-Flag |
| C-04 | `app/components/lineup/MarketTab.tsx` | 293 | `.gte("id",90001).lte("id",90200)` Player Pool | `getWmPlayerPool()` |

### 2d. Code-Audit: team_name String-Matching (wird in F1-B umgestellt)

| # | Datei | Zeile | Problem |
|---|---|---|---|
| C-05 | `app/wm/[id]/waiver/page.tsx` | 246 | `nations.find(n => n.name === player.team_name)` |
| C-06 | `app/wm/[id]/lineup/page.tsx` | 227 | `nations.find(n => n.name === player.team_name)` |
| C-07 | `app/wm/[id]/admin/page.tsx` | 395 | gleich + TODO-Kommentar |
| C-08 | `app/wm/[id]/admin/page.tsx` | 1277 | gleich + TODO-Kommentar |
| C-09 | `app/wm/[id]/draft/page.tsx` | 1143 | `nations.find(n => n.name === p.team_name)` |
| C-10 | `app/wm/[id]/draft/page.tsx` | 247 | `.in("team_name", nationNames)` |

**Fix in F1-B:** Spieler werden mit ihrer `nation_id` aus `wm_player_nations` geladen:

```sql
SELECT p.*, pn.nation_id, wn.name AS nation_name, wn.flag_url
FROM players p
JOIN wm_player_nations pn ON pn.player_id = p.id AND pn.tournament_id = $1
JOIN wm_nations wn ON wn.id = pn.nation_id
WHERE p.is_test_player = $is_test
```

### 2e. Parallelbetrieb Test + Real (dauerhaft)

```
wm_tournaments
  ┌─────────────────────────────────────────────┐
  │ "WM 2026 QA"  is_test_tournament = true     │
  │  → Player Pool: is_test_player = true        │
  │  → QA/Chaos/E2E-Skripte laufen hier dauerhaft│
  └─────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────┐
  │ "WM 2026"     is_test_tournament = false    │
  │  → Player Pool: is_test_player = false       │
  │  → Echte Ligen, echter Draft, echte Daten   │
  └─────────────────────────────────────────────┘
```

Test-Tournament wird nicht gelöscht. Beide koexistieren dauerhaft.

### 2f. Environment-Empfehlung

| Environment | Player-Daten | Tournament-Typ | Zweck |
|---|---|---|---|
| Production | Echte API-Football-Spieler | `is_test_tournament=false` | Live-Ligen |
| Production | Testspieler (90001–90168) | `is_test_tournament=true` | QA-Turniere parallel |
| Staging | Testspieler | `is_test_tournament=true` | Feature-Tests, Regression |
| Dev | Testspieler | `is_test_tournament=true` | Lokale Entwicklung |

Kein separater API-Key für Test-Daten nötig — Testspieler sind in der DB, kein API-Call erforderlich.

---

## Sektion 3: Import-Architektur für echte API-Football-Spieler

*(Design only — Implementierung in F1-C)*

### 3a. Import-Endpunkt

```
POST /api/wm/import-players
```

Separater Endpunkt (nicht der bestehende `/api/import-players` für Liga-Modus), da:
- WM nutzt `/players/squads?team=` statt `/players?league=`
- WM-Import setzt `is_test_player=false`, `player_source='api_football'` explizit
- WM-Import schreibt zusätzlich in `wm_player_nations`
- Liga-Import hat keine `tournament_id`-Logik

### 3b. Request-Payload

```typescript
POST /api/wm/import-players
{
  tournament_id: string;
  api_team_id?: number;              // für scope="nation"
  scope: "nation" | "tournament";    // "tournament" = alle Nationen sequenziell
  dry_run: boolean;                  // true = kein DB-Write, nur Report
}
```

**`dry_run: true` ist Pflicht vor jedem ersten echten Import einer Nation oder des Tournaments.**

### 3c. API-Football Endpoints

```
GET /players/squads?team={api_team_id}   → Squad einer Nation
GET /teams?league=1&season=2026          → Alle WM-Teams mit api_team_id
GET /players?league=1&season=2026        → Alle WM-Spieler (paginiert, Premium)
```

API-Football League ID für WM 2026: `league=1`, `season=2026`.

### 3d. Feld-Mapping API-Football → players

| API-Football | players | Transformation |
|---|---|---|
| `player.id` | `id` (PK) | direkt — Option A (INVARIANT 6) |
| `player.name` | `name` | direkt |
| `statistics[0].games.position` | `position` | `Goalkeeper→GK`, `Defender→DF`, `Midfielder→MF`, `Attacker→FW` |
| `statistics[0].team.name` | `team_name` | Nation-Name (Display only, INVARIANT 4) |
| `statistics[0].team.id` | `api_team_id` | direkt |
| `player.nationality` | `nationality` | direkt |
| `player.photo` | `photo_url` | direkt |
| — | `is_test_player` | immer `false` (explizit) |
| — | `player_source` | immer `'api_football'` (explizit) |
| — | `rating` | `null` (kein Mapping) |

### 3e. Import-Pseudologik

```typescript
// POST /api/wm/import-players  (F1-C — nicht implementiert)
async function importWmPlayers(req: ImportRequest) {
  // STEP 1: Pre-flight Validation
  await validatePreFlight(req.tournamentId, req.apiTeamId);

  // STEP 2: API-Football Squad abrufen
  const squad = await fetchApiFootball(`/players/squads?team=${req.apiTeamId}`);

  // STEP 3: Pro Spieler
  const results = [];
  for (const entry of squad.players) {
    const player = mapApiPlayerToDbPlayer(entry);

    // STEP 3a: Collision Check
    await checkCollision(player.id);

    if (!req.dry_run) {
      // STEP 3b: Upsert players
      await supabase.from('players').upsert({
        id:             player.id,
        name:           player.name,
        position:       player.position,
        team_name:      player.teamName,
        nationality:    player.nationality,
        photo_url:      player.photo,
        api_team_id:    player.apiTeamId,
        is_test_player: false,          // EXPLIZIT
        player_source:  'api_football', // EXPLIZIT
      }, { onConflict: 'id' });

      // STEP 3c: wm_player_nations verknüpfen
      await supabase.from('wm_player_nations').upsert({
        tournament_id: req.tournamentId,
        player_id:     player.id,
        nation_id:     await resolveNationId(req.tournamentId, player.apiTeamId),
      }, { onConflict: 'tournament_id,player_id' });
    }

    results.push(player);
  }

  // STEP 4: Post-import Validation
  if (!req.dry_run) await validatePostImport(req.tournamentId, req.apiTeamId);

  return buildReport(results, req.dry_run);
}
```

### 3f. Dry-Run Report

```typescript
{
  dry_run: true,
  total_players_seen: number,
  players_to_insert: number,           // id nicht in players vorhanden
  players_to_update: number,           // id vorhanden, is_test_player=false
  collisions: Array<{                  // id vorhanden, is_test_player=true ← BLOCKER
    player_id: number,
    existing_name: string,
    incoming_name: string,
  }>,
  missing_nation_mappings: number,     // wm_nations hat keinen Eintrag für api_team_id
  invalid_positions: Array<{ player_id: number, raw_position: string }>,
  warnings: string[],
  would_write_to_players: number,
  would_write_to_wm_player_nations: number,
}
```

### 3g. Validation Layer — Pre-flight (7 Checks)

```
V-01: Tournament existiert UND is_test_tournament=false.
      Echte Spieler dürfen nicht in Test-Tournaments importiert werden.

V-02: wm_nations enthält einen Eintrag mit diesem api_team_id im Tournament.

V-03: Collision Bulk-Check — existiert ein players-Row mit is_test_player=true
      für eine der API-Football-IDs im Squad? (zusätzlich zu Per-Spieler-Check)

V-04: FOOTBALL_API_KEY vorhanden.

V-05: Rate-Limit-Check (100 req/day Free Tier).

V-06: Squad-Größe plausibel (23–26 Spieler für WM-Kader).

V-07: Position-Verteilung plausibel (min. 1 GK, min. 5 DF, min. 5 MF, min. 2 FW).
```

### 3h. Collision-Check (pro Spieler)

```typescript
async function checkCollision(playerId: number) {
  const { data } = await supabase
    .from('players')
    .select('id, name, is_test_player')
    .eq('id', playerId)
    .single();

  if (data?.is_test_player) {
    throw new Error(
      `COLLISION: player.id=${playerId} (${data.name}) ist ein Testspieler. ` +
      `Echter Import würde Testdaten überschreiben. Abbruch.`
    );
  }
  // is_test_player=false → Upsert ist safe
}
```

### 3i. Validation Layer — Post-import (5 Checks)

```
P-01: Alle neu geschriebenen Spieler haben is_test_player=false.
P-02: Alle neu geschriebenen Spieler haben einen wm_player_nations-Eintrag.
P-03: Keine Testspieler in wm_player_nations dieses (realen) Tournaments.
P-04: Position-Counts im erwarteten Range.
P-05: Keine doppelten Spieler für dieselbe Nation im selben Tournament.
```

### 3j. wm_import_runs — Empfehlung für F1-B/F2

Import-Reports sollten persistent gespeichert werden (nicht nur als API-Response):

```sql
-- Empfehlung für F1-B oder F2 — NICHT in F1-A/F1-C implementieren
CREATE TABLE wm_import_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES wm_tournaments(id),
  scope         TEXT NOT NULL,           -- 'nation' | 'tournament'
  api_team_id   INTEGER,                 -- NULL wenn scope='tournament'
  dry_run       BOOLEAN NOT NULL,
  status        TEXT NOT NULL,           -- 'success' | 'failed' | 'partial'
  report        JSONB NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

Nutzen: Nachvollziehbarkeit, Debugging, Dry-Run vs. Real Vergleich, Kaderänderungs-Audit, gezieltes Batch-Rollback.

---

## Sektion 4: Migration-Strategie

### 4a. Phasen-Übersicht

```
Phase 1 — DB-Migrationen:
  M-01: ALTER TABLE players ADD is_test_player, player_source + CHECK-Constraint
  M-02: ALTER TABLE wm_tournaments ADD is_test_tournament
  M-03a: Backfill players (automatisch, idempotent)
  M-03b: Backfill wm_tournaments (manuell, pro Tournament semantisch prüfen)

Phase 2 — Seed-Update:
  wm_test_players_seed.sql erhält is_test_player=true, player_source='test'
  → QA-Skripte bleiben dauerhaft reproduzierbar

Phase 3 — Code-Umstellung (F1-B):
  lib/wm-player-pool.ts erstellen
  C-01–C-04: ID-Range-Checks ersetzen
  C-05–C-10: team_name-Lookups auf wm_player_nations-Join umstellen

Phase 4 — Import-Endpunkt (F1-C):
  POST /api/wm/import-players implementieren
  Dry-Run zuerst, dann echter Import

Phase 5 — Echter Import (nach Premium + finalen Kadern):
  Dry-Run für alle 32 Nationen
  Import nation by nation
  Post-Import Validation
  Test-Turniere weiterhin parallel aktiv
```

### 4b. Regressions-Schutz für QA-Skripte

```
GUARANTEE 1: Testspieler IDs 90001–90168 bleiben dauerhaft in DB.
             Kein Import-Script darf diese Rows löschen oder überschreiben.

GUARANTEE 2: wm_test_players_seed.sql bleibt idempotent ausführbar.
             Seed erhält is_test_player=true, player_source='test'.

GUARANTEE 3: Bestehende Test-Turniere bleiben is_test_tournament=true.
             Alle Leagues darin sehen weiterhin nur Testspieler.

GUARANTEE 4: QA/Chaos/E2E-Skripte verwenden tournament_id eines
             is_test_tournament=true Turniers — niemals eines realen.

GUARANTEE 5: Import-Guard V-01 verhindert versehentlichen Import in Test-Turniere.
```

### 4c. Rollback-Prozedur (bei fehlgeschlagenem Import)

```sql
-- Nation-Rollback (api_team_id bekannt):
DELETE FROM wm_player_nations
WHERE tournament_id = $tournament_id
  AND nation_id = (
    SELECT id FROM wm_nations
    WHERE tournament_id = $tournament_id AND api_team_id = $api_team_id
  );

DELETE FROM players
WHERE api_team_id = $api_team_id
  AND player_source = 'api_football'
  AND is_test_player = false
  AND id NOT IN (SELECT player_id FROM wm_squad_players)
  AND id NOT IN (SELECT player_id FROM squad_players);
```

**`player_source` ist für sicheren Rollback kritisch** — ohne dieses Feld wäre nicht unterscheidbar, welche Rows aus welchem Import stammen.

---

## Sektion 5: Operational Workflow & Admin-Prozess

### 5a. Gate 0 — Voraussetzungen (einmalig)

```
PRE-01: API-Football Premium-Zugang aktiv (league=1, season=2026 zugänglich)
PRE-02: Offizielle WM 2026 Kader bekannt und auf API-Football verfügbar
PRE-03: DB-Migrationen M-01 bis M-03b ausgeführt und verifiziert
PRE-04: wm_test_players_seed.sql aktualisiert (is_test_player=true)
PRE-05: Mindestens ein wm_tournaments mit is_test_tournament=false angelegt
PRE-06: Alle 32 wm_nations mit korrektem api_team_id befüllt
PRE-07: POST /api/wm/import-players deployed
PRE-08: QA-Baseline verifiziert: E2E-Tests grün
```

**PRE-06 kann bereits mit dem Free Tier vorbereitet werden** via `GET /teams?league=1&season=2026`.

### 5b. Workflow pro Nation (32× ausführen)

```
GATE 0: Voraussetzungen PRE-01–PRE-08 alle erfüllt? → JA: weiter | NEIN: Stop

STEP 1 DRY-RUN:
  POST /api/wm/import-players { ..., dry_run: true }
  Prüfen:
    collisions = 0?              → JA: weiter | NEIN: Stop (Konflikt lösen)
    missing_nation_mappings = 0? → JA: weiter | NEIN: wm_nations befüllen
    invalid_positions = 0?       → JA: weiter | NEIN: Mapping korrigieren
    total_players_seen ∈ [23,26] → JA: weiter | NEIN: prüfen
    warnings leer?               → JA: weiter | NEIN: prüfen

STEP 2 IMPORT:
  POST /api/wm/import-players { ..., dry_run: false }
  Nur wenn alle Dry-Run-Gates passiert.

STEP 3 POST-IMPORT VALIDATION (automatisch):
  P-01 bis P-05 alle Pass? → weiter | Fail: Rollback (4c)

STEP 4 QA-CHECK (manuell, ~5 min):
  □ Nation im Draft-Filter sichtbar?
  □ Spieler der Nation sichtbar?
  □ Spieler-Photos laden?
  □ Position-Labels korrekt?
  □ Testspieler NICHT sichtbar in realer Liga?
  □ Test-Liga: Testspieler weiterhin sichtbar?
  Alle Pass? → weiter | Fail: Rollback (4c)

STEP 5 ACTIVATION (nach allen 32 Nationen):
  □ Alle 32 Nationen importiert
  □ wm_tournaments.status = 'upcoming'
  □ wm_gameweeks angelegt
  □ Commissioner gibt Draft frei
```

### 5c. Tournament-weiter Import (scope: "tournament")

```typescript
// Empfohlene Reihenfolge: Dry-Run für alle 32 Nationen aggregiert,
// dann nation by nation importieren.

// 1. Aggregierter Dry-Run:
POST /api/wm/import-players { tournament_id, scope: "tournament", dry_run: true }

// 2. Wenn Report clean — echter Import:
POST /api/wm/import-players { tournament_id, scope: "tournament", dry_run: false }
// Intern: for each nation → Pre-flight → Import → Validate
// Bei erstem Fehler: Stop + Rollback bisher importierter Nationen
```

Rate-Limit beachten: 100 req/day Free Tier — bei 32 Nationen ggf. über mehrere Tage verteilen oder Premium nutzen.

---

## Sektion 6: Risiko-Matrix, Phasenplanung & Aufwände

### 6a. Risiko-Matrix

| ID | Risiko | W'lichkeit | Schwere | Mitigation |
|---|---|---|---|---|
| R-01 | API-Football-ID kollidiert mit Test-ID (90001–90168) | Hoch | Kritisch | `is_test_player`-Flag + Collision-Check V-03/per Spieler |
| R-02 | Spieler ohne wm_nations-Eintrag importiert | Mittel | Hoch | Pre-flight V-02: Nation muss in wm_nations existieren |
| R-03 | team_name-Mismatch (z.B. "USA" vs. "United States") | Hoch | Mittel | wm_player_nations als primäre Quelle (INVARIANT 4/5) |
| R-04 | Liga-Spieler durch WM-Import überschrieben | Mittel | Niedrig | ON CONFLICT DO UPDATE nur WM-relevante Felder; Liga-Stats bleiben |
| R-05 | Kaderänderungen nach initialem Import | Hoch | Mittel | scope="nation" erneut ausführen; ON CONFLICT DO UPDATE ist idempotent |
| R-06 | Rate-Limit überschritten (100 req/day) | Hoch bei 32 Nationen | Mittel | Import aufteilen; Premium vor vollem Import; wm_import_runs für Status |
| R-07 | wm_player_nations-Backfill vergessen | Niedrig | Hoch | P-02 als obligatorischer Post-Import Check |
| R-08 | Test-Tournament versehentlich is_test_tournament=false | Niedrig | Kritisch | M-03b manuell + Checkliste; Admin-UI zeigt Flag sichtbar |
| R-09 | Draft startet vor vollständigem Import | Mittel | Hoch | STEP 5 Activation Gate: erst nach 32/32 Nationen |
| R-10 | Zukünftiger Multi-Provider braucht Schema-Migration | Niedrig | Niedrig | player_source bereits vorbereitet; UUID-Schicht als dokumentierter Pfad |

### 6b. Phasenplanung

#### F1-A: Architektur & Design *(diese Session — abgeschlossen)*
```
✓ Codebase-Analyse
✓ Architektur-Invarianten
✓ Schema-Design (M-01 bis M-03b)
✓ Import-Endpunkt Design + Dry-Run-Spec
✓ Validation Layer (V-01–V-07, P-01–P-05)
✓ Migration-Strategie (nicht-destruktiv, rollbackbar)
✓ Operational Workflow
✓ Risiko-Matrix
✓ Spec-Dokument
```

#### F1-B: Code-Umstellung *(nächste Session — kein echter Import)*
```
□ DB-Migrationen M-01, M-02 ausführen
□ M-03a Backfill players (automatisch)
□ M-03b Backfill wm_tournaments (manuell)
□ wm_test_players_seed.sql updaten
□ lib/wm-player-pool.ts erstellen
□ C-01–C-04: ID-Range-Checks ersetzen
□ C-05–C-10: team_name-Lookups auf wm_player_nations-Join umstellen
□ Regression-Tests: E2E + Chaos-Tests grün
Aufwand: ~1 Session, ~4–6h
Blocker: keine
```

#### F1-C: Import-Endpunkt *(nach Premium-Zugang + finalen Kadern)*
```
□ POST /api/wm/import-players implementieren
□ Dry-Run vollständig implementieren
□ Pre-flight V-01–V-07
□ Post-import P-01–P-05
□ Collision-Check
□ Rollback-Prozedur
□ Admin-UI: Import-Trigger + Dry-Run Report
□ (Optional F2) wm_import_runs Persistenz
□ Dry-Run für alle 32 Nationen
□ Echter Import nach erfolgreichem Dry-Run
Aufwand: ~2–3 Sessions, ~8–12h
Blocker: PRE-01 (Premium), PRE-02 (offizielle Kader)
```

### 6c. Kritische Blocker

```
BLOCKER-1: API-Football Premium-Zugang
           → F1-C kann nicht starten ohne league=1, season=2026 Zugriff
           → F1-A und F1-B sind vollständig unabhängig davon

BLOCKER-2: Offizielle WM 2026 Kader (Turnierbeginn: 11. Juni 2026)
           → Vorläufige Kader ggf. ab Mai 2026 verfügbar
           → Echter Import erst nach finaler Bekanntgabe empfohlen

BLOCKER-3: 32 wm_nations mit korrekten api_team_id befüllt
           → Abrufbar mit Free Tier: GET /teams?league=1&season=2026
           → Kann sofort nach F1-B vorbereitet werden
```

### 6d. Aufwandsschätzung

| Phase | Aufwand | Kann starten | Blocker |
|---|---|---|---|
| F1-A (Spec) | ~2h | sofort | — |
| F1-B (Code) | ~4–6h | sofort nach F1-A | — |
| F1-C (Import) | ~8–12h | nach Premium + Kader | BLOCKER-1, 2, 3 |

### 6e. Langfristiger Migrationspfad zu Multi-Provider *(dokumentiert, nicht implementieren)*

```
Aktuell (Option A):
  players.id = API-Football player.id (INT)
  Einfach, konsistent mit Liga-Modus.

Zukünftig bei Multi-Provider-Bedarf:
  players.id         → interne UUID oder SERIAL
  players.api_player_id → api_football player.id
  players.player_source → 'api_football' | 'fbref' | 'statsbomb' | ...

Migration-Trigger:
  Nur wenn zweiter Player-Data-Provider integriert werden soll.
  Bis dahin: Option A ist korrekt und performant.
  player_source CHECK-Constraint mit 'manual' als Erweiterungs-Slot bereits vorbereitet.
```

### 6f. Archivierungsstrategie *(dokumentiert, nicht implementieren)*

Für spätere Erweiterung (F2+):

```sql
-- Option A (einfach):
ALTER TABLE players ADD COLUMN is_archived BOOLEAN DEFAULT false;

-- Option B (auditierbar):
ALTER TABLE players ADD COLUMN archived_at TIMESTAMPTZ;
```

Einsatz: fehlerhafte Imports deaktivieren, doppelte Spieler archivieren, Import-Batches rollbacken, manuelle Korrekturen nachvollziehen. Entscheidung zwischen Option A und B bei Bedarf treffen.

---

## Zusammenfassung

F1-A definiert eine saubere, erweiterbare Architektur für den Umstieg auf echte WM-Spieler:

- **Keine Big-Bang-Migration.** Testdaten bleiben dauerhaft aktiv, echte Spieler kommen additiv dazu.
- **Explizite Trennung** statt ID-Range-Heuristik — `is_test_player` + `is_test_tournament` als Guards.
- **Dry-Run ist Pflicht** vor jedem echten Import — kein versehentliches Überschreiben von Testdaten.
- **wm_player_nations** als primäre Verknüpfungsquelle ersetzt fragiles `team_name`-String-Matching.
- **F1-B ist sofort startbar** — keine API-Schlüssel, keine externen Abhängigkeiten, keine Breaking Changes.
