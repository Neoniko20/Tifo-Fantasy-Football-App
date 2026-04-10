import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { processWaivers } from "@/lib/waiver-processor";

const supabaseServer = createServiceRoleClient();

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const expected   = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { data: leagues } = await supabaseServer
    .from("leagues").select("id, mode").eq("mode", "liga");

  const runs: any[] = [];
  for (const l of (leagues || [])) {
    const { data: gw } = await supabaseServer
      .from("liga_gameweeks")
      .select("gameweek, waiver_window_open, status")
      .eq("league_id", l.id)
      .eq("status", "active")
      .maybeSingle();

    if (!gw) continue;
    if (gw.waiver_window_open) continue; // still open → skip

    const result = await processWaivers(l.id, gw.gameweek);
    runs.push(result);
  }

  return NextResponse.json({ ok: true, runs });
}
