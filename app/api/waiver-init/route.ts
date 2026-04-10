import { NextRequest, NextResponse } from "next/server";
import { rebuildWaiverWire, resetWaiverPriority } from "@/lib/waiver-init";
import { createServiceRoleClient } from "@/lib/supabase-server";

const supabaseServer = createServiceRoleClient();

export async function POST(req: NextRequest) {
  const { leagueId } = await req.json().catch(() => ({}));
  if (!leagueId) return NextResponse.json({ ok: false, error: "leagueId required" }, { status: 400 });

  const { inserted } = await rebuildWaiverWire(leagueId);

  const { data: activeGW } = await supabaseServer
    .from("liga_gameweeks").select("gameweek").eq("league_id", leagueId).eq("status", "active").maybeSingle();
  await resetWaiverPriority(leagueId, activeGW?.gameweek ?? 1);

  await supabaseServer.from("liga_admin_audit_log").insert({
    league_id: leagueId,
    actor_id:  null,
    actor_label: "admin",
    action: "waivers_initialized",
    metadata: { inserted },
  });

  return NextResponse.json({ ok: true, inserted });
}
