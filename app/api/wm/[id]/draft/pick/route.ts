import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/wm/[id]/draft/pick
 *
 * Führt einen WM-Draft-Pick durch. Schreibt in:
 *  - draft_picks       (Board-Log, bleibt wie bisher)
 *  - wm_squad_players  (isolierter WM-Kader, ersetzt squad_players)
 *  - draft_sessions    (current_pick advance)
 *  - leagues           (status → "active" wenn Draft fertig)
 *
 * Body: { player_id, team_id, round, pick }
 * Rückgabe: { ok, nextPick, finished }
 */

type PickBody = {
  player_id: number;
  team_id:   string;
  round:     number;
  pick:      number;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;

  // ── 1. Auth: User muss eingeloggt sein ───────────────────────────
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
  let body: PickBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger Request-Body" }, { status: 400 });
  }

  const { player_id, team_id, round, pick } = body;
  if (!player_id || !team_id || round === undefined || pick === undefined) {
    return NextResponse.json(
      { error: "player_id, team_id, round und pick sind Pflichtfelder" },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();

  // ── 3. Liga-Zugehörigkeit validieren ─────────────────────────────
  const { data: league } = await supabase
    .from("leagues")
    .select("id, owner_id, max_teams, status")
    .eq("id", leagueId)
    .single();

  if (!league) {
    return NextResponse.json({ error: "Liga nicht gefunden" }, { status: 404 });
  }

  const isOwner = league.owner_id === user.id;

  // User muss Mitglied sein (eigenes Team) ODER Liga-Owner (für Bot-Picks)
  const { data: userTeam } = await supabase
    .from("teams")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!isOwner && !userTeam) {
    return NextResponse.json({ error: "Nicht Mitglied dieser Liga" }, { status: 403 });
  }

  // ── 4. team_id gehört zur Liga ────────────────────────────────────
  const { data: pickingTeam } = await supabase
    .from("teams")
    .select("id, user_id")
    .eq("id", team_id)
    .eq("league_id", leagueId)
    .single();

  if (!pickingTeam) {
    return NextResponse.json({ error: "Team gehört nicht zu dieser Liga" }, { status: 403 });
  }

  // Non-owner darf nur für das eigene Team picken
  if (!isOwner && pickingTeam.id !== userTeam?.id) {
    return NextResponse.json({ error: "Du bist gerade nicht dran" }, { status: 403 });
  }

  // ── 5. Spieler bereits gedraftet? ────────────────────────────────
  const { data: existingPick } = await supabase
    .from("wm_squad_players")
    .select("id")
    .eq("league_id", leagueId)
    .eq("player_id", player_id)
    .maybeSingle();

  if (existingPick) {
    return NextResponse.json(
      { error: "Spieler bereits gedraftet — wähle einen anderen" },
      { status: 409 },
    );
  }

  // ── 6. Draft-Session laden und Pick-Position prüfen ──────────────
  const { data: session } = await supabase
    .from("draft_sessions")
    .select("id, current_pick, total_picks, draft_order, status, seconds_per_pick, draft_type")
    .eq("league_id", leagueId)
    .eq("status", "active")
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "Kein aktiver Draft" }, { status: 409 });
  }

  // Optimistic-Lock: Pick-Nummer muss stimmen
  if (session.current_pick !== pick) {
    return NextResponse.json(
      { error: "Zu langsam — dieser Slot wurde bereits vergeben" },
      { status: 409 },
    );
  }

  // ── 6b. Idempotency: if this pick slot already exists, return success silently.
  // Prevents duplicate DB writes when two browser tabs call triggerBot() simultaneously.
  const { data: existingSlotPick } = await supabase
    .from("draft_picks")
    .select("id")
    .eq("draft_session_id", session.id)
    .eq("pick_number", pick)
    .maybeSingle();

  if (existingSlotPick) {
    const nextPick = pick + 1;
    const finished = nextPick >= session.total_picks;
    return NextResponse.json({ ok: true, nextPick, finished });
  }

  // ── 7. WM-Turnier-ID auflösen ─────────────────────────────────────
  const { data: wmSettings } = await supabase
    .from("wm_league_settings")
    .select("tournament_id")
    .eq("league_id", leagueId)
    .maybeSingle();

  // ── 8. Schreiben — draft_picks + wm_squad_players ────────────────
  const { error: pickError } = await supabase.from("draft_picks").insert({
    draft_session_id: session.id,
    team_id,
    player_id,
    pick_number:      pick,
    round,
  });

  if (pickError) {
    console.error("[draft/pick] draft_picks insert:", pickError.message);
    return NextResponse.json({ error: "Draft-Pick konnte nicht gespeichert werden" }, { status: 500 });
  }

  const { error: squadError } = await supabase.from("wm_squad_players").insert({
    league_id:     leagueId,
    tournament_id: wmSettings?.tournament_id ?? null,
    team_id,
    player_id,
    draft_round:   round,
    draft_pick:    pick,
    acquired_via:  "draft",
  });

  if (squadError) {
    // Duplicate — race condition, bereits vergeben
    if (squadError.code === "23505") {
      return NextResponse.json(
        { error: "Spieler wurde soeben von einem anderen Team gedraftet" },
        { status: 409 },
      );
    }
    console.error("[draft/pick] wm_squad_players insert:", squadError.message);
    return NextResponse.json({ error: "Kader konnte nicht aktualisiert werden" }, { status: 500 });
  }

  // Auch in squad_players eintragen, damit /leagues/[id]/lineup Kader anzeigt
  await supabase.from("squad_players").upsert(
    { team_id, player_id },
    { onConflict: "team_id,player_id", ignoreDuplicates: true },
  );

  // ── 9. Draft-Session vorrücken ────────────────────────────────────
  const nextPick = pick + 1;
  const finished = nextPick >= session.total_picks;
  const newStatus = finished ? "finished" : "active";

  await supabase
    .from("draft_sessions")
    .update({
      current_pick: nextPick,
      status: newStatus,
      pick_started_at: finished ? null : new Date().toISOString(),
    })
    .eq("id", session.id);

  if (finished) {
    await supabase
      .from("leagues")
      .update({ status: "active" })
      .eq("id", leagueId);
  }

  return NextResponse.json({ ok: true, nextPick, finished });
}
