import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { processIngestEvent } from "@/lib/wm-ingest";
import {
  mapAfStatToPayload,
  makeIngestIdempotencyKey,
  isFixtureRelevant,
  type AfFixtureTeamBlock,
} from "@/lib/wm-live-ingest";
import type { WMIngestEvent } from "@/lib/wm-types";

export const runtime = "nodejs";
export const maxDuration = 300;

const AF_BASE = "https://v3.football.api-sports.io";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function afetch(path: string, apiKey: string): Promise<any> {
  const res = await fetch(`${AF_BASE}${path}`, {
    headers: { "x-apisports-key": apiKey },
    cache: "no-store",
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("retry-after") || "10", 10);
    await delay(retryAfter * 1000);
    return afetch(path, apiKey);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status} — ${path}`);
  return res.json();
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // 1. Auth
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. API key
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "FOOTBALL_API_KEY not configured" }, { status: 500 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const supabase = createServiceRoleClient();
  const now = Date.now();

  const summary: {
    fixtures_checked: number;
    fixtures_polled: number;
    events_built: number;
    events_applied: number;
    warnings: string[];
    dry_run: boolean;
  } = {
    fixtures_checked: 0,
    fixtures_polled: 0,
    events_built: 0,
    events_applied: 0,
    warnings: [],
    dry_run: dryRun,
  };

  // 3. Load all active WM tournaments
  const { data: tournaments } = await supabase
    .from("wm_tournaments")
    .select("id");

  if (!tournaments?.length) {
    return NextResponse.json({ ok: true, ...summary, message: "no tournaments" });
  }

  for (const tournament of tournaments) {
    const tournamentId = tournament.id;

    // 4. Find active gameweek for this tournament
    const { data: activeGw } = await supabase
      .from("wm_gameweeks")
      .select("gameweek")
      .eq("tournament_id", tournamentId)
      .eq("status", "active")
      .maybeSingle();

    if (!activeGw) continue;
    const gameweek = activeGw.gameweek;

    // 5. Fixtures for this GW with api_fixture_id
    const { data: fixtures } = await supabase
      .from("wm_fixtures")
      .select("id, api_fixture_id, status, kickoff")
      .eq("tournament_id", tournamentId)
      .eq("gameweek", gameweek)
      .not("api_fixture_id", "is", null);

    if (!fixtures?.length) continue;
    summary.fixtures_checked += fixtures.length;

    const relevantFixtures = fixtures.filter((f) =>
      isFixtureRelevant(f.status, f.kickoff, now),
    );

    // 6. Per-fixture: fetch player stats from API-Football + dispatch events
    for (const fixture of relevantFixtures) {
      const apiFixtureId = fixture.api_fixture_id as number;
      summary.fixtures_polled++;

      let teamBlocks: AfFixtureTeamBlock[] = [];
      try {
        await delay(1100); // stay under 10 req/min on free tier
        const json = await afetch(`/fixtures/players?fixture=${apiFixtureId}`, apiKey);
        teamBlocks = json.response ?? [];
      } catch (err: any) {
        summary.warnings.push(`api_fetch_failed:fixture:${apiFixtureId}: ${err.message}`);
        continue;
      }

      // 7. Build one event per player, dispatch via processIngestEvent
      for (const team of teamBlocks) {
        for (const playerEntry of team.players) {
          const apiPlayerId = playerEntry.player.id;
          if (!apiPlayerId) continue;

          const payload = mapAfStatToPayload(playerEntry);
          const idempotencyKey = makeIngestIdempotencyKey(apiFixtureId, apiPlayerId);

          summary.events_built++;

          if (dryRun) continue;

          const event: WMIngestEvent = {
            type: "player.stat_update",
            version: 1,
            tournament_id: tournamentId,
            gameweek,
            payload: payload as Record<string, unknown>,
            idempotency_key: idempotencyKey,
            source: "api_football",
          };

          // Process per-league: find all WM leagues for this tournament
          const { data: leagueSettings } = await supabase
            .from("wm_league_settings")
            .select("league_id")
            .eq("tournament_id", tournamentId);

          for (const ls of leagueSettings ?? []) {
            const result = await processIngestEvent(ls.league_id, event, "api_football_sync");
            summary.events_applied++;
            if (result.warnings.length) {
              summary.warnings.push(...result.warnings.map(w => `league:${ls.league_id}:${w}`));
            }
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true, ...summary });
}
