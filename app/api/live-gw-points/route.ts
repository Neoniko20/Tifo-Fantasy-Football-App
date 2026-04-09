import { NextRequest, NextResponse } from "next/server";
import { importGameweekLive } from "@/lib/gw-import";
import { supabase } from "@/lib/supabase";

// Simple in-memory rate limit: leagueId → last run timestamp
const lastRun = new Map<string, number>();
const MIN_INTERVAL_MS = 45_000;

export async function GET(req: NextRequest) {
  const leagueId = req.nextUrl.searchParams.get("leagueId");
  const gwParam  = req.nextUrl.searchParams.get("gameweek");
  if (!leagueId || !gwParam) {
    return NextResponse.json({ ok: false, error: "leagueId and gameweek required" }, { status: 400 });
  }
  const gameweek = Number(gwParam);
  if (!Number.isFinite(gameweek)) {
    return NextResponse.json({ ok: false, error: "gameweek must be numeric" }, { status: 400 });
  }

  // Safety: only import when the GW is "active"
  const { data: gwRow } = await supabase
    .from("liga_gameweeks")
    .select("status")
    .eq("league_id", leagueId)
    .eq("gameweek", gameweek)
    .maybeSingle();

  if (!gwRow) {
    return NextResponse.json({ ok: false, error: "gameweek not found" }, { status: 404 });
  }
  if (gwRow.status !== "active") {
    // Not active — return cached points without re-importing
    return NextResponse.json({ ok: true, skipped: true, reason: `status=${gwRow.status}` });
  }

  // Rate limit
  const now = Date.now();
  const prev = lastRun.get(leagueId) || 0;
  if (now - prev < MIN_INTERVAL_MS) {
    return NextResponse.json({ ok: true, skipped: true, reason: "rate-limited", retryInMs: MIN_INTERVAL_MS - (now - prev) });
  }
  lastRun.set(leagueId, now);

  const result = await importGameweekLive(leagueId, gameweek);
  return NextResponse.json(result);
}
