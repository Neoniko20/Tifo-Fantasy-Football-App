import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import {
  findGameweeksToImport,
  importGameweekForLeague,
  type ImportResult,
} from "@/lib/gw-import";

// Force Node.js runtime (Edge has no service-role key support)
export const runtime = "nodejs";

// Vercel Cron may take longer than the default 10s
export const maxDuration = 300; // 5 minutes

export async function GET(req: NextRequest) {
  // 1. Authenticate the cron caller
  const auth = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  if (auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Service-role client for audit log writes
  const supabase = createServiceRoleClient();

  // 3. Find pending GWs
  const todayISO = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const pending = await findGameweeksToImport(todayISO);

  const results: Array<ImportResult & { audit_logged?: boolean }> = [];

  // 4. Import each one (per-league try/catch so one failure doesn't kill the whole run)
  for (const p of pending) {
    try {
      const result = await importGameweekForLeague(p.league_id, p.gameweek);

      // Audit log entry
      await supabase.from("liga_admin_audit_log").insert({
        league_id:   p.league_id,
        actor_id:    null,
        actor_label: "cron",
        action:      result.ok ? "gw_imported" : "gw_import_failed",
        gameweek:    p.gameweek,
        metadata: {
          api_calls_used:   result.apiCallsUsed,
          players_imported: result.playersImported,
          message:          result.message,
          error:            result.error,
        },
      });

      results.push({ ...result, audit_logged: true });
    } catch (err: any) {
      // Catch-all: log error and continue with next GW
      console.error(
        `cron import failed for league ${p.league_id} GW${p.gameweek}:`,
        err,
      );

      try {
        await supabase.from("liga_admin_audit_log").insert({
          league_id:   p.league_id,
          actor_id:    null,
          actor_label: "cron",
          action:      "gw_import_failed",
          gameweek:    p.gameweek,
          metadata:    { error: err?.message || String(err) },
        });
      } catch {
        // Ignore audit log failures
      }

      results.push({
        ok: false,
        leagueId:        p.league_id,
        gameweek:        p.gameweek,
        apiCallsUsed:    0,
        playersImported: 0,
        message:         `Import failed: ${err?.message || err}`,
        error:           "exception",
      });
    }
  }

  // 5. Top-level run audit entry
  await supabase.from("liga_admin_audit_log").insert({
    league_id:   null,
    actor_id:    null,
    actor_label: "cron",
    action:      "cron_run",
    gameweek:    null,
    metadata: {
      pending_count: pending.length,
      success_count: results.filter((r) => r.ok).length,
      failure_count: results.filter((r) => !r.ok).length,
      today:         todayISO,
    },
  });

  return NextResponse.json({
    ok:      true,
    today:   todayISO,
    pending: pending.length,
    results,
  });
}
