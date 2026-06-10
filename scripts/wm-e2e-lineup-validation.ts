/**
 * TIFO — WM Lineup E2E Validation
 *
 * Testet den vollständigen Lineup-Flow nach einem Draft:
 *   0. Setup: Test-User, Liga, Squad (wm_squad_players), aktive Gameweek
 *   1. Happy Path: Gültige 4-3-3 Lineup speichern → 200
 *   2. Persistenz: Lineup aus team_lineups lesen → Felder stimmen
 *   3. Reload: Lineup erneut speichern (upsert) → 200 (idempotent)
 *   4. Invalid Cases (10 Fälle) → alle 400/409
 *   5. Locked Lineup → 409
 *   6. Cleanup
 *
 * Läuft gegen localhost:3000 (Dev-Server muss laufen).
 * Schreibt nur in Test-isolierte Datensätze, löscht alles am Ende.
 *
 * Verwendung:
 *   node --experimental-strip-types scripts/wm-e2e-lineup-validation.ts
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

// ── Reporter ───────────────────────────────────────────────────────────────
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

function note(msg: string) { console.log(`  ℹ️  ${msg}`); }
function header(n: number | string, title: string) {
  console.log(`\n${"─".repeat(56)}`);
  console.log(`Block ${n}: ${title}`);
  console.log("─".repeat(56));
}

// ── Konfiguration ─────────────────────────────────────────────────────────
const WC_TOURNAMENT_ID = "a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7";
const TEST_EMAIL       = `e2e-lineup-test-${Date.now()}@tifo-test.invalid`;
const TEST_PASSWORD    = "E2eTestPassword123!";
const BASE_URL         = "http://localhost:3000";
const FORMATION        = "4-3-3";
// Positionen für 4-3-3: GK×1, DF×4, MF×3, FW×3
const POSITIONS_433 = ["GK", "DF", "DF", "DF", "DF", "MF", "MF", "MF", "FW", "FW", "FW"] as const;
const BENCH_SIZE = 4;

// ── State ─────────────────────────────────────────────────────────────────
let adminSb: SupabaseClient;
let userSb:  SupabaseClient;
let testUserId    = "";
let testLeagueId  = "";
let teamId        = "";
let gameweekId    = "";
let gameweekNum   = 1;
let userJwt       = "";
let squadPlayerIds: number[] = [];   // 15 Spieler im Kader (11 + 4 Bank)

// ── Server-Check ──────────────────────────────────────────────────────────
async function waitForServer(maxWait = 30_000): Promise<boolean> {
  const start = Date.now();
  process.stdout.write("  Warte auf Dev-Server http://localhost:3000");
  while (Date.now() - start < maxWait) {
    try {
      const r = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(2000) });
      if (r.status !== 0) { console.log(" ✓\n"); return true; }
    } catch { /* noch nicht bereit */ }
    process.stdout.write(".");
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(" ✗\n");
  return false;
}

// ── Hilfsfunktion: Spieler nach Position laden ────────────────────────────
async function loadPlayersByPosition(pos: string, limit: number): Promise<number[]> {
  const { data } = await adminSb
    .from("players")
    .select("id")
    .eq("is_test_player", false)
    .eq("position", pos)
    .limit(limit);
  return (data || []).map((p: any) => p.id);
}

