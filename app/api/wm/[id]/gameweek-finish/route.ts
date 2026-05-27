import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { writeSystemMessage } from "@/lib/wm-system-messages";

/**
 * POST /api/wm/[id]/gameweek-finish
 *
 * Atomically closes a WM gameweek:
 *  1. Guard: already finished → no-op
 *  2. Rebuild teams.total_points via SUM(wm_gameweek_points) for all teams
 *  3. Set wm_gameweeks.status → 'finished'
 *  4. Calculate GW top scorer (team with highest gw_points)
 *  5. Write GW-end system message to league chat
 *
 * Owner-only. Idempotent: second call returns { ok: true, already_finished: true }.
 *
 * Body:    { gameweek: number }
 * Returns: { ok: true, teams_updated: number, winner: { team_name, gw_points } | null }
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

  // ── 5. Idempotency guard: already finished → no-op ───────────────
  const { data: gwRow, error: gwLookupError } = await supabase
    .from("wm_gameweeks")
    .select("id, status")
    .eq("tournament_id", tournamentId)
    .eq("gameweek", gameweek)
    .maybeSingle();
  if (gwLookupError) {
    return NextResponse.json({ error: "Spieltag laden fehlgeschlagen: " + gwLookupError.message }, { status: 500 });
  }
  if (gwRow?.status === "finished") {
    return NextResponse.json({ ok: true, already_finished: true });
  }

  // ── 6. Load all teams in this league ─────────────────────────────
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, name")
    .eq("league_id", leagueId);
  if (teamsError) {
    return NextResponse.json({ error: "Teams laden fehlgeschlagen: " + teamsError.message }, { status: 500 });
  }
  if (!teams?.length) {
    return NextResponse.json({ error: "Keine Teams in dieser Liga" }, { status: 404 });
  }

  // ── 7. Rebuild teams.total_points via SUM (all GWs, all teams) ───
  // SUM-based rebuild (not increment) → idempotent, drift-free.
  let teamsUpdated = 0;
  const updateErrors: string[] = [];

  for (const team of teams) {
    const { data: allPts, error: sumError } = await supabase
      .from("wm_gameweek_points")
      .select("points")
      .eq("team_id", team.id);

    if (sumError) {
      updateErrors.push(`sum failed for ${team.id}: ${sumError.message}`);
      continue;
    }

    const newTotal = Math.round(
      (allPts ?? []).reduce((s, r) => s + (r.points ?? 0), 0) * 10,
    ) / 10;

    const { error: updateError } = await supabase
      .from("teams")
      .update({ total_points: newTotal })
      .eq("id", team.id);

    if (updateError) {
      updateErrors.push(`update failed for ${team.id}: ${updateError.message}`);
    } else {
      teamsUpdated++;
    }
  }

  // Abort before status change if majority of updates failed
  if (updateErrors.length > 0 && teamsUpdated === 0) {
    return NextResponse.json(
      { error: "Alle total_points Updates fehlgeschlagen", details: updateErrors },
      { status: 500 },
    );
  }

  // ── 8. Set wm_gameweeks.status → 'finished' (atomic, race-safe) ──
  // Using .neq("status", "finished") as an optimistic lock:
  // if two concurrent calls reach here, exactly one will update 1 row;
  // the other updates 0 rows → detected as already_finished, no double message.
  if (gwRow?.id) {
    const { data: updated, error: gwError } = await supabase
      .from("wm_gameweeks")
      .update({ status: "finished" })
      .eq("id", gwRow.id)
      .neq("status", "finished")
      .select("id");
    if (gwError) {
      return NextResponse.json(
        { error: "Spieltag-Status Update fehlgeschlagen: " + gwError.message },
        { status: 500 },
      );
    }
    if (!updated?.length) {
      // Another concurrent call already set status → no-op for this call
      return NextResponse.json({ ok: true, already_finished: true });
    }
  }

  // ── 9. Top team of this GW ────────────────────────────────────────
  // Sum wm_gameweek_points for this GW only → rank by gw_points
  const { data: gwPts } = await supabase
    .from("wm_gameweek_points")
    .select("team_id, points")
    .eq("league_id", leagueId)
    .eq("gameweek", gameweek);

  const gwSums: Record<string, number> = {};
  for (const row of gwPts ?? []) {
    gwSums[row.team_id] = (gwSums[row.team_id] ?? 0) + (row.points ?? 0);
  }

  let winnerTeamId: string | null = null;
  let winnerGwPoints = 0;
  for (const [teamId, pts] of Object.entries(gwSums)) {
    if (pts > winnerGwPoints) {
      winnerGwPoints = pts;
      winnerTeamId = teamId;
    }
  }
  const winnerTeam = teams.find((t) => t.id === winnerTeamId) ?? null;
  const winnerGwPointsRounded = Math.round(winnerGwPoints * 10) / 10;

  // ── 10. System message ────────────────────────────────────────────
  const content = winnerTeam
    ? `■ Spieltag ${gameweek} abgeschlossen — ${winnerTeam.name} führt mit ${winnerGwPointsRounded} Punkten!`
    : `■ Spieltag ${gameweek} abgeschlossen.`;

  await writeSystemMessage(supabase, leagueId, content, {
    kind:         "system",
    event_type:   "gameweek_end",
    icon:         "■",
    ticker_text:  `Spieltag ${gameweek} beendet`,
    priority:     "high",
    source:       "admin",
    related_team_id: winnerTeamId ?? undefined,
  });

  return NextResponse.json({
    ok:            true,
    teams_updated: teamsUpdated,
    update_errors: updateErrors.length > 0 ? updateErrors : undefined,
    winner: winnerTeam
      ? { team_name: winnerTeam.name, gw_points: winnerGwPointsRounded }
      : null,
  });
}
