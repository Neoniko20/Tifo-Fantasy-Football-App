import { NextRequest, NextResponse } from "next/server";
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

    const result = await importGameweekForLeague(leagueId, gameweek);

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
