# WM Phase 2.2: Live Match Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fixture lifecycle management (scheduled → live → finished) via a new admin Spielplan tab, persist scores + penalties to `wm_fixtures`, and display penalty shootout results on the Matchday page.

**Architecture:** New "Spielplan" tab in the existing WM admin page provides inline score/status editing. Each save calls `PATCH /api/wm/fixtures/[fixtureId]` which validates auth and ownership server-side before writing to `wm_fixtures`. The matchday page reads the updated rows directly — no cache layer. Points calculation remains the separate existing Spieltage tab flow (unchanged).

**Tech Stack:** Next.js 14 App Router, Supabase (PostgreSQL + RLS), TypeScript, Tailwind CSS variables pattern.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `docs/sql/wm_fixtures_add_penalties.sql` | ALTER TABLE migration |
| Modify | `lib/wm-types.ts` | Add `penalties_home`/`penalties_away` to `WMFixture` |
| Create | `app/api/wm/fixtures/[fixtureId]/route.ts` | PATCH — auth + validation + DB write |
| Modify | `app/wm/[id]/admin/page.tsx` | Add "fixtures" AdminTab + Spielplan UI |
| Modify | `app/wm/[id]/matchday/page.tsx` | Render `n.E. X:Y` when penalties present |

---

## Task 1: SQL Migration — penalties columns

**Files:**
- Create: `docs/sql/wm_fixtures_add_penalties.sql`

- [ ] **Write migration file**

```sql
-- Add penalty shootout columns to wm_fixtures (display only, no scoring impact)
alter table wm_fixtures
  add column if not exists penalties_home integer check (penalties_home >= 0),
  add column if not exists penalties_away  integer check (penalties_away  >= 0);
```

- [ ] **Run in Supabase SQL Editor**

Open Supabase dashboard → SQL Editor → paste and run the migration.

Expected: `ALTER TABLE` success message, no errors.

- [ ] **Verify columns exist**

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'wm_fixtures'
  and column_name in ('penalties_home', 'penalties_away');
```

Expected: 2 rows, `data_type = integer`, `is_nullable = YES`.

- [ ] **Commit migration file**

```bash
git -C /Users/nikoko/my-fantasy-app add docs/sql/wm_fixtures_add_penalties.sql
git -C /Users/nikoko/my-fantasy-app commit -m "feat(wm): add penalties_home/away columns to wm_fixtures"
```

---

## Task 2: Extend WMFixture type

**Files:**
- Modify: `lib/wm-types.ts`

- [ ] **Add penalties fields to WMFixture interface**

In `lib/wm-types.ts`, find the `WMFixture` interface and add two fields after `away_score`:

```typescript
  home_score: number | null;
  away_score: number | null;
  penalties_home?: number | null;   // display only — no scoring impact
  penalties_away?: number | null;
  api_fixture_id?: number | null;
