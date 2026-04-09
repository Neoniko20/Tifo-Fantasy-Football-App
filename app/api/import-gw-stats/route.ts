import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { importGameweekForLeague } from "@/lib/gw-import";

export async function POST(req: NextRequest) {
  try {
    const { leagueId, gameweek } = await req.json();
    if (!leagueId || !gameweek) {
      return NextResponse.json(
        { error: "leagueId und gameweek erforderlich" },
        { status: 400 },
      );
    }

    const apiKey = process.env.NEXT_PUBLIC_FOOTBALL_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "API-Key fehlt" }, { status: 500 });
    }

    // Behavior matches the previous inline implementation:
    // prefer SERVICE_ROLE_KEY if present, fall back to ANON_KEY.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const result = await importGameweekForLeague(
      supabase,
      leagueId,
      gameweek,
      apiKey,
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      apiCallsUsed:    result.apiCallsUsed,
      playersImported: result.playersImported,
      message:         result.message,
    });
  } catch (err: any) {
    console.error("import-gw-stats error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
