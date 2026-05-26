# WM Hub Redesign — `/wm/[id]` aligned with Liga-Detail UX

**Date:** 2026-05-17  
**Status:** Approved — ready for implementation  
**File:** `app/wm/[id]/page.tsx`  
**Approach:** Full rewrite (Option A) — Liga-Seite als Vorlage, keine shared Components

---

## 1. Ziel

`/wm/[id]/page.tsx` soll visuell und strukturell wie `/leagues/[id]/page.tsx` aussehen. Die alte isolierte WM-Hub-Ansicht (Pill-Tabs, Status-Card mit 3 Buttons, Einstellungen-Tab) wird ersetzt durch die Liga-Zentrale-Erfahrung — mit WM-spezifischen Datenquellen und Tabs.

### Was sich ändert
- Pill-Tab-Bar → Underline-Tab-Bar
- Einstellungen-Tab → Settings Modal (Slide-up Sheet)
- Status-Card mit 3 Action-Buttons → Quick-Actions Row im Übersicht-Tab
- Kein `← WM` + UserBadge Header → Liga-Name + ⚙ Gear + UserBadge Header

### Was bleibt
- Nationen-Tab (unveränderter Inhalt)
- Alle WM-Datenquellen (keine Liga-Tabellen)
- Kein H2H, keine Trades, kein Dynasty
- Keine `/leagues/[id]`-Links im WM-Kontext

---

## 2. Datenquellen (strikt WM-spezifisch)

| Daten | Tabelle |
|---|---|
| Liga-Metadaten | `leagues` (`mode = "wm"`) |
| Teams | `teams` (`.eq("league_id", ...)`) |
| WM-Einstellungen | `wm_league_settings` (join: `wm_tournaments`) |
| Spieltage | `wm_gameweeks` (`.eq("tournament_id", ...)`) |
| GW-Punkte | `wm_gameweek_points` (team_id + gameweek) |
| Nationen | `wm_nations` (`.eq("tournament_id", ...)`) |
| Fixtures | `wm_fixtures` — nur als Link zu `/wm/[id]/matchday`, keine eigene Abfrage |
| Draft Session | `draft_sessions` (für Status-Erkennung) |
| Transaktionen | via `TransactionsFeed` Komponente (leagueId) |

**Nie verwenden:**
- `liga_gameweeks`, `liga_gameweek_points`, `liga_lineups`, `liga_settings`, `liga_matchups`

---

## 3. Architektur

### Geänderte Dateien

| Datei | Änderung |
|---|---|
| `app/wm/[id]/page.tsx` | Vollständiges Rewrite |

### Aus `/leagues/[id]/page.tsx` direkt kopierte Helper

- `TeamAvatar` Funktion (inline im File)
- `SectionHeader` Funktion (inline im File)
- `rankColor(i)` Helper
- Activities Modal Markup (Slide-up Sheet)
- Settings Modal Markup (Slide-up Sheet) — angepasst für WM-Daten

### Externe Komponenten (bereits vorhanden, unverändert)

- `BottomNav`
- `Spinner`
- `TransactionsFeed`
- `TeamDetailSheet`
- `UserBadge`
- `EmptyState`
- `mergeRules`, `RULE_GROUPS` aus `@/lib/scoring`

---

## 4. State

```tsx
// Auth
user, loading

// Liga
league, teams, myTeam

// WM-spezifisch
settings: WMLeagueSettings | null   // aus wm_league_settings
gameweeks: WMGameweek[]             // aus wm_gameweeks
currentGW: WMGameweek | null        // aktiver oder erster GW
selectedGW: number                  // GW-Selector
gwPointsMap: Record<string, number> // team_id → GW-Punkte
nations: WMNation[]                 // aus wm_nations
hasDraft: boolean                   // draft_sessions vorhanden

// UI
tab: "uebersicht" | "tabelle" | "nationen"
standingsView: "table" | "details"
showSettings: boolean
showActivities: boolean
actFilter: "alle" | "transfer" | "waiver"
sheetTeam: any | null               // TeamDetailSheet
tableExpanded: boolean

// Team-Edit (im Settings Modal)
editTeamName: string
savingName: boolean

// Invite Code Copy
copiedCode: boolean
```

---

## 5. Header

```
← WM        [Liga-Name]        ⚙  👤
```

- `← WM` → `window.location.href = "/wm"`
- Liga-Name: `text-lg font-black truncate`
- ⚙ Gear Button: `onClick={() => setShowSettings(true)}`
  - **Immer sichtbar** (auch bei `setup` und `drafting`) — Owner brauchen Invite-Code + Einstellungen vor dem Draft
- 👤 `<UserBadge />`

---

## 6. Setup / Drafting States

Werden vor dem aktiven Spielbetrieb gezeigt (kein Tab-Bar). Gleiche Optik wie Liga-Seite.