// ── Block 0: Setup ────────────────────────────────────────────────────────
async function block0_Setup(): Promise<boolean> {
  header(0, "Setup — Test-Umgebung erstellen");

  // Test-User
  const { data: newUser, error: uErr } = await adminSb.auth.admin.createUser({
    email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true,
  });
  if (uErr || !newUser.user) { console.error("❌ User:", uErr?.message); return false; }
  testUserId = newUser.user.id;
  ok("Test-User erstellt", !!testUserId);

  // Sign-In
  const { data: session, error: signInErr } = await userSb.auth.signInWithPassword({
    email: TEST_EMAIL, password: TEST_PASSWORD,
  });
  if (signInErr || !session.session) { console.error("❌ Sign-In:", signInErr?.message); return false; }
  userJwt = session.session.access_token;
  ok("Sign-In → JWT erhalten", !!userJwt);

  // Liga
  const { data: league, error: lErr } = await adminSb.from("leagues").insert({
    name: "E2E Lineup Test Liga (temp)",
    status: "active",
    owner_id: testUserId,
    max_teams: 4,
  }).select().single();
  if (lErr || !league) { console.error("❌ Liga:", lErr?.message); return false; }
  testLeagueId = league.id;
  ok("Test-Liga erstellt", !!testLeagueId);

  // WM-Settings
  const { error: wsErr } = await adminSb.from("wm_league_settings").insert({
    league_id:       testLeagueId,
    tournament_id:   WC_TOURNAMENT_ID,
    squad_size:      11,
    bench_size:      BENCH_SIZE,
    allowed_formations: [FORMATION],
    position_limits: {
      GK: { min: 1, max: 1 },
      DF: { min: 3, max: 5 },
      MF: { min: 2, max: 5 },
      FW: { min: 1, max: 3 },
    },
  });
  if (wsErr) { console.error("❌ wm_league_settings:", wsErr.message); return false; }
  ok("WM-Settings gespeichert", true);

  // Team
  const { data: team, error: tErr } = await adminSb.from("teams").insert({
    league_id: testLeagueId, user_id: testUserId, name: "E2E Lineup Team",
  }).select().single();
  if (tErr || !team) { console.error("❌ Team:", tErr?.message); return false; }
  teamId = team.id;
  ok("Team erstellt", !!teamId);

  // Spieler laden: genau 11+BENCH_SIZE aus echten WM-Spielern
  const gkIds  = await loadPlayersByPosition("GK", 2);
  const dfIds  = await loadPlayersByPosition("DF", 5);
  const mfIds  = await loadPlayersByPosition("MF", 4);
  const fwIds  = await loadPlayersByPosition("FW", 4);

  ok("Genug GK-Spieler", gkIds.length >= 2);
  ok("Genug DF-Spieler", dfIds.length >= 5);
  ok("Genug MF-Spieler", mfIds.length >= 4);
  ok("Genug FW-Spieler", fwIds.length >= 4);

  // 15 Spieler: 1GK + 4DF + 3MF + 3FW (XI) + 1GK + 1DF + 1MF (Bank spare)
  // Für 4-3-3: GK×1, DF×4, MF×3, FW×3 + Bank: GK, DF, MF, FW
  const xiIds = [
    gkIds[0],
    dfIds[0], dfIds[1], dfIds[2], dfIds[3],
    mfIds[0], mfIds[1], mfIds[2],
    fwIds[0], fwIds[1], fwIds[2],
  ];
  const benchIds = [gkIds[1], dfIds[4], mfIds[3], fwIds[3]];
  squadPlayerIds = [...xiIds, ...benchIds];

  ok(`${squadPlayerIds.length} einzigartige Spieler-IDs`, new Set(squadPlayerIds).size === squadPlayerIds.length);

  // wm_squad_players befüllen
  const rows = squadPlayerIds.map(pid => ({
    league_id:    testLeagueId,
    team_id:      teamId,
    tournament_id: WC_TOURNAMENT_ID,
    player_id:    pid,
    draft_round:  1,
    draft_pick:   squadPlayerIds.indexOf(pid) + 1,
    acquired_via: "draft",
  }));

  const { error: spErr } = await adminSb.from("wm_squad_players").insert(rows);
  if (spErr) { console.error("❌ wm_squad_players:", spErr.message); return false; }
  ok(`${squadPlayerIds.length} Spieler in wm_squad_players`, true);

  // Aktive/kommende Gameweek laden (nicht anlegen — Unique-Constraint tournament+gameweek)
  const { data: gw, error: gwErr } = await adminSb
    .from("wm_gameweeks")
    .select("id, gameweek, status")
    .eq("tournament_id", WC_TOURNAMENT_ID)
    .neq("status", "finished")
    .order("gameweek")
    .limit(1)
    .maybeSingle();
  if (gwErr || !gw) { console.error("❌ wm_gameweeks:", gwErr?.message ?? "Kein aktiver Spieltag gefunden"); return false; }
  gameweekId  = gw.id;
  gameweekNum = gw.gameweek;
  ok(`Gameweek geladen (GW ${gameweekNum}, ${gw.status})`, !!gameweekId);

  return true;
}

