import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

type ResetResult = {
  team_id: string;
  subs_reversed: number;
  skipped: boolean;
  skip_reason?: string;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;

  // ── Auth ──────────────────────────────────────────────────────────
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
  );
  const { data: { user } } = await anonClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });

  // ── Body ──────────────────────────────────────────────────────────
  let gameweek: number;
  try {
    ({ gameweek } = await req.json());
  } catch {
    return NextResponse.json({ error: "Ungültiger Request-Body" }, { status: 400 });
  }
  if (!gameweek || typeof gameweek !== "number") {
    return NextResponse.json({ error: "gameweek (number) ist Pflichtfeld" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // ── Ownership check ───────────────────────────────────────────────
  const { data: league, error: leagueError } = await supabase
    .from("leagues").select("owner_id").eq("id", leagueId).single();
  if (leagueError || !league) return NextResponse.json({ error: "Liga nicht gefunden" }, { status: 404 });
  if (league.owner_id !== user.id) return NextResponse.json({ error: "Kein Zugriff — nur Liga-Owner" }, { status: 403 });

  // ── Load teams ────────────────────────────────────────────────────
  const { data: teams, error: teamsError } = await supabase
    .from("teams").select("id").eq("league_id", leagueId);
  if (teamsError) return NextResponse.json({ error: "Fehler beim Laden der Teams" }, { status: 500 });
  const teamIds = (teams || []).map((t: any) => t.id);
  if (teamIds.length === 0) return NextResponse.json({ ok: true, results: [], message: "Keine Teams in dieser Liga" });

  // ── Load auto-subs for this GW ────────────────────────────────────
  const { data: allSubs, error: subsError } = await supabase
    .from("team_substitutions")
    .select("id, team_id, player_in, player_out")
    .in("team_id", teamIds)
    .eq("gameweek", gameweek)
    .eq("auto", true);

  if (subsError) return NextResponse.json({ error: "Fehler beim Laden der Auto-Subs" }, { status: 500 });

  if (!allSubs || allSubs.length === 0) {
    return NextResponse.json({
      ok: true,
      results: [],
      message: `Keine Auto-Subs für GW${gameweek} gefunden`,
    });
  }

  // ── Group subs by team ────────────────────────────────────────────
  const subsByTeam = new Map<string, typeof allSubs>();
  for (const sub of allSubs) {
    if (!subsByTeam.has(sub.team_id)) subsByTeam.set(sub.team_id, []);
    subsByTeam.get(sub.team_id)!.push(sub);
  }

  const results: ResetResult[] = [];

  for (const [teamId, subs] of subsByTeam.entries()) {
    // ── Load current lineup ─────────────────────────────────────────
    const { data: lineup, error: lineupError } = await supabase
      .from("team_lineups")
      .select("starting_xi")
      .eq("team_id", teamId)
      .eq("gameweek", gameweek)
      .maybeSingle();

    if (lineupError) {
      console.error(`[auto-subs-reset] lineup query team ${teamId}:`, lineupError.message);
      results.push({ team_id: teamId, subs_reversed: 0, skipped: true, skip_reason: "DB-Fehler beim Laden des Lineups" });
      continue;
    }

    if (!lineup) {
      results.push({ team_id: teamId, subs_reversed: 0, skipped: true, skip_reason: "Kein Lineup gefunden" });
      continue;
    }

    // ── Reverse subs: apply in reverse order ────────────────────────
    // Auto-subs modified starting_xi: replaced player_out with player_in.
    // To reverse: replace player_in back with player_out.
    let xi = (lineup.starting_xi as number[]).slice();
    for (const sub of [...subs].reverse()) {
      const inIdx = xi.indexOf(sub.player_in);
      if (inIdx !== -1) {
        xi[inIdx] = sub.player_out;
      } else {
        // player_in not found in XI (edge case) — ensure player_out is present
        if (!xi.includes(sub.player_out)) {
          xi = [...xi, sub.player_out];
        }
      }
    }

    // ── Write restored lineup ───────────────────────────────────────
    const { error: updateError } = await supabase
      .from("team_lineups")
      .update({ starting_xi: xi, updated_at: new Date().toISOString() })
      .eq("team_id", teamId)
      .eq("gameweek", gameweek);

    if (updateError) {
      console.error(`[auto-subs-reset] lineup update team ${teamId}:`, updateError.message);
      results.push({ team_id: teamId, subs_reversed: 0, skipped: true, skip_reason: "DB-Fehler beim Speichern des Lineups" });
      continue;
    }

    // ── Delete the auto-sub records ─────────────────────────────────
    const subIds = subs.map((s: any) => s.id);
    const { error: deleteError } = await supabase
      .from("team_substitutions")
      .delete()
      .in("id", subIds);

    if (deleteError) {
      console.error(`[auto-subs-reset] delete subs team ${teamId}:`, deleteError.message);
      results.push({ team_id: teamId, subs_reversed: 0, skipped: true, skip_reason: "DB-Fehler beim Löschen der Subs" });
      continue;
    }

    results.push({ team_id: teamId, subs_reversed: subs.length, skipped: false });
  }

  const totalReversed = results.reduce((n, r) => n + r.subs_reversed, 0);
  const skipped = results.filter(r => r.skipped).length;

  return NextResponse.json({ ok: true, results, totalReversed, skipped });
}