### Status = `setup`
```
┌─────────────────────────────────────────────┐
│  📋  Draft vorbereiten                      │
│       Der Draft wurde noch nicht gestartet  │
└─────────────────────────────────────────────┘

[Draft-Einstellungen Block — falls draft_session vorhanden]
[Teilnehmer-Liste — falls teams.length > 0]
[Invite-Code Block — falls Owner + invite_code]

[  Draft-Raum öffnen →  ]   → /wm/[id]/draft
```

### Status = `drafting`
```
┌─────────────────────────────────────────────┐
│  ● Draft läuft!                             │
│  Snake Draft · N Runden · N Teams           │
└─────────────────────────────────────────────┘
[  Zum Draft →  ]   → /wm/[id]/draft
```

---

## 7. Tab-Bar (ab Status `active`)

```
  Übersicht   |   Tabelle   |   Nationen
  ────────────
```

Underline-Style (Linie unter aktivem Tab). Keine Pill-Optik mehr.

---

## 8. GW-Selector

Horizontale Scroll-Row direkt unter Tab-Bar (sichtbar in Übersicht + Tabelle):

```
[GP·1]  [GP·2]  [GP·3 ●]  [AF·4]  [VF·5] …
```

- Quelle: `wm_gameweeks`, sortiert nach `gameweek`
- Label: `GW ${gw.gameweek}` + Sub-Label `PHASE_LABEL[gw.phase]` (kurz)
- Aktiver GW: Pulse-Dot
- `onClick` → `setSelectedGW(gw.gameweek)` + `loadGWData()`

---

## 9. TAB: Übersicht

### 9.1 Mein Stand (Stat-Strip)

```
┌──────────────────────────────────────────────────┐
│   Rang    │   GW-Punkte (MD N)   │   Gesamt       │
│   2/8     │      34.5 🟢         │    128.0        │
│           ● Spieltag läuft · [Team-Name]          │
└──────────────────────────────────────────────────┘
```

- Nur sichtbar wenn `myTeam` vorhanden
- Rang: Position in `teams` (sortiert nach `total_points`)
- GW-Punkte: `gwPointsMap[myTeam.id]` für `selectedGW`
- Gesamt: `myTeam.total_points`
- Live-Strip (grün, pulse): wenn `currentGW?.status === "active"` && `selectedGW === currentGW.gameweek`

### 9.2 Quick-Actions Row

```
┌─────────────────────────────────────────────┐
│  [Aufstellung →]  [Draft-Board →]           │
│  [Waiver →]       [Spielplan →]             │
└─────────────────────────────────────────────┘
```

2×2 Grid, jeder Button als `rounded-2xl` Card-Button.

| Button | Route | Sichtbarkeit | Label-Logik |
|---|---|---|---|
| Aufstellung | `/wm/[id]/lineup` | nur wenn `myTeam` vorhanden | "Aufstellung →" |
| Draft | `/wm/[id]/draft` | immer | `setup` → "Draft-Raum öffnen" · `drafting` → "Zum Draft" · sonst → "Draft-Board" |
| Waiver | `/wm/[id]/waiver` | immer | "Waiver →" |
| Spielplan | `/wm/[id]/matchday` | immer | "Spielplan →" |

### 9.3 Standings-Preview

Top 5 Teams (oder alle wenn ≤ 5), danach "Alle anzeigen →" → setzt `setTab("tabelle")`.

```
┌─────────────────────────────────────────────┐
│  1  ████  Mein Team (Du)   128.0   34.5    │
│  2  ████  Team B           121.0   31.0    │
│  3  ████  Team C           118.5   29.0    │
│  ...                                        │
│                    [Alle anzeigen →]        │
└─────────────────────────────────────────────┘
```

- Klick eigene Zeile → `/wm/[id]/lineup`
- Klick Gegner → `setSheetTeam(team)`

### 9.4 Aktivitäten-Preview

```
┌─────────────────────────────────────────────┐
│  AKTIVITÄTEN          [Alle anzeigen →]     │
│  Transfer: Spieler X → Team A               │
│  Waiver: Spieler Y beansprucht              │
└─────────────────────────────────────────────┘
```

- `TransactionsFeed` mit `limit={3}` und ohne Modal
- "Alle anzeigen →" → `setShowActivities(true)`

---

## 10. TAB: Tabelle

Toggle: **[Tabelle]  [Details]**

### TABLE-Ansicht
```
#   Avatar   Team-Name         FPTS    GW
1   ████     Mein Team (Du)●  128.0  34.5
2   ████     Team B           121.0  31.0
...
```

Spalten: Rang · `TeamAvatar` · Team-Name · `total_points` · `gwPointsMap[id]`  
Kein W-L, kein Waiver-Prio, kein Streak.

