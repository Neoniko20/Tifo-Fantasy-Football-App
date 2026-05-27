# E1 — WM Live Scoring: Implementierungsplan

**Datum:** 2026-05-26  
**Branch:** `feature/wm-live-scoring`  
**Spec:** `docs/superpowers/specs/2026-05-26-wm-live-scoring-e1.md`  
**Geschätzter Aufwand:** 2–3 Tage

---

## Reihenfolge

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 (QA)

Task 1 ist unabhängig und sofort wirksam (P0).
Task 2 und 3 sind unabhängig voneinander, aber beide vor Task 4.
Task 4 setzt Task 1–3 voraus.
```

---

## Task 1 — `total_points` live update im Ingest

**Ziel:** Jeder `player.stat_update` aktualisiert sofort `teams.total_points`.  
**Risiko:** Niedrig — additive Änderung, keine Migration  
**Commit-Ziel:** `fix(ingest): update teams.total_points after every stat_update`

### Datei
`lib/wm-ingest.ts` — Funktion `handlePlayerStatUpdate()` (Zeile ~328–367)

### Änderung

Nach dem Upsert-Loop für alle Teams (nach Zeile 367, vor dem Goal system message Block) einfügen:

```typescript
// ── total_points live rebuild ─────────────────────────────────────────────
// Nach GW-Punkte-Update: teams.total_points für alle betroffenen Teams aktualisieren.
// SUM-Query statt Inkrement → idempotent, kein Drift bei concurrent writes.
const affectedTeamIds = squadEntries.map((e) => e.team_id);
for (const teamId of affectedTeamIds) {
  const { data: allPts } = await supabase
    .from("wm_gameweek_points")
    .select("points")
    .eq("team_id", teamId);
  const newTotal = Math.round(
    (allPts ?? []).reduce((s, r) => s + (r.points ?? 0), 0) * 10
  ) / 10;
  await supabase.from("teams").update({ total_points: newTotal }).eq("id", teamId);
  applied.push(`teams.total_points:${teamId}`);
}
```

### QA-Check Task 1
1. Ingest ein `player.stat_update` via Admin-Formular
2. Prüfen: `teams.total_points` in Supabase Table Editor erhöht sich
3. Live Center öffnen: `total_points` zeigt korrekten Wert (nicht 0)

---

## Task 2 — Gameweek-Start API + Rank Snapshot

**Ziel:** GW-Start schreibt Rang-Snapshot aller Teams als Baseline für `rank_delta`.  
**Risiko:** Niedrig — neue API, neue Tabelle, Admin-UI-Änderung minimal  
**Commit-Ziel:** `feat(wm): gameweek-start API with rank snapshot`

### DB-Migration

```sql
-- Datei: db/migrations.sql (anfügen)

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

**In Supabase ausführen** bevor Task 4 getestet wird.

### Neue API-Route

**Datei:** `app/api/wm/[id]/gameweek-start/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;
  const { gameweek } = await req.json();

  // Auth: nur Owner
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const userSb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: { user } } = await userSb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await userSb
    .from("league_members").select("role").eq("league_id", leagueId).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner") return NextResponse.json({ error: "Nur Owner" }, { status: 403 });

  const supabase = createServiceRoleClient();

  // 1. GW-Status auf active setzen
  const { error: gwError } = await supabase
    .from("wm_gameweeks")
    .update({ status: "active" })
    .eq("league_id", leagueId)   // falls wm_gameweeks.league_id existiert; sonst via tournament_id
    .eq("gameweek", gameweek);
  if (gwError) return NextResponse.json({ error: gwError.message }, { status: 500 });

  // 2. Alle Teams der Liga laden (mit total_points für Rang-Berechnung)
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, total_points")
    .eq("league_id", leagueId)
    .order("total_points", { ascending: false });
  if (teamsError) return NextResponse.json({ error: teamsError.message }, { status: 500 });

  // 3. Rang berechnen und Snapshot schreiben
  const snapshots = (teams ?? []).map((t, idx) => ({
    league_id:    leagueId,
    gameweek,
    team_id:      t.id,
    rank:         idx + 1,
    total_points: t.total_points ?? 0,
  }));

  const { error: snapError } = await supabase
    .from("wm_gw_rank_snapshots")
    .upsert(snapshots, { onConflict: "league_id,gameweek,team_id" });
  if (snapError) return NextResponse.json({ error: snapError.message }, { status: 500 });

  return NextResponse.json({ ok: true, snapshot_count: snapshots.length });
}
```

### Admin-Änderung

**Datei:** `app/wm/[id]/admin/page.tsx`

`updateGameweekStatus()` erweitern: wenn `status === "active"`, rufe `/api/wm/${leagueId}/gameweek-start` statt direktem DB-Write auf:

