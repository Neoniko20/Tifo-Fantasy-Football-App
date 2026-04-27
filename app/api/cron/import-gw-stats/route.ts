import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import {
  findGameweeksToImport,
  findGameweeksToStart,
  importGameweekForLeague,
  type ImportResult,
} from "@/lib/gw-import";
import { sendPushToLeague } from "@/lib/push";
import { generateH2HPairings } from "@/lib/h2h-matchups";
import { processWaivers } from "@/lib/waiver-processor";

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

  // 3. Auto-start: flip upcoming GWs whose window has begun
  const todayISO = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const toStart  = await findGameweeksToStart(todayISO);
  let startedCount = 0;

  for (const gw of toStart) {
    try {
      await supabase
        .from("liga_gameweeks")
        .update({ status: "active" })
        .eq("id", gw.id);

      await supabase.from("liga_admin_audit_log").insert({
        league_id:   gw.league_id,
        actor_id:    null,
        actor_label: "cron",
        action:      "gw_started",
        gameweek:    gw.gameweek,
        metadata:    { auto_start: true },
      });

      sendPushToLeague(gw.league_id, "gw_started", {
        title: `▶ Spieltag ${gw.gameweek} gestartet`,
        body:  "Die Spieltag-Wertung läuft!",
        link:  "/",
      }).catch((e) =>
        console.warn(`push gw_started failed for league ${gw.league_id}:`, e),
      );

      // Auto-generate H2H pairings (no-op if not H2H or already exists)
      generateH2HPairings(gw.league_id, gw.gameweek).catch((e) =>
        console.warn(`H2H pairing failed for league ${gw.league_id} GW${gw.gameweek}:`, e),
      );

      // Auto-open waiver window if waiver_enabled and GW >= waiver_mode_starts_gameweek
      try {
        const { data: ls } = await supabase
          .from("liga_settings")
          .select("waiver_enabled, waiver_mode_starts_gameweek")
          .eq("league_id", gw.league_id)
          .maybeSingle();

        if (ls?.waiver_enabled) {
          const waiverStartGW = ls.waiver_mode_starts_gameweek ?? 1;
          if (gw.gameweek >= waiverStartGW) {
            await supabase
              .from("liga_gameweeks")
              .update({ waiver_window_open: true })
              .eq("id", gw.id);
          }
        }
      } catch (e) {
        console.warn(`waiver window open failed for league ${gw.league_id}:`, e);
      }

      startedCount++;
    } catch (err: any) {
      console.error(
        `auto-start failed for league ${gw.league_id} GW${gw.gameweek}:`,
        err,
      );
    }
  }

  // 4. Find GWs past their end_date → import + finish
  const pending = await findGameweeksToImport(todayISO);

  const results: Array<ImportResult & { audit_logged?: boolean }> = [];

  // 5. Import each one (per-league try/catch so one failure doesn't kill the whole run)
  for (const p of pending) {
    try {
      const result = await importGameweekForLeague(p.league_id, p.gameweek);

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

      if (result.ok) {
        sendPushToLeague(p.league_id, "gw_finished", {
          title: `■ Spieltag ${p.gameweek} beendet`,
          body:  "Der Spieltag ist abgeschlossen. Punkte wurden berechnet!",
          link:  "/",
        }).catch((e) =>
          console.warn(`push gw_finished failed for league ${p.league_id}:`, e),
        );

        // Auto-close waiver window + process claims if waiver_enabled
        try {
          const { data: ls } = await supabase
            .from("liga_settings")
            .select("waiver_enabled")
            .eq("league_id", p.league_id)
            .maybeSingle();

          if (ls?.waiver_enabled) {
            await supabase
              .from("liga_gameweeks")
              .update({ waiver_window_open: false })
              .eq("league_id", p.league_id)
              .eq("gameweek", p.gameweek);

            await processWaivers(p.league_id, p.gameweek);
          }
        } catch (e) {
          console.warn(`auto waiver processing failed for league ${p.league_id} GW${p.gameweek}:`, e);
        }
      }

      results.push({ ...result, audit_logged: true });
    } catch (err: any) {
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
        // ignore audit failures
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

  // 6. Top-level run audit entry
  await supabase.from("liga_admin_audit_log").insert({
    league_id:   null,
    actor_id:    null,
    actor_label: "cron",
    action:      "cron_run",
    gameweek:    null,
    metadata: {
      started_count: startedCount,
      pending_count: pending.length,
      success_count: results.filter((r) => r.ok).length,
      failure_count: results.filter((r) => !r.ok).length,
      today:         todayISO,
    },
  });

  return NextResponse.json({
    ok:      true,
    today:   todayISO,
    started: startedCount,
    pending: pending.length,
    results,
  });
}
