import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/wm/[id]/gameweek-start
 *
 * Starts a WM gameweek: sets status → 'active' and writes a rank snapshot
 * for all teams in the league. The snapshot is the baseline for rank_delta
 * in the Live Center.
 *
 * Owner-only. Idempotent: calling again refreshes the snapshot.
 *
 * Body:  { gameweek: number }
 * Returns: { ok: true, snapshot_count: number }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;

  // ── 1. Auth: user must be logged in ──────────────────────────────
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
  );
  const { data: { user } } = await anonClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  // ── 2. Owner check via leagues.owner_id ──────────────────────────
  const supabase = createServiceRoleClient();

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("owner_id")
    .eq("id", leagueId)
    .single();
  if (leagueError || !league) {
    return NextResponse.json({ error: "Liga nicht gefunden" }, { status: 404 });
  }
  if (league.owner_id !== user.id) {
    return NextResponse.json({ error: "Kein Zugriff — nur Liga-Owner" }, { status: 403 });
  }

  // ── 3. Parse body ────────────────────────────────────────────────
  const body = await req.json().catch(() => ({}));
  const gameweek = Number(body?.gameweek);
  if (!gameweek || gameweek < 1) {
    return NextResponse.json({ error: "Ungültiger gameweek-Wert" }, { status: 400 });
  }

  // ── 4. tournament_id via wm_league_settings ──────────────────────
  const { data: settings, error: settingsError } = await supabase
    .from("wm_league_settings")
    .select("tournament_id")
    .eq("league_id", leagueId)
    .maybeSingle();
  if (settingsError || !settings?.tournament_id) {
    return NextResponse.json({ error: "WM-Liga-Einstellungen nicht gefunden" }, { status: 404 });
  }
  const tournamentId = settings.tournament_id;

  // ── 5. Set wm_gameweeks.status → 'active' ────────────────────────
  const { error: gwError } = await supabase
    .from("wm_gameweeks")
    .update({ status: "active" })
    .eq("tournament_id", tournamentId)
    .eq("gameweek", gameweek);
  if (gwError) {
    return NextResponse.json({ error: "Spieltag-Status Update fehlgeschlagen: " + gwError.message }, { status: 500 });
  }

  // ── 6. Load all teams ordered by total_points DESC ───────────────
  // ORDER BY total_points DESC → rank = index + 1
  // Ties: same total_points → same effective rank ordering (stable sort)
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, total_points")
    .eq("league_id", leagueId)
    .order("total_points", { ascending: false });
  if (teamsError) {
    return NextResponse.json({ error: "Teams laden fehlgeschlagen: " + teamsError.message }, { status: 500 });
  }
  if (!teams?.length) {
    return NextResponse.json({ ok: true, snapshot_count: 0 });
  }

  // ── 7. Build rank snapshot rows ───────────────────────────────────
  const snapshots = teams.map((t, idx) => ({
    league_id:    leagueId,
    gameweek,
    team_id:      t.id,
    rank:         idx + 1,                           // 1-based
    total_points: (t.total_points ?? 0) as number,
  }));

  // ── 8. UPSERT — idempotent, refreshes snapshot on repeat calls ───
  const { error: upsertError } = await supabase
    .from("wm_gw_rank_snapshots")
    .upsert(snapshots, { onConflict: "league_id,gameweek,team_id" });
  if (upsertError) {
    return NextResponse.json(
      { error: "Snapshot schreiben fehlgeschlagen: " + upsertError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, snapshot_count: snapshots.length });
}
