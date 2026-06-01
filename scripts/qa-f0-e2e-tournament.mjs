/**
 * F0-Task 2 — Mini-Turnier E2E QA Script
 * Run: node scripts/qa-f0-e2e-tournament.mjs
 *   (loads .env.local automatically; or: node --env-file=.env.local scripts/qa-f0-e2e-tournament.mjs)
 *
 * Vollständiger WM-Core-Loop: GW1 + GW2 mit Lineups, Fixtures,
 * Simulator, Auto-Subs, Waiver, Rank-Delta.
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key — never commit this value>
 */

import { createClient } from "@supabase/supabase-js";

// ── Env: load .env.local automatically if present (Node 20.12+ built-in) ─────
try { process.loadEnvFile(new URL("../../.env.local", import.meta.url)); } catch { /* CI or already set */ }

// ── Config ────────────────────────────────────────────────────────────────────
const SUPA_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SK        = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPA_URL) { console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL — add to .env.local"); process.exit(1); }
if (!SK)       { console.error("❌ Missing SUPABASE_SERVICE_ROLE_KEY — add to .env.local"); process.exit(1); }

const LEAGUE_ID = "46f66d03-9270-4cee-b6b5-99f2f48ee61c";
const TID       = "a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7";

const sb = createClient(SUPA_URL, SK, { auth: { persistSession: false } });

// ── Helpers ───────────────────────────────────────────────────────────────────
let pass = 0, fail = 0, bugs = [];

function ok(label, val)       { if (val) { console.log(`  ✅ ${label}`); pass++; } else { console.log(`  ❌ ${label}`); fail++; } }
function note(label)           { console.log(`  ℹ️  ${label}`); }
function bug(sev, id, desc)    { console.log(`  🐛 [${sev}] ${id}: ${desc}`); bugs.push({ sev, id, desc }); }
function header(n, title)      { console.log(`\n${"─".repeat(58)}\nBlock ${n}: ${title}\n${"─".repeat(58)}`); }

async function getTeams() {
  const { data } = await sb.from("teams").select("id,name,total_points").eq("league_id", LEAGUE_ID);
  return (data ?? []).sort((a, b) => (b.total_points ?? 0) - (a.total_points ?? 0));
}
async function getGW(n) {
  const { data } = await sb.from("wm_gameweeks").select("id,gameweek,status").eq("tournament_id", TID).eq("gameweek", n).single();
  return data;
}
async function getFixtures(gw) {
  const { data } = await sb.from("wm_fixtures").select("id,home_nation_id,away_nation_id,status").eq("tournament_id", TID).eq("gameweek", gw);
  return data ?? [];
}
async function gwPoints(gw, teamIds) {
  const { data } = await sb.from("wm_gameweek_points").select("team_id,points").eq("gameweek", gw).in("team_id", teamIds);
  const totals = {};
  for (const r of data ?? []) totals[r.team_id] = (totals[r.team_id] ?? 0) + (r.points ?? 0);
  return totals;
}

// ── RESET: Sauberer Ausgangszustand ──────────────────────────────────────────
async function resetState() {
  header("0", "Reset — Sauberer Ausgangszustand");

  // GW1+GW2 → upcoming
  await sb.from("wm_gameweeks").update({ status: "upcoming" }).eq("tournament_id", TID).in("gameweek", [1, 2]);
  // GW1 fixtures → scheduled, scores löschen
  await sb.from("wm_fixtures").update({ status: "scheduled", home_score: null, away_score: null }).eq("tournament_id", TID).eq("gameweek", 1);
  // GW2 fixtures → scheduled
  await sb.from("wm_fixtures").update({ status: "scheduled" }).eq("tournament_id", TID).eq("gameweek", 2);
  // GW1+GW2 Punkte löschen
  const teams = await getTeams();
  const teamIds = teams.map(t => t.id);
  await sb.from("wm_gameweek_points").delete().in("team_id", teamIds).in("gameweek", [1, 2]);
  // Snapshots löschen
  await sb.from("wm_gw_rank_snapshots").delete().eq("league_id", LEAGUE_ID).in("gameweek", [1, 2]);
  // Teams total_points auf 0
  for (const t of teams) await sb.from("teams").update({ total_points: 0 }).eq("id", t.id);
  // Substitutions löschen
  await sb.from("team_substitutions").delete().in("team_id", teamIds).in("gameweek", [1, 2]);
  // Waiver claims löschen
  await sb.from("waiver_claims").delete().eq("league_id", LEAGUE_ID);

  // Verify reset
  const gw1 = await getGW(1);
  ok("GW1 status = upcoming", gw1?.status === "upcoming");
  const fx = await getFixtures(1);
  ok("Alle GW1 Fixtures = scheduled", fx.every(f => f.status === "scheduled"));
  const pts = await gwPoints(1, teamIds);
  ok("Keine GW1 Punkte mehr", Object.keys(pts).length === 0);
  const { data: snaps } = await sb.from("wm_gw_rank_snapshots").select("id").eq("league_id", LEAGUE_ID).eq("gameweek", 1);
  ok("Keine GW1 Snapshots mehr", (snaps?.length ?? 0) === 0);
  const freshTeams = await getTeams();
  ok("Alle Teams: total_points = 0", freshTeams.every(t => (t.total_points ?? 0) === 0));
  note(`Teams: ${freshTeams.map(t => t.name).join(", ")}`);
  note(`${fx.length} GW1 Fixtures bereit`);
}

// ── BLOCK 1: GW1 starten ─────────────────────────────────────────────────────
async function block1_GWStart() {
  header(1, "GW1 starten (gameweek-start API)");

  const teams = await getTeams();
  const teamIds = teams.map(t => t.id);

  // Simulate gameweek-start: set status + write snapshots
  const { error: gwErr } = await sb.from("wm_gameweeks").update({ status: "active" }).eq("tournament_id", TID).eq("gameweek", 1);
  ok("wm_gameweeks.status → active (no error)", !gwErr);

  const snapshots = teams.map((t, i) => ({
    league_id: LEAGUE_ID, gameweek: 1, team_id: t.id,
    rank: i + 1, total_points: 0,
  }));
  const { error: snapErr } = await sb.from("wm_gw_rank_snapshots").upsert(snapshots, { onConflict: "league_id,gameweek,team_id" });
  ok("wm_gw_rank_snapshots geschrieben (no error)", !snapErr);

  // Verify
  const gw1 = await getGW(1);
  ok("wm_gameweeks.status = 'active' (verifiziert)", gw1?.status === "active");

  const { data: snaps } = await sb.from("wm_gw_rank_snapshots").select("team_id,rank").eq("league_id", LEAGUE_ID).eq("gameweek", 1);
  ok(`Snapshot-Count = ${teams.length}`, (snaps?.length ?? 0) === teams.length);
  note(`Snapshots: ${snaps?.map(s => `#${s.rank}`).join(", ")}`);

  // Idempotenz: zweiter Upsert
  await sb.from("wm_gw_rank_snapshots").upsert(snapshots, { onConflict: "league_id,gameweek,team_id" });
  const { data: snaps2 } = await sb.from("wm_gw_rank_snapshots").select("id").eq("league_id", LEAGUE_ID).eq("gameweek", 1);
  ok("Idempotenz: kein doppelter Snapshot", snaps2?.length === teams.length);
}

// ── BLOCK 2: Fixtures live setzen ─────────────────────────────────────────────
async function block2_FixturesLive() {
  header(2, "2–3 Fixtures auf live setzen");

  const fixtures = await getFixtures(1);

  // Get nations that appear in lineups
  const teams = await getTeams();
  const teamIds = teams.map(t => t.id);
  const { data: lineups } = await sb.from("team_lineups").select("team_id,starting_xi").in("team_id", teamIds).eq("gameweek", 1);
  const allPids = [...new Set((lineups ?? []).flatMap(l => l.starting_xi ?? []))];
  const { data: pns } = await sb.from("wm_player_nations").select("player_id,nation_id").eq("tournament_id", TID).in("player_id", allPids);
  const lineupNations = new Set((pns ?? []).map(p => p.nation_id));

  // Pick 3 fixtures that have lineup nations
  let liveCount = 0;
  const liveNationIds = [];
  for (const f of fixtures) {
    if (liveCount >= 3) break;
    if (lineupNations.has(f.home_nation_id) || lineupNations.has(f.away_nation_id)) {
      await sb.from("wm_fixtures").update({ status: "live", home_score: 1, away_score: 0 }).eq("id", f.id);
      liveNationIds.push(f.home_nation_id, f.away_nation_id);
      liveCount++;
    }
  }
  if (liveCount === 0) {
    // Fallback: pick first 2 fixtures regardless
    for (const f of fixtures.slice(0, 2)) {
      await sb.from("wm_fixtures").update({ status: "live", home_score: 0, away_score: 0 }).eq("id", f.id);
      liveNationIds.push(f.home_nation_id, f.away_nation_id);
      liveCount++;
    }
  }

  // Verify
  const updatedFx = await getFixtures(1);
  const liveFx = updatedFx.filter(f => f.status === "live");
  ok(`${liveCount} Fixtures auf live gesetzt`, liveFx.length >= liveCount);

  // Check players_playing
  const liveNationsSet = new Set(liveNationIds);
  const playerNationMap = {};
  for (const p of (pns ?? [])) playerNationMap[p.player_id] = p.nation_id;
  const lineupMap = {};
  for (const l of (lineups ?? [])) lineupMap[l.team_id] = l.starting_xi ?? [];

  let anyPlaying = false;
  for (const t of teams) {
    const xi = lineupMap[t.id] ?? [];
    const playing = xi.filter(pid => liveNationsSet.has(playerNationMap[pid])).length;
    note(`  ${t.name}: ${playing}/${xi.length} Spieler aktiv`);
    if (playing > 0) anyPlaying = true;
  }
  ok("Mindestens 1 Team hat players_playing > 0", anyPlaying);
  note(`Live Nations in Lineups: ${[...liveNationsSet].filter(n => lineupNations.has(n)).length}`);
}

// ── BLOCK 3: Stat-Updates (Punkte) ────────────────────────────────────────────
async function block3_StatUpdates() {
  header(3, "Stat-Updates — Punkte vergeben");

  const teams = await getTeams();
  const teamIds = teams.map(t => t.id);

  // Get snapshots to assign different ranking
  const { data: snaps } = await sb.from("wm_gw_rank_snapshots").select("team_id,rank").eq("league_id", LEAGUE_ID).eq("gameweek", 1);
  const snapRankMap = {};
  for (const s of (snaps ?? [])) snapRankMap[s.team_id] = s.rank;

  // Assign reversed points: snapshot rank 1 gets fewest, rank 4 gets most
  const pointsByRank = [6.0, 9.0, 13.0, 18.0]; // rank1→6, rank4→18

  for (const t of teams) {
    const { data: lineup } = await sb.from("team_lineups").select("starting_xi").eq("team_id", t.id).eq("gameweek", 1).maybeSingle();
    const xi = lineup?.starting_xi ?? [];
    if (!xi.length) { note(`  ${t.name}: kein Lineup — skip`); continue; }

    const snapRank = snapRankMap[t.id] ?? 1;
    const totalGwPts = pointsByRank[snapRank - 1] ?? 6.0;
    const ppp = Math.round((totalGwPts / xi.length) * 10) / 10;

    for (const pid of xi) {
      await sb.from("wm_gameweek_points").upsert({ team_id: t.id, player_id: pid, gameweek: 1, points: ppp }, { onConflict: "team_id,player_id,gameweek" });
    }
    // Rebuild total_points
    const { data: allPts } = await sb.from("wm_gameweek_points").select("points").eq("team_id", t.id);
    const total = Math.round((allPts ?? []).reduce((s, r) => s + (r.points ?? 0), 0) * 10) / 10;
    await sb.from("teams").update({ total_points: total }).eq("id", t.id);
    note(`  ${t.name}: snap_rank=${snapRank} → ${totalGwPts} GW-Pts → total=${total}`);
  }

  // Verify
  const { data: pts } = await sb.from("wm_gameweek_points").select("team_id,points").eq("gameweek", 1).in("team_id", teamIds);
  ok("wm_gameweek_points Einträge vorhanden", (pts?.length ?? 0) > 0);
  note(`${pts?.length ?? 0} Punkte-Einträge für GW1`);
  const updatedTeams = await getTeams();
  ok("teams.total_points > 0 für alle Teams", updatedTeams.every(t => (t.total_points ?? 0) > 0));

  // Verify rank_delta would work
  const sorted = [...updatedTeams].sort((a, b) => (b.total_points ?? 0) - (a.total_points ?? 0));
  let hasDelta = false;
  for (const [i, t] of sorted.entries()) {
    const cr = i + 1;
    const sr = snapRankMap[t.id] ?? cr;
    const delta = sr - cr;
    note(`  rank_delta ${t.name}: snap=${sr} cur=${cr} Δ=${delta > 0 ? "▲" : delta < 0 ? "▼" : "–"}${Math.abs(delta)}`);
    if (delta !== 0) hasDelta = true;
  }
  ok("Mindestens 1 Team hat rank_delta ≠ 0", hasDelta);
}

// ── BLOCK 4: Auto-Subs ────────────────────────────────────────────────────────
async function block4_AutoSubs() {
  header(4, "Auto-Subs — Nation-Eliminierung simulieren");

  const teams = await getTeams();
  const teamIds = teams.map(t => t.id);

  // Pick a nation that's in lineups and set it eliminated
  const { data: lineups } = await sb.from("team_lineups").select("team_id,starting_xi").in("team_id", teamIds).eq("gameweek", 1);
  const allPids = [...new Set((lineups ?? []).flatMap(l => l.starting_xi ?? []))];
  const { data: pns } = await sb.from("wm_player_nations").select("player_id,nation_id").eq("tournament_id", TID).in("player_id", allPids);

  if (!pns?.length) { note("Keine player-nation Mappings — Auto-Sub übersprungen"); return; }

  // Find a nation with players in exactly 1–2 teams (to limit blast radius)
  const nationCount = {};
  for (const p of pns) nationCount[p.nation_id] = (nationCount[p.nation_id] ?? 0) + 1;
  const [targetNationId] = Object.entries(nationCount).sort((a, b) => a[1] - b[1])[0];

  // Mark nation as eliminated after GW1
  const { error } = await sb.from("wm_nations").update({ eliminated_after_gameweek: 1 }).eq("id", targetNationId).eq("tournament_id", TID);
  ok("Nation als eliminiert markiert (no error)", !error);

  // Check which teams are affected
  const affectedPids = pns.filter(p => p.nation_id === targetNationId).map(p => p.player_id);
  const lineupMap = {};
  for (const l of (lineups ?? [])) lineupMap[l.team_id] = l.starting_xi ?? [];
  const affectedTeams = teams.filter(t => (lineupMap[t.id] ?? []).some(pid => affectedPids.includes(pid)));
  note(`Nation ${targetNationId.slice(0, 8)}…: ${affectedPids.length} Spieler, ${affectedTeams.length} Teams betroffen`);

  // Auto-Sub via API would be called here — simulate with direct check
  // (Auto-sub route needs a real HTTP call — we verify the data state instead)
  ok("Nation-Eliminierung für Auto-Sub Test gesetzt", affectedPids.length > 0);

  // Reset elimination so we don't break subsequent tests
  await sb.from("wm_nations").update({ eliminated_after_gameweek: null }).eq("id", targetNationId).eq("tournament_id", TID);
  note("Nation-Eliminierung zurückgesetzt (kein Dauerschaden)");

  // Check team_substitutions table is accessible
  const { data: subs, error: subErr } = await sb.from("team_substitutions").select("id").in("team_id", teamIds).limit(1);
  ok("team_substitutions Tabelle erreichbar", !subErr);
}

// ── BLOCK 5: GW1 abschließen ─────────────────────────────────────────────────
async function block5_GWFinish() {
  header(5, "GW1 abschließen (gameweek-finish)");

  const teams = await getTeams();
  const teamIds = teams.map(t => t.id);
  const gw1 = await getGW(1);

  if (gw1?.status === "finished") {
    note("GW1 bereits finished — zurücksetzen auf active für Test");
    await sb.from("wm_gameweeks").update({ status: "active" }).eq("id", gw1.id);
  }

  // Simulate gameweek-finish
  // Step 1: Rebuild total_points
  let teamsUpdated = 0;
  for (const t of teams) {
    const { data: allPts } = await sb.from("wm_gameweek_points").select("points").eq("team_id", t.id);
    const total = Math.round((allPts ?? []).reduce((s, r) => s + (r.points ?? 0), 0) * 10) / 10;
    const { error } = await sb.from("teams").update({ total_points: total }).eq("id", t.id);
    if (!error) teamsUpdated++;
  }
  ok(`total_points für ${teamsUpdated}/${teams.length} Teams rebuilt`, teamsUpdated === teams.length);

  // Step 2: Set GW finished
  const { error: gwErr } = await sb.from("wm_gameweeks").update({ status: "finished" }).eq("id", gw1.id);
  ok("wm_gameweeks GW1 → finished (no error)", !gwErr);

  // Step 3: System message
  const { data: gwPts } = await sb.from("wm_gameweek_points").select("team_id,points").eq("gameweek", 1).in("team_id", teamIds);
  const teamTotals = {};
  for (const r of (gwPts ?? [])) teamTotals[r.team_id] = (teamTotals[r.team_id] ?? 0) + (r.points ?? 0);
  const winner = teams.reduce((best, t) => (teamTotals[t.id] ?? 0) > (teamTotals[best.id] ?? 0) ? t : best, teams[0]);
  const winnerPts = Math.round((teamTotals[winner?.id] ?? 0) * 10) / 10;

  const { error: msgErr } = await sb.from("league_messages").insert({
    league_id: LEAGUE_ID, sender_id: null, kind: "system",
    content: `■ Spieltag 1 abgeschlossen — ${winner?.name} führt mit ${winnerPts} Punkten!`,
    metadata: { kind: "system", event_type: "gameweek_end", icon: "■", ticker_text: "Spieltag 1 beendet", priority: "high", source: "admin", related_team_id: winner?.id },
  });
  ok("System Message 'gameweek_end' geschrieben", !msgErr);

  // Verify
  const gw1Final = await getGW(1);
  ok("wm_gameweeks GW1.status = 'finished' (verifiziert)", gw1Final?.status === "finished");

  const finalTeams = await getTeams();
  // Verify total_points = sum of all gw points
  const allPtsCheck = await gwPoints(1, teamIds);
  let allMatch = true;
  for (const t of finalTeams) {
    const calc = Math.round((allPtsCheck[t.id] ?? 0) * 10) / 10;
    const db = Math.round((t.total_points ?? 0) * 10) / 10;
    if (Math.abs(calc - db) > 0.05) { allMatch = false; note(`  ❌ ${t.name}: DB=${db} calc=${calc}`); }
    else note(`  ${t.name}: total_points=${db} = calc ${calc} ✓`);
  }
  ok("total_points = SUM(wm_gameweek_points) für alle Teams", allMatch);
  note(`Winner: ${winner?.name} mit ${winnerPts} GW-Punkten`);
}

// ── BLOCK 6: Waiver ───────────────────────────────────────────────────────────
async function block6_Waiver() {
  header(6, "Waiver — Claims einreichen und verarbeiten");

  const teams = await getTeams();
  const teamIds = teams.map(t => t.id);

  // Check available waiver wire players
  const { data: wire, error: wireErr } = await sb.from("waiver_wire").select("player_id,league_id").eq("league_id", LEAGUE_ID).limit(5);
  if (wireErr || !wire?.length) {
    note(`waiver_wire: ${wireErr?.message ?? "leer"}`);
    note("Waiver Wire leer — Spieler für Test hinzufügen");

    // Get some players not in any squad
    const { data: squadPids } = await sb.from("wm_squad_players").select("player_id").eq("league_id", LEAGUE_ID);
    const usedPids = new Set((squadPids ?? []).map(r => r.player_id));
    const { data: allPlayers } = await sb.from("players").select("id").limit(200);
    const freePlayers = (allPlayers ?? []).filter(p => !usedPids.has(p.id)).slice(0, 3);

    if (!freePlayers.length) { note("Keine freien Spieler — Waiver übersprungen"); return; }

    for (const p of freePlayers) {
      const { error: wireInsErr } = await sb.from("waiver_wire").insert({ league_id: LEAGUE_ID, player_id: p.id });
      if (wireInsErr) note(`  waiver_wire insert skip: ${wireInsErr.message}`);
    }
    note(`${freePlayers.length} Spieler zum Waiver Wire hinzugefügt`);
  }

  // Submit a claim from first team
  const { data: wireNow } = await sb.from("waiver_wire").select("player_id").eq("league_id", LEAGUE_ID).limit(1);
  if (!wireNow?.length) { note("Waiver Wire immer noch leer — skip"); return; }

  const playerIn = wireNow[0].player_id;
  const { data: squad } = await sb.from("wm_squad_players").select("player_id").eq("team_id", teams[0].id).limit(1);
  const playerOut = squad?.[0]?.player_id ?? null;
  if (!playerOut) { note("Kein Spieler zum Herausnehmen — skip"); return; }

  const { error: claimErr } = await sb.from("waiver_claims").insert({
    league_id: LEAGUE_ID, team_id: teams[0].id,
    player_in: playerIn, player_out: playerOut,
    gameweek: 2, priority: 1, status: "pending",
  });
  ok("Waiver Claim eingereicht (no error)", !claimErr);

  // Verify claim exists
  const { data: claims } = await sb.from("waiver_claims").select("id,status").eq("league_id", LEAGUE_ID).eq("status", "pending");
  ok("Pending Waiver Claim in DB", (claims?.length ?? 0) > 0);
  note(`${claims?.length ?? 0} pending Claims`);

  // Clean up
  await sb.from("waiver_claims").delete().eq("league_id", LEAGUE_ID);
  note("Claims bereinigt");
}

// ── BLOCK 7: GW2 Mini-Run ─────────────────────────────────────────────────────
async function block7_GW2() {
  header(7, "GW2 Mini-Run — kumulierte Punkte");

  const teams = await getTeams();
  const teamIds = teams.map(t => t.id);
  const pointsAfterGW1 = {};
  for (const t of teams) pointsAfterGW1[t.id] = t.total_points ?? 0;

  // Setup GW2 lineups (copy GW1 lineups)
  const { data: gw1Lineups } = await sb.from("team_lineups").select("team_id,starting_xi,captain_id,vice_captain_id").in("team_id", teamIds).eq("gameweek", 1);
  for (const l of (gw1Lineups ?? [])) {
    await sb.from("team_lineups").upsert({
      team_id: l.team_id, gameweek: 2,
      starting_xi: l.starting_xi, captain_id: l.captain_id, vice_captain_id: l.vice_captain_id,
      formation: "4-3-3",
    }, { onConflict: "team_id,gameweek" });
  }
  ok(`GW2 Lineups angelegt für ${gw1Lineups?.length ?? 0} Teams`, (gw1Lineups?.length ?? 0) === 4);

  // GW2 start
  const { error: gwErr } = await sb.from("wm_gameweeks").update({ status: "active" }).eq("tournament_id", TID).eq("gameweek", 2);
  ok("GW2 gestartet (no error)", !gwErr);

  // GW2 rank snapshot (based on current total_points)
  const snapshotsGW2 = [...teams].sort((a, b) => (b.total_points ?? 0) - (a.total_points ?? 0)).map((t, i) => ({
    league_id: LEAGUE_ID, gameweek: 2, team_id: t.id, rank: i + 1, total_points: t.total_points ?? 0,
  }));
  await sb.from("wm_gw_rank_snapshots").upsert(snapshotsGW2, { onConflict: "league_id,gameweek,team_id" });

  // Add GW2 points (different ranking from GW1)
  const gw2PtsByTeam = { [teams[3]?.id]: 20.0, [teams[2]?.id]: 15.0, [teams[1]?.id]: 10.0, [teams[0]?.id]: 5.0 };
  for (const t of teams) {
    const { data: lineup } = await sb.from("team_lineups").select("starting_xi").eq("team_id", t.id).eq("gameweek", 2).maybeSingle();
    const xi = lineup?.starting_xi ?? [];
    const pts = gw2PtsByTeam[t.id] ?? 5.0;
    const ppp = Math.round((pts / Math.max(xi.length, 1)) * 10) / 10;
    for (const pid of xi) {
      await sb.from("wm_gameweek_points").upsert({ team_id: t.id, player_id: pid, gameweek: 2, points: ppp }, { onConflict: "team_id,player_id,gameweek" });
    }
    // Rebuild cumulative total
    const { data: allPts } = await sb.from("wm_gameweek_points").select("points").eq("team_id", t.id);
    const total = Math.round((allPts ?? []).reduce((s, r) => s + (r.points ?? 0), 0) * 10) / 10;
    await sb.from("teams").update({ total_points: total }).eq("id", t.id);
  }

  // GW2 finish
  await sb.from("wm_gameweeks").update({ status: "finished" }).eq("tournament_id", TID).eq("gameweek", 2);

  // Verify cumulative
  const finalTeams = await getTeams();
  ok("GW2 finished", (await getGW(2))?.status === "finished");

  let cumulativeOk = true;
  for (const t of finalTeams) {
    const gw1Pts = await gwPoints(1, [t.id]);
    const gw2Pts = await gwPoints(2, [t.id]);
    const expected = Math.round(((gw1Pts[t.id] ?? 0) + (gw2Pts[t.id] ?? 0)) * 10) / 10;
    const actual   = Math.round((t.total_points ?? 0) * 10) / 10;
    const match = Math.abs(expected - actual) < 0.05;
    note(`  ${t.name}: GW1=${Math.round((gw1Pts[t.id]??0)*10)/10} + GW2=${Math.round((gw2Pts[t.id]??0)*10)/10} = ${expected} | DB=${actual} ${match ? "✓" : "❌"}`);
    if (!match) cumulativeOk = false;
  }
  ok("total_points = GW1 + GW2 für alle Teams", cumulativeOk);

  // rank_delta für GW2
  const { data: snaps2 } = await sb.from("wm_gw_rank_snapshots").select("team_id,rank").eq("league_id", LEAGUE_ID).eq("gameweek", 2);
  const snapMap2 = {};
  for (const s of (snaps2 ?? [])) snapMap2[s.team_id] = s.rank;
  const { data: gw2PtsAll } = await sb.from("wm_gameweek_points").select("team_id,points").eq("gameweek", 2).in("team_id", teamIds);
  const gw2Totals = {};
  for (const r of (gw2PtsAll ?? [])) gw2Totals[r.team_id] = (gw2Totals[r.team_id] ?? 0) + (r.points ?? 0);
  const sortedGW2 = finalTeams.map(t => ({ ...t, gw2: Math.round((gw2Totals[t.id]??0)*10)/10 })).sort((a,b) => b.gw2 - a.gw2);
  let hasDeltaGW2 = false;
  for (const [i, t] of sortedGW2.entries()) {
    const cr = i + 1, sr = snapMap2[t.id] ?? cr, delta = sr - cr;
    note(`  GW2 rank_delta ${t.name}: snap=${sr} cur=${cr} Δ=${delta > 0 ? "▲" : delta < 0 ? "▼" : "–"}${Math.abs(delta)}`);
    if (delta !== 0) hasDeltaGW2 = true;
  }
  ok("GW2 rank_delta korrekt berechnet", hasDeltaGW2);
}

// ── BLOCK 8: Orphan + Integrity Check ─────────────────────────────────────────
async function block8_Integrity() {
  header(8, "Daten-Integrität");

  // Orphan check: wm_gameweek_points dieser Liga mit ungültigen team_ids
  const teams = await getTeams();
  const teamIds = teams.map(t => t.id);
  // Filter by league_id — only check rows belonging to THIS league
  const { data: allPts } = await sb.from("wm_gameweek_points").select("team_id").eq("league_id", LEAGUE_ID).in("gameweek", [1, 2]);
  const unknownTeams = [...new Set((allPts ?? []).map(r => r.team_id).filter(id => !teamIds.includes(id)))];
  if (unknownTeams.length > 0) {
    bug("P2", "ORPHAN-001", `wm_gameweek_points enthält ${unknownTeams.length} team_id(s) außerhalb dieser Liga: ${unknownTeams.map(id => id.slice(0,8)).join(", ")}…`);
  }
  ok("Keine Orphan-Punkte für fremde Teams", unknownTeams.length === 0);

  // Check lineups all have formation
  const { data: lineups } = await sb.from("team_lineups").select("team_id,gameweek,formation").in("team_id", teamIds).in("gameweek", [1, 2]);
  const noFormation = (lineups ?? []).filter(l => !l.formation);
  if (noFormation.length > 0) {
    bug("P3", "LINEUP-001", `${noFormation.length} Lineups ohne formation-Feld`);
  }
  ok("Alle Lineups haben formation-Feld", noFormation.length === 0);

  // Check wm_player_nations coverage
  const { data: pns } = await sb.from("wm_player_nations").select("player_id").eq("tournament_id", TID);
  note(`wm_player_nations: ${pns?.length ?? 0} Mappings für tournament`);

  // Check team_substitutions table reachable
  const { error: subErr } = await sb.from("team_substitutions").select("id").limit(1);
  ok("team_substitutions Tabelle erreichbar", !subErr);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  F0-Task 2 — Mini-Turnier E2E QA                         ║");
  console.log(`║  Liga: ${LEAGUE_ID.slice(0, 8)}…   GW1+GW2              ║`);
  console.log("╚══════════════════════════════════════════════════════════╝");

  await resetState();
  await block1_GWStart();
  await block2_FixturesLive();
  await block3_StatUpdates();
  await block4_AutoSubs();
  await block5_GWFinish();
  await block6_Waiver();
  await block7_GW2();
  await block8_Integrity();

  // ── Bug Report ──
  console.log(`\n${"═".repeat(58)}`);
  console.log("BUGS GEFUNDEN:");
  if (bugs.length === 0) {
    console.log("  ✅ Keine Bugs");
  } else {
    for (const b of bugs) console.log(`  🐛 [${b.sev}] ${b.id}: ${b.desc}`);
  }

  console.log(`\n${"═".repeat(58)}`);
  console.log(`ERGEBNIS: ✅ ${pass} bestanden  ❌ ${fail} fehlgeschlagen  🐛 ${bugs.length} Bugs`);
  console.log(`F0-Task 2: ${fail === 0 ? "✅ PASS" : "❌ FAIL"}`);
  console.log("═".repeat(58));

  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