### DETAILS-Ansicht (horizontal scroll)
```
#   Team          FPTS   Max-PF   GW1   GW2   GW3 …
1   Mein Team●   128.0   38.5    34.5  31.0  …
```

Spalten: Rang · Team · Gesamt-FPTS · Max-PF (höchste GW-Punkte dieses Teams) · je eine Spalte pro `wm_gameweek`.  
Quelle: alle `wm_gameweek_points` für alle GWs dieses Teams — einmalig laden beim Tab-Wechsel.

---

## 11. TAB: Nationen

Unveränderter Inhalt aus aktuellem `/wm/[id]/page.tsx`:

```
GRUPPE A
  🏴 Deutschland   ● Aktiv
  🏴 Frankreich    ✕ Raus GW3   (opacity: 0.5)
  ...
GRUPPE B
  ...
```

Quelle: `wm_nations` gruppiert nach `group_letter`, sortiert alphabetisch.  
Badge: grün `Aktiv` / rot `Raus GW{n}` abhängig von `nation.eliminated_after_gameweek`.

---

## 12. Activities Modal

Identisch zur Liga-Seite. Slide-up Sheet.

```
─────────────────────────────
          Aktivitäten      ✕
  [Alle]  [Transfers]  [Waiver]
─────────────────────────────
  TransactionsFeed
─────────────────────────────
```

Filter-Optionen: `alle | transfer | waiver` (kein „trade" für WM).  
Quelle: `<TransactionsFeed leagueId={leagueId} kindFilter={...} />`

---

## 13. Settings Modal

Slide-up Sheet, `maxHeight: "80vh"`, scrollbar.

```
─────────────────────────────────────────
     Liga-Einstellungen               ✕
─────────────────────────────────────────
WERTUNGSSYSTEM
  Modus          Standard (WM)
  Teams          {teams.length}
  Spieltage      {gameweeks.length}

LIGA INFO
  Einladungscode   {league.invite_code}   [Kopieren]
  Turnier          {settings.wm_tournaments.name}
  Status           {league.status}

WM-EINSTELLUNGEN    (nur wenn settings vorhanden)
  Startelf         {settings.squad_size} Spieler
  Bank             {settings.bench_size} Spieler
  Transfers/GW     {unlimited ? "Unlimited" : n}
  Waiver-System    {FAAB Budget | Priority}
  Waiver ab        GW {settings.waiver_mode_starts_gameweek}
  Claims/GW        {limit ? n : "Unlimited"}
  Auto-Subs        {An | Aus}
  Formationen      [4-3-3] [4-4-2] …

SCORING-REGELN      (RULE_GROUPS + mergeRules)
  [Tor GK: 10]  [Tor DF: 6]  …

MEIN TEAM           (nur wenn myTeam vorhanden)
  [Team-Name Input]  [Speichern]

ADMIN               (nur wenn league.owner_id === user.id)
  [Admin-Einstellungen →]   → /wm/[id]/admin
─────────────────────────────────────────
```

---

## 14. TeamDetailSheet

Bestehende `<TeamDetailSheet>` Komponente — unverändert.  
`leagueId` prop übergibt die WM-Liga-ID.  
Links innerhalb des Sheets, die auf `/leagues/` zeigen: nicht Teil dieses Rewrites (eigenes Ticket).

---

## 15. Nicht in Scope

| Feature | Begründung |
|---|---|
| Nation-Elimination UI | Vorbereitet durch `wm_nations.eliminated_after_gameweek`, aber keine neue Logik |
| Phase 2.3 Scoring | Kein Gameplay-Refactor |
| Shared Components | Nach WM-Stabilisierung sinnvoll, nicht jetzt |
| TeamDetailSheet interne Links | Eigenes Routing-Ticket |
| H2H / Trades / Dynasty | Nicht Teil des WM-Modus |

---

## 16. Akzeptanzkriterien

- [ ] `/wm/[id]` zeigt visuell dieselbe Struktur wie `/leagues/[id]`
- [ ] Settings ⚙ Gear ist in allen Status sichtbar (setup, drafting, active)
- [ ] Settings Modal zeigt alle WM-Einstellungen aus `wm_league_settings`
- [ ] Kein Link auf `/leagues/[id]` irgendwo im WM-Hub
- [ ] Alle Datenquellen sind WM-spezifisch (`wm_*` Tabellen)
- [ ] Tabs: Übersicht | Tabelle | Nationen
- [ ] GW-Selector mit Phase-Labels funktioniert
- [ ] Quick-Actions Row zeigt Draft-Label korrekt nach Status
- [ ] Nationen-Tab funktioniert wie bisher
- [ ] Activities Modal mit Filter `alle | transfer | waiver`
- [ ] TypeScript kompiliert ohne Fehler
- [ ] Mobile-first Layout (max-w-md)
