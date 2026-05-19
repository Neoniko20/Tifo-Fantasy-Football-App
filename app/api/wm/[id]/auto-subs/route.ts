import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { applyLiveSubs } from "@/lib/live-sub";
import { validateFormation } from "@/lib/wm-formations";

type TeamResult = {
  team_id: string;
  subs: { out: number; in: number }[];
  skipped: boolean;
  skip_reason?: string;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;

  // ── 1. Auth ───────────────────────────────────────────────────────
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
  );
  const { data: { user } } = await anonClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  // ── 2. Body ───────────────────────────────────────────────────────
  let gameweek_id: string;
  try {
    ({ gameweek_id } = await req.json());
  } catch {
    return NextResponse.json({ error: "Ungültiger Request-Body" }, { status: 400 });
  }
  if (!gameweek_id) {
    return NextResponse.json({ error: "gameweek_id ist Pflichtfeld" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // ── 3. Liga + Owner-Check ─────────────────────────────────────────
  const { data: league } = await supabase
    .from("leagues")
    .select("id, owner_id")
    .eq("id", leagueId)
    .single();

  if (!league) {
    return NextResponse.json({ error: "Liga nicht gefunden" }, { status: 404 });
  }
  if (league.owner_id !== user.id) {
    return NextResponse.json({ error: "Kein Zugriff — nur Liga-Owner" }, { status: 403 });
  }

  // ── 4. WM-Settings → tournament_id ───────────────────────────────
  const { data: wmSettings } = await supabase
    .from("wm_league_settings")
    .select("tournament_id")
    .eq("league_id", leagueId)
    .maybeSingle();

  const tournamentId = wmSettings?.tournament_id ?? null;

  // ── 5. Gameweek validieren ────────────────────────────────────────
  const gwQuery = supabase
    .from("wm_gameweeks")
    .select("id, gameweek, status")
    .eq("id", gameweek_id);

  if (tournamentId) gwQuery.eq("tournament_id", tournamentId);

  const { data: gw } = await gwQuery.maybeSingle();

  if (!gw) {
    return NextResponse.json({ error: "Gameweek nicht gefunden oder gehört nicht zur Liga" }, { status: 404 });
  }
  if (gw.status === "upcoming") {
    return NextResponse.json({ error: "Gameweek hat noch nicht begonnen" }, { status: 409 });
  }

  // ── 6. Alle Teams der Liga laden ──────────────────────────────────
  const { data: teams } = await supabase
    .from("teams")
    .select("id")
    .eq("league_id", leagueId);

  const teamIds = (teams || []).map(t => t.id);
  if (teamIds.length === 0) {
    return NextResponse.json({ ok: true, results: [], message: "Keine Teams in dieser Liga" });
  }

  // ── 7. Alle Lineups für diesen GW laden ───────────────────────────
  const { data: lineups } = await supabase
    .from("team_lineups")
    .select("team_id, starting_xi, bench, formation, captain_id")
    .in("team_id", teamIds)
    .eq("gameweek", gw.gameweek);

  if (!lineups || lineups.length === 0) {
    return NextResponse.json({ ok: true, results: [], message: "Keine Lineups für diesen Spieltag" });
  }

  // ── 8. Alle relevanten Spieler-IDs sammeln ────────────────────────
  const allPlayerIds = new Set<number>();
  for (const l of lineups) {
    for (const id of (l.starting_xi as number[] || [])) allPlayerIds.add(id);
    for (const id of (l.bench as number[] || [])) allPlayerIds.add(id);
  }

  // ── 9. Spielminuten aus wm_gameweek_points ────────────────────────
  const { data: pointsRows } = await supabase
    .from("wm_gameweek_points")
    .select("player_id, minutes")
    .eq("gameweek", gw.gameweek)
    .in("player_id", [...allPlayerIds]);

  const playerMinutes: Record<number, number> = {};
  for (const row of (pointsRows || [])) {
    playerMinutes[row.player_id] = row.minutes ?? 0;
  }
  // Spieler ohne Stats-Eintrag → 0 Minuten
  for (const pid of allPlayerIds) {
    if (playerMinutes[pid] === undefined) playerMinutes[pid] = 0;
  }

  // ── 10. Spieler-Positionen + team_name laden ─────────────────────
  const { data: playerRows } = await supabase
    .from("players")
    .select("id, position, team_name")
    .in("id", [...allPlayerIds]);

  const playerPositionMap: Record<number, string> = {};
  const playerTeamMap: Record<number, string> = {};
  for (const p of (playerRows || [])) {
    playerPositionMap[p.id] = p.position;
    playerTeamMap[p.id] = p.team_name ?? "";
  }

  // ── 10b. Eliminierte Nationen → playerEliminated Map ──────────────
  const playerEliminated: Record<number, boolean> = {};
  if (tournamentId) {
    // FK-based lookup via wm_player_nations — builds per-player nation map
    const { data: pnRows } = await supabase
      .from("wm_player_nations")
      .select("player_id, wm_nations(eliminated_after_gameweek)")
      .eq("tournament_id", tournamentId)
      .in("player_id", [...allPlayerIds]);

    const playerFKNationMap: Record<number, { eliminated_after_gameweek: number | null } | null> = {};
    for (const pn of (pnRows || [])) {
      playerFKNationMap[pn.player_id] = (pn.wm_nations as unknown as { eliminated_after_gameweek: number | null } | null) ?? null;
    }

    // Load string-fallback data once for players not in FK map
    const fkPlayerIds = new Set(Object.keys(playerFKNationMap).map(Number));
    const missingPlayerIds = [...allPlayerIds].filter(id => !fkPlayerIds.has(id));

    let fallbackNationRows: Array<{ name: string; eliminated_after_gameweek: number | null }> = [];
    // TODO remove fallback after real WM player import
    if (missingPlayerIds.length > 0) {
      const { data } = await supabase
        .from("wm_nations")
        .select("name, eliminated_after_gameweek")
        .eq("tournament_id", tournamentId)
        .not("eliminated_after_gameweek", "is", null);
      fallbackNationRows = data || [];
    }

    for (const pid of allPlayerIds) {
      if (pid in playerFKNationMap) {
        const nation = playerFKNationMap[pid];
        if (nation?.eliminated_after_gameweek && gw.gameweek > nation.eliminated_after_gameweek) {
          playerEliminated[pid] = true;
        }
      } else {
        // fallback: string-based match
        const teamName = playerTeamMap[pid] ?? "";
        const nation = fallbackNationRows.find(n => n.name === teamName);
        if (nation?.eliminated_after_gameweek && gw.gameweek > nation.eliminated_after_gameweek) {
          playerEliminated[pid] = true;
        }
      }
    }
  }

  // ── 11. Existing auto-subs laden (Duplikat-Schutz) ────────────────
  const { data: existingSubs } = await supabase
    .from("team_substitutions")
    .select("team_id")
    .in("team_id", teamIds)
    .eq("gameweek", gw.gameweek)
    .eq("auto", true);

  const teamsWithAutoSubs = new Set((existingSubs || []).map(s => s.team_id));

  // ── 12. Pro Team Auto-Subs berechnen + speichern ──────────────────
  const results: TeamResult[] = [];

  for (const lineup of lineups) {
    const teamId = lineup.team_id;
    const startingXI = (lineup.starting_xi as number[]) || [];
    const bench = (lineup.bench as number[]) || [];
    const formation = lineup.formation as string;

    // Bereits Auto-Subs gelaufen?
    if (teamsWithAutoSubs.has(teamId)) {
      results.push({ team_id: teamId, subs: [], skipped: true, skip_reason: "Auto-Subs bereits ausgeführt" });
      continue;
    }

    if (startingXI.length !== 11) {
      results.push({ team_id: teamId, subs: [], skipped: true, skip_reason: "Lineup unvollständig" });
      continue;
    }

    // Nur Starter aus wm_squad_players einwechseln (Bank-Spieler auch prüfen)
    const { data: squadRows } = await supabase
      .from("wm_squad_players")
      .select("player_id")
      .eq("team_id", teamId)
      .eq("league_id", leagueId)
      .in("player_id", [...new Set([...startingXI, ...bench])]);

    const squadSet = new Set((squadRows || []).map(r => r.player_id));
    const safeBench = bench.filter(pid => squadSet.has(pid));

    // applyLiveSubs aus lib/live-sub.ts
    const { effectiveXI, subs } = applyLiveSubs(
      startingXI,
      safeBench,
      playerMinutes,
      playerPositionMap,
      playerEliminated,
    );

    if (subs.length === 0) {
      results.push({ team_id: teamId, subs: [], skipped: false });
      continue;
    }

    // Formations-Validierung nach Einwechslungen
    const newPositions = effectiveXI.map(pid => playerPositionMap[pid] as "GK" | "DF" | "MF" | "FW").filter(Boolean);
    const formationCheck = validateFormation(newPositions, formation);

    if (!formationCheck.valid) {
      results.push({
        team_id: teamId,
        subs: [],
        skipped: true,
        skip_reason: `Formation ungültig nach Auto-Sub: ${formationCheck.errors.join(", ")}`,
      });
      continue;
    }

    // team_substitutions schreiben
    const subRows = subs.map(s => ({
      team_id:    teamId,
      gameweek:   gw.gameweek,
      player_out: s.out,
      player_in:  s.in,
      reason:     "auto_sub",
      auto:       true,
    }));

    const { error: subError } = await supabase.from("team_substitutions").insert(subRows);
    if (subError) {
      console.error(`[auto-subs] team ${teamId}:`, subError.message);
      results.push({ team_id: teamId, subs: [], skipped: true, skip_reason: "DB-Fehler beim Speichern" });
      continue;
    }

    // team_lineups.starting_xi aktualisieren
    await supabase
      .from("team_lineups")
      .update({ starting_xi: effectiveXI, updated_at: new Date().toISOString() })
      .eq("team_id", teamId)
      .eq("gameweek", gw.gameweek);

    results.push({ team_id: teamId, subs, skipped: false });
  }

  const totalSubs = results.reduce((n, r) => n + r.subs.length, 0);
  const skipped   = results.filter(r => r.skipped).length;

  return NextResponse.json({ ok: true, results, totalSubs, skipped });
}