```

- [ ] **TypeScript check**

```bash
/Users/nikoko/my-fantasy-app/node_modules/.bin/tsc --noEmit --project /Users/nikoko/my-fantasy-app/tsconfig.json 2>&1 | head -20
```

Expected: no output (no errors).

- [ ] **Commit**

```bash
git -C /Users/nikoko/my-fantasy-app add lib/wm-types.ts
git -C /Users/nikoko/my-fantasy-app commit -m "feat(wm): add penalties_home/away to WMFixture type"
```

---

## Task 3: PATCH /api/wm/fixtures/[fixtureId]

**Files:**
- Create: `app/api/wm/fixtures/[fixtureId]/route.ts`

- [ ] **Create directory and route file**

```bash
mkdir -p /Users/nikoko/my-fantasy-app/app/api/wm/fixtures/\[fixtureId\]
```

- [ ] **Write the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import type { WMFixtureStatus } from "@/lib/wm-types";

const VALID_STATUSES = new Set<WMFixtureStatus>(["scheduled", "live", "finished"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ fixtureId: string }> },
) {
  const { fixtureId } = await params;

  // ── 1. Auth ───────────────────────────────────────────────────────
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
  );
  const { data: { user } } = await anonClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Nicht eingeloggt" }, { status: 401 });
  }

  // ── 2. Parse body ─────────────────────────────────────────────────
  let body: {
    status?: string;
    home_score?: number | null;
    away_score?: number | null;
    penalties_home?: number | null;
    penalties_away?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ungültiger JSON-Body" }, { status: 400 });
  }

  // ── 3. Validate fields ────────────────────────────────────────────
  const { status, home_score, away_score, penalties_home, penalties_away } = body;

  if (status !== undefined && !VALID_STATUSES.has(status as WMFixtureStatus)) {
    return NextResponse.json({ ok: false, error: `Ungültiger Status "${status}"` }, { status: 400 });
  }
  if (status === "finished" && (home_score == null || away_score == null)) {
    return NextResponse.json({ ok: false, error: "home_score und away_score sind Pflicht bei status=finished" }, { status: 400 });
  }
  for (const [key, val] of [["home_score", home_score], ["away_score", away_score], ["penalties_home", penalties_home], ["penalties_away", penalties_away]] as const) {
    if (val != null && (typeof val !== "number" || !Number.isInteger(val) || val < 0)) {
      return NextResponse.json({ ok: false, error: `${key} muss eine ganze Zahl >= 0 sein` }, { status: 400 });
    }
  }

  const supabase = createServiceRoleClient();

  // ── 4. Load fixture + resolve tournament ─────────────────────────
  const { data: fixture } = await supabase
    .from("wm_fixtures")
    .select("id, tournament_id")
    .eq("id", fixtureId)
    .maybeSingle();

  if (!fixture) {
    return NextResponse.json({ ok: false, error: "Fixture nicht gefunden" }, { status: 404 });
  }

  // ── 5. Owner check via wm_league_settings → leagues ──────────────
  const { data: leagueSettings } = await supabase
    .from("wm_league_settings")
    .select("league_id")
    .eq("tournament_id", fixture.tournament_id)
    .limit(20);

  const leagueIds = (leagueSettings || []).map(s => s.league_id);
  if (leagueIds.length === 0) {
    return NextResponse.json({ ok: false, error: "Kein Zugriff" }, { status: 403 });
  }

  const { data: ownedLeague } = await supabase
    .from("leagues")
    .select("id")
    .in("id", leagueIds)
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!ownedLeague) {
    return NextResponse.json({ ok: false, error: "Kein Zugriff — nur Liga-Owner" }, { status: 403 });
  }

  // ── 6. Build update payload ───────────────────────────────────────
  const update: Record<string, unknown> = {};
  if (status      !== undefined) update.status          = status;
  if (home_score  !== undefined) update.home_score       = home_score;
  if (away_score  !== undefined) update.away_score       = away_score;
  if (penalties_home !== undefined) update.penalties_home = penalties_home;
  if (penalties_away !== undefined) update.penalties_away = penalties_away;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: "Keine Felder zum Aktualisieren" }, { status: 400 });
  }

  // ── 7. Write ──────────────────────────────────────────────────────
  const { data: updated, error } = await supabase
    .from("wm_fixtures")
    .update(update)
    .eq("id", fixtureId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, fixture: updated });
}
```

- [ ] **TypeScript check**

```bash
/Users/nikoko/my-fantasy-app/node_modules/.bin/tsc --noEmit --project /Users/nikoko/my-fantasy-app/tsconfig.json 2>&1 | head -20
```

Expected: no output.

- [ ] **Commit**

```bash
git -C /Users/nikoko/my-fantasy-app add app/api/wm/fixtures/\[fixtureId\]/route.ts
git -C /Users/nikoko/my-fantasy-app commit -m "feat(wm): add PATCH /api/wm/fixtures/[fixtureId] with owner auth"
```

---

## Task 4: Admin Spielplan Tab

**Files:**
- Modify: `app/wm/[id]/admin/page.tsx`

This task has four sub-steps: type, state, data loading, and UI.

### 4a — Extend AdminTab type and TABS array

- [ ] **Replace AdminTab type**

Find line 29:
```typescript
type AdminTab = "general" | "points" | "waiver" | "autosubs" | "nations" | "debug";
```

Replace with:
```typescript
type AdminTab = "general" | "points" | "waiver" | "autosubs" | "nations" | "fixtures" | "debug";
```

- [ ] **Add tab entry to TABS array**

Find the TABS array (lines 31–38). Insert `{ id: "fixtures", label: "Spielplan" }` before `{ id: "debug", label: "Debug" }`:

