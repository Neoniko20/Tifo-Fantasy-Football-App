// app/api/wm/[id]/simulate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { processIngestEvent } from "@/lib/wm-ingest";
import {
  createRng, generateScore, generatePlayerStats, buildFixtureEvents,
  type SimFixture,
} from "@/lib/wm-simulator";
import type { WMIngestEvent } from "@/lib/wm-types";

interface SimulateRequest {
  scope: "fixture" | "gameweek" | "tournament" | "reset";
  fixture_id?: string;
  gameweek?: number;
  seed?: number;
  dry_run?: boolean;
  force?: boolean;
  reset_scope?: "simulated_only" | "gameweek" | "tournament";
  typed_confirmation?: string; // required for reset_scope: "tournament"
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;

  // ── Auth + Ownership ──────────────────────────────────────────────────────
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: { user } } = await anonClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });

  const supabase = createServiceRoleClient();
  const { data: league } = await supabase
    .from("leagues").select("owner_id").eq("id", leagueId).single();
  if (!league) return NextResponse.json({ error: "Liga nicht gefunden" }, { status: 404 });
  if (league.owner_id !== user.id)
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: SimulateRequest;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Ungültiger Request-Body" }, { status: 400 }); }

  // ── Reset scope ───────────────────────────────────────────────────────────
  if (body.scope === "reset") {
    return handleReset(body, leagueId, supabase);
  }

  // ── Load WM settings ──────────────────────────────────────────────────────
  const { data: wmSettings } = await supabase
    .from("wm_league_settings").select("tournament_id").eq("league_id", leagueId).maybeSingle();
  if (!wmSettings?.tournament_id)
    return NextResponse.json({ error: "Kein WM-Turnier für diese Liga" }, { status: 400 });
  const tournamentId = wmSettings.tournament_id;

  // ── Load fixtures ─────────────────────────────────────────────────────────
  let fixtures: any[] | null = null;

  if (body.scope === "fixture" && body.fixture_id) {
    const { data } = await supabase
      .from("wm_fixtures")
      .select("id, gameweek, stage, home_nation_id, away_nation_id, status")
      .eq("tournament_id", tournamentId)
      .eq("id", body.fixture_id);
    fixtures = data;
  } else if (body.scope === "gameweek" && body.gameweek) {
    const { data } = await supabase
      .from("wm_fixtures")
      .select("id, gameweek, stage, home_nation_id, away_nation_id, status")
      .eq("tournament_id", tournamentId)
      .eq("gameweek", body.gameweek);
    fixtures = data;
  } else {
    // scope: "tournament" → all fixtures
    const { data } = await supabase
      .from("wm_fixtures")
      .select("id, gameweek, stage, home_nation_id, away_nation_id, status")
      .eq("tournament_id", tournamentId);
    fixtures = data;
  }

  if (!fixtures?.length)
    return NextResponse.json({ ok: true, message: "Keine Fixtures gefunden", events_preview: [] });

  // ── Source protection (skip fixtures with admin/api_football events) ──────
  const affectedFixtureIds = fixtures.map((f: any) => f.id);
  let protectedFixtures: string[] = [];

  if (!body.force) {
    const { data: protectedLogs } = await supabase
      .from("wm_event_log")
      .select("related_fixture_id")
      .in("related_fixture_id", affectedFixtureIds)
      .in("source", ["admin", "api_football"]);
    protectedFixtures = [...new Set((protectedLogs || []).map((l: any) => l.related_fixture_id))];
  }

  const rng = createRng(body.seed);
  const idempotencyRun = `sim-${Date.now()}-${body.seed ?? "rnd"}`;

  // ── Load squad players once (outside loop to avoid N+1) ──────────────────
  const { data: squadPlayers } = await supabase
    .from("wm_squad_players")
    .select("player_id")
    .eq("league_id", leagueId);
  const allPlayerIds = (squadPlayers || []).map((p: any) => p.player_id as number);

  // ── Build all events ──────────────────────────────────────────────────────
  const allEvents: WMIngestEvent[] = [];
  const skippedFixtures: string[] = [];
  const warnings: string[] = [];

  for (const fixture of fixtures as SimFixture[]) {
    if (protectedFixtures.includes(fixture.id)) {
      skippedFixtures.push(fixture.id);
      warnings.push(`fixture ${fixture.id} has admin/api_football events — skipped (use force:true to override)`);
      continue;
    }

    const score = generateScore(fixture.stage as any, rng);

    // Get players from home/away nation
    const { data: nationPlayers } = await supabase
      .from("wm_player_nations")
      .select("player_id")
      .eq("tournament_id", tournamentId)
      .in("nation_id", [fixture.home_nation_id, fixture.away_nation_id])
      .in("player_id", allPlayerIds.length > 0 ? allPlayerIds : [-1]);

    const playerIds = (nationPlayers || []).map((p: any) => p.player_id as number);
    const stats = generatePlayerStats(playerIds, score, rng);

    const events = buildFixtureEvents(fixture, score, stats, tournamentId, idempotencyRun);
    allEvents.push(...events);
  }

  // ── Dry run: return preview without writing ────────────────────────────────
  if (body.dry_run) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      events_preview: allEvents,
      affected_fixtures: affectedFixtureIds.filter((id: string) => !skippedFixtures.includes(id)),
      skipped_fixtures: skippedFixtures,
      warnings,
    });
  }

  // ── Execute: send each event through the Ingest Layer ─────────────────────
  const results: Array<{ event_type: string; ok: boolean; error?: string }> = [];

  for (const event of allEvents) {
    const result = await processIngestEvent(leagueId, event, "simulator");
    results.push({ event_type: event.type, ok: result.ok, error: result.error });
    if (!result.ok) warnings.push(`event ${event.type} failed: ${result.error}`);
  }

  return NextResponse.json({
    ok: true,
    executed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    skipped_fixtures: skippedFixtures,
    warnings,
  });
}

