# Design: Admin Gameweeks Tab — Refactor + Inline Stepper + Bulk Import

**Datum:** 2026-04-14  
**Status:** Approved  
**Scope:** `app/leagues/[id]/admin/page.tsx` → Gameweek-bezogene Logik extrahieren

---

## Problem

Die Admin-Seite hat 1917 Zeilen und 77+ `useState`-Calls. Der Gameweeks-Tab enthält die häufigste Admin-Aufgabe (GW verwalten), ist aber über die gesamte Datei verteilt. Für einen einzelnen GW müssen 5 separate Aktionen in der richtigen Reihenfolge ausgeführt werden — ohne visuellen Hinweis auf Reihenfolge oder Status.

Zusätzlich gibt es keinen Weg, mehrere vergangene GWs auf einmal zu importieren. Das ist relevant wenn ein Spieler der Liga erst nach Saisonbeginn beitritt und rückwirkend Punkte berechnet werden müssen.

---

## Ziel

1. Alle Gameweek-Logik in eine eigenständige Komponente extrahieren
2. Pro GW den Verwaltungs-Workflow als visuellen Inline-Stepper darstellen
3. Bulk-Import für vergangene GWs ohne Punkte-Daten ergänzen

---

## Architektur

### Neue Dateistruktur

```
app/
  leagues/[id]/admin/
    page.tsx                        ← schrumpft von 1917 → ~1100 Zeilen
  components/admin/
    GameweeksTab.tsx                ← neu, ~400 Zeilen
```

### Eigenständigkeit

`GameweeksTab` ist eine **self-contained Komponente**:
- Holt eigene Daten (`liga_gameweeks`, `liga_gameweek_points` für Import-Status)
- Verwaltet eigenen State (alle ~12 GW-bezogenen useState-Calls)
- Alle GW-Funktionen leben in der Komponente, kein Prop-Drilling

**Props:**
```typescript
interface GameweeksTabProps {
  leagueId: string;
  userId: string;
}
```

`admin/page.tsx` rendert nur noch:
```tsx
{tab === "gameweeks" && (
  <GameweeksTab leagueId={leagueId} userId={user.id} />
)}
```

### Was in `admin/page.tsx` bleibt

- Auth / Owner-Check
- Tab-Navigation (gameweeks / points / settings / import)
- Punkte-Tab
- Settings-Tab
- Import-Tab

### Was in `GameweeksTab.tsx` wandert

Alle folgenden Funktionen und ihr State:
- `createGameweek`, `autoGenerateGameweeks`
- `updateGWStatus`
- `toggleLeague`
- `importGWStats`
- `toggleWaiverWindow`
- `processWaivers`
- State: `gameweeks`, `selectedGW`, `newGWNum`, `newGWLabel`, `newGWStart`, `newGWEnd`, `importing`, `importResult`, `initializing`, `processingWaivers`

---

## UI: Inline Stepper pro GW-Zeile

Jede GW-Zeile besteht aus zwei Ebenen:

### Obere Zeile — Identität + Status-Toggle

```
GW3  Spieltag 3  15.–21. Nov     [Bald]  [Aktiv ●]  [Fertig]
```

- GW-Nummer fett, Label und Datumsbereich daneben
- Drei Status-Buttons: `upcoming` / `active` / `finished`
- Aktiver Status farbig hervorgehoben (primary für active, success für finished)

### Untere Zeile — 5 Aktions-Chips

```
⚽ 3 Ligen  ·  📥 Importieren  ·  🔓 Waiver offen  ·  ▶ Verarbeiten  ·  ✅ Fertig
```

#### Chip-Zustände

| Zustand | Aussehen | Verhalten |
|---|---|---|
| Ausstehend | Grau, klickbar | Primäre Aktion ausführen |
| Aktiv/Laufend | Farbig, spinning | Zeigt Ladeindikator |
| Erledigt | Grün + ✓, gedimmt | Kein Klick nötig, optional wiederholbar |

#### Die 5 Schritte

