import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import type { WMFixtureStatus, WMStage } from "@/lib/wm-types";

const VALID_STAGES   = new Set<WMStage>(["group","round_of_32","round_of_16","quarter","semi","final"]);
const VALID_STATUSES = new Set<WMFixtureStatus>(["scheduled","live","finished"]);

type FixtureInput = {
  gameweek:        number;
  stage:           string;
  home_nation_id:  string;
  away_nation_id:  string;
  kickoff:         string;
  stadium?:        string | null;
  city?:           string | null;
  status?:         string;
  home_score?:     number | null;
  away_score?:     number | null;
  api_fixture_id?: number | null;
};

export async function POST(req: NextRequest) {
  const supabase = createServiceRoleClient();

  let tournament_id: string;
  let fixtures: FixtureInput[];
  try {
    ({ tournament_id, fixtures } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!tournament_id) {
    return NextResponse.json({ ok: false, error: "tournament_id required" }, { status: 400 });
  }
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    return NextResponse.json({ ok: false, error: "fixtures array required" }, { status: 400 });
  }

  // Verify tournament exists
  const { data: tournament } = await supabase
    .from("wm_tournaments")
    .select("id")
    .eq("id", tournament_id)
    .maybeSingle();
  if (!tournament) {
    return NextResponse.json({ ok: false, error: "tournament not found" }, { status: 404 });
  }

  // Load all nation IDs for this tournament for validation
  const { data: nations } = await supabase
    .from("wm_nations")
    .select("id")
    .eq("tournament_id", tournament_id);
  const nationIds = new Set((nations || []).map(n => n.id));

  let inserted = 0;
  let updated  = 0;
  const errors: string[] = [];

  for (let i = 0; i < fixtures.length; i++) {
    const f   = fixtures[i];
    const row = i + 1;

    if (!f.gameweek || typeof f.gameweek !== "number" || f.gameweek < 1) {
      errors.push(`row ${row}: gameweek must be a positive number`); continue;
    }
    if (!VALID_STAGES.has(f.stage as WMStage)) {
      errors.push(`row ${row}: invalid stage "${f.stage}"`); continue;
    }
    if (!f.home_nation_id || !nationIds.has(f.home_nation_id)) {
      errors.push(`row ${row}: home_nation_id not found in tournament`); continue;
    }
    if (!f.away_nation_id || !nationIds.has(f.away_nation_id)) {
      errors.push(`row ${row}: away_nation_id not found in tournament`); continue;
    }
    if (f.home_nation_id === f.away_nation_id) {
      errors.push(`row ${row}: home and away nation cannot be the same`); continue;
    }
    if (!f.kickoff || isNaN(Date.parse(f.kickoff))) {
      errors.push(`row ${row}: kickoff must be a valid ISO timestamp`); continue;
    }
    const status = (f.status ?? "scheduled") as WMFixtureStatus;
    if (!VALID_STATUSES.has(status)) {
      errors.push(`row ${row}: invalid status "${f.status}"`); continue;
    }

    const record = {
      tournament_id,
      gameweek:       f.gameweek,
      stage:          f.stage,
      home_nation_id: f.home_nation_id,
      away_nation_id: f.away_nation_id,
      kickoff:        f.kickoff,
      stadium:        f.stadium   ?? null,
      city:           f.city      ?? null,
      status,
      home_score:     f.home_score     ?? null,
      away_score:     f.away_score     ?? null,
      api_fixture_id: f.api_fixture_id ?? null,
    };

    if (f.api_fixture_id != null) {
      // Upsert by api_fixture_id — check first to distinguish insert vs update
      const { data: existing } = await supabase
        .from("wm_fixtures")
        .select("id")
        .eq("api_fixture_id", f.api_fixture_id)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("wm_fixtures")
          .update(record)
          .eq("api_fixture_id", f.api_fixture_id);
        if (error) { errors.push(`row ${row}: ${error.message}`); continue; }
        updated++;
      } else {
        const { error } = await supabase.from("wm_fixtures").insert(record);
        if (error) { errors.push(`row ${row}: ${error.message}`); continue; }
        inserted++;
      }
    } else {
      // Upsert by composite key (tournament_id, gameweek, home_nation_id, away_nation_id)
      const { error } = await supabase
        .from("wm_fixtures")
        .upsert(record, { onConflict: "tournament_id,gameweek,home_nation_id,away_nation_id" });
      if (error) { errors.push(`row ${row}: ${error.message}`); continue; }
      inserted++;
    }
  }

  return NextResponse.json({ ok: true, inserted, updated, errors });
}
