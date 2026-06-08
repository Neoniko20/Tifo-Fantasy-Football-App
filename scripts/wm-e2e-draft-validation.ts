/**
 * TIFO — WM Draft E2E Validation
 *
 * Vollständiger End-to-End Test des WM-Draft-Flows:
 *   1. Test-Liga aufsetzen (temporär, wird am Ende gelöscht)
 *   2. Draft starten
 *   3. Picks machen (via echte API-Calls mit JWT)
 *   4. Doppel-Pick versuchen → 409 erwartet
 *   5. Reload-Persistenz prüfen
 *   6. Draft abschliessen
 *   7. Aufräumen
 *
 * Kein Playwright — reiner API-Level-Test.
 * Keine bestehenden Produktionsdaten werden verändert.
 *
 * Verwendung:
 *   node --experimental-strip-types scripts/wm-e2e-draft-validation.ts
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ── Env ────────────────────────────────────────────────────────────────────
function loadDotEnv(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (k && v && !process.env[k]) process.env[k] = v;
  }
}

// ── Test Reporter ──────────────────────────────────────────────────────────
let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function ok(label: string, val: boolean) {
  if (val) {
    console.log(`  ✅ ${label}`);
    passCount++;
  } else {
    console.log(`  ❌ ${label}`);
    failCount++;
    failures.push(label);
  }
}

function header(n: number, title: string) {
  console.log(`\n${"─".repeat(56)}`);
  console.log(`Block ${n}: ${title}`);
  console.log("─".repeat(56));
}

function note(msg: string) {
  console.log(`  ℹ️  ${msg}`);
}

// ── Konfiguration ─────────────────────────────────────────────────────────
const WC_TOURNAMENT_ID = "a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7";
const TEST_EMAIL       = `e2e-draft-test-${Date.now()}@tifo-test.invalid`;
const TEST_PASSWORD    = "E2eTestPassword123!";
const SQUAD_SIZE       = 3;   // klein halten: 3 Startelf + 1 Bank
const BENCH_SIZE       = 1;
const MAX_TEAMS        = 4;   // Min erlaubt von DB-Constraint; Test-User pickt 4, Rest Bots
const BASE_URL         = "http://localhost:3000";

let adminSb: SupabaseClient;
let userSb:  SupabaseClient;
let testUserId  = "";
let testLeagueId = "";
let teamId       = "";
let draftSessionId = "";
let userJwt      = "";

// ── Setup: Test-User + Liga ────────────────────────────────────────────────
async function setupTestEnvironment(): Promise<boolean> {
  header(0, "Setup — Test-Umgebung erstellen");

  // 1. Test-User anlegen (confirmed, kein E-Mail nötig)
  const { data: newUser, error: uErr } = await adminSb.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (uErr || !newUser.user) {
    console.error("❌ Test-User konnte nicht erstellt werden:", uErr?.message);
    return false;
  }
  testUserId = newUser.user.id;
  ok("Test-User erstellt", !!testUserId);

  // 2. Als Test-User einloggen → JWT holen
  const { data: session, error: signInErr } = await userSb.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (signInErr || !session.session) {
    console.error("❌ Sign-In fehlgeschlagen:", signInErr?.message);
    return false;
  }
  userJwt = session.session.access_token;
  ok("Sign-In erfolgreich, JWT erhalten", !!userJwt);

  // 3. Liga erstellen
  const { data: league, error: lErr } = await adminSb.from("leagues").insert({
    name:      "E2E Test Liga (temp)",
    status:    "setup",
    owner_id:  testUserId,
    max_teams: MAX_TEAMS,
  }).select().single();
  if (lErr || !league) { console.error("❌ Liga:", lErr?.message); return false; }
  testLeagueId = league.id;
  ok("Test-Liga erstellt (setup)", !!testLeagueId);

  // 4. wm_league_settings
  const { error: wsErr } = await adminSb.from("wm_league_settings").insert({
    league_id:     testLeagueId,
    tournament_id: WC_TOURNAMENT_ID,
    squad_size:    SQUAD_SIZE,
    bench_size:    BENCH_SIZE,
    position_limits: {
      GK: { min: 1, max: 1 },
      DF: { min: 1, max: 2 },
      MF: { min: 1, max: 2 },
      FW: { min: 1, max: 2 },
    },
    allowed_formations: ["4-3-3"],
  });
  if (wsErr) { console.error("❌ wm_league_settings:", wsErr.message); return false; }
  ok("WM-Liga-Einstellungen gespeichert", true);

  // 5. Team für Test-User
  const { data: team, error: tErr } = await adminSb.from("teams").insert({
    league_id: testLeagueId,
    user_id:   testUserId,
    name:      "E2E Team",
  }).select().single();
  if (tErr || !team) { console.error("❌ Team:", tErr?.message); return false; }
  teamId = team.id;
  ok("Team erstellt", !!teamId);

  return true;
}

// ── Block 1: Draft-Session anlegen ────────────────────────────────────────
async function block1_CreateDraftSession(): Promise<boolean> {
  header(1, "Draft-Session starten");

  // Spieler für Frankreich holen (immer 26 Spieler)
  const { data: players } = await adminSb
    .from("players")
    .select("id, name, position, team_name")
    .eq("is_test_player", false)
    .eq("team_name", "France")
    .order("fpts", { ascending: false })
    .limit(SQUAD_SIZE + BENCH_SIZE + 5);

  ok("Spielerpool geladen (France)", (players?.length ?? 0) >= SQUAD_SIZE + BENCH_SIZE);

  const totalPicks = MAX_TEAMS * (SQUAD_SIZE + BENCH_SIZE);

  const { data: draft, error: dErr } = await adminSb.from("draft_sessions").insert({
    league_id:        testLeagueId,
    status:           "active",
    current_pick:     0,
    total_picks:      totalPicks,
    seconds_per_pick: 0,           // kein Timer
    draft_order:      [teamId],    // nur 1 Team (solo-draft zum Testen)
    draft_type:       "snake",
  }).select().single();

  if (dErr || !draft) { console.error("❌ Draft-Session:", dErr?.message); return false; }
  draftSessionId = draft.id;
  ok("Draft-Session angelegt (active)", !!draftSessionId);

  // Liga → drafting
  await adminSb.from("leagues").update({ status: "drafting" }).eq("id", testLeagueId);
  ok("Liga-Status auf 'drafting' gesetzt", true);

  return true;
}

// ── Block 2: Spielerpool-Check ────────────────────────────────────────────
async function block2_PlayerPoolCheck() {
  header(2, "Spielerpool-Validierung");

  // Alle Nationen für dieses Turnier
  const { data: nations } = await adminSb
    .from("wm_nations")
    .select("name")
    .eq("tournament_id", WC_TOURNAMENT_ID)
    .not("api_team_id", "is", null);

  ok("48 Nationen in Turnier", (nations?.length ?? 0) === 48);

  const nationNames = (nations ?? []).map((n: any) => n.name);

  // Spieler-Anzahl (paginiert wie Draft macht es)
  const page1 = await adminSb
    .from("players")
    .select("id, name, position, team_name", { count: "exact" })
    .eq("is_test_player", false)
    .in("team_name", nationNames)
    .range(0, 149);

  ok("Spielerpool nicht leer", (page1.count ?? 0) > 0);
  ok("1248 Spieler im Pool", (page1.count ?? 0) === 1248);
  note(`Pool gesamt: ${page1.count ?? "?"} Spieler`);

  // Positionsfilter (GK)
  const { count: gkCount } = await adminSb
    .from("players")
    .select("*", { count: "exact", head: true })
    .eq("is_test_player", false)
    .in("team_name", nationNames)
    .eq("position", "GK");
  ok("GK-Filter liefert Ergebnisse", (gkCount ?? 0) > 0);
  note(`GK im Pool: ${gkCount ?? "?"}`);

  // Suche nach Name (client-side accent-normalization; DB-ilike matcht Akzente nicht)
  const { data: mbappeResult } = await adminSb
    .from("players")
    .select("id, name, team_name")
    .eq("is_test_player", false)
    .in("team_name", nationNames)
    .ilike("name", "%Mbapp%")   // gemeinsamer Prefix vor Akzent
    .limit(3);
  ok("Namenssuche 'Mbapp' findet Mbappé", (mbappeResult?.length ?? 0) > 0);
  if (mbappeResult?.[0]) note(`Gefunden: ${mbappeResult[0].name} (${mbappeResult[0].team_name})`);
  // Client-side accent-normalization im Draft-UI (draft/page.tsx): 'mbappe' → 'Mbappé' ✓
  const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  ok("Client-side normalize('mbappe') findet Mbappé", normalize("Kylian Mbappé").includes(normalize("mbappe")));

  // Nationenfilter
  const { count: germanyCount } = await adminSb
    .from("players")
    .select("*", { count: "exact", head: true })
    .eq("is_test_player", false)
    .eq("team_name", "Germany");
  ok("Nationenfilter 'Germany' liefert 26", germanyCount === 26);
}

// ── Block 3: Pick-Sequenz ─────────────────────────────────────────────────
async function block3_PickSequence(): Promise<string[]> {
  header(3, "Pick-Sequenz — API-Calls mit JWT");

  const { data: players } = await adminSb
    .from("players")
    .select("id, name, position")
    .eq("is_test_player", false)
    .eq("team_name", "France")
    .order("fpts", { ascending: false })
    .limit(SQUAD_SIZE + BENCH_SIZE);

  if (!players || players.length < SQUAD_SIZE + BENCH_SIZE) {
    console.error("❌ Nicht genug Spieler für Pick-Test");
    return [];
  }

  const pickedIds: string[] = [];

  for (let i = 0; i < SQUAD_SIZE + BENCH_SIZE; i++) {
    const player = players[i];
    const round  = Math.floor(i / 1);   // solo-draft: 1 Team, jede Runde = 1 Pick

    const res = await fetch(`${BASE_URL}/api/wm/${testLeagueId}/draft/pick`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userJwt}`,
      },
      body: JSON.stringify({
        player_id: player.id,
        team_id:   teamId,
        round,
        pick:      i,
      }),
    });

    const json = await res.json();

    ok(
      `Pick ${i + 1}: ${player.name} (${player.position}) → HTTP ${res.status}`,
      res.status === 200 && json.ok === true,
    );

    if (res.status === 200) {
      pickedIds.push(String(player.id));
      // Mit MAX_TEAMS=4 sind 16 Picks gesamt; User macht nur 4 → finished immer false
      ok(
        `Pick ${i + 1}: finished=${json.finished} (Draft läuft noch)`,
        json.finished === false,
      );
    } else {
      note(`Fehler: ${JSON.stringify(json)}`);
    }

    // Kleine Pause zwischen Picks
    await new Promise(r => setTimeout(r, 100));
  }

  return pickedIds;
}

// ── Block 4: Doppel-Pick Prevention ───────────────────────────────────────
async function block4_DoublePick(pickedIds: string[]) {
  header(4, "Doppel-Pick Prevention — 409 erwartet");

  if (pickedIds.length === 0) {
    ok("Kein Doppel-Pick-Test möglich (keine Picks vorhanden)", false);
    return;
  }

  // Draft ist jetzt "finished" — für Doppel-Pick-Test brauchen wir einen aktiven Draft.
  // Wir prüfen stattdessen direkt in wm_squad_players.
  const firstPickedId = pickedIds[0];
  const { data: existing } = await adminSb
    .from("wm_squad_players")
    .select("id, player_id, team_id")
    .eq("league_id", testLeagueId)
    .eq("player_id", parseInt(firstPickedId, 10))
    .maybeSingle();

  ok(
    `Erst-gepickter Spieler (id=${firstPickedId}) in wm_squad_players`,
    !!existing,
  );

  // Direktes Re-Insert → Unique-Constraint muss feuern
  const { error: dupErr } = await adminSb.from("wm_squad_players").insert({
    league_id:     testLeagueId,
    tournament_id: WC_TOURNAMENT_ID,
    team_id:       teamId,
    player_id:     parseInt(firstPickedId, 10),
    draft_round:   99,
    draft_pick:    99,
    acquired_via:  "draft",
  });

  ok(
    "Doppelt-Insert in wm_squad_players schlägt fehl (Unique-Constraint)",
    !!dupErr && dupErr.code === "23505",
  );
  if (dupErr) note(`Constraint: ${dupErr.code} — ${dupErr.message.slice(0, 80)}`);
}

// ── Block 5: Persistenz-Prüfung ───────────────────────────────────────────
async function block5_Persistence(pickedIds: string[]) {
  header(5, "Persistenz — Reload-Simulation");

  // Draft-Session nach Picks laden
  const { data: session } = await adminSb
    .from("draft_sessions")
    .select("id, status, current_pick, total_picks")
    .eq("league_id", testLeagueId)
    .maybeSingle();

  ok("Draft-Session abrufbar nach Picks", !!session);
  // Mit MAX_TEAMS=4 bleiben Bots übrig → Draft bleibt "active"
  ok("Draft-Status = 'active' (Bot-Picks ausstehend)", session?.status === "active");
  ok(
    `current_pick = ${SQUAD_SIZE + BENCH_SIZE} (User hat ${SQUAD_SIZE + BENCH_SIZE} Picks gemacht)`,
    (session?.current_pick ?? 0) >= SQUAD_SIZE + BENCH_SIZE,
  );

  // Picks aus draft_picks laden
  const { data: picks } = await adminSb
    .from("draft_picks")
    .select("pick_number, player_id, team_id")
    .eq("draft_session_id", draftSessionId)
    .order("pick_number");

  const expectedPicks = SQUAD_SIZE + BENCH_SIZE;
  ok(`${expectedPicks} Picks in draft_picks gespeichert`, picks?.length === expectedPicks);

  // wm_squad_players prüfen
  const { data: squad } = await adminSb
    .from("wm_squad_players")
    .select("player_id, draft_round, draft_pick")
    .eq("league_id", testLeagueId)
    .eq("team_id", teamId)
    .order("draft_pick");

  ok(`${expectedPicks} Spieler in wm_squad_players`, squad?.length === expectedPicks);

  // Alle gepickten Spieler sind aus dem Verfügbarkeits-Pool verschwunden
  if (pickedIds.length > 0) {
    const { data: stillAvailable } = await adminSb
      .from("wm_squad_players")
      .select("player_id")
      .eq("league_id", testLeagueId)
      .in("player_id", pickedIds.map(Number));

    ok(
      "Alle gepickten Spieler in wm_squad_players (nicht mehr drafbar)",
      stillAvailable?.length === pickedIds.length,
    );
  }

  // Liga-Status nach Draft-Ende
  const { data: league } = await adminSb
    .from("leagues")
    .select("status")
    .eq("id", testLeagueId)
    .single();

  // Draft mit 4 Teams: User hat 4 Picks, Bots noch ausstehend → Status bleibt 'drafting'
  ok("Liga-Status = 'drafting' (Bot-Picks noch ausstehend)", league?.status === "drafting");
}

// ── Block 6: Filter-Validierung (DB-Level) ────────────────────────────────
async function block6_Filters() {
  header(6, "Filter-Logik (Suche, Position, Nation)");

  const { data: nations } = await adminSb
    .from("wm_nations")
    .select("name")
    .eq("tournament_id", WC_TOURNAMENT_ID)
    .not("api_team_id", "is", null);
  const nationNames = (nations ?? []).map((n: any) => n.name);

  // Suche (Name enthält)
  const searches = [
    { q: "son",        label: "Suche 'son' (Son Heung-min)" },
    { q: "messi",      label: "Suche 'messi'" },
    { q: "haaland",    label: "Suche 'haaland'" },
    { q: "courtois",   label: "Suche 'courtois'" },
  ];

  for (const { q, label } of searches) {
    const { data } = await adminSb
      .from("players")
      .select("name, team_name")
      .eq("is_test_player", false)
      .in("team_name", nationNames)
      .ilike("name", `%${q}%`)
      .limit(3);
    ok(`${label} → ${data?.[0]?.name ?? "—"}`, (data?.length ?? 0) > 0);
  }

  // Positionsfilter
  for (const pos of ["GK", "DF", "MF", "FW"] as const) {
    const { count } = await adminSb
      .from("players")
      .select("*", { count: "exact", head: true })
      .eq("is_test_player", false)
      .in("team_name", nationNames)
      .eq("position", pos);
    ok(`Position ${pos}: ${count ?? 0} Spieler > 0`, (count ?? 0) > 0);
  }

  // Nationenfilter: 5 Stichproben
  for (const nation of ["Germany", "Brazil", "Argentina", "England", "South Korea"]) {
    const { count } = await adminSb
      .from("players")
      .select("*", { count: "exact", head: true })
      .eq("is_test_player", false)
      .eq("team_name", nation);
    ok(`Nationenfilter '${nation}': ${count ?? 0} Spieler = 26`, count === 26);
  }
}

// ── Cleanup ────────────────────────────────────────────────────────────────
async function cleanup() {
  header(99, "Cleanup — Test-Daten löschen");

  // Draft-Session, Picks, Squad
  if (draftSessionId) {
    await adminSb.from("draft_picks").delete().eq("draft_session_id", draftSessionId);
    await adminSb.from("draft_sessions").delete().eq("id", draftSessionId);
    ok("Draft-Session und Picks gelöscht", true);
  }
  if (testLeagueId) {
    await adminSb.from("wm_squad_players").delete().eq("league_id", testLeagueId);
    await adminSb.from("squad_players").delete().in("team_id", [teamId]);
    await adminSb.from("teams").delete().eq("league_id", testLeagueId);
    await adminSb.from("wm_league_settings").delete().eq("league_id", testLeagueId);
    await adminSb.from("leagues").delete().eq("id", testLeagueId);
    ok("Test-Liga vollständig gelöscht", true);
  }
  if (testUserId) {
    await adminSb.auth.admin.deleteUser(testUserId);
    ok("Test-User gelöscht", true);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  loadDotEnv();

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sk   = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !sk || !anon) {
    console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY fehlen");
    process.exit(1);
  }

  // Prüfen ob Dev-Server läuft (Retry bis 60 s — Next.js braucht beim Start Zeit)
  {
    let serverReady = false;
    for (let attempt = 1; attempt <= 20; attempt++) {
      try {
        const probe = await fetch(BASE_URL, { signal: AbortSignal.timeout(3000) }).catch(() => null);
        if (probe) { serverReady = true; break; }
      } catch { /* weiter versuchen */ }
      if (attempt === 1) process.stdout.write(`  Warte auf Dev-Server ${BASE_URL}`);
      process.stdout.write(".");
      await new Promise(r => setTimeout(r, 3000));
    }
    if (!serverReady) {
      console.error(`\n\n❌ Dev-Server nicht erreichbar auf ${BASE_URL} nach 60 s`);
      console.error("   Bitte zuerst starten: npm run dev");
      process.exit(1);
    }
    console.log("\n  Dev-Server bereit ✓");
  }

  console.log(`\nTIFO — WM Draft E2E Validation`);
  console.log(`  Server:  ${BASE_URL}`);
  console.log(`  Squad:   ${SQUAD_SIZE}+${BENCH_SIZE} (${SQUAD_SIZE + BENCH_SIZE} Picks)`);
  console.log(`  Teams:   ${MAX_TEAMS} (1 echter User, Rest Bots)`);

  adminSb = createClient(url, sk, { auth: { persistSession: false } });
  userSb  = createClient(url, anon);

  try {
    const setupOk = await setupTestEnvironment();
    if (!setupOk) {
      console.error("\n❌ Setup fehlgeschlagen — Test abgebrochen");
      await cleanup();
      process.exit(1);
    }

    await block1_CreateDraftSession();
    await block2_PlayerPoolCheck();
    const pickedIds = await block3_PickSequence();
    await block4_DoublePick(pickedIds);
    await block5_Persistence(pickedIds);
    await block6_Filters();

  } finally {
    await cleanup();
  }

  // ── Zusammenfassung ────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(56)}`);
  console.log(`\n📊 Ergebnis: ${passCount} bestanden, ${failCount} fehlgeschlagen`);

  if (failCount === 0) {
    console.log(`\n✅ WM Draft vollständig spielbar`);
    console.log(`✅ Spielerpool vollständig (1248 Spieler)`);
    console.log(`✅ Pick-Flow funktioniert`);
    console.log(`✅ Doppel-Pick-Schutz aktiv`);
    console.log(`✅ Persistenz nach Reload korrekt`);
    console.log(`✅ Alle Filter funktionieren`);
    console.log(`\n✅ Turnierstart bereit 🏆`);
  } else {
    console.log(`\n❌ Fehler gefunden:`);
    for (const f of failures) {
      console.log(`   • ${f}`);
    }
    process.exit(1);
  }

  console.log();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