```typescript
const TABS: { id: AdminTab; label: string }[] = [
  { id: "general",  label: "Allgemein"      },
  { id: "points",   label: "Spieltage"      },
  { id: "waiver",   label: "Waiver"         },
  { id: "autosubs", label: "Auto-Subs"      },
  { id: "nations",  label: "Ausscheidungen" },
  { id: "fixtures", label: "Spielplan"      },
  { id: "debug",    label: "Debug"          },
];
```

### 4b — Add fixtures state

- [ ] **Add state variables after existing state declarations** (after line 55 `const [tab, setTab] = ...`)

```typescript
  // ── Fixtures tab state ────────────────────────────────────────
  const [fixtureGW, setFixtureGW]         = useState<number>(1);
  const [adminFixtures, setAdminFixtures]  = useState<WMFixture[]>([]);
  const [fixtureEdits, setFixtureEdits]    = useState<Record<string, Partial<WMFixture>>>({});
  const [fixtureSaving, setFixtureSaving]  = useState<Record<string, boolean>>({});
  const [fixtureSaveAll, setFixtureSaveAll] = useState(false);
```

### 4c — Add loadFixturesForAdmin function

- [ ] **Add function after the existing `loadAll` block** (before the first `async function save...` or similar)

```typescript
  async function loadFixturesForAdmin(gw: number) {
    if (!settings?.tournament_id) return;
    const { data } = await supabase
      .from("wm_fixtures")
      .select(`
        *,
        home_nation:wm_nations!home_nation_id(id, name, flag_url),
        away_nation:wm_nations!away_nation_id(id, name, flag_url)
      `)
      .eq("tournament_id", settings.tournament_id)
      .eq("gameweek", gw)
      .order("kickoff");
    setAdminFixtures((data as WMFixture[]) || []);
    setFixtureEdits({});
  }
```

- [ ] **Trigger load when fixtures tab is opened**

Find the tab bar click handler (line ~531):
```typescript
<button key={t.id} onClick={() => setTab(t.id)}
```

Replace with:
```typescript
<button key={t.id} onClick={() => {
  setTab(t.id);
  if (t.id === "fixtures") loadFixturesForAdmin(fixtureGW);
}}
```

### 4d — Add Spielplan tab UI

- [ ] **Add fixtures tab content before the debug tab block**

Find:
```typescript
      {/* ════════════════════════════════
          TAB: DEBUG / STATUS
      ════════════════════════════════ */}
      {tab === "debug" && (
```

Insert this entire block before it:

