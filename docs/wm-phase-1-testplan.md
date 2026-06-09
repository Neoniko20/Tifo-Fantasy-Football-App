# WM Phase-1 Testplan

**Stand:** Mai 2026 — Stabilisierungssprint angewendet  
**Scope:** Alle serverseitigen WM-Routen + Admin-UI + Root Page  
**Nicht in Scope:** Auto-Football-Integration, Matchday-UI, Scoring-Algorithmus

---

## Voraussetzungen

- Supabase local oder Staging-Umgebung
- Mindestens 2 Test-Accounts (Owner + Member)
- `CRON_SECRET` gesetzt in `.env.local`
- Mindestens 1 WM-Liga — erkennbar via `wm_league_settings.league_id` (mode-Spalte optional)
- **Migration ausgeführt:** `db/migrations.sql` vollständig in Supabase SQL Editor eingespielt
  - Prüfen: `SELECT deadline FROM wm_gameweeks LIMIT 1` darf nicht fehlen

---

## Testfälle

### TC-01 · WM-Liga erstellen

**Ziel:** Liga mit mode=wm, wm_league_settings und wm_tournament werden korrekt angelegt.

**Schritte:**
1. Als User A → `/leagues` → „WM 2026" erstellen
2. Supabase prüfen:
   - `leagues.mode = 'wm'`
   - `wm_league_settings.league_id` vorhanden
   - `wm_league_settings.tournament_id` auf gültigen Eintrag in `wm_tournaments` zeigt

**Erwartetes Ergebnis:** Liga status=setup, WM-Settings korrekt befüllt.

---

### TC-02 · Teams beitreten (WM Root Page)

**Ziel:** User B tritt per Invite-Code bei, WM Root Page zeigt beide Teams.

**Schritte:**
1. User B → `/leagues` → Code eingeben
2. User A → `/wm` prüfen: eigene Liga-Karte sichtbar
3. User B → `/wm` prüfen: eigene Liga-Karte sichtbar

**Erwartetes Ergebnis:**
- Karte zeigt Liganame, Teamname, Teamanzahl
- Button "Öffnen →" vorhanden
- Draft-Button sichtbar (status=setup/draft), Lineup/Waiver noch inaktiv

---

### TC-03 · Draft-Pick speichern

**Route:** `POST /api/wm/[id]/draft/pick`

**Schritte:**
1. Liga-Status auf `draft` setzen
2. Draft-Session erstellen
3. `POST { player_id, team_id, round: 1, pick: 0 }`
4. Supabase: `wm_squad_players` Eintrag prüfen → `acquired_via = 'draft'`

**Erwartetes Ergebnis:** 200 `{ ok: true, nextPick: 1, finished: false }`

---

### TC-04 · Draft-Duplikat verhindern

**Route:** `POST /api/wm/[id]/draft/pick`

**Schritte:**
1. Pick aus TC-03 wiederholen (gleicher `player_id`)

**Erwartetes Ergebnis:** 409 `{ error: "Spieler bereits in dieser WM-Liga gedraftet" }`

---

### TC-05 · Lineup speichern

**Route:** `POST /api/wm/[id]/lineup`

**Schritte:**
1. Liga auf `active` setzen, aktive Gameweek vorhanden
2. 11 Spieler aus `wm_squad_players` des Teams
3. Gültige Formation, Kapitän in Startelf
4. `POST { team_id, gameweek_id, formation, starters[11], bench, captain_id, vice_captain_id }`
5. `team_lineups` prüfen: `starting_xi`, `formation`, `captain_id` korrekt

**Erwartetes Ergebnis:** 200 `{ ok: true }`

---

### TC-06 · Lineup mit fremdem Spieler ablehnen

**Route:** `POST /api/wm/[id]/lineup`

**Schritte:**
1. Gleicher Request wie TC-05, aber einer der `starters[]` ist ein Spieler-ID aus einem anderen Team (nicht in `wm_squad_players` für dieses Team)

**Erwartetes Ergebnis:** 400 `{ error: "Spieler gehören nicht zu diesem Team: [id]" }`

---

### TC-07 · Lineup nach Deadline ablehnen

**Route:** `POST /api/wm/[id]/lineup`

**Schritte:**
1. In `wm_gameweeks` das `deadline`-Feld auf einen Zeitpunkt in der Vergangenheit setzen
2. Gleicher valider Request wie TC-05

**Erwartetes Ergebnis:** 409 `{ error: "Aufstellungs-Deadline ist bereits abgelaufen" }`

> **✅ Migration erfolgt:** `wm_gameweeks.deadline TIMESTAMPTZ` in `db/migrations.sql` ergänzt.

---

### TC-08 · Waiver Claim verarbeiten

**Route:** `POST /api/process-waivers-wm`

