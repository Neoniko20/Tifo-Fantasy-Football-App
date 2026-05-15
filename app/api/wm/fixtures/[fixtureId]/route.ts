import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import type { WMFixtureStatus } from "@/lib/wm-types";

const VALID_STATUSES = new Set<WMFixtureStatus>(["scheduled", "live", "finished"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ fixtureId: string }> },
) {
  const { fixtureId } = await params;

  // ── 1. Auth ───────────────────────────────────────────────────────
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
  );
  const { data: { user } } = await anonClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Nicht eingeloggt" }, { status: 401 });
  }

  // ── 2. Parse body ─────────────────────────────────────────────────
  let body: {
    status?: string;
    home_score?: number | null;
    away_score?: number | null;
    penalties_home?: number | null;
    penalties_away?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ungültiger JSON-Body" }, { status: 400 });
  }

  // ── 3. Validate fields ────────────────────────────────────────────
  const { status, home_score, away_score, penalties_home, penalties_away } = body;

  if (status !== undefined && !VALID_STATUSES.has(status as WMFixtureStatus)) {
    return NextResponse.json({ ok: false, error: `Ungültiger Status "${status}"` }, { status: 400 });
  }
  if (status === "finished" && (home_score == null || away_score == null)) {
    return NextResponse.json({ ok: false, error: "home_score und away_score sind Pflicht bei status=finished" }, { status: 400 });
  }
  for (const [key, val] of [["home_score", home_score], ["away_score", away_score], ["penalties_home", penalties_home], ["penalties_away", penalties_away]] as [string, unknown][]) {
    if (val != null && (typeof val !== "number" || !Number.isInteger(val) || (val as number) < 0)) {
      return NextResponse.json({ ok: false, error: `${key} muss eine ganze Zahl >= 0 sein` }, { status: 400 });
    }
  }

  const supabase = createServiceRoleClient();

  // ── 4. Load fixture → get tournament_id ──────────────────────────
  const { data: fixture } = await supabase
    .from("wm_fixtures")
    .select("id, tournament_id")
    .eq("id", fixtureId)
    .maybeSingle();

  if (!fixture) {
    return NextResponse.json({ ok: false, error: "Fixture nicht gefunden" }, { status: 404 });
  }

  // ── 5. Owner check: fixture.tournament_id → league → owner ───────
  const { data: leagueSettings } = await supabase
    .from("wm_league_settings")
    .select("league_id")
    .eq("tournament_id", fixture.tournament_id)
    .limit(20);

  const leagueIds = (leagueSettings || []).map((s: { league_id: string }) => s.league_id);
  if (leagueIds.length === 0) {
    return NextResponse.json({ ok: false, error: "Kein Zugriff" }, { status: 403 });
  }

  const { data: ownedLeague } = await supabase
    .from("leagues")
    .select("id")
    .in("id", leagueIds)
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!ownedLeague) {
    return NextResponse.json({ ok: false, error: "Kein Zugriff — nur Liga-Owner" }, { status: 403 });
  }

  // ── 6. Build update payload ───────────────────────────────────────
  const update: Record<string, unknown> = {};
  if (status           !== undefined) update.status          = status;
  if (home_score       !== undefined) update.home_score       = home_score;
  if (away_score       !== undefined) update.away_score       = away_score;
  if (penalties_home   !== undefined) update.penalties_home   = penalties_home;
  if (penalties_away   !== undefined) update.penalties_away   = penalties_away;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: "Keine Felder zum Aktualisieren" }, { status: 400 });
  }

  // ── 7. Write to DB ────────────────────────────────────────────────
  const { data: updated, error } = await supabase
    .from("wm_fixtures")
    .update(update)
    .eq("id", fixtureId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, fixture: updated });
}
