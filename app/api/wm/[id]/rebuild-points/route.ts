import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;

  // ── Auth: only authenticated users ───────────────────────────────
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
  );
  const { data: { user } } = await anonClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });

  const supabase = createServiceRoleClient();

  // ── Ownership check: league owner only ───────────────────────────
  const { data: league, error: leagueError } = await supabase
    .from("leagues").select("owner_id").eq("id", leagueId).single();
  if (leagueError || !league) return NextResponse.json({ error: "Liga nicht gefunden" }, { status: 404 });
  if (league.owner_id !== user.id) return NextResponse.json({ error: "Kein Zugriff — nur Liga-Owner" }, { status: 403 });

  // ── Load all teams in this league ─────────────────────────────────
  const { data: teams, error: teamsError } = await supabase
    .from("teams").select("id").eq("league_id", leagueId);
  if (teamsError) return NextResponse.json({ error: "Fehler beim Laden der Teams" }, { status: 500 });
  const teamIds = (teams || []).map((t: any) => t.id);
  if (teamIds.length === 0) return NextResponse.json({ ok: true, updated: [] });

  // ── Per team: sum ALL wm_gameweek_points → write teams.total_points ─
  const updated: Array<{ team_id: string; total_points: number; error?: string }> = [];

  for (const teamId of teamIds) {
    const { data: pointsRows, error: pointsError } = await supabase
      .from("wm_gameweek_points")
      .select("points")
      .eq("team_id", teamId);

    if (pointsError) {
      console.error(`[rebuild-points] points query team ${teamId}:`, pointsError.message);
      updated.push({ team_id: teamId, total_points: 0, error: pointsError.message });
      continue;
    }

    const total = (pointsRows || []).reduce(
      (sum: number, r: any) => sum + (r.points || 0), 0,
    );
    const rounded = Math.round(total * 10) / 10;

    const { error: updateError } = await supabase
      .from("teams")
      .update({ total_points: rounded })
      .eq("id", teamId);

    if (updateError) {
      console.error(`[rebuild-points] team ${teamId}:`, updateError.message);
      updated.push({ team_id: teamId, total_points: rounded, error: updateError.message });
      continue;
    }
    updated.push({ team_id: teamId, total_points: rounded });
  }

  return NextResponse.json({
    ok: true,
    updated,
    failed: updated.filter(u => u.error).length,
  });
}