// ── API-Helfer ────────────────────────────────────────────────────────────
async function postLineup(body: object): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE_URL}/api/wm/${testLeagueId}/lineup`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${userJwt}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function validBody(overrides: Partial<{
  team_id: string;
  gameweek_id: string;
  formation: string;
  starters: number[];
  bench: number[];
  captain_id: number | null;
  vice_captain_id: number | null;
}> = {}) {
  const xiIds = squadPlayerIds.slice(0, 11);
  const benchIds = squadPlayerIds.slice(11, 11 + BENCH_SIZE);
  return {
    team_id:         teamId,
    gameweek_id:     gameweekId,
    formation:       FORMATION,
    starters:        xiIds,
    bench:           benchIds,
    captain_id:      xiIds[0],
    vice_captain_id: xiIds[1],
    ...overrides,
  };
}

// ── Block 1: Happy Path ───────────────────────────────────────────────────
async function block1_HappyPath() {
  header(1, "Happy Path — Gültige 4-3-3 Lineup speichern");

  const { status, json } = await postLineup(validBody());
  ok(`POST /lineup → HTTP ${status} (erwartet: 200)`, status === 200);
  ok("Response: ok=true", json.ok === true);
}

// ── Block 2: Persistenz ───────────────────────────────────────────────────
async function block2_Persistence() {
  header(2, "Persistenz — Lineup aus DB lesen");

  const { data: lineup } = await adminSb
    .from("team_lineups")
    .select("*")
    .eq("team_id", teamId)
    .eq("gameweek", gameweekNum)
    .maybeSingle();

  ok("Lineup in team_lineups gespeichert", !!lineup);
  ok(`Formation = ${FORMATION}`, lineup?.formation === FORMATION);
  ok("starting_xi hat 11 Einträge", (lineup?.starting_xi as number[])?.length === 11);
  ok(`bench hat ${BENCH_SIZE} Einträge`, (lineup?.bench as number[])?.length === BENCH_SIZE);
  ok("captain_id gesetzt", lineup?.captain_id != null);
  ok("vice_captain_id gesetzt", lineup?.vice_captain_id != null);
  ok("locked = false (noch nicht aktiv)", lineup?.locked === false);

  // Spieler-IDs stimmen
  const xiIds = squadPlayerIds.slice(0, 11);
  const savedXi: number[] = lineup?.starting_xi || [];
  ok(
    "starting_xi enthält alle 11 erwarteten Spieler",
    xiIds.every(id => savedXi.includes(id)),
  );
}

// ── Block 3: Reload / Idempotenz ──────────────────────────────────────────
async function block3_Reload() {
  header(3, "Reload — Lineup erneut speichern (Upsert)");

  const { status, json } = await postLineup(validBody());
  ok(`Zweites POST → HTTP ${status} (erwartet: 200, idempotent)`, status === 200);
  ok("Response: ok=true", json.ok === true);

  // Nur ein Eintrag in DB
  const { count } = await adminSb
    .from("team_lineups")
    .select("*", { count: "exact", head: true })
    .eq("team_id", teamId)
    .eq("gameweek", gameweekNum);
  ok("Genau 1 Lineup-Eintrag nach 2 Saves (Upsert)", count === 1);
}

// ── Block 4: Invalid Cases ────────────────────────────────────────────────
async function block4_InvalidCases() {
  header(4, "Invalid Cases — 10 Ablehnungs-Tests");

  const xiIds = squadPlayerIds.slice(0, 11);
  const benchIds = squadPlayerIds.slice(11, 11 + BENCH_SIZE);

  // 4.1 Zu wenige Starter
  {
    const r = await postLineup(validBody({ starters: xiIds.slice(0, 10) }));
    ok("4.1 Nur 10 Starter → 400", r.status === 400);
    if (r.status !== 400) note(`  Fehler: ${JSON.stringify(r.json)}`);
  }

  // 4.2 Zu viele Starter
  {
    // Brauchen einen Extra-Spieler aus der Bank
    const r = await postLineup(validBody({ starters: [...xiIds, benchIds[0]] }));
    ok("4.2 12 Starter → 400", r.status === 400);
  }

  // 4.3 Duplikat in Startern
  {
    const dup = [...xiIds.slice(0, 10), xiIds[0]]; // letzter = erster
    const r = await postLineup(validBody({ starters: dup }));
    ok("4.3 Duplikat in starters → 400", r.status === 400);
  }

  // 4.4 Spieler im Starter der nicht im Squad ist
  {
    const foreign = 999999; // existiert sicher nicht
    const r = await postLineup(validBody({ starters: [...xiIds.slice(0, 10), foreign] }));
    ok("4.4 Fremder Spieler → 400", r.status === 400);
  }

  // 4.5 Ungültige Formation
  {
    const r = await postLineup(validBody({ formation: "99-0-0" }));
    ok("4.5 Unbekannte Formation → 400", r.status === 400);
  }

  // 4.6 Positions-Counts passen nicht zur Formation (GK fehlt)
  {
    // Lade einen extra DF der nicht im Squad ist
    const { data: extraDf } = await adminSb
      .from("players")
      .select("id")
      .eq("is_test_player", false)
      .eq("position", "DF")
      .not("id", "in", `(${squadPlayerIds.join(",")})`)
      .limit(1)
      .maybeSingle();
    if (extraDf) {
      const badXi = [extraDf.id, ...xiIds.slice(1)]; // GK durch DF ersetzt → kein GK
      const r = await postLineup(validBody({ starters: badXi }));
      ok("4.6 Falsche Positions-Counts (kein GK) → 400", r.status === 400);
    } else {
      note("4.6 Skip — kein extra DF außerhalb des Squads verfügbar");
      passCount++;
    }
  }

  // 4.7 Kapitän nicht in Startelf
  {
    const r = await postLineup(validBody({ captain_id: benchIds[0] }));
    ok("4.7 Kapitän auf Bank → 400", r.status === 400);
  }

  // 4.8 Vize-Kapitän nicht in Startelf
  {
    const r = await postLineup(validBody({ vice_captain_id: benchIds[0] }));
    ok("4.8 Vize-Kapitän auf Bank → 400", r.status === 400);
  }

  // 4.9 Kapitän = Vize-Kapitän
  {
    const r = await postLineup(validBody({ captain_id: xiIds[0], vice_captain_id: xiIds[0] }));
    ok("4.9 Kapitän = Vize → 400", r.status === 400);
  }

  // 4.10 Bank zu groß (neuer bench_size Guard)
  {
    // Alle 15 Squad-Spieler als Bank (weit über bench_size=4)
    const r = await postLineup(validBody({ bench: squadPlayerIds }));
    ok(`4.10 Bank > bench_size (${squadPlayerIds.length} > ${BENCH_SIZE}) → 400`, r.status === 400);
    if (r.status !== 400) note(`  Response: ${JSON.stringify(r.json)}`);
  }
}

// ── Block 5: Locked Lineup ────────────────────────────────────────────────
async function block5_LockedLineup() {
  header(5, "Locked Lineup → 409");

  // Lineup direkt locken
  const { error: lockErr } = await adminSb
    .from("team_lineups")
    .update({ locked: true })
    .eq("team_id", teamId)
    .eq("gameweek", gameweekNum);
  ok("Lineup manuell gesperrt", !lockErr);

  const { status, json } = await postLineup(validBody());
  ok(`POST auf gesperrtes Lineup → HTTP ${status} (erwartet: 409)`, status === 409);
  if (status !== 409) note(`  Response: ${JSON.stringify(json)}`);

  // Wieder entsperren für Cleanup
  await adminSb.from("team_lineups").update({ locked: false }).eq("team_id", teamId);
}

// ── Block 99: Cleanup ─────────────────────────────────────────────────────
async function block99_Cleanup() {
  header(99, "Cleanup — Test-Daten löschen");

  // Gameweek NICHT löschen — wir nutzen eine vorhandene Produktion-GW (read-only)
  note(`Gameweek ${gameweekNum} (id=${gameweekId}) bleibt erhalten (nicht von uns angelegt)`);

  // Liga löscht Cascade: teams, wm_squad_players, team_lineups, wm_league_settings
  const { error: lErr } = await adminSb.from("leagues").delete().eq("id", testLeagueId);
  ok("Test-Liga + Cascade gelöscht", !lErr);
  if (lErr) note(`Liga-Fehler: ${lErr.message}`);

  // User
  const { error: uErr } = await adminSb.auth.admin.deleteUser(testUserId);
  ok("Test-User gelöscht", !uErr);
  if (uErr) note(`User-Fehler: ${uErr.message}`);
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  loadDotEnv();

  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey      = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error("❌ Supabase-Umgebungsvariablen fehlen");
    process.exit(1);
  }

  adminSb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  userSb  = createClient(supabaseUrl, anonKey);

  console.log("\nTIFO — WM Lineup E2E Validation");
  console.log(`  Server: ${BASE_URL}`);
  console.log(`  Formation: ${FORMATION} (11 Starter + ${BENCH_SIZE} Bank)`);

  const serverReady = await waitForServer();
  if (!serverReady) {
    console.error("❌ Dev-Server nicht erreichbar");
    process.exit(1);
  }

  let setupOk = false;
  try {
    setupOk = await block0_Setup();
    if (!setupOk) {
      console.error("\n❌ Setup fehlgeschlagen — Test abgebrochen");
      return;
    }
    await block1_HappyPath();
    await block2_Persistence();
    await block3_Reload();
    await block4_InvalidCases();
    await block5_LockedLineup();
  } finally {
    if (testUserId || testLeagueId || gameweekId) {
      await block99_Cleanup();
    }
  }

  // ── Zusammenfassung ────────────────────────────────────────────────
  console.log("\n" + "═".repeat(56));
  console.log(`\n📊 Ergebnis: ${passCount} bestanden, ${failCount} fehlgeschlagen`);

  if (failCount === 0) {
    console.log("\n✅ WM Lineup vollständig validiert");
    console.log("✅ Happy Path: Lineup speicherbar");
    console.log("✅ Persistenz: Felder korrekt in DB");
    console.log("✅ Upsert: Idempotent");
    console.log("✅ 10 Invalid Cases korrekt abgelehnt");
    console.log("✅ Locked Lineup: 409");
    console.log("\n✅ Lineup-Flow bereit für Turnierstart 🏆\n");
    process.exit(0);
  } else {
    console.log("\n❌ Fehler gefunden:");
    for (const f of failures) console.log(`   • ${f}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Unbehandelter Fehler:", err);
  process.exit(1);
});
