/**
 * TIFO — WM Matchday Readiness Audit
 *
 * Read-only Audit-Script: prüft, ob alle technischen Voraussetzungen
 * für einen echten WM-Spieltag vorhanden sind.
 *
 * Kein DB-Write, kein Side-Effect.
 *
 * Status-Levels:
 *   PASS — technische Prüfung erfolgreich
 *   WARN — Daten fehlen oder Feature noch nicht implementiert (kein Crash)
 *   FAIL — Query bricht, Schema fehlt, unerwarteter harter Fehler
 *
 * Bekannte Gaps werden am Ende als strukturierte Warnings ausgegeben.
 *
 * Verwendung:
 *   node --experimental-strip-types scripts/wm-matchday-readiness.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ── Env ─────────────────────────────────────────────────────────────────────

function loadDotEnv(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (k && v && !process.env[k]) process.env[k] = v;
  }
}

// ── Reporter ─────────────────────────────────────────────────────────────────

let passCount = 0;
let warnCount = 0;
let failCount = 0;
const failures: string[] = [];
const warnings_list: string[] = [];

function pass(label: string) {
  console.log(`  ✅ PASS  ${label}`);
  passCount++;
}

function warn(label: string, detail?: string) {
  const msg = detail ? `${label} — ${detail}` : label;
  console.log(`  ⚠️  WARN  ${msg}`);
  warnCount++;
  warnings_list.push(msg);
}

function fail(label: string, detail?: string) {
  const msg = detail ? `${label} — ${detail}` : label;
  console.log(`  ❌ FAIL  ${msg}`);
  failCount++;
  failures.push(msg);
}

function header(n: number | string, title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Block ${n}: ${title}`);
  console.log("─".repeat(60));
}

function note(msg: string) {
  console.log(`     ℹ️   ${msg}`);
}

// ── Audit-Blöcke ─────────────────────────────────────────────────────────────

async function checkTournament(sb: SupabaseClient): Promise<string | null> {
  header(1, "wm_tournaments");
  try {
    const { data, error } = await sb.from("wm_tournaments").select("id, name, status").limit(5);
    if (error) throw error;
    if (!data || data.length === 0) {
      warn("wm_tournaments erreichbar, aber kein Turnier vorhanden");
      return null;
    }
    pass(`wm_tournaments erreichbar (${data.length} Turnier/e gefunden)`);
    for (const t of data) note(`${t.name} → status: ${t.status}`);
    const active = data.find((t) => t.status === "active");
    if (!active) {
      warn("Kein Turnier mit status='active' gefunden", "GW-Start/Finish benötigt aktives Turnier");
    } else {
      pass(`Aktives Turnier: ${active.name} (${active.id})`);
    }
    return data[0].id;
  } catch (e: any) {
    fail("wm_tournaments nicht erreichbar", e?.message);
    return null;
  }
}

async function checkGameweeks(sb: SupabaseClient, tournamentId: string | null) {
  header(2, "wm_gameweeks");
  try {
    const q = sb.from("wm_gameweeks").select("gameweek, phase, status, label").order("gameweek");
    if (tournamentId) q.eq("tournament_id", tournamentId);
    const { data, error } = await q.limit(10);
    if (error) throw error;
    if (!data || data.length === 0) {
      warn("wm_gameweeks erreichbar, aber keine Gameweeks vorhanden");
      return;
    }
    pass(`wm_gameweeks erreichbar (${data.length} GW/s)`);
    const validPhases = ["group", "round_of_32", "round_of_16", "quarter", "semi", "final"];
    const validStatuses = ["upcoming", "active", "finished"];
    let phaseOk = true;
    let statusOk = true;
    for (const gw of data) {
      if (!validPhases.includes(gw.phase)) phaseOk = false;
      if (!validStatuses.includes(gw.status)) statusOk = false;
    }
    if (phaseOk) pass("Alle GW-Phasen plausibel");
    else warn("Unbekannte GW-Phase gefunden", `Erwartet: ${validPhases.join(", ")}`);
    if (statusOk) pass("Alle GW-Status plausibel");
    else warn("Unbekannter GW-Status gefunden", `Erwartet: ${validStatuses.join(", ")}`);
    const active = data.filter((g) => g.status === "active");
    if (active.length > 0) pass(`Aktiver GW: GW${active[0].gameweek} (${active[0].label})`);
    else warn("Kein aktiver Gameweek", "Lineup-Lock + Live-Center benötigen aktiven GW");
  } catch (e: any) {
    fail("wm_gameweeks nicht erreichbar", e?.message);
  }
}

async function checkFixtures(sb: SupabaseClient, tournamentId: string | null) {
  header(3, "wm_fixtures");
  try {
    const q = sb.from("wm_fixtures").select("id, gameweek, stage, status, home_score, away_score").order("gameweek").limit(20);
    if (tournamentId) q.eq("tournament_id", tournamentId);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) {
      warn("wm_fixtures erreichbar, aber keine Fixtures vorhanden", "Fixtures müssen vor GW-Start importiert werden");
      return;
    }
    pass(`wm_fixtures erreichbar (${data.length} Fixture/s gefunden)`);
    const gw1 = data.filter((f) => f.gameweek === 1);
    if (gw1.length > 0) pass(`GW1-Fixtures vorhanden (${gw1.length} Spiele)`);
    else warn("Keine GW1-Fixtures gefunden");
    const liveOrFinished = data.filter((f) => f.status === "live" || f.status === "finished");
    if (liveOrFinished.length > 0) {
      pass(`${liveOrFinished.length} Fixture/s live oder abgeschlossen`);
    } else {
      note("Alle Fixtures noch im Status 'scheduled' — erwartet vor Turnierstart");
    }
  } catch (e: any) {
    fail("wm_fixtures nicht erreichbar", e?.message);
  }
}

async function checkNations(sb: SupabaseClient, tournamentId: string | null) {
  header(4, "wm_nations");
  try {
    const q = sb.from("wm_nations").select("id, name, code, eliminated_after_gameweek, group_letter").limit(60);
    if (tournamentId) q.eq("tournament_id", tournamentId);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) {
      warn("wm_nations erreichbar, aber keine Nationen vorhanden");
      return;
    }
    pass(`wm_nations erreichbar (${data.length} Nationen)`);
    const invalidElim = data.filter(
      (n) => n.eliminated_after_gameweek !== null &&
        (n.eliminated_after_gameweek < 1 || n.eliminated_after_gameweek > 8),
    );
    if (invalidElim.length === 0) pass("eliminated_after_gameweek-Werte alle NULL oder 1–8");
    else fail(`${invalidElim.length} Nation/en mit ungültigem eliminated_after_gameweek`, invalidElim.map((n) => n.name).join(", "));
    const withGroup = data.filter((n) => n.group_letter);
    if (withGroup.length > 0) pass(`${withGroup.length} Nationen mit group_letter`);
    else warn("Keine Nationen mit group_letter", "Gruppenphase-Darstellung nicht möglich");
  } catch (e: any) {
    fail("wm_nations nicht erreichbar", e?.message);
  }
}

async function checkLeagueSettings(sb: SupabaseClient): Promise<string | null> {
  header(5, "wm_league_settings + scoring_rules");
  try {
    const { data, error } = await sb.from("wm_league_settings").select("league_id, bench_size, squad_size, scoring_rules, position_limits").limit(5);
    if (error) throw error;
    if (!data || data.length === 0) {
      warn("wm_league_settings erreichbar, aber keine Liga-Settings vorhanden");
      return null;
    }
    pass(`wm_league_settings erreichbar (${data.length} Liga/s)`);
    const withRules = data.filter((s) => s.scoring_rules !== null);
    if (withRules.length > 0) pass(`${withRules.length} Liga/s mit custom scoring_rules`);
    else note("Keine custom scoring_rules → DEFAULT_SCORING_RULES wird in wm-points.ts verwendet (erwartet OK)");
    const withLimits = data.filter((s) => s.position_limits !== null);
    if (withLimits.length > 0) pass("position_limits vorhanden");
    else warn("position_limits fehlen", "Lineup-Validierung nutzt Fallback-Werte");
    return data[0].league_id;
  } catch (e: any) {
    fail("wm_league_settings nicht erreichbar", e?.message);
    return null;
  }
}

async function checkLineups(sb: SupabaseClient, leagueId: string | null) {
  header(6, "team_lineups");
  try {
    const q = sb.from("team_lineups").select("id, team_id, gameweek, formation, starting_xi, bench, captain_id, vice_captain_id, locked").limit(10);
    if (leagueId) {
      // team_lineups hat kein league_id — Abfrage ohne Filter ist OK
    }
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) {
      warn("team_lineups erreichbar, aber keine Lineups gespeichert", "Kein Team hat bisher ein Lineup abgegeben");
      return;
    }
    pass(`team_lineups erreichbar (${data.length} Lineup/s gefunden)`);

    let xiOk = 0, benchOk = 0, captainSet = 0;
    for (const lineup of data) {
      if (Array.isArray(lineup.starting_xi)) xiOk++;
      if (Array.isArray(lineup.bench)) benchOk++;
      if (lineup.captain_id) captainSet++;
    }
    if (xiOk === data.length) pass("starting_xi ist überall ein Array");
    else warn(`${data.length - xiOk} Lineup/s mit ungültigem starting_xi (nicht Array)`);

    if (benchOk === data.length) pass("bench ist überall ein Array");
    else warn(`${data.length - benchOk} Lineup/s mit ungültigem bench (nicht Array)`);

    if (captainSet === data.length) pass("captain_id ist überall gesetzt");
    else warn(`${data.length - captainSet} Lineup/s ohne captain_id gesetzt`);

    const locked = data.filter((l) => l.locked);
    note(`${locked.length} von ${data.length} Lineup/s gesperrt (locked=true)`);

    // Captain → wm_squad_players cross-check (nur für erstes produktives Lineup)
    // Test-Spieler (IDs 90001–90120) sind E2E-Testdaten und werden als WARN behandelt.
    const TEST_ID_MIN = 90001;
    const TEST_ID_MAX = 90120;
    const productiveLineups = data.filter(
      (l) => l.captain_id && (l.captain_id < TEST_ID_MIN || l.captain_id > TEST_ID_MAX),
    );
    const testLineups = data.filter(
      (l) => l.captain_id >= TEST_ID_MIN && l.captain_id <= TEST_ID_MAX,
    );

    if (testLineups.length > 0) {
      warn(
        `${testLineups.length} Lineup/s mit Test-captain_id (90001–90120) gefunden`,
        "Übrig gebliebene E2E-Testdaten — kein Produktionsproblem, aber DB-Cleanup empfohlen",
      );
    }

    const first = productiveLineups[0];
    if (first) {
      const { data: squadRow, error: squadErr } = await sb
        .from("wm_squad_players")
        .select("player_id")
        .eq("player_id", first.captain_id)
        .eq("team_id", first.team_id)
        .maybeSingle();
      if (squadErr) {
        warn("captain_id Kader-Check fehlgeschlagen", squadErr.message);
      } else if (!squadRow) {
        fail(
          `captain_id (${first.captain_id}) nicht in wm_squad_players für team ${first.team_id}`,
          "Captain nicht im Squad → Scoring würde 0 ausgeben",
        );
      } else {
        pass("captain_id existiert in wm_squad_players (Stichprobe OK)");
      }
    } else if (testLineups.length === 0) {
      note("Keine Lineups vorhanden — captain_id Kader-Check übersprungen");
    } else {
      note("Alle Lineups sind Testdaten — captain_id Kader-Check für Produktionsdaten übersprungen");
    }
  } catch (e: any) {
    fail("team_lineups nicht erreichbar", e?.message);
  }
}

async function checkGameweekPoints(sb: SupabaseClient) {
  header(7, "wm_gameweek_points + Live-Center-SUM-Query");
  try {
    const { data: schemaCheck, error: schemaErr } = await sb
      .from("wm_gameweek_points")
      .select("id, team_id, player_id, gameweek, points, nation_active, is_captain")
      .limit(1);
    if (schemaErr) throw schemaErr;
    pass("wm_gameweek_points erreichbar, erwartete Spalten vorhanden");

    if (!schemaCheck || schemaCheck.length === 0) {
      warn("wm_gameweek_points ist leer", "Noch keine Punkte berechnet — erwartet vor erstem Spieltag");
    } else {
      pass(`${schemaCheck.length}+ Punkte-Einträge vorhanden`);
    }

    // Live-Center-ähnliche SUM-Abfrage
    const { data: sumData, error: sumErr } = await sb
      .from("wm_gameweek_points")
      .select("team_id, points")
      .eq("gameweek", 1)
      .limit(100);
    if (sumErr) throw sumErr;
    pass("Live-Center SUM-Query läuft ohne Fehler (GW1, max 100 Rows)");

    if (sumData && sumData.length > 0) {
      const totals: Record<string, number> = {};
      for (const row of sumData) {
        totals[row.team_id] = (totals[row.team_id] ?? 0) + (row.points ?? 0);
      }
      const teams = Object.keys(totals).length;
      note(`GW1: ${teams} Teams mit Punkten (aggregiert client-seitig)`);
    } else {
      note("GW1: Noch keine Punkte vorhanden");
    }
  } catch (e: any) {
    fail("wm_gameweek_points / SUM-Query fehlgeschlagen", e?.message);
  }
}

async function checkPlayerNations(sb: SupabaseClient) {
  header(8, "wm_player_nations");
  try {
    const { data, error } = await sb.from("wm_player_nations").select("player_id, nation_id").limit(10);
    if (error) throw error;
    if (!data || data.length === 0) {
      warn("wm_player_nations erreichbar, aber keine Einträge", "Nation-Mapping für Scoring fehlt → calculateWMGameweekPoints erhält nation=null");
    } else {
      pass(`wm_player_nations erreichbar (${data.length}+ Einträge)`);
    }
  } catch (e: any) {
    // Tabelle könnte noch nicht existieren
    if (e?.message?.includes("does not exist") || e?.code === "42P01") {
      warn("wm_player_nations existiert nicht", "Nation-Mapping noch nicht migriert");
    } else {
      fail("wm_player_nations nicht erreichbar", e?.message);
    }
  }
}

// ── Bekannte Gaps ────────────────────────────────────────────────────────────

function printKnownGaps() {
  header("GAPS", "Bekannte nicht-implementierte Features (WARN, kein FAIL)");

  const gaps = [
    {
      id: "GAP-1",
      title: "Kein produktiver Live-Ingest / API-Football-Polling",
      detail:
        "app/api/wm/[id]/simulate (synthetisch) existiert, aber keine produktive Route " +
        "die live Spielerstatistiken von API-Football polt. " +
        "handlePlayerStatUpdate() in lib/wm-ingest.ts ist vorhanden, hat aber keinen realen Trigger.",
    },
    {
      id: "GAP-2",
      title: "Kein wm_player_map: API-Football player_id ↔ lokale players.id",
      detail:
        "wm_gameweek_points.player_id referenziert players.id (Vereinsspieler). " +
        "API-Football verwendet abweichende Spieler-IDs für Nationalspieler. " +
        "Ohne Mapping-Tabelle schlägt der Ingest bei echten API-Daten fehl.",
    },
    {
      id: "GAP-3",
      title: "Vice-Captain-Fallback nicht implementiert",
      detail:
        "handlePlayerStatUpdate() in lib/wm-ingest.ts prüft nur captain_id, " +
        "nicht vice_captain_id. scoring_rules.vice_captain_multiplier existiert, " +
        "wird aber nie angewendet.",
    },
    {
      id: "GAP-4",
      title: "Scoring filtert nicht explizit gegen team_lineups.starting_xi",
      detail:
        "handlePlayerStatUpdate() iteriert wm_squad_players und berechnet Punkte " +
        "für alle Squad-Spieler. Ob ein Spieler tatsächlich in starting_xi steht, " +
        "wird nicht geprüft → Bench-Spieler könnten Punkte erhalten.",
    },
    {
      id: "GAP-5",
      title: "Lineup-Lock bei GW-Start nicht automatisiert",
      detail:
        "team_lineups.locked wird nicht automatisch auf true gesetzt wenn ein " +
        "Gameweek auf status='active' wechselt. Muss manuell per Admin-Aufruf " +
        "oder DB-Trigger ausgelöst werden.",
    },
    {
      id: "GAP-6",
      title: "GW-Start / GW-Finish sind manuelle Admin-Calls",
      detail:
        "api/wm/[id]/gameweek-start und gameweek-finish existieren, werden aber " +
        "nicht automatisch ausgelöst. Kein Cron-Job oder Webhook vorhanden.",
    },
  ];

  for (const gap of gaps) {
    console.log(`\n  ⚠️  ${gap.id}: ${gap.title}`);
    console.log(`     ${gap.detail}`);
    warnCount++;
    warnings_list.push(`${gap.id}: ${gap.title}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  loadDotEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║    TIFO — WM Matchday Readiness Audit                   ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  Datum: ${new Date().toLocaleString("de-DE")}`);

  if (!url || !key) {
    console.log("\n  ❌ FAIL  SUPABASE-ENV nicht gesetzt");
    console.log("     Setze NEXT_PUBLIC_SUPABASE_URL und");
    console.log("     SUPABASE_SERVICE_ROLE_KEY (oder ANON_KEY) in .env.local");
    process.exit(1);
  }

  const sb = createClient(url, key);

  const tournamentId = await checkTournament(sb);
  await checkGameweeks(sb, tournamentId);
  await checkFixtures(sb, tournamentId);
  await checkNations(sb, tournamentId);
  const leagueId = await checkLeagueSettings(sb);
  await checkLineups(sb, leagueId);
  await checkGameweekPoints(sb);
  await checkPlayerNations(sb);
  printKnownGaps();

  // ── Zusammenfassung ───────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log("ERGEBNIS");
  console.log("═".repeat(60));
  console.log(`  ✅ PASS : ${passCount}`);
  console.log(`  ⚠️  WARN : ${warnCount}`);
  console.log(`  ❌ FAIL : ${failCount}`);

  if (failures.length > 0) {
    console.log("\nFEHLER:");
    for (const f of failures) console.log(`  ❌ ${f}`);
  }

  if (failCount > 0) {
    console.log("\n→ Audit NICHT bestanden — technische Fehler beheben.\n");
    process.exit(1);
  } else if (warnCount > 0) {
    console.log("\n→ Audit mit Warnings abgeschlossen — Gaps dokumentiert, kein Crash.\n");
  } else {
    console.log("\n→ Audit vollständig bestanden.\n");
  }
}

main().catch((e) => {
  console.error("Unerwarteter Fehler:", e);
  process.exit(1);
});