```typescript
// Ersetze: await supabase.from("wm_gameweeks").update({ status }).eq("id", gw.id);
// Mit:
if (status === "active") {
  const { data: { session } } = await supabase.auth.getSession();
  await fetch(`/api/wm/${leagueId}/gameweek-start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify({ gameweek: gwNum }),
  });
} else {
  await supabase.from("wm_gameweeks").update({ status }).eq("id", gw.id);
}
```

**Hinweis:** `wm_gameweeks` hat ein `tournament_id`-Feld, kein `league_id`. Die API-Route muss den `tournament_id` aus `wm_league_settings` laden um den GW korrekt zu finden. Anpassung in der Route:

```typescript
// tournament_id via league settings holen
const { data: settings } = await supabase
  .from("wm_league_settings").select("tournament_id").eq("league_id", leagueId).maybeSingle();
const tournamentId = settings?.tournament_id;

await supabase.from("wm_gameweeks")
  .update({ status: "active" })
  .eq("tournament_id", tournamentId)
  .eq("gameweek", gameweek);
```

### QA-Check Task 2
1. In Supabase: `wm_gw_rank_snapshots` Tabelle erstellen (Migration ausführen)
2. Admin → GW auf `active` setzen
3. Supabase Table Editor: `wm_gw_rank_snapshots` zeigt Einträge für alle Teams
4. Idempotenz: GW nochmal auf `active` setzen → Snapshot wird überschrieben, kein Fehler

---

## Task 3 — Gameweek-Finish API

**Ziel:** Atomarer GW-Abschluss — total_points finalisieren, GW schliessen, system message.  
**Risiko:** Mittel — ersetzt Admin-Direktzugriff, muss idempotent sein  
**Commit-Ziel:** `feat(wm): gameweek-finish API — atomic close with system message`

### Neue API-Route

**Datei:** `app/api/wm/[id]/gameweek-finish/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { writeSystemMessage } from "@/lib/wm-system-messages";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;
  const { gameweek } = await req.json();

  // Auth: nur Owner (gleicher Pattern wie Task 2)
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const userSb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: { user } } = await userSb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await userSb
    .from("league_members").select("role").eq("league_id", leagueId).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner") return NextResponse.json({ error: "Nur Owner" }, { status: 403 });

  const supabase = createServiceRoleClient();

  // tournament_id holen
  const { data: settings } = await supabase
    .from("wm_league_settings").select("tournament_id").eq("league_id", leagueId).maybeSingle();
  const tournamentId = settings?.tournament_id;

  // Guard: bereits finished?
  const { data: gwData } = await supabase
    .from("wm_gameweeks")
    .select("id, status")
    .eq("tournament_id", tournamentId)
    .eq("gameweek", gameweek)
    .maybeSingle();
  if (gwData?.status === "finished") {
    return NextResponse.json({ ok: true, already_finished: true });
  }

  // 1. Alle Teams der Liga
  const { data: teams, error: teamsError } = await supabase
    .from("teams").select("id, name").eq("league_id", leagueId);
  if (teamsError) return NextResponse.json({ error: teamsError.message }, { status: 500 });

  // 2. total_points für alle Teams rebuilden (alle GWs)
  let teamsUpdated = 0;
  for (const team of (teams ?? [])) {
    const { data: allPts } = await supabase
      .from("wm_gameweek_points").select("points").eq("team_id", team.id);
    const newTotal = Math.round(
      (allPts ?? []).reduce((s, r) => s + (r.points ?? 0), 0) * 10
    ) / 10;
    await supabase.from("teams").update({ total_points: newTotal }).eq("id", team.id);
    teamsUpdated++;
  }

  // 3. GW auf finished setzen
  await supabase
    .from("wm_gameweeks")
    .update({ status: "finished" })
    .eq("id", gwData?.id);

  // 4. Top-Team dieses GW ermitteln
  const { data: gwTotals } = await supabase
    .from("wm_gameweek_points")
    .select("team_id, points")
    .eq("league_id", leagueId)
    .eq("gameweek", gameweek);

  const gwSums: Record<string, number> = {};
  for (const row of (gwTotals ?? [])) {
    gwSums[row.team_id] = (gwSums[row.team_id] ?? 0) + (row.points ?? 0);
  }
  const topTeamId = Object.entries(gwSums).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topPoints  = topTeamId ? Math.round((gwSums[topTeamId] ?? 0) * 10) / 10 : 0;
  const topTeam   = (teams ?? []).find((t) => t.id === topTeamId);

  // 5. System message
  const content = topTeam
    ? `■ Spieltag ${gameweek} abgeschlossen — ${topTeam.name} führt mit ${topPoints} Punkten!`
    : `■ Spieltag ${gameweek} abgeschlossen.`;
  await writeSystemMessage(supabase, leagueId, content, {
    type: "gw_finished",
    gameweek,
    winner_team_id: topTeamId ?? null,
    gw_points: topPoints,
  });

  return NextResponse.json({
    ok: true,
    teams_updated: teamsUpdated,
    winner: topTeam ? { team_name: topTeam.name, gw_points: topPoints } : null,
  });
}
```

### Admin-Änderung

**Datei:** `app/wm/[id]/admin/page.tsx`

`updateGameweekStatus()` erweitern: wenn `status === "finished"`, rufe neue API auf:

```typescript
if (status === "finished") {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`/api/wm/${leagueId}/gameweek-finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify({ gameweek: gwNum }),
  });
  const data = await res.json();
  if (data.winner) {
    toast(`GW ${gwNum} abgeschlossen — ${data.winner.team_name} mit ${data.winner.gw_points} Pts!`, "success");
  } else {
    toast(`GW ${gwNum} abgeschlossen.`, "success");
  }
} else if (status === "active") {
  // → Task 2 API (gameweek-start)
} else {
  await supabase.from("wm_gameweeks").update({ status }).eq("id", gw.id);
}
```

### QA-Check Task 3
1. GW manuell auf `active` setzen (oder via Task-2-API)
2. Einige stat_updates einspielen (damit GW-Punkte vorhanden)
3. Admin → GW auf `finished` setzen
4. Prüfen: `teams.total_points` in DB aktualisiert
5. Prüfen: `wm_gameweeks.status = finished`
6. Prüfen: system message im Liga-Chat sichtbar
7. Erneut auf `finished` klicken → `already_finished: true`, kein Fehler

---

## Task 4 — Live Center: rank_delta, players_playing, Realtime

**Ziel:** Live Center zeigt echte Bewegung und Spieler-Status.  
**Risiko:** Mittel — mehrere UI-Änderungen, Datenladen für alle Teams erweitert  
**Commit-Ziel:** `feat(live-center): rank_delta, players_playing, wm_gameweeks realtime`

### Datei
`app/wm/[id]/live/page.tsx`

### Änderungen im Detail

#### 4a. Typ `LiveTeamRow` erweitern

```typescript
type LiveTeamRow = {
  team_id:               string;
  team_name:             string;
  gw_points:             number;
  total_points:          number;
  rank_delta:            number;   // bereits vorhanden, war 0
  players_playing:       number;   // bereits vorhanden, war 0
  players_total:         number;
  is_my_team:            boolean;
  has_nation_eliminated: boolean;
  snapshot_rank:         number;   // NEU — für delta-Berechnung
};
```

#### 4b. Snapshot laden in `loadAll()`

```typescript
// Nach loadLeaderboard():
const { data: snapshots } = await supabase
  .from("wm_gw_rank_snapshots")
  .select("team_id, rank")
  .eq("league_id", leagueId)
  .eq("gameweek", gw.gameweek);

const snapshotMap: Record<string, number> = {};
for (const s of (snapshots ?? [])) snapshotMap[s.team_id] = s.rank;
setSnapshotRanks(snapshotMap);  // neuer useState
```

#### 4c. starting_xi aller Teams laden (für players_playing)

```typescript
// In loadLeaderboard() oder separat nach Leaderboard-Load:
const { data: allLineups } = await supabase
  .from("team_lineups")
  .select("team_id, starting_xi")
  .in("team_id", teamIds)
  .eq("gameweek", gw);

const lineupMap: Record<string, number[]> = {};
for (const l of (allLineups ?? [])) {
  lineupMap[l.team_id] = l.starting_xi ?? [];
}
```

#### 4d. `rank_delta` und `players_playing` berechnen

```typescript
// In loadLeaderboard() nach Sortierung:
const sortedRows = [...rows].sort((a, b) =>
  b.gw_points !== a.gw_points
    ? b.gw_points - a.gw_points
    : b.total_points - a.total_points
);

const finalRows = sortedRows.map((row, idx) => {
  const currentRank  = idx + 1;
  const snapshotRank = snapshotMap[row.team_id] ?? currentRank;
  const delta        = snapshotRank - currentRank;

  const xi = lineupMap[row.team_id] ?? [];
  const playing = xi.filter((pid) => liveNations.has(playerNationMap[pid])).length;

  return { ...row, rank_delta: delta, players_playing: playing, snapshot_rank: snapshotRank };
});
setLeaderboard(finalRows);
```

#### 4e. Realtime: `wm_gameweeks` Subscription ergänzen

```typescript
// In der bestehenden Realtime-setup:
.on("postgres_changes",
  { event: "*", schema: "public", table: "wm_gameweeks", filter: `tournament_id=eq.${tournamentId}` },
  () => { if (user) loadAll(user.id); }
)
```

#### 4f. Live Center UI — rank_delta anzeigen

In der Leaderboard-Komponente / Inline-Render:

```tsx
{row.rank_delta !== 0 && (
  <span style={{ color: row.rank_delta > 0 ? "var(--color-success)" : "var(--color-error)", fontSize: 10 }}>
    {row.rank_delta > 0 ? `▲${row.rank_delta}` : `▼${Math.abs(row.rank_delta)}`}
  </span>
)}

{row.players_playing > 0 && (
  <span style={{ color: "var(--color-primary)", fontSize: 10 }}>
    ⚽ {row.players_playing}/{row.players_total}
  </span>
)}
```

### QA-Check Task 4
1. GW starten (Task-2-API) → Snapshot wird geschrieben
2. Live Center öffnen → rank_delta = 0 für alle (GW gerade gestartet, Snapshot = aktueller Rang)
3. Stat-Updates einspielen (ein Team bekommt mehr Punkte)
4. Live Center: Leaderboard sortiert sich um → rank_delta zeigt Bewegung
5. Fixture auf `live` setzen → players_playing > 0 für Teams mit spielenden Nationen
6. GW auf `finished` setzen (Task-3-API) → Live Center reload via wm_gameweeks Realtime

---

## Task 5 — QA End-to-End

**Kein Code.** Vollständiger manueller Durchlauf.

### Szenario 1: Live GW-Ablauf
1. Admin: Draft abschliessen, Lineups setzen
2. Admin: GW 1 → `active` → Snapshot prüfen
3. Admin/Simulator: 3 stat_updates für verschiedene Spieler
4. Live Center: `total_points` zeigt korrekte Werte (nicht 0)
5. Live Center: Leaderboard-Reihenfolge ändert sich bei Updates
6. Live Center: `rank_delta` zeigt korrekte Bewegung
7. Fixture auf `live` setzen → `players_playing > 0`
8. Admin: GW → `finished` → system message im Chat
9. Alle `teams.total_points` in DB korrekt

### Szenario 2: Recovery
1. GW-Finish unterbrechen (Browser offline während Request)
2. GW-Status prüfen → bleibt `active`
3. Erneut auf `finished` klicken → funktioniert sauber

### Szenario 3: Idempotenz
1. Gleichen stat_update zweimal einspielen
2. `wm_gameweek_points` hat nur einen Eintrag (ON CONFLICT)
3. `total_points` korrekt (nicht verdoppelt)

---

## Vollständige Dateiliste

| Datei | Aktion | Task |
|-------|--------|------|
| `lib/wm-ingest.ts` | Modifiziert — total_points rebuild nach stat_update | 1 |
| `db/migrations.sql` | Erweitert — `wm_gw_rank_snapshots` Tabelle | 2 |
| `app/api/wm/[id]/gameweek-start/route.ts` | Neu | 2 |
| `app/api/wm/[id]/gameweek-finish/route.ts` | Neu | 3 |
| `app/wm/[id]/admin/page.tsx` | Modifiziert — GW-Buttons rufen neue APIs auf | 2+3 |
| `app/wm/[id]/live/page.tsx` | Modifiziert — rank_delta, players_playing, Realtime | 4 |

**Keine weiteren Dateien.** Keine neue Scoring-Engine, keine neuen Komponenten.

---

## Commit-Reihenfolge

```
1. fix(ingest): update teams.total_points after every stat_update
2. feat(wm): gameweek-start API with rank snapshot  [+ DB Migration in Supabase]
3. feat(wm): gameweek-finish API — atomic close with system message
4. feat(live-center): rank_delta, players_playing, wm_gameweeks realtime
5. (nach QA) fix: eventuelle Bugfixes aus QA
```

---

## Risiko pro Task

| Task | Risiko | Grund |
|------|--------|-------|
| 1 — total_points live | Niedrig | Additive Änderung, idempotent durch SUM |
| 2 — GW-Start API | Niedrig | Neue Route, Admin-UI minimal geändert |
| 3 — GW-Finish API | Mittel | Ersetzt bisherigen Admin-direktzugriff, System Message |
| 4 — Live Center | Mittel | Mehrere UI-Änderungen, neue Daten für alle Teams |
| QA | — | — |

---

## Migration-Hinweis

**`wm_gw_rank_snapshots` muss in Supabase manuell ausgeführt werden** bevor Task 4 getestet werden kann. Die SQL ist in `db/migrations.sql` eingefügt (Task 2). Ohne Migration funktioniert Task 4 (rank_delta) mit fallback `rank_delta = 0` — kein Crash.
