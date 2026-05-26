import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/wm/[id]/draft/admin-pick
 *
 * Liga-Owner kann einen Spieler retroaktiv einem leeren Pick-Slot zuweisen.
 * Bypassed die current_pick-Validierung — nur für Admin-Korrekturen.
 *
 * Body: { player_id, team_id, pick_number, round }
 */

type AdminPickBody = {
  player_id:   number;
  team_id:     string;
  pick_number: number;
  round:       number;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;

  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
  );
  const { data: { user } } = await anonClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });

  let body: AdminPickBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Ungültiger Body" }, { status: 400 }); }

  const { player_id, team_id, pick_number, round } = body;
  if (!player_id || !team_id || pick_number === undefined || round === undefined) {
    return NextResponse.json({ error: "player_id, team_id, pick_number und round erforderlich" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // Nur Liga-Owner darf Admin-Picks setzen
  const { data: league } = await supabase
    .from("leagues").select("id, owner_id").eq("id", leagueId).single();
  if (!league) return NextResponse.json({ error: "Liga nicht gefunden" }, { status: 404 });
  if (league.owner_id !== user.id) return NextResponse.json({ error: "Nur Liga-Owner" }, { status: 403 });

  // Team muss zur Liga gehören
  const { data: team } = await supabase
    .from("teams").select("id").eq("id", team_id).eq("league_id", leagueId).single();
  if (!team) return NextResponse.json({ error: "Team nicht in dieser Liga" }, { status: 404 });

  // Draft-Session muss existieren
  const { data: session } = await supabase
    .from("draft_sessions").select("id, status").eq("league_id", leagueId).maybeSingle();
  if (!session) return NextResponse.json({ error: "Keine Draft-Session" }, { status: 409 });

  // Slot darf noch nicht belegt sein
  const { data: slotTaken } = await supabase
    .from("draft_picks")
    .select("id").eq("draft_session_id", session.id).eq("pick_number", pick_number).maybeSingle();
  if (slotTaken) return NextResponse.json({ error: "Slot bereits belegt" }, { status: 409 });

  // Spieler darf noch nicht gedraftet worden sein
  const { data: playerTaken } = await supabase
    .from("wm_squad_players")
    .select("id").eq("league_id", leagueId).eq("player_id", player_id).maybeSingle();
  if (playerTaken) return NextResponse.json({ error: "Spieler bereits gedraftet" }, { status: 409 });

  // Turnier-ID für wm_squad_players
  const { data: wmSettings } = await supabase
    .from("wm_league_settings").select("tournament_id").eq("league_id", leagueId).maybeSingle();

  // Schreiben
  const { error: pickErr } = await supabase.from("draft_picks").insert({
    draft_session_id: session.id,
    team_id,
    player_id,
    pick_number,
    round,
  });
  if (pickErr) return NextResponse.json({ error: "draft_picks: " + pickErr.message }, { status: 500 });

  const { error: squadErr } = await supabase.from("wm_squad_players").insert({
    league_id:     leagueId,
    tournament_id: wmSettings?.tournament_id ?? null,
    team_id,
    player_id,
    draft_round:   round,
    draft_pick:    pick_number,
    acquired_via:  "draft",
  });
  if (squadErr) {
    if (squadErr.code === "23505") return NextResponse.json({ error: "Spieler soeben anderweitig vergeben" }, { status: 409 });
    return NextResponse.json({ error: "wm_squad_players: " + squadErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