| # | Chip | Erledigt-Bedingung | Klick-Aktion |
|---|---|---|---|
| 1 | ⚽ Ligen | `active_leagues.length >= 1` | Inline-Toggle: Ligaflags ein-/ausschalten (kein Modal) |
| 2 | 📥 Import | `liga_gameweek_points` für diesen GW existiert | `importGWStats(gwNum)` |
| 3 | 🔓 Waiver | `waiver_window_open === false` (geschlossen = verwaltet) | Toggle auf/zu — Ladeindikator beim Umschalten |
| 4 | ▶ Verarbeiten | Approved/rejected claims > 0 für diesen GW | `processWaivers()` für diesen GW |
| 5 | ✅ Fertig | `status === "finished"` | `updateGWStatus(gwNum, "finished")` |

#### Ligen-Picker (Schritt 1)

Kein Modal — klappt direkt unterhalb des Chips aus. Zeigt Ligaflags als Toggle-Chips (analog zu bestehender Implementierung). Schließt sich automatisch wenn man außerhalb klickt.

#### Mobile

Auf schmalen Viewports (`< sm`) klappt die Chip-Reihe unterhalb der Identitätszeile (statt daneben). Kein horizontales Scrollen.

---

## UI: Bulk-Import ("Aufholen")

### Platzierung

Kollabierte Leiste **ganz oben** im GameweeksTab, vor der GW-Liste:

```
▶  Vergangene GWs nachholen  (3 GWs ohne Import)
```

Nur sichtbar wenn ≥1 GW ohne `liga_gameweek_points`-Einträge existiert.  
Wenn alle importiert: `✅ Alle GWs aktuell` — eingeklappt, kein Expand möglich.

### Ausgeklappt

**Auswahl:**
```
☑ GW1  Spieltag 1  (01.–07. Sep)   kein Import
☑ GW2  Spieltag 2  (08.–14. Sep)   kein Import
☐ GW3  Spieltag 3  (15.–21. Sep)   bereits importiert ↺ neu importieren?
```

- GWs ohne Punkte-Daten: vorselektiert
- GWs mit Punkte-Daten: ausgegraut, optional anwählbar (für Neuberechnung nach Regeländerung)
- "Alle auswählen" Toggle oben

**Aktion:**
```
[Ausgewählte importieren (2)]
```

### Fortschritt

Kein Modal. Button wird zum Inline-Fortschrittsstreifen:
```
✓ GW1 importiert  →  ⏳ GW2 läuft...  →  ○ GW3 ausstehend
```

- Sequenziell (nicht parallel) — verhindert API-Überlastung
- Jeder GW wird einzeln importiert, Fortschritt live aktualisiert
- Bei Fehler: GW markiert mit ✗, Import läuft weiter mit nächstem

---

## Datenfluss

### Import-Status ermitteln

Beim Laden des Tabs: einmalige Abfrage ob für jeden GW Punkte existieren:

```typescript
const { data: importedGWs } = await supabase
  .from("liga_gameweek_points")
  .select("gameweek")
  .eq("league_id", leagueId);

const importedSet = new Set(importedGWs?.map(r => r.gameweek) ?? []);
```

### Waiver-Status ermitteln

Für den "Verarbeiten"-Chip: prüfen ob claims mit `approved`/`rejected`-Status für diesen GW existieren:

```typescript
const { count } = await supabase
  .from("waiver_claims")
  .select("id", { count: "exact", head: true })
  .eq("league_id", leagueId)
  .eq("gameweek", gwNum)
  .in("status", ["approved", "rejected"]);
```

Wird beim Laden gecacht als `processedGWs: Set<number>`.

---

## Was sich nicht ändert

- Alle bestehenden API-Routes bleiben unverändert (`/api/import-gw-stats`, `/api/process-waivers`, etc.)
- Das Datenmodell (`liga_gameweeks`, `liga_gameweek_points`, `waiver_claims`) bleibt unverändert
- Keine neuen Supabase-Tabellen oder -Spalten nötig
- Andere Tabs der Admin-Seite bleiben unangetastet

---

## Nicht im Scope

- Settings-Tab Extraktion (separates Ticket)
- Points-Tab Extraktion (zu klein, lohnt sich nicht)
- Push-Notifications bei GW-Status-Änderung
- Automatisches GW-Erstellen via Cron
