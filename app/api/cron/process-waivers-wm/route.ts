import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { processWmWaivers } from "@/app/api/process-waivers-wm/route";

const supabase = createServiceRoleClient();

/**
 * GET /api/cron/process-waivers-wm
 *
 * Triggered by Vercel Cron (0 5 * * *).
 * Iterates all active WM leagues and processes pending waiver claims
 * for any league whose waiver window is already closed.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const expected   = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // All WM leagues
  const { data: leagues } = await supabase
    .from("leagues")
    .select("id")
    .eq("mode", "wm");

  const runs: Array<{ leagueId: string; result: any }> = [];

  for (const league of leagues || []) {
    // Find the active gameweek for this league (via wm_league_settings → tournament_id)
    const { data: settings } = await supabase
      .from("wm_league_settings")
      .select("tournament_id")
      .eq("league_id", league.id)
      .maybeSingle();

    if (!settings?.tournament_id) continue;

    const { data: gw } = await supabase
      .from("wm_gameweeks")
      .select("gameweek, waiver_window_open, status")
      .eq("tournament_id", settings.tournament_id)
      .eq("status", "active")
      .maybeSingle();

    // Skip if no active GW, window still open, or already finished
    if (!gw || gw.waiver_window_open || gw.status === "finished") continue;

    const res = await processWmWaivers(league.id, gw.gameweek);
    const body = await res.json();
    runs.push({ leagueId: league.id, result: body });
  }

  return NextResponse.json({ ok: true, runs });
}
