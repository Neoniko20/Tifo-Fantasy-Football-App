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

  // ── WM mode check ─────────────────────────────────────────────────
  // This route is WM-only. rebuildWaiverWire() auto-detects mode internally,
  // but we validate here for a clear error message if called on a Liga league.
  const { data: leagueMode } = await supabase
    .from("leagues").select("mode").eq("id", leagueId).single();
  if (leagueMode?.mode !== "wm") {
    return NextResponse.json({ error: "Diese Route ist nur für WM-Ligen" }, { status: 400 });
  }

  // ── Rebuild waiver wire (auto-detects WM mode via leagues.mode) ───
  let inserted: number;
  try {
    const result = await rebuildWaiverWire(leagueId);
    inserted = result.inserted;
  } catch (e: any) {
    console.error("[rebuild-waiver] rebuildWaiverWire failed:", e.message);
    return NextResponse.json({ error: "Fehler beim Aufbauen des Waiver Wire: " + e.message }, { status: 500 });
  }

  // ── Find active GW via wm_gameweeks (not liga_gameweeks) ──────────
  // WM-only route: uses wm_gameweeks instead of liga_gameweeks.
  // Falls back to GW 1 if no active GW found (e.g. tournament not started).
  const { data: wmSettings } = await supabase
    .from("wm_league_settings")
    .select("tournament_id")
    .eq("league_id", leagueId)
    .maybeSingle();

  let activeGW = 1;
  if (wmSettings?.tournament_id) {
    const { data: gw, error: gwError } = await supabase
      .from("wm_gameweeks")
      .select("gameweek")
      .eq("tournament_id", wmSettings.tournament_id)
      .eq("status", "active")
      .maybeSingle();
    if (gwError) {
      console.warn("[rebuild-waiver] wm_gameweeks query failed, using GW 1:", gwError.message);
    } else if (gw) {
      activeGW = gw.gameweek;
    }
  }

  // ── Reset waiver priority ─────────────────────────────────────────
  try {
    await resetWaiverPriority(leagueId, activeGW);
  } catch (e: any) {
    console.error("[rebuild-waiver] resetWaiverPriority failed:", e.message);
    // Wire was rebuilt successfully — priority reset failure is non-fatal.
    // Return ok with a warning so admin knows to check priority manually.
    return NextResponse.json({
      ok: true,
      inserted,
      activeGW,
      warning: "Waiver Wire aufgebaut, aber Priority-Reset fehlgeschlagen: " + e.message,
    });
  }

  return NextResponse.json({ ok: true, inserted, activeGW });
}
