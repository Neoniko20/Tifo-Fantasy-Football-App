/**
 * TIFO — WM Import Status Report
 *
 * Prints a diagnostic summary of the current WM 2026 import state.
 * Read-only — no DB writes.
 *
 * Usage:
 *   node --experimental-strip-types scripts/wm-import-status.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ── Load .env.local ────────────────────────────────────────────────────────
function loadDotEnv(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && val && !process.env[key]) process.env[key] = val;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  loadDotEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  console.log("\nTIFO — WM 2026 Import Status");
  console.log("─".repeat(50));

  // ── wm_nations ────────────────────────────────────────────────────────
  const [
    { count: nationsTotal },
    { count: nationsWithId },
    { count: nationsWithoutId },
  ] = await Promise.all([
    supabase.from("wm_nations").select("*", { count: "exact", head: true }),
    supabase.from("wm_nations").select("*", { count: "exact", head: true }).not("api_team_id", "is", null),
    supabase.from("wm_nations").select("*", { count: "exact", head: true }).is("api_team_id", null),
  ]);

  console.log("\n📍 wm_nations");
  console.log(`   Total:                  ${nationsTotal ?? "—"}`);
  console.log(`   With api_team_id:       ${nationsWithId ?? "—"}`);
  console.log(`   Without api_team_id:    ${nationsWithoutId ?? "—"}`);

  // ── wm_fixtures ───────────────────────────────────────────────────────
  const [
    { count: fixturesTotal },
    { count: fixturesWithId },
    { count: fixturesWithoutId },
  ] = await Promise.all([
    supabase.from("wm_fixtures").select("*", { count: "exact", head: true }),
    supabase.from("wm_fixtures").select("*", { count: "exact", head: true }).not("api_fixture_id", "is", null),
    supabase.from("wm_fixtures").select("*", { count: "exact", head: true }).is("api_fixture_id", null),
  ]);

  console.log("\n📅 wm_fixtures");
  console.log(`   Total:                  ${fixturesTotal ?? "—"}`);
  console.log(`   With api_fixture_id:    ${fixturesWithId ?? "—"}`);
  console.log(`   Without api_fixture_id: ${fixturesWithoutId ?? "—"}`);

  // ── players ───────────────────────────────────────────────────────────
  const [
    { count: playersWithId },
    { count: playersTest },
  ] = await Promise.all([
    supabase.from("players").select("*", { count: "exact", head: true }).not("api_football_player_id", "is", null),
    supabase.from("players").select("*", { count: "exact", head: true }).eq("is_test_player", true),
  ]);

  console.log("\n👤 players");
  console.log(`   With api_football_player_id:  ${playersWithId ?? "—"}  ${playersWithId === 0 ? "(squads not yet available)" : "✅"}`);
  console.log(`   Test players (is_test_player): ${playersTest ?? "—"}`);

  // ── Summary ───────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(50));

  const teamsReady   = (nationsWithId ?? 0) >= 48;
  const fixturesReady = (fixturesWithId ?? 0) >= 72;
  const playersReady = (playersWithId ?? 0) > 0;

  console.log("\n🚦 Import readiness:");
  console.log(`   Teams (48 expected):    ${teamsReady    ? "✅" : "⚠️ "} ${nationsWithId ?? 0} imported`);
  console.log(`   Fixtures (72 expected): ${fixturesReady ? "✅" : "⚠️ "} ${fixturesWithId ?? 0} imported`);
  console.log(`   Players:                ${playersReady  ? "✅" : "⏳"} ${playersWithId ?? 0} imported${!playersReady ? " — run import again when API-Football exposes squads" : ""}`);

  if (!playersReady) {
    console.log("\n💡 To re-run import (teams + fixtures from cache, players fetched fresh):");
    console.log("   node --experimental-strip-types scripts/ingest-wm-2026-api-football.ts");
  }

  console.log();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