```typescript
      {/* ════════════════════════════════
          TAB: SPIELPLAN
      ════════════════════════════════ */}
      {tab === "fixtures" && (
        <div className="w-full max-w-xl space-y-4">

          {/* GW Selector */}
          <div className="overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            <div className="flex gap-2 min-w-max pb-1">
              {gameweeks.map(gw => (
                <button key={gw.gameweek}
                  onClick={() => { setFixtureGW(gw.gameweek); loadFixturesForAdmin(gw.gameweek); }}
                  className="px-3 py-2 rounded-xl text-[10px] font-black transition-all"
                  style={{
                    background: fixtureGW === gw.gameweek ? "var(--color-primary)" : "var(--bg-card)",
                    color:      fixtureGW === gw.gameweek ? "var(--bg-page)" : "var(--color-muted)",
                    border:     `1px solid ${fixtureGW === gw.gameweek ? "var(--color-primary)" : "var(--color-border)"}`,
                  }}>
                  GW{gw.gameweek}
                </button>
              ))}
            </div>
          </div>

          {/* Fixture Cards */}
          {adminFixtures.length === 0 && (
            <p className="text-[9px] text-center py-8" style={{ color: "var(--color-muted)" }}>
              Keine Fixtures für GW{fixtureGW} — zuerst importieren.
            </p>
          )}

          {adminFixtures.map(fixture => {
            const edit = fixtureEdits[fixture.id] ?? {};
            const currentStatus = edit.status ?? fixture.status;
            const isDirty = !!fixtureEdits[fixture.id] && Object.keys(fixtureEdits[fixture.id]!).length > 0;

            function updateEdit(field: keyof WMFixture, value: unknown) {
              setFixtureEdits(prev => ({
                ...prev,
                [fixture.id]: { ...prev[fixture.id], [field]: value },
              }));
            }

            async function saveFixture() {
              if (!isDirty) return;
              setFixtureSaving(prev => ({ ...prev, [fixture.id]: true }));
              const { data: { session } } = await supabase.auth.getSession();
              const res = await fetch(`/api/wm/fixtures/${fixture.id}`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${session?.access_token ?? ""}`,
                },
                body: JSON.stringify(fixtureEdits[fixture.id]),
              });
              const json = await res.json();
              setFixtureSaving(prev => ({ ...prev, [fixture.id]: false }));
              if (json.ok) {
                setAdminFixtures(prev => prev.map(f => f.id === fixture.id ? { ...f, ...json.fixture } : f));
                setFixtureEdits(prev => { const n = { ...prev }; delete n[fixture.id]; return n; });
                toast({ title: "Gespeichert", description: `${fixture.home_nation?.name} vs ${fixture.away_nation?.name}` });
              } else {
                toast({ title: "Fehler", description: json.error, variant: "destructive" });
              }
            }

            return (
              <div key={fixture.id} className="rounded-2xl p-4 space-y-3"
                style={{
                  background: "var(--bg-card)",
                  border: `1px solid ${isDirty ? "var(--color-primary)" : "var(--color-border)"}`,
                }}>

                {/* Nations */}
                <p className="text-[9px] font-black uppercase tracking-widest text-center" style={{ color: "var(--color-muted)" }}>
                  {fixture.home_nation?.name ?? "?"} vs {fixture.away_nation?.name ?? "?"}
                </p>

                {/* Scores */}
                <div className="flex items-center justify-center gap-3">
                  <div className="flex flex-col items-center gap-1">
                    <p className="text-[7px] uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Heim</p>
                    <input
                      type="number" min="0"
                      value={edit.home_score !== undefined ? (edit.home_score ?? "") : (fixture.home_score ?? "")}
                      onChange={e => updateEdit("home_score", e.target.value === "" ? null : parseInt(e.target.value, 10))}
                      placeholder="–"
                      className="w-12 h-10 rounded-lg text-center text-sm font-black bg-transparent outline-none"
                      style={{ border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                  <span className="text-[10px] font-black mt-4" style={{ color: "var(--color-muted)" }}>:</span>
                  <div className="flex flex-col items-center gap-1">
                    <p className="text-[7px] uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Gast</p>
                    <input
                      type="number" min="0"
                      value={edit.away_score !== undefined ? (edit.away_score ?? "") : (fixture.away_score ?? "")}
                      onChange={e => updateEdit("away_score", e.target.value === "" ? null : parseInt(e.target.value, 10))}
                      placeholder="–"
                      className="w-12 h-10 rounded-lg text-center text-sm font-black bg-transparent outline-none"
                      style={{ border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                </div>

                {/* Penalties (only shown when status = finished) */}
                {currentStatus === "finished" && (
                  <div className="flex items-center justify-center gap-3">
                    <div className="flex flex-col items-center gap-1">
                      <p className="text-[7px] uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>n.E. Heim</p>
                      <input
                        type="number" min="0"
                        value={edit.penalties_home !== undefined ? (edit.penalties_home ?? "") : (fixture.penalties_home ?? "")}
                        onChange={e => updateEdit("penalties_home", e.target.value === "" ? null : parseInt(e.target.value, 10))}
                        placeholder="–"
                        className="w-12 h-9 rounded-lg text-center text-xs font-black bg-transparent outline-none"
                        style={{ border: "1px solid var(--color-border-subtle)", color: "var(--color-muted)" }}
                      />
                    </div>
                    <span className="text-[8px] mt-4" style={{ color: "var(--color-border)" }}>:</span>
                    <div className="flex flex-col items-center gap-1">
                      <p className="text-[7px] uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>n.E. Gast</p>
                      <input
                        type="number" min="0"
                        value={edit.penalties_away !== undefined ? (edit.penalties_away ?? "") : (fixture.penalties_away ?? "")}
                        onChange={e => updateEdit("penalties_away", e.target.value === "" ? null : parseInt(e.target.value, 10))}
                        placeholder="–"
                        className="w-12 h-9 rounded-lg text-center text-xs font-black bg-transparent outline-none"
                        style={{ border: "1px solid var(--color-border-subtle)", color: "var(--color-muted)" }}
                      />
                    </div>
                  </div>
                )}

                {/* Status Buttons */}
                <div className="flex gap-2 justify-center">
                  {(["scheduled", "live", "finished"] as const).map(s => (
                    <button key={s} onClick={() => updateEdit("status", s)}
                      className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all"
                      style={{
                        background: currentStatus === s
                          ? s === "live"     ? "var(--color-primary)"
                          : s === "finished" ? "var(--color-success)"
                          :                    "var(--color-border)"
                          : "var(--bg-page)",
                        color: currentStatus === s
                          ? s === "scheduled" ? "var(--color-text)" : "var(--bg-page)"
                          : "var(--color-muted)",
                        border: `1px solid ${currentStatus === s ? "transparent" : "var(--color-border)"}`,
                      }}>
                      {s === "scheduled" ? "Geplant" : s === "live" ? "Live" : "Fertig"}
                    </button>
                  ))}
                </div>

                {/* Save button */}
                <div className="flex justify-end">
                  <button
                    onClick={saveFixture}
                    disabled={!isDirty || fixtureSaving[fixture.id]}
                    className="px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest disabled:opacity-40 transition-all"
                    style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
                    {fixtureSaving[fixture.id] ? "..." : "Speichern"}
                  </button>
                </div>
              </div>
            );
          })}

          {/* Alle speichern */}
          {Object.keys(fixtureEdits).length > 1 && (
            <button
              disabled={fixtureSaveAll}
              onClick={async () => {
                setFixtureSaveAll(true);
                const dirtyIds = Object.keys(fixtureEdits);
                for (const fid of dirtyIds) {
                  const { data: { session } } = await supabase.auth.getSession();
                  const res = await fetch(`/api/wm/fixtures/${fid}`, {
                    method: "PATCH",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${session?.access_token ?? ""}`,
                    },
                    body: JSON.stringify(fixtureEdits[fid]),
                  });
                  const json = await res.json();
                  if (json.ok) {
                    setAdminFixtures(prev => prev.map(f => f.id === fid ? { ...f, ...json.fixture } : f));
                    setFixtureEdits(prev => { const n = { ...prev }; delete n[fid]; return n; });
                  }
                }
                setFixtureSaveAll(false);
                toast({ title: "Alle gespeichert" });
              }}
              className="w-full py-3 rounded-2xl text-[9px] font-black uppercase tracking-widest disabled:opacity-40 transition-all"
              style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
              {fixtureSaveAll ? "Speichere..." : `Alle speichern (${Object.keys(fixtureEdits).length})`}
            </button>
          )}

        </div>
      )}
```

- [ ] **TypeScript check**

```bash
/Users/nikoko/my-fantasy-app/node_modules/.bin/tsc --noEmit --project /Users/nikoko/my-fantasy-app/tsconfig.json 2>&1 | head -30
```

Expected: no output.

- [ ] **Commit**

```bash
git -C /Users/nikoko/my-fantasy-app add app/wm/\[id\]/admin/page.tsx
git -C /Users/nikoko/my-fantasy-app commit -m "feat(wm): add Spielplan tab to admin — inline fixture score/status editing"
```

---

## Task 5: Matchday Page — penalty display

**Files:**
- Modify: `app/wm/[id]/matchday/page.tsx`

- [ ] **Add penalty line after score block**

Find the score block in matchday page (the `{isFinished || isLive ? (...)` block). The current closing of the score column div looks like this:

```tsx
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isFinished || isLive ? (
                        <>
                          <span className="text-base font-black w-5 text-center" style={{ color: "var(--color-primary)" }}>
                            {fixture.home_score ?? 0}
                          </span>
                          <span className="text-[9px] font-black" style={{ color: "var(--color-border)" }}>:</span>
                          <span className="text-base font-black w-5 text-center" style={{ color: "var(--color-primary)" }}>
                            {fixture.away_score ?? 0}
                          </span>
                        </>
                      ) : (
                        <span className="text-[9px] font-black px-2" style={{ color: "var(--color-muted)" }}>vs</span>
                      )}
                    </div>
```

Replace with:

```tsx
                    <div className="flex flex-col items-center flex-shrink-0">
                      <div className="flex items-center gap-1.5">
                        {isFinished || isLive ? (
                          <>
                            <span className="text-base font-black w-5 text-center" style={{ color: "var(--color-primary)" }}>
                              {fixture.home_score ?? 0}
                            </span>
                            <span className="text-[9px] font-black" style={{ color: "var(--color-border)" }}>:</span>
                            <span className="text-base font-black w-5 text-center" style={{ color: "var(--color-primary)" }}>
                              {fixture.away_score ?? 0}
                            </span>
                          </>
                        ) : (
                          <span className="text-[9px] font-black px-2" style={{ color: "var(--color-muted)" }}>vs</span>
                        )}
                      </div>
                      {(isFinished || isLive) && fixture.penalties_home != null && (
                        <p className="text-[7px] font-black text-center mt-0.5" style={{ color: "var(--color-muted)" }}>
                          n.E. {fixture.penalties_home}:{fixture.penalties_away ?? "?"}
                        </p>
                      )}
                    </div>
```

- [ ] **TypeScript check**

```bash
/Users/nikoko/my-fantasy-app/node_modules/.bin/tsc --noEmit --project /Users/nikoko/my-fantasy-app/tsconfig.json 2>&1 | head -20
```

Expected: no output.

- [ ] **Commit**

```bash
git -C /Users/nikoko/my-fantasy-app add app/wm/\[id\]/matchday/page.tsx
git -C /Users/nikoko/my-fantasy-app commit -m "feat(wm): show penalty shootout result on matchday page"
```

---

## Self-Review

**Spec coverage check:**
- ✅ SQL migration with nullable integers + check constraint → Task 1
- ✅ WMFixture type extended with penalties fields → Task 2
- ✅ PATCH endpoint with auth (session + owner check), full input validation → Task 3
- ✅ `status=finished` requires scores — validated server-side → Task 3
- ✅ Scores/penalties as nullable integers >= 0 — validated server-side → Task 3
- ✅ Fixture belongs to tournament of user's league — checked server-side → Task 3
- ✅ New Spielplan tab, inline editing, GW selector, status buttons → Task 4
- ✅ "Alle speichern" only sends dirty fixtures → Task 4 (`Object.keys(fixtureEdits)`)
- ✅ Penalty fields only shown when status=finished → Task 4 (`{currentStatus === "finished" && ...}`)
- ✅ After save: local state updated, no full refetch → Task 4 (`setAdminFixtures(prev => prev.map(...))`)
- ✅ Matchday page: `n.E. X:Y` shown only when `penalties_home != null` → Task 5
- ✅ Penalties are display-only — no scoring code reads them → confirmed by absence

**Type consistency:** `WMFixture.penalties_home`/`penalties_away` defined in Task 2, used in Tasks 4 and 5. Field names consistent throughout.

**Placeholder scan:** No TBDs, no "implement later", all code blocks complete.

---

## Test Sequence (after all tasks complete)

### Test 1: Live Status

```sql
-- Set Canada vs USA to live, score 1:0
update wm_fixtures
set status = 'live', home_score = 1, away_score = 0
where tournament_id = 'a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7'
  and home_nation_id = 'd574839a-f7aa-4671-9d29-a03baf949ee7';
```

Matchday page reload → Canada vs USA card shows pulsing Live dot, score "1 : 0".

### Test 2: Finished with Penalties

```sql
-- Set Portugal vs Angola to finished 1:1 with penalties 4:2
update wm_fixtures
set status = 'finished', home_score = 1, away_score = 1,
    penalties_home = 4, penalties_away = 2
where tournament_id = 'a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7'
  and home_nation_id = '6cc23a5a-0fe7-4e5b-aff6-f1db949bcf86';
```

Matchday page reload → Portugal vs Angola: "Beendet", "1 : 1", "n.E. 4:2" below.

### Test 3: Admin Spielplan Tab Flow

1. Open `/wm/[league-id]/admin` → click "Spielplan" tab
2. GW1 fixtures load with current scores/status
3. Click "Live" button on Germany vs Saudi Arabia → border turns primary color (dirty)
4. Enter score 2:0
5. Click "Speichern" → toast appears, border returns to normal
6. Switch to Matchday page → Germany card shows Live dot + "2 : 0"

### Test 4: Verify DB State

```sql
select
  hn.name as home, an.name as away,
  f.status, f.home_score, f.away_score,
  f.penalties_home, f.penalties_away
from wm_fixtures f
join wm_nations hn on hn.id = f.home_nation_id
join wm_nations an on an.id = f.away_nation_id
where f.tournament_id = 'a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7'
  and f.gameweek = 1
order by f.kickoff;
```
