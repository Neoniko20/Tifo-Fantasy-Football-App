import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { FORMATIONS, validateFormation } from "@/lib/wm-formations";
import { shouldAllowLineupSave } from "@/lib/wm-lineup-lock";

type LineupBody = {
  team_id:         string;
  gameweek_id:     string;
  formation:       string;
  starters:        number[];
  bench:           number[];
  captain_id:      number | null;
  vice_captain_id: number | null;
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

  // ── 2. Body parsen ────────────────────────────────────────────────
  let body: LineupBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger Request-Body" }, { status: 400 });
  }

  const { team_id, gameweek_id, formation, starters, bench, captain_id, vice_captain_id } = body;
  if (!team_id || !gameweek_id || !formation || !starters || !bench) {
    return NextResponse.json(
      { error: "team_id, gameweek_id, formation, starters und bench sind Pflichtfelder" },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();

  // ── 3. Liga existiert + User ist Mitglied ─────────────────────────
  const { data: league } = await supabase
    .from("leagues")
    .select("id, owner_id")
    .eq("id", leagueId)
    .single();

  if (!league) {
    return NextResponse.json({ error: "Liga nicht gefunden" }, { status: 404 });
  }

  const isLeagueOwner = league.owner_id === user.id;

  const { data: userTeam } = await supabase
    .from("teams")
    .select("id, user_id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!isLeagueOwner && !userTeam) {
    return NextResponse.json({ error: "Nicht Mitglied dieser Liga" }, { status: 403 });
  }

  // ── 4. Team gehört zur Liga ───────────────────────────────────────
  const { data: targetTeam } = await supabase
    .from("teams")
    .select("id, user_id")
    .eq("id", team_id)
    .eq("league_id", leagueId)
    .single();

  if (!targetTeam) {
    return NextResponse.json({ error: "Team gehört nicht zu dieser Liga" }, { status: 403 });
  }

  // User muss Owner des Teams oder Liga-Admin sein
  if (!isLeagueOwner && targetTeam.user_id !== user.id) {
    return NextResponse.json({ error: "Nicht dein Team" }, { status: 403 });
  }

  // ── 5. WM-Settings für tournament_id ─────────────────────────────
  const { data: wmSettings } = await supabase
    .from("wm_league_settings")
    .select("tournament_id, allowed_formations, bench_size")
    .eq("league_id", leagueId)
    .maybeSingle();

  const tournamentId = wmSettings?.tournament_id;

  // ── 6. Gameweek gehört zur Liga + Status-Check ───────────────────
  const gwQuery = supabase
    .from("wm_gameweeks")
    .select("id, gameweek, status, deadline, waiver_window_open")
    .eq("id", gameweek_id);

  if (tournamentId) {
    gwQuery.eq("tournament_id", tournamentId);
  }

  const { data: gw } = await gwQuery.maybeSingle();

  if (!gw) {
    return NextResponse.json({ error: "Gameweek nicht gefunden oder gehört nicht zu dieser Liga" }, { status: 404 });
  }

  // Deadline-Check (falls das Feld existiert)
  if (gw.deadline && new Date(gw.deadline) < new Date()) {
    return NextResponse.json({ error: "Aufstellungs-Deadline ist bereits abgelaufen" }, { status: 409 });
  }

  // ── 7. Duplikate prüfen ───────────────────────────────────────────
  const allPlayerIds = [...starters, ...bench];
  const uniqueIds = new Set(allPlayerIds);
  if (uniqueIds.size !== allPlayerIds.length) {
    return NextResponse.json({ error: "Doppelte Spieler in Startelf oder Bank" }, { status: 400 });
  }

  // ── 8. Alle Spieler gehören zum Team ─────────────────────────────
  if (allPlayerIds.length > 0) {
    const { data: squadPlayers } = await supabase
      .from("wm_squad_players")
      .select("player_id")
      .eq("team_id", team_id)
      .in("player_id", allPlayerIds);

    const ownedIds = new Set((squadPlayers || []).map(p => p.player_id));
    const foreignIds = allPlayerIds.filter(id => !ownedIds.has(id));
    if (foreignIds.length > 0) {
      return NextResponse.json(
        { error: `Spieler gehören nicht zu diesem Team: ${foreignIds.join(", ")}` },
        { status: 400 },
      );
    }
  }

  // ── 9. Startelf: genau 11 Spieler ────────────────────────────────
  if (starters.length !== 11) {
    return NextResponse.json({ error: "Startelf muss genau 11 Spieler enthalten" }, { status: 400 });
  }

  // ── 9b. Bank: nicht größer als bench_size ────────────────────────
  const maxBench = wmSettings?.bench_size ?? 4;
  if (bench.length > maxBench) {
    return NextResponse.json(
      { error: `Bank darf maximal ${maxBench} Spieler enthalten (${bench.length} angegeben)` },
      { status: 400 },
    );
  }

  // ── 10. Formation gültig ──────────────────────────────────────────
  if (!FORMATIONS[formation]) {
    return NextResponse.json({ error: `Unbekannte Formation: ${formation}` }, { status: 400 });
  }

  const allowedFormations: string[] | undefined = wmSettings?.allowed_formations;
  if (allowedFormations && allowedFormations.length > 0 && !allowedFormations.includes(formation)) {
    return NextResponse.json({ error: `Formation ${formation} ist in dieser Liga nicht erlaubt` }, { status: 400 });
  }

  // Positions der Starter für Formations-Validierung laden
  const { data: starterPlayers } = await supabase
    .from("players")
    .select("id, position")
    .in("id", starters);

  const starterPositions = starters.map(id => {
    const p = (starterPlayers || []).find(sp => sp.id === id);
    return p?.position as "GK" | "DF" | "MF" | "FW" | undefined;
  }).filter(Boolean) as Array<"GK" | "DF" | "MF" | "FW">;

  const validation = validateFormation(starterPositions, formation);
  if (!validation.valid) {
    return NextResponse.json(
      { error: `Formation nicht erfüllt: ${validation.errors.join(", ")}` },
      { status: 400 },
    );
  }

  // ── 11. Kapitän & Vize müssen Starter sein ────────────────────────
  if (captain_id !== null && captain_id !== undefined && !starters.includes(captain_id)) {
    return NextResponse.json({ error: "Kapitän muss in der Startelf sein" }, { status: 400 });
  }
  if (vice_captain_id !== null && vice_captain_id !== undefined && !starters.includes(vice_captain_id)) {
    return NextResponse.json({ error: "Vize-Kapitän muss in der Startelf sein" }, { status: 400 });
  }
  if (captain_id !== null && captain_id === vice_captain_id) {
    return NextResponse.json({ error: "Kapitän und Vize-Kapitän dürfen nicht identisch sein" }, { status: 400 });
  }

  // ── 12. Gameweek-Status + Lineup-Lock prüfen ─────────────────────
  // Checks (in order): finished → active → row locked.
  // Covers the "no existing row but GW already active" gap.
  const { data: existingLineup } = await supabase
    .from("team_lineups")
    .select("locked")
    .eq("team_id", team_id)
    .eq("gameweek", gw.gameweek)
    .maybeSingle();

  const lockCheck = shouldAllowLineupSave({
    gameweekStatus: gw.status,
    existingLocked: existingLineup?.locked,
  });
  if (!lockCheck.allow) {
    return NextResponse.json({ error: lockCheck.error }, { status: lockCheck.status });
  }

  // ── 13. Upsert ────────────────────────────────────────────────────
  const { error: upsertError } = await supabase
    .from("team_lineups")
    .upsert({
      team_id,
      tournament_id: tournamentId ?? null,
      gameweek: gw.gameweek,
      formation,
      starting_xi:     starters,
      bench,
      captain_id:      captain_id ?? null,
      vice_captain_id: vice_captain_id ?? null,
      updated_at:      new Date().toISOString(),
    }, { onConflict: "team_id,gameweek" });

  if (upsertError) {
    console.error("[wm/lineup] upsert error:", upsertError.message);
    return NextResponse.json({ error: "Aufstellung konnte nicht gespeichert werden" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