**Schritte:**
1. Spieler in `waiver_wire` als `available` eingetragen
2. `waiver_claim` mit status=pending, gameweek korrekt gesetzt
3. `POST { leagueId, gameweek }` mit Service-Role-Key (oder Admin-Button im Frontend)
4. Prüfen:
   - `waiver_wire.status = 'claimed'`
   - `wm_squad_players` enthält neuen Spieler mit `acquired_via = 'waiver'`
   - Claim-Status = `approved`
   - Falls `player_out`: Spieler aus `wm_squad_players` entfernt, zurück auf Wire

**Erwartetes Ergebnis:** 200 `{ ok: true, approved: 1, rejected: 0 }`

---

### TC-09 · Auto-Subs ausführen

**Route:** `POST /api/wm/[id]/auto-subs`

**Schritte:**
1. Gameweek auf `finished` setzen
2. Stats für Starter eintragen: Starter A → `minutes = 0`, Bench-Spieler B → `minutes = 75`
3. `POST { gameweek_id }` mit Bearer-Token (Liga-Owner)
4. Prüfen:
   - `team_substitutions` enthält Eintrag mit `auto = true`, `player_out = A`, `player_in = B`
   - `team_lineups.starting_xi` enthält B statt A
5. Zweiten Aufruf mit gleichem `gameweek_id` → Team wird übersprungen

**Erwartetes Ergebnis:**
- Erster Aufruf: `{ ok: true, totalSubs: 1, skipped: 0 }`
- Zweiter Aufruf: `{ ok: true, totalSubs: 0, skipped: 1 }` (Duplikat-Schutz)

---

### TC-10 · Punkte nach Auto-Subs berechnen

**Ziel:** `savePoints()` im Admin nutzt nach Auto-Subs die aktualisierte `starting_xi`.

**Schritte:**
1. TC-09 abgeschlossen (Auto-Sub erfolgt, starting_xi aktualisiert)
2. Admin-Panel → GW auswählen → „Punkte berechnen & speichern"
3. `wm_gameweek_points` prüfen:
   - Eintrag für Spieler B (eingewechselter Spieler) mit Punkten
   - Kein Eintrag für Spieler A (der nicht gespielt hat) oder Eintrag mit `points = 0`
4. `teams.total_points` korrekt aktualisiert

**Erwartetes Ergebnis:** Spieler B fließt mit seinen Stats in die Team-Wertung ein.

---

### TC-11 · Cron-Routen manuell testen

**Route:** `GET /api/cron/process-waivers-wm`

**Schritte:**
```bash
curl -X GET http://localhost:3000/api/cron/process-waivers-wm \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Erwartetes Ergebnis:** 200 `{ ok: true, runs: [...] }`

**Ohne Token:**
```bash
curl -X GET http://localhost:3000/api/cron/process-waivers-wm
```
**Erwartetes Ergebnis:** 401 `{ ok: false, error: "unauthorized" }`

---

## Offene Risiken

| # | Risiko | Auswirkung | Status |
|---|--------|-----------|--------|
| R-01 | `wm_gameweeks.deadline` Spalte fehlt in DB | TC-07 nicht testbar, Deadline-Schutz greift nie | ✅ **Behoben** — `db/migrations.sql` ergänzt |
| R-02 | `lib/waiver-init.ts → rebuildWaiverWire()` liest noch `squad_players` | WM-Wire nach Draft evtl. inkorrekt | ✅ **Behoben** — auto-detect via `leagues.mode`, WM nutzt `wm_squad_players` |
| R-03 | Auto-Subs: kein Nation-Check beim Einwechseln | Spieler ausgeschiedener Nation wird eingewechselt (0 Punkte) | Akzeptiert als Known Behavior |
| R-04 | `team_substitutions` hat kein `league_id` Feld | Duplikat-Check muss über `team_id` erfolgen — kein Cross-League-Schutz | Niedrig — teams sind league-scoped |
| R-05 | WM Root Page zeigt Empty State wenn `mode` in DB nicht exakt `"wm"` | User sieht keine Ligen trotz Mitgliedschaft | ✅ **Behoben** — Page nutzt `wm_league_settings` als primären Diskriminator |
| R-06 | Lineup-Route: Positions aus globaler `players` Tabelle | Falls Position geändert wird, bricht Validierung | Niedrig — Positionen sind stabil |
| R-07 | `db/migrations.sql` muss manuell in Supabase SQL Editor ausgeführt werden | `deadline`-Spalte fehlt in produktiver DB bis Migration läuft | Offen — vor erstem TC-07-Test ausführen |

---

## Testablauf (empfohlen)

```
TC-01 Liga erstellen
  → TC-02 Team beitreten
    → TC-03 Draft-Pick
      → TC-04 Duplikat-Schutz
        → TC-05 Lineup speichern
          → TC-06 Fremder Spieler
          → TC-07 Deadline (falls R-01 gelöst)
            → TC-08 Waiver
              → TC-09 Auto-Subs
                → TC-10 Punkte berechnen
                  → TC-11 Cron
```
