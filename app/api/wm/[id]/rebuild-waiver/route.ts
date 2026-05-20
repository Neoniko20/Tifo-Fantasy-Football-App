import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { rebuildWaiverWire, resetWaiverPriority } from "@/lib/waiver-init";

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

  const supabase = createServiceRoleClient();

  // ── Ownership check ───────────────────────────────────────────────
  const { data: league, error: leagueError } = await supabase
    .from("leagues").select("owner_id").eq("id", leagueId).single();
  if (leagueError || !league) return NextResponse.json({ error: "Liga nicht gefunden" }, { status: 404 });
  if (league.owner_id !== user.id) return NextResponse.json({ error: "Kein Zugriff — nur Liga-Owner" }, { status: 403 });

  // ── Rebuild waiver wire (auto-detects WM mode via leagues.mode) ───
  const { inserted } = await rebuildWaiverWire(leagueId);

  // ── Find active GW via wm_gameweeks (not liga_gameweeks) ──────────
  const { data: wmSettings } = await supabase
    .from("wm_league_settings")
    .select("tournament_id")
    .eq("league_id", leagueId)
    .maybeSingle();

  let activeGW = 1;
  if (wmSettings?.tournament_id) {
    const { data: gw } = await supabase
      .from("wm_gameweeks")
      .select("gameweek")
      .eq("tournament_id", wmSettings.tournament_id)
      .eq("status", "active")
      .maybeSingle();
    if (gw) activeGW = gw.gameweek;
  }

  // ── Reset waiver priority ─────────────────────────────────────────
  await resetWaiverPriority(leagueId, activeGW);

  return NextResponse.json({ ok: true, inserted, activeGW });
}