// ── Reset handler ─────────────────────────────────────────────────────────────

async function handleReset(
  body: SimulateRequest,
  leagueId: string,
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  const resetScope = body.reset_scope ?? "simulated_only";

  // Tournament reset requires typed confirmation
  if (resetScope === "tournament") {
    if (body.typed_confirmation !== "RESET") {
      return NextResponse.json(
        { error: 'typed_confirmation "RESET" ist Pflicht für reset_scope: "tournament"' },
        { status: 400 },
      );
    }
    // Also check tournament is not locked (status: finished)
    const { data: settings } = await supabase
      .from("wm_league_settings").select("tournament_id").eq("league_id", leagueId).maybeSingle();
    if (settings?.tournament_id) {
      const { data: tournament } = await supabase
        .from("wm_tournaments").select("status").eq("id", settings.tournament_id).maybeSingle();
      if (tournament?.status === "finished") {
        return NextResponse.json(
          { error: "Turnier ist abgeschlossen — Reset nicht möglich" },
          { status: 409 },
        );
      }
    }
  }

  // Delete simulated event log entries
  let deleteQuery = supabase.from("wm_event_log").delete().eq("league_id", leagueId);
  if (resetScope === "simulated_only") {
    deleteQuery = deleteQuery.eq("source", "simulator");
  } else if (resetScope === "gameweek" && body.gameweek) {
    deleteQuery = deleteQuery.eq("gameweek", body.gameweek).eq("source", "simulator");
  } else if (resetScope === "tournament") {
    deleteQuery = deleteQuery.eq("source", "simulator");
  }

  const { error } = await deleteQuery;
  if (error) return NextResponse.json({ error: "Reset fehlgeschlagen: " + error.message }, { status: 500 });

  return NextResponse.json({ ok: true, reset_scope: resetScope });
}
