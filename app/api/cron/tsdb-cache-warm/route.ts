import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { fetchTsdbPlayer, upsertCached, getCached, isStale } from "@/lib/tsdb-cache";

const supabaseServer = createServiceRoleClient();

// Cap per-run work so the serverless function doesn't exceed its 300s budget.
const MAX_PLAYERS_PER_RUN = 400;
const DELAY_MS            = 500;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { data: players } = await supabaseServer
    .from("players")
    .select("id, name, team_name")
    .order("fpts", { ascending: false })
    .limit(MAX_PLAYERS_PER_RUN * 2);

  let warmed  = 0;
  let skipped = 0;
  let errors  = 0;

  for (const p of (players || [])) {
    const cached = await getCached(p.name, p.team_name || "");
    if (cached && !isStale(cached)) { skipped++; continue; }

    try {
      const fresh = await fetchTsdbPlayer(p.name, p.team_name || "");
      await upsertCached({ ...fresh, player_id_fk: p.id });
      warmed++;
      await sleep(DELAY_MS);
    } catch {
      errors++;
    }

    if (warmed >= MAX_PLAYERS_PER_RUN) break;
  }

  await supabaseServer.from("liga_admin_audit_log").insert({
    league_id: null,
    actor_id: null,
    actor_label: "cron",
    action: "tsdb_cache_warm",
    metadata: { warmed, skipped, errors },
  });

  return NextResponse.json({ ok: true, warmed, skipped, errors });
}
