"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { BottomNav } from "@/app/components/BottomNav";
import { LEAGUE_META, ALL_LEAGUES, calcActiveLeagues } from "@/lib/league-meta";
import tsdbLeagues from "@/lib/tsdb-leagues.json";

// api-sports league id → tsdb badge
const LEAGUE_BADGES: Record<string, string> = {
  "78":  (tsdbLeagues as any)["78"]?.badge  || "",  // Bundesliga
  "39":  (tsdbLeagues as any)["39"]?.badge  || "",  // Premier League
  "135": (tsdbLeagues as any)["135"]?.badge || "",  // Serie A
  "61":  (tsdbLeagues as any)["61"]?.badge  || "",  // Ligue 1
  "140": (tsdbLeagues as any)["140"]?.badge || "",  // La Liga
};
const LEAGUE_KEY_TO_APID: Record<string, string> = {
  bundesliga: "78", premier: "39", seriea: "135", ligue1: "61", laliga: "140",
};

const EMPTY_STATS = {
  goals: 0, assists: 0, minutes: 0, shots_on: 0, key_passes: 0,
  pass_accuracy: 0, dribbles: 0, tackles: 0, interceptions: 0,
  saves: 0, clean_sheet: false, yellow_cards: 0, red_cards: 0,
};

function calcPoints(stats: typeof EMPTY_STATS, position: string, isCaptain: boolean) {
  let p = 0;
  if (position === "GK" || position === "DF") p += stats.goals * 6;
  else if (position === "MF") p += stats.goals * 5;
  else p += stats.goals * 4;
  p += stats.assists * 3;
  if (stats.clean_sheet) {
    if (position === "GK" || position === "DF") p += 4;
    else if (position === "MF") p += 1;
  }
  if (position === "GK") p += stats.saves * 1.5;
  p += stats.shots_on * 0.5;
  p += stats.key_passes * 0.8;
  p += (stats.pass_accuracy / 100) * 0.5;
  p += stats.dribbles * 0.2;
  p += stats.tackles * 0.6;
  p += stats.interceptions * 0.6;
  p -= stats.yellow_cards * 1;
  p -= stats.red_cards * 3;
  if (stats.minutes >= 60) p += 1;
  else if (stats.minutes > 0) p += 0.4;
  const base = Math.round(p * 10) / 10;
  return isCaptain ? base * 2 : base;
}

async function logAdminAction(
  leagueId: string,
  userId: string,
  action: string,
  gameweek: number | null,
  metadata: Record<string, any> = {},
) {
  try {
    await supabase.from("liga_admin_audit_log").insert({
      league_id:   leagueId,
      actor_id:    userId,
      actor_label: "admin",
      action,
      gameweek,
      metadata,
    });
  } catch (e) {
    // Audit log failures must not break the user flow
    console.warn("audit log insert failed:", e);
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case "gw_started":         return "▶ Spieltag gestartet";
    case "gw_finished":        return "■ Spieltag beendet";
    case "gw_imported":        return "↓ Stats importiert";
    case "gw_recalculated":    return "↻ Neu berechnet";
    case "gw_import_failed":   return "❌ Import fehlgeschlagen";
    case "gw_status_changed":  return "⇄ Status geändert";
    case "cron_run":           return "⏰ Cron-Lauf";
    default:                   return action;
  }
}

export default function LigaAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [user, setUser] = useState<any>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [league, setLeague] = useState<any>(null);
  const [gameweeks, setGameweeks] = useState<any[]>([]);
  const [selectedGW, setSelectedGW] = useState<number>(1);
  const [squadPlayers, setSquadPlayers] = useState<any[]>([]);
  const [playerStats, setPlayerStats] = useState<Record<number, typeof EMPTY_STATS>>({});
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState<number | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [tab, setTab] = useState<"gameweeks" | "points" | "settings" | "import">("gameweeks");
  const [importLeague, setImportLeague] = useState<string>("all");
  const [importRunning, setImportRunning] = useState(false);
  const [importLog, setImportLog] = useState<string[]>([]);
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [importStatus, setImportStatus] = useState<any>(null);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [auditLogVisible, setAuditLogVisible] = useState(false);

  // Liga-Einstellungen (Basis)
  const [settingsName, setSettingsName] = useState("");
  const [settingsMaxTeams, setSettingsMaxTeams] = useState(8);
  const [settingsScoringType, setSettingsScoringType] = useState("h2h");
  const [settingsStatus, setSettingsStatus] = useState("setup");
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Liga-Settings (erweitert)
  const [ligaSettings, setLigaSettings] = useState<any>(null);
  const [squadSize, setSquadSize] = useState(15);
  const [benchSize, setBenchSize] = useState(4);
  const [irSpots, setIrSpots] = useState(0);
  const [taxiSpots, setTaxiSpots] = useState(0);
  const [maxPerClub, setMaxPerClub] = useState<number | "">(3);
  const [posLimits, setPosLimits] = useState({
    GK: { min: 1, max: 2 },
    DF: { min: 3, max: 5 },
    MF: { min: 2, max: 5 },
    FW: { min: 1, max: 4 },
  });
  const [allowedFormations, setAllowedFormations] = useState<string[]>(
    ["4-3-3","4-4-2","3-5-2","5-3-2","3-4-3","4-5-1","5-4-1","5-2-3","3-6-1"]
  );
  const [loading, setLoading] = useState(true);

  // Auto-Generieren
  const [autoGenLeague, setAutoGenLeague] = useState("bundesliga");
  const [autoGenerating, setAutoGenerating] = useState(false);

  const LIGA_PRESETS: Record<string, { label: string; start: string; count: number }> = {
    bundesliga:   { label: "Bundesliga 26/27",     start: "2026-08-28", count: 34 },
    premier:      { label: "Premier League 26/27", start: "2026-08-22", count: 38 },
    seriea:       { label: "Serie A 26/27",         start: "2026-08-22", count: 38 },
    ligue1:       { label: "Ligue 1 26/27",         start: "2026-08-23", count: 38 },
    laliga:       { label: "La Liga 26/27",          start: "2026-08-14", count: 38 },
    custom:       { label: "Eigene Liga",            start: "", count: 34 },
  };
  const [autoStart, setAutoStart] = useState(LIGA_PRESETS.bundesliga.start);
  const [autoCount, setAutoCount] = useState(LIGA_PRESETS.bundesliga.count);

  // Neuer GW-Form
  const [newGWNum, setNewGWNum] = useState(1);
  const [newGWLabel, setNewGWLabel] = useState("");
  const [newGWStart, setNewGWStart] = useState("");
  const [newGWEnd, setNewGWEnd] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
    });
  }, []);

  async function loadAll(userId: string) {
    // Player count + import status
    const { count } = await supabase.from("players").select("*", { count: "exact", head: true });
    setPlayerCount(count);
    fetch("/api/import-players").then(r => r.json()).then(d => setImportStatus(d)).catch(() => {});

    const { data: leagueData } = await supabase
      .from("leagues").select("*").eq("id", leagueId).single();
    setLeague(leagueData);

    if (leagueData?.owner_id !== userId) {
      setIsOwner(false);
      setLoading(false);
      return;
    }
    setIsOwner(true);
    setSettingsName(leagueData.name || "");
    setSettingsMaxTeams(leagueData.max_teams || 8);
    setSettingsScoringType(leagueData.scoring_type || "h2h");
    setSettingsStatus(leagueData.status || "setup");

    // Liga-Settings laden
    const { data: ls } = await supabase
      .from("liga_settings").select("*").eq("league_id", leagueId).maybeSingle();
    if (ls) {
      setLigaSettings(ls);
      setSquadSize(ls.squad_size || 15);
      setBenchSize(ls.bench_size || 4);
      setIrSpots(ls.ir_spots || 0);
      setTaxiSpots(ls.taxi_spots || 0);
      setMaxPerClub(ls.max_players_per_club ?? 3);
      if (ls.position_limits) setPosLimits(ls.position_limits);
      if (ls.allowed_formations) setAllowedFormations(ls.allowed_formations);
    }

    const { data: gwData } = await supabase
      .from("liga_gameweeks")
      .select("*").eq("league_id", leagueId).order("gameweek");
    setGameweeks(gwData || []);

    const active = (gwData || []).find((g: any) => g.status === "active");
    if (active) setSelectedGW(active.gameweek);
    if (gwData && gwData.length > 0) setNewGWNum(gwData.length + 1);

    // Alle Spieler aus dem Liga-Pool laden
    const { data: teamsData } = await supabase
      .from("teams").select("id").eq("league_id", leagueId);
    const teamIds = (teamsData || []).map((t: any) => t.id);

    if (teamIds.length > 0) {
      const { data: picks } = await supabase
        .from("squad_players")
        .select("player_id, players(id, name, position, team_name, photo_url)")
        .in("team_id", teamIds);

      const seen = new Set<number>();
      const unique: any[] = [];
      for (const p of (picks || [])) {
        if (!seen.has(p.player_id)) { seen.add(p.player_id); unique.push(p); }
      }
      setSquadPlayers(unique);
    }

    setLoading(false);
    loadAuditLog();
  }

  async function loadStatsForGW(gw: number) {
    const playerIds = squadPlayers.map((p: any) => p.player_id);
    if (playerIds.length === 0) return;

    const { data } = await supabase
      .from("liga_gameweek_points")
      .select("player_id, goals, assists, minutes, shots_on, key_passes, pass_accuracy, dribbles, tackles, interceptions, saves, clean_sheet, yellow_cards, red_cards")
      .eq("gameweek", gw)
      .in("player_id", playerIds);

    const map: Record<number, typeof EMPTY_STATS> = {};
    for (const s of (data || [])) {
      map[s.player_id] = {
        goals: s.goals || 0, assists: s.assists || 0, minutes: s.minutes || 0,
        shots_on: s.shots_on || 0, key_passes: s.key_passes || 0,
        pass_accuracy: s.pass_accuracy || 0, dribbles: s.dribbles || 0,
        tackles: s.tackles || 0, interceptions: s.interceptions || 0,
        saves: s.saves || 0, clean_sheet: s.clean_sheet || false,
        yellow_cards: s.yellow_cards || 0, red_cards: s.red_cards || 0,
      };
    }
    setPlayerStats(map);
  }

  useEffect(() => {
    if (squadPlayers.length > 0 && tab === "points") loadStatsForGW(selectedGW);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGW, tab, squadPlayers.length]);

  function getStat(playerId: number) {
    return playerStats[playerId] || { ...EMPTY_STATS };
  }

  function updateStat(playerId: number, field: keyof typeof EMPTY_STATS, value: number | boolean) {
    setPlayerStats(prev => ({ ...prev, [playerId]: { ...getStat(playerId), [field]: value } }));
  }

  async function createGameweek() {
    if (!newGWLabel.trim()) { alert("Label eingeben"); return; }
    const { error } = await supabase.from("liga_gameweeks").insert({
      league_id: leagueId,
      gameweek: newGWNum,
      label: newGWLabel.trim(),
      start_date: newGWStart || null,
      end_date: newGWEnd || null,
      status: "upcoming",
    });
    if (error) { alert("Fehler: " + error.message); return; }
    const { data } = await supabase.from("liga_gameweeks").select("*").eq("league_id", leagueId).order("gameweek");
    setGameweeks(data || []);
    setNewGWNum(prev => prev + 1);
    setNewGWLabel("");
    setNewGWStart("");
    setNewGWEnd("");
  }

  async function autoGenerateGameweeks() {
    if (!autoStart) { alert("Startdatum eingeben"); return; }
    if (gameweeks.length > 0) {
      if (!confirm(`Es gibt bereits ${gameweeks.length} Spieltage. Trotzdem generieren?`)) return;
    }
    setAutoGenerating(true);
    const start = new Date(autoStart);
    const rows = [];
    for (let i = 0; i < autoCount; i++) {
      const gwStart = new Date(start);
      gwStart.setDate(start.getDate() + i * 7);
      const gwEnd = new Date(gwStart);
      gwEnd.setDate(gwStart.getDate() + 6);
      const startStr = gwStart.toISOString().split("T")[0];
      const endStr   = gwEnd.toISOString().split("T")[0];
      const { activeLeagues, isIntlBreak, intlBreakLabel } = calcActiveLeagues(startStr, endStr);
      rows.push({
        league_id: leagueId,
        gameweek: i + 1,
        label: isIntlBreak ? `ST ${i + 1} – ${intlBreakLabel}` : `Spieltag ${i + 1}`,
        start_date: startStr,
        end_date: endStr,
        status: "upcoming",
        active_leagues: isIntlBreak ? [] : activeLeagues,
        double_gw_leagues: [],
        notes: isIntlBreak ? intlBreakLabel : null,
      });
    }
    const { error } = await supabase.from("liga_gameweeks").upsert(rows, { onConflict: "league_id,gameweek" });
    if (error) { alert("Fehler: " + error.message); setAutoGenerating(false); return; }
    const { data } = await supabase.from("liga_gameweeks").select("*").eq("league_id", leagueId).order("gameweek");
    setGameweeks(data || []);
    setNewGWNum((data?.length || 0) + 1);
    setAutoGenerating(false);
  }

  async function updateGWStatus(gwId: string, status: string, gwNum?: number) {
    await supabase.from("liga_gameweeks").update({ status }).eq("id", gwId);
    setGameweeks(prev => prev.map(g => g.id === gwId ? { ...g, status } : g));
    if (gwNum !== undefined && user?.id) {
      const action =
        status === "active"   ? "gw_started"  :
        status === "finished" ? "gw_finished" : "gw_status_changed";
      await logAdminAction(leagueId, user.id, action, gwNum, { new_status: status });
    }
    loadAuditLog();
  }

  async function saveSettings() {
    setSaving(true);
    const { error } = await supabase.from("leagues").update({
      name: settingsName.trim(),
      max_teams: settingsMaxTeams,
      scoring_type: settingsScoringType,
      status: settingsStatus,
    }).eq("id", leagueId);
    if (error) { alert("Fehler: " + error.message); setSaving(false); return; }
    setLeague((prev: any) => ({ ...prev, name: settingsName.trim(), max_teams: settingsMaxTeams, scoring_type: settingsScoringType, status: settingsStatus }));
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 3000);
    setSaving(false);
  }

  async function saveLigaSettings() {
    setSaving(true);
    const payload = {
      league_id: leagueId,
      squad_size: squadSize,
      bench_size: benchSize,
      ir_spots: irSpots,
      taxi_spots: taxiSpots,
      max_players_per_club: maxPerClub === "" ? null : Number(maxPerClub),
      position_limits: posLimits,
      allowed_formations: allowedFormations,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("liga_settings")
      .upsert(payload, { onConflict: "league_id" });
    if (error) { alert("Fehler: " + error.message); setSaving(false); return; }
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 3000);
    setSaving(false);
  }

  async function runImport(forceRestart = false) {
    setImportRunning(true);
    setImportLog(["⏳ Import gestartet..."]);
    try {
      const res = await fetch("/api/import-players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league: importLeague, maxCalls: 90, restart: forceRestart }),
      });
      const data = await res.json();
      if (data.error) {
        setImportLog([`❌ Fehler: ${data.error}`]);
      } else {
        const lines: string[] = [data.message];
        for (const s of data.summary || []) {
          if (s.pagesImported === 0 && s.done) {
            lines.push(`✅ ${s.league}: bereits vollständig`);
          } else if (s.done) {
            lines.push(`✅ ${s.league}: ${s.players} Spieler (${s.pagesImported} Seiten)`);
          } else {
            lines.push(`⏸ ${s.league}: ${s.players} Spieler — noch ${s.remaining} Seiten offen`);
          }
        }
        if (data.remainingLeagues?.length > 0) {
          lines.push("", "📅 Morgen weitermachen:", ...data.remainingLeagues.map((r: string) => `  → ${r}`));
        }
        setImportLog(lines);
        // Refresh status
        const { count: newCount } = await supabase.from("players").select("*", { count: "exact", head: true });
        setPlayerCount(newCount);
        fetch("/api/import-players").then(r => r.json()).then(d => setImportStatus(d)).catch(() => {});
      }
    } catch (e: any) {
      setImportLog([`❌ ${e.message}`]);
    }
    setImportRunning(false);
  }

  async function deleteLeague() {
    const { error, count } = await supabase
      .from("leagues")
      .delete({ count: "exact" })
      .eq("id", leagueId)
      .eq("owner_id", user.id); // Sicherheit: nur eigene Liga

    if (error) {
      alert("Fehler beim Löschen: " + error.message);
      setDeleteConfirm(false);
      return;
    }
    if (count === 0) {
      alert("Liga konnte nicht gelöscht werden. Fehlende Berechtigung?\n\nBitte in Supabase ausführen:\nCREATE POLICY \"Owner can delete own league\" ON leagues FOR DELETE TO authenticated USING (owner_id = auth.uid());");
      setDeleteConfirm(false);
      return;
    }
    window.location.href = "/leagues";
  }

  async function loadAuditLog() {
    const { data } = await supabase
      .from("liga_admin_audit_log")
      .select("*")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: false })
      .limit(20);
    setAuditLog(data || []);
  }

  async function importGWStats(gwNum: number, recalc: boolean = false) {
    setImporting(gwNum);
    setImportResult(null);
    try {
      const res = await fetch("/api/import-gw-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId, gameweek: gwNum }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Fehler");
      setImportResult(json.message || "Importiert!");
      setGameweeks(prev =>
        prev.map(g => g.gameweek === gwNum ? { ...g, status: "finished" } : g),
      );
      if (user?.id) {
        await logAdminAction(
          leagueId,
          user.id,
          recalc ? "gw_recalculated" : "gw_imported",
          gwNum,
          {
            api_calls_used:   json.apiCallsUsed,
            players_imported: json.playersImported,
          },
        );
      }
      loadAuditLog();
    } catch (e: any) {
      setImportResult("Fehler: " + e.message);
      if (user?.id) {
        await logAdminAction(leagueId, user.id, "gw_import_failed", gwNum, { error: e.message });
      }
    }
    setImporting(null);
  }

  async function toggleLeague(gwId: string, leagueKey: string, field: "active_leagues" | "double_gw_leagues") {
    const gw = gameweeks.find(g => g.id === gwId);
    if (!gw) return;
    const current: string[] = gw[field] || [];
    const updated = current.includes(leagueKey)
      ? current.filter((l: string) => l !== leagueKey)
      : [...current, leagueKey];
    await supabase.from("liga_gameweeks").update({ [field]: updated }).eq("id", gwId);
    setGameweeks(prev => prev.map(g => g.id === gwId ? { ...g, [field]: updated } : g));
  }

  async function savePoints() {
    setSaving(true);
    try {
      const { data: teamsData } = await supabase
        .from("teams").select("id").eq("league_id", leagueId);
      const teamIds = (teamsData || []).map((t: any) => t.id);

      for (const teamId of teamIds) {
        const { data: lineup } = await supabase
          .from("liga_lineups")
          .select("starting_xi, captain_id")
          .eq("team_id", teamId).eq("gameweek", selectedGW).maybeSingle();

        const xi: number[] = lineup?.starting_xi || [];
        const captainId: number | null = lineup?.captain_id || null;
        let teamGWPts = 0;

        for (const playerId of xi) {
          const entry = squadPlayers.find(p => p.player_id === playerId);
          const player = entry?.players;
          if (!player) continue;
          const stats = getStat(playerId);
          const isCaptain = playerId === captainId;
          const pts = calcPoints(stats, player.position, isCaptain);

          await supabase.from("liga_gameweek_points").upsert({
            team_id: teamId,
            league_id: leagueId,
            player_id: playerId,
            gameweek: selectedGW,
            points: pts,
            is_captain: isCaptain,
            ...stats,
          }, { onConflict: "team_id,player_id,gameweek" });

          teamGWPts += pts;
        }

        // Total-Punkte aktualisieren
        const { data: allPts } = await supabase
          .from("liga_gameweek_points")
          .select("points").eq("team_id", teamId);
        const total = (allPts || []).reduce((s: number, r: any) => s + (r.points || 0), 0);
        await supabase.from("teams").update({ total_points: Math.round(total * 10) / 10 }).eq("id", teamId);
      }

      // H2H: Matchup-Ergebnisse berechnen
      if (league?.scoring_type === "h2h") await calcH2H(teamIds);

      alert(`GW${selectedGW} Punkte gespeichert!`);
    } catch (e: any) { alert("Fehler: " + e.message); }
    setSaving(false);
  }

  async function calcH2H(teamIds: string[]) {
    // Punkte pro Team für diesen GW
    const { data: gwPts } = await supabase
      .from("liga_gameweek_points")
      .select("team_id, points")
      .eq("league_id", leagueId)
      .eq("gameweek", selectedGW);

    const teamPts: Record<string, number> = {};
    for (const r of (gwPts || [])) {
      teamPts[r.team_id] = (teamPts[r.team_id] || 0) + r.points;
    }

    // Bestehende Matchups laden oder paaren
    const { data: existing } = await supabase
      .from("liga_matchups")
      .select("*").eq("league_id", leagueId).eq("gameweek", selectedGW);

    if (!existing || existing.length === 0) {
      // Zufällige Paarungen erstellen
      const shuffled = [...teamIds].sort(() => Math.random() - 0.5);
      for (let i = 0; i < shuffled.length - 1; i += 2) {
        const home = shuffled[i];
        const away = shuffled[i + 1];
        const homeP = teamPts[home] || 0;
        const awayP = teamPts[away] || 0;
        await supabase.from("liga_matchups").upsert({
          league_id: leagueId,
          gameweek: selectedGW,
          home_team_id: home,
          away_team_id: away,
          home_points: homeP,
          away_points: awayP,
          winner_id: homeP > awayP ? home : awayP > homeP ? away : null,
        }, { onConflict: "league_id,gameweek,home_team_id,away_team_id" });
      }
    } else {
      // Bestehende Matchups aktualisieren
      for (const m of existing) {
        const homeP = teamPts[m.home_team_id] || 0;
        const awayP = teamPts[m.away_team_id] || 0;
        await supabase.from("liga_matchups").update({
          home_points: homeP,
          away_points: awayP,
          winner_id: homeP > awayP ? m.home_team_id : awayP > homeP ? m.away_team_id : null,
        }).eq("id", m.id);
      }
    }
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center text-[9px] font-black uppercase tracking-widest animate-pulse"
      style={{ background: "#0c0900", color: "#2a2010" }}>Lade Admin...</main>
  );

  if (!isOwner) return (
    <main className="flex min-h-screen items-center justify-center flex-col gap-4" style={{ background: "#0c0900" }}>
      <p className="text-sm font-black" style={{ color: "#ff4d6d" }}>Kein Zugriff</p>
      <button onClick={() => window.location.href = `/leagues/${leagueId}`}
        className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>← Zurück</button>
    </main>
  );

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "#0c0900" }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "#f5a623" }} />

      {/* Header */}
      <div className="w-full max-w-xl flex justify-between items-center mb-5">
        <button onClick={() => window.location.href = `/leagues/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>← Liga</button>
        <div className="text-center">
          <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>Admin</p>
          <p className="text-sm font-black" style={{ color: "#f5a623" }}>{league?.name}</p>
        </div>
        <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
          style={{ background: "#1a0a00", border: "1px solid #f5a623", color: "#f5a623" }}>Owner</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 w-full max-w-xl mb-5 p-1 rounded-xl" style={{ background: "#141008", border: "1px solid #2a2010" }}>
        {([
          { id: "gameweeks", label: "Spieltage" },
          { id: "points",    label: "Punkte" },
          { id: "settings",  label: "Einstellungen" },
          { id: "import",    label: "Import" },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex-1 py-2 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all"
            style={{ background: tab === t.id ? "#f5a623" : "transparent", color: tab === t.id ? "#0c0900" : "#5a4020" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* SPIELTAGE VERWALTEN */}
      {tab === "gameweeks" && (
        <div className="w-full max-w-xl space-y-3">

          {/* Auto-Generieren */}
          <div className="rounded-xl p-4" style={{ background: "#0f0d06", border: "1px solid #3a2a10" }}>
            <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "#f5a623" }}>
              Auto-Generieren
            </p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="col-span-2">
                <p className="text-[8px] font-black uppercase mb-1" style={{ color: "#8a6a40" }}>Liga / Wettbewerb</p>
                <select value={autoGenLeague}
                  onChange={e => {
                    const key = e.target.value;
                    setAutoGenLeague(key);
                    if (LIGA_PRESETS[key].start) setAutoStart(LIGA_PRESETS[key].start);
                    setAutoCount(LIGA_PRESETS[key].count);
                  }}
                  className="w-full p-2 rounded-lg text-sm font-black focus:outline-none"
                  style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }}>
                  {Object.entries(LIGA_PRESETS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-[8px] font-black uppercase mb-1" style={{ color: "#8a6a40" }}>Saisonstart</p>
                <input type="date" value={autoStart} onChange={e => setAutoStart(e.target.value)}
                  className="w-full p-2 rounded-lg text-sm focus:outline-none"
                  style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }} />
              </div>
              <div>
                <p className="text-[8px] font-black uppercase mb-1" style={{ color: "#8a6a40" }}>Anzahl Spieltage</p>
                <input type="number" value={autoCount} min={1} max={50} onChange={e => setAutoCount(Number(e.target.value))}
                  className="w-full p-2 rounded-lg text-sm font-black focus:outline-none"
                  style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }} />
              </div>
            </div>
            <p className="text-[8px] mb-3" style={{ color: "#5a4020" }}>
              Generiert {autoCount} Spieltage à 7 Tage ab {autoStart || "?"}
            </p>
            <button onClick={autoGenerateGameweeks} disabled={autoGenerating}
              className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
              style={{ background: autoGenerating ? "#2a2010" : "#3a2a10", color: autoGenerating ? "#5a4020" : "#f5a623", border: "1px solid #f5a623" }}>
              {autoGenerating ? "Generiere..." : `Alle ${autoCount} Spieltage generieren`}
            </button>
          </div>

          {/* Neuer GW */}
          <div className="rounded-xl p-4" style={{ background: "#141008", border: "1px solid #2a2010" }}>
            <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "#5a4020" }}>
              Neuer Spieltag
            </p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <p className="text-[8px] font-black uppercase mb-1" style={{ color: "#8a6a40" }}>Nummer</p>
                <input type="number" value={newGWNum} onChange={e => setNewGWNum(Number(e.target.value))}
                  className="w-full p-2 rounded-lg text-sm font-black focus:outline-none"
                  style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }} />
              </div>
              <div>
                <p className="text-[8px] font-black uppercase mb-1" style={{ color: "#8a6a40" }}>Label</p>
                <input type="text" value={newGWLabel} onChange={e => setNewGWLabel(e.target.value)}
                  placeholder="z.B. Spieltag 1"
                  className="w-full p-2 rounded-lg text-sm focus:outline-none"
                  style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }} />
              </div>
              <div>
                <p className="text-[8px] font-black uppercase mb-1" style={{ color: "#8a6a40" }}>Start</p>
                <input type="date" value={newGWStart} onChange={e => setNewGWStart(e.target.value)}
                  className="w-full p-2 rounded-lg text-sm focus:outline-none"
                  style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }} />
              </div>
              <div>
                <p className="text-[8px] font-black uppercase mb-1" style={{ color: "#8a6a40" }}>Ende</p>
                <input type="date" value={newGWEnd} onChange={e => setNewGWEnd(e.target.value)}
                  className="w-full p-2 rounded-lg text-sm focus:outline-none"
                  style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }} />
              </div>
            </div>
            <button onClick={createGameweek}
              className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest"
              style={{ background: "#f5a623", color: "#0c0900" }}>
              Spieltag {newGWNum} anlegen
            </button>
          </div>

          {/* Bestehende GWs */}
          {gameweeks.map(gw => {
            const activeLgs: string[] = gw.active_leagues || [];
            const doubleLgs: string[] = gw.double_gw_leagues || [];
            const isBreak = activeLgs.length === 0 && !gw.notes?.includes("Winterpause");
            return (
              <div key={gw.id} className="p-4 rounded-xl space-y-3"
                style={{ background: "#141008", border: `1px solid ${gw.status === "active" ? "#3a2a10" : "#2a2010"}` }}>
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-black text-sm" style={{ color: "#c8b080" }}>
                      GW{gw.gameweek} · {gw.label}
                    </p>
                    {gw.start_date && (
                      <p className="text-[8px] font-black uppercase mt-0.5" style={{ color: "#5a4020" }}>
                        {gw.start_date} → {gw.end_date || "?"}
                      </p>
                    )}
                    {gw.notes && (
                      <p className="text-[8px] font-black mt-0.5" style={{ color: "#f5a623" }}>
                        ⚠ {gw.notes}
                      </p>
                    )}
                  </div>
                  {/* Status Badge */}
                  <span
                    className="px-2 py-1 rounded-lg text-[7px] font-black uppercase"
                    style={{
                      background:
                        gw.status === "finished" ? "#00ce7d" :
                        gw.status === "active"   ? "#f5a623" :
                                                   "#2a2010",
                      color:
                        gw.status === "upcoming" ? "#5a4020" : "#0c0900",
                    }}>
                    {gw.status === "upcoming" ? "Bald" :
                     gw.status === "active"   ? "Live" : "Fertig"}
                  </span>
                </div>

                {/* 1-Klick Lifecycle Buttons */}
                <div className="grid grid-cols-3 gap-2">
                  {/* Start */}
                  <button
                    onClick={() => updateGWStatus(gw.id, "active", gw.gameweek)}
                    disabled={gw.status !== "upcoming"}
                    className="py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-30"
                    style={{
                      background: gw.status === "upcoming" ? "#1a1208" : "#0c0900",
                      color:      gw.status === "upcoming" ? "#f5a623" : "#5a4020",
                      border:     "1px solid #f5a623",
                    }}>
                    ▶ Starten
                  </button>

                  {/* End + Import */}
                  <button
                    onClick={() => importGWStats(gw.gameweek, false)}
                    disabled={importing === gw.gameweek || gw.status === "finished"}
                    className="py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-30"
                    style={{
                      background: importing === gw.gameweek ? "#2a2010" : "#0a1a0a",
                      color:      importing === gw.gameweek ? "#5a4020" : "#00ce7d",
                      border:     "1px solid #00ce7d",
                    }}>
                    {importing === gw.gameweek ? "..." : "■ Beenden + Import"}
                  </button>

                  {/* Recalculate */}
                  <button
                    onClick={() => importGWStats(gw.gameweek, true)}
                    disabled={importing === gw.gameweek || gw.status !== "finished"}
                    className="py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-30"
                    style={{
                      background: importing === gw.gameweek ? "#2a2010" : "#1a0a08",
                      color:      importing === gw.gameweek ? "#5a4020" : "#ff8866",
                      border:     "1px solid #ff8866",
                    }}>
                    ↻ Neu rechnen
                  </button>
                </div>

                {/* Liga-Toggles */}
                <div>
                  <p className="text-[7px] font-black uppercase tracking-widest mb-1.5" style={{ color: "#8a6a40" }}>
                    Spielende Ligen
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_LEAGUES.map(key => {
                      const meta = LEAGUE_META[key];
                      const active = activeLgs.includes(key);
                      const isDouble = doubleLgs.includes(key);
                      return (
                        <div key={key} className="flex items-center gap-0.5">
                          <button onClick={() => toggleLeague(gw.id, key, "active_leagues")}
                            className="px-2 py-1 rounded-lg text-[8px] font-black transition-all"
                            style={{
                              background: active ? "#1a1208" : "#0c0900",
                              border: `1px solid ${active ? "#f5a623" : "#2a2010"}`,
                              color: active ? "#f5a623" : "#2a2010",
                            }}>
                            {meta.flag} {meta.short}
                          </button>
                          {active && (
                            <button onClick={() => toggleLeague(gw.id, key, "double_gw_leagues")}
                              title="Doppelspieltag"
                              className="px-1.5 py-1 rounded-lg text-[8px] font-black transition-all"
                              style={{
                                background: isDouble ? "#1a0a00" : "#0c0900",
                                border: `1px solid ${isDouble ? "#ff6b00" : "#2a2010"}`,
                                color: isDouble ? "#ff6b00" : "#2a2010",
                              }}>
                              ×2
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {isBreak && (
                    <p className="text-[8px] mt-1.5 font-black" style={{ color: "#5a4020" }}>
                      Länderspielpause — keine Liga-Spiele
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {/* AUDIT LOG (collapsible) */}
          <div className="rounded-xl p-4" style={{ background: "#0f0d06", border: "1px solid #2a2010" }}>
            <button
              onClick={() => setAuditLogVisible(v => !v)}
              className="w-full flex items-center justify-between text-[9px] font-black uppercase tracking-widest"
              style={{ color: "#8a6a40" }}>
              <span>📜 Admin-Verlauf ({auditLog.length})</span>
              <span>{auditLogVisible ? "▲" : "▼"}</span>
            </button>
            {auditLogVisible && (
              <div className="mt-3 space-y-1.5">
                {auditLog.length === 0 && (
                  <p className="text-[8px] font-black uppercase" style={{ color: "#5a4020" }}>
                    Noch keine Einträge
                  </p>
                )}
                {auditLog.map(entry => (
                  <div key={entry.id}
                    className="flex items-start justify-between gap-2 py-1 border-b"
                    style={{ borderColor: "#1a1208" }}>
                    <div className="flex-1">
                      <p className="text-[9px] font-black" style={{ color: "#c8b080" }}>
                        {actionLabel(entry.action)}{entry.gameweek ? ` · GW${entry.gameweek}` : ""}
                      </p>
                      {entry.metadata?.players_imported !== undefined && (
                        <p className="text-[7px]" style={{ color: "#5a4020" }}>
                          {entry.metadata.players_imported} Spieler · {entry.metadata.api_calls_used} API-Calls
                        </p>
                      )}
                      {entry.metadata?.error && (
                        <p className="text-[7px]" style={{ color: "#ff4d6d" }}>
                          {entry.metadata.error}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[7px] font-black uppercase"
                        style={{ color: entry.actor_label === "cron" ? "#00ce7d" : "#f5a623" }}>
                        {entry.actor_label}
                      </span>
                      <span className="text-[7px]" style={{ color: "#5a4020" }}>
                        {new Date(entry.created_at).toLocaleString("de-DE", {
                          day: "2-digit", month: "2-digit",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {gameweeks.length === 0 && (
            <p className="text-center text-sm font-black py-8" style={{ color: "#2a2010" }}>
              Noch keine Spieltage
            </p>
          )}

          {importResult && (
            <div className="rounded-xl p-4 text-center"
              style={{
                background: importResult.startsWith("Fehler") ? "#1a0808" : "#0a1a0a",
                border: `1px solid ${importResult.startsWith("Fehler") ? "#ff4d6d" : "#00ce7d"}`,
              }}>
              <p className="text-sm font-black"
                style={{ color: importResult.startsWith("Fehler") ? "#ff4d6d" : "#00ce7d" }}>
                {importResult}
              </p>
            </div>
          )}
        </div>
      )}

      {/* PUNKTE EINTRAGEN */}
      {tab === "points" && (
        <div className="w-full max-w-xl">
          {/* GW-Auswahl */}
          <div className="flex gap-2 flex-wrap mb-4">
            {gameweeks.map(gw => (
              <button key={gw.gameweek} onClick={() => setSelectedGW(gw.gameweek)}
                className="px-3 py-2 rounded-xl text-[10px] font-black transition-all"
                style={{
                  background: selectedGW === gw.gameweek ? "#f5a623" : "#141008",
                  color: selectedGW === gw.gameweek ? "#0c0900" : "#5a4020",
                  border: `1px solid ${selectedGW === gw.gameweek ? "#f5a623" : "#2a2010"}`,
                }}>
                GW{gw.gameweek}
              </button>
            ))}
          </div>

          {gameweeks.length === 0 ? (
            <p className="text-center text-sm font-black py-8" style={{ color: "#2a2010" }}>
              Erst Spieltage anlegen
            </p>
          ) : (
            <>
              <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "#5a4020" }}>
                GW{selectedGW} · {squadPlayers.length} Spieler im Pool
              </p>
              <div className="space-y-2 mb-4">
                {squadPlayers.map(({ player_id, players: p }) => {
                  if (!p) return null;
                  const s = getStat(player_id);
                  const pts = calcPoints(s, p.position, false);
                  return (
                    <div key={player_id} className="rounded-xl p-3"
                      style={{ background: "#141008", border: "1px solid #2a2010" }}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {p.photo_url && <img src={p.photo_url} className="w-7 h-7 rounded-full" alt="" />}
                          <div>
                            <p className="font-black text-sm" style={{ color: "#c8b080" }}>{p.name}</p>
                            <p className="text-[8px] font-black uppercase" style={{ color: "#5a4020" }}>
                              {p.position} · {p.team_name}
                            </p>
                          </div>
                        </div>
                        <span className="text-sm font-black" style={{ color: "#f5a623" }}>{pts.toFixed(1)}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[
                          { key: "minutes",       label: "Min"      },
                          { key: "goals",         label: "Tore"     },
                          { key: "assists",       label: "Assists"  },
                          { key: "shots_on",      label: "Schüsse"  },
                          { key: "key_passes",    label: "KeyPass"  },
                          { key: "tackles",       label: "Tackles"  },
                          { key: "interceptions", label: "Int."     },
                          { key: "saves",         label: "Saves"    },
                          { key: "yellow_cards",  label: "Gelb"     },
                          { key: "red_cards",     label: "Rot"      },
                          { key: "dribbles",      label: "Dribbl."  },
                          { key: "pass_accuracy", label: "Pass%"    },
                        ].map(({ key, label }) => (
                          <div key={key}>
                            <p className="text-[7px] font-black uppercase mb-0.5" style={{ color: "#8a6a40" }}>{label}</p>
                            <input type="number" min={0}
                              value={s[key as keyof typeof s] as number}
                              onChange={e => updateStat(player_id, key as any, Number(e.target.value))}
                              className="w-full p-1 rounded text-xs text-center font-black focus:outline-none"
                              style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }} />
                          </div>
                        ))}
                        <div className="col-span-4 flex items-center gap-2 mt-1">
                          <input type="checkbox" id={`cs-${player_id}`} checked={s.clean_sheet}
                            onChange={e => updateStat(player_id, "clean_sheet", e.target.checked)} className="w-4 h-4" />
                          <label htmlFor={`cs-${player_id}`} className="text-[9px] font-black uppercase"
                            style={{ color: "#5a4020" }}>Clean Sheet</label>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button onClick={savePoints} disabled={saving}
                className="w-full py-4 rounded-xl text-sm font-black uppercase tracking-widest transition-all"
                style={{ background: saving ? "#2a2010" : "#f5a623", color: saving ? "#5a4020" : "#0c0900" }}>
                {saving ? "Speichern..." : `GW${selectedGW} Punkte berechnen & speichern`}
              </button>
            </>
          )}
        </div>
      )}

      {/* SPIELER IMPORT */}
      {tab === "import" && (
        <div className="w-full max-w-xl space-y-3">

          {/* DB Status */}
          <div className="rounded-xl p-4" style={{ background: "#141008", border: "1px solid #2a2010" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
                Spieler-Datenbank
              </p>
              <p className="text-[8px] font-black uppercase" style={{ color: "#3a2a10" }}>Saison 2024/25</p>
            </div>
            <p className="text-4xl font-black mb-1" style={{ color: "#f5a623" }}>
              {playerCount?.toLocaleString("de-DE") ?? "–"}
            </p>
            <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "#3a2a10" }}>
              Spieler total
            </p>
          </div>

          {/* Per-League Progress */}
          {importStatus?.leagues && (
            <div className="rounded-xl overflow-hidden" style={{ background: "#141008", border: "1px solid #2a2010" }}>
              <p className="text-[9px] font-black uppercase tracking-widest px-4 pt-3 pb-2" style={{ color: "#5a4020" }}>
                Fortschritt pro Liga
              </p>
              {importStatus.leagues.map((lg: any) => {
                const pct = lg.totalPages ? Math.round((lg.pagesDone / lg.totalPages) * 100) : 0;
                const statusColor = lg.done ? "#00ce7d" : lg.pagesDone > 0 ? "#f5a623" : "#3a2a10";
                return (
                  <div key={lg.key} className="px-4 py-2.5 flex items-center gap-3"
                    style={{ borderTop: "1px solid #1a1208" }}>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          {LEAGUE_BADGES[LEAGUE_KEY_TO_APID[lg.key]] && (
                            <img src={LEAGUE_BADGES[LEAGUE_KEY_TO_APID[lg.key]]} alt="" className="w-4 h-4 object-contain" />
                          )}
                          <p className="text-[9px] font-black" style={{ color: "#c8b080" }}>{lg.name}</p>
                        </div>
                        <p className="text-[8px] font-black" style={{ color: statusColor }}>
                          {lg.done ? "✅ Fertig" : lg.pagesDone > 0
                            ? `${lg.pagesDone}/${lg.totalPages ?? "?"} Seiten`
                            : "Ausstehend"}
                        </p>
                      </div>
                      {/* Progress bar */}
                      <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "#2a2010" }}>
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${lg.done ? 100 : pct}%`, background: statusColor }} />
                      </div>
                    </div>
                    <button onClick={() => setImportLeague(lg.key)}
                      className="text-[7px] font-black uppercase px-2 py-1 rounded-lg flex-shrink-0"
                      style={{
                        background: importLeague === lg.key ? "#f5a62320" : "#1a1208",
                        color: importLeague === lg.key ? "#f5a623" : "#3a2a10",
                        border: `1px solid ${importLeague === lg.key ? "#f5a62340" : "#2a2010"}`,
                      }}>
                      {lg.done ? "Neu" : lg.pagesDone > 0 ? "Weiter" : "Starten"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Import starten */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: "#141008", border: "1px solid #2a2010" }}>
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
                Import ausführen
              </p>
              <p className="text-[8px] font-black" style={{ color: "#3a2a10" }}>
                Max. 90 Calls / Run
              </p>
            </div>

            {/* Liga picker */}
            <div className="flex flex-wrap gap-2">
              {[
                { key: "all",        label: "Alle (offen)", apId: null },
                { key: "bundesliga", label: "Bundesliga",   apId: "78"  },
                { key: "premier",    label: "Premier",      apId: "39"  },
                { key: "laliga",     label: "La Liga",      apId: "140" },
                { key: "seriea",     label: "Serie A",      apId: "135" },
                { key: "ligue1",     label: "Ligue 1",      apId: "61"  },
              ].map(({ key, label, apId }) => (
                <button key={key} onClick={() => setImportLeague(key)}
                  className="py-2 px-3 rounded-xl text-[8px] font-black uppercase transition-all flex items-center gap-1.5"
                  style={{
                    background: importLeague === key ? "#f5a62320" : "#0c0900",
                    color: importLeague === key ? "#f5a623" : "#5a4020",
                    border: `1px solid ${importLeague === key ? "#f5a623" : "#2a2010"}`,
                  }}>
                  {apId && LEAGUE_BADGES[apId] && (
                    <img src={LEAGUE_BADGES[apId]} alt="" className="w-3.5 h-3.5 object-contain" />
                  )}
                  {label}
                </button>
              ))}
            </div>

            <div className="p-3 rounded-xl text-[8px]" style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#5a4020" }}>
              💡 Der Import merkt sich den Fortschritt. Bei Tageslimit einfach morgen neu starten — er macht dort weiter wo er aufgehört hat.
              {importStatus?.needsProgressTable && (
                <p className="mt-2" style={{ color: "#f5a623" }}>
                  ⚠ Für Fortschritts-Tracking: Tabelle <code>import_progress</code> in Supabase anlegen
                  (Spalten: league_key text PK, pages_done int, total_pages int, done bool, updated_at text)
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button onClick={() => runImport(false)} disabled={importRunning}
                className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                style={{
                  background: importRunning ? "#2a2010" : "#f5a623",
                  color: importRunning ? "#5a4020" : "#0c0900",
                }}>
                {importRunning ? "⏳ Läuft..." : "▶ Fortsetzen"}
              </button>
              <button onClick={() => runImport(true)} disabled={importRunning}
                className="py-3 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#5a4020" }}>
                ↺ Neu
              </button>
            </div>
          </div>

          {/* Log */}
          {importLog.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: "#141008", border: "1px solid #2a2010" }}>
              <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "#5a4020" }}>
                Ergebnis
              </p>
              <div className="space-y-1">
                {importLog.map((line, i) => (
                  <p key={i} className="text-[10px] font-black"
                    style={{
                      color: line.startsWith("✅") ? "#00ce7d"
                           : line.startsWith("❌") ? "#ff4d6d"
                           : line.startsWith("⏸") ? "#f5a623"
                           : line.startsWith("📅") ? "#4a9eff"
                           : line.startsWith("  →") ? "#4a9eff"
                           : "#c8b080",
                    }}>
                    {line || "\u00A0"}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* EINSTELLUNGEN */}
      {tab === "settings" && (
        <div className="w-full max-w-xl space-y-3">

          {/* Liga-Einstellungen bearbeiten */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: "#141008", border: "1px solid #2a2010" }}>
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
              Liga-Einstellungen
            </p>

            <div>
              <p className="text-[8px] font-black uppercase mb-1" style={{ color: "#8a6a40" }}>Liga-Name</p>
              <input type="text" value={settingsName} onChange={e => setSettingsName(e.target.value)}
                className="w-full p-3 rounded-xl text-sm font-black focus:outline-none"
                style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[8px] font-black uppercase mb-1" style={{ color: "#8a6a40" }}>Max. Teams</p>
                <select value={settingsMaxTeams} onChange={e => setSettingsMaxTeams(Number(e.target.value))}
                  className="w-full p-3 rounded-xl text-sm font-black focus:outline-none"
                  style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }}>
                  {[4,6,8,10,12,14,16].map(n => <option key={n} value={n}>{n} Teams</option>)}
                </select>
              </div>
              <div>
                <p className="text-[8px] font-black uppercase mb-1" style={{ color: "#8a6a40" }}>Wertung</p>
                <select value={settingsScoringType} onChange={e => setSettingsScoringType(e.target.value)}
                  className="w-full p-3 rounded-xl text-sm font-black focus:outline-none"
                  style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }}>
                  <option value="h2h">Head-to-Head</option>
                  <option value="standard">Gesamtpunkte</option>
                </select>
              </div>
            </div>

            <div>
              <p className="text-[8px] font-black uppercase mb-1" style={{ color: "#8a6a40" }}>Liga-Status</p>
              <div className="flex gap-2">
                {(["setup", "drafting", "active", "finished"] as const).map(s => (
                  <button key={s} onClick={() => setSettingsStatus(s)}
                    className="flex-1 py-2 rounded-xl text-[8px] font-black uppercase transition-all"
                    style={{
                      background: settingsStatus === s ? "#f5a623" : "#0c0900",
                      color: settingsStatus === s ? "#0c0900" : "#5a4020",
                      border: `1px solid ${settingsStatus === s ? "#f5a623" : "#2a2010"}`,
                    }}>
                    {s === "setup" ? "Aufbau" : s === "drafting" ? "Draft" : s === "active" ? "Aktiv" : "Beendet"}
                  </button>
                ))}
              </div>
            </div>

            {/* Invite Code */}
            <div className="flex items-center justify-between p-3 rounded-xl"
              style={{ background: "#0c0900", border: "1px solid #2a2010" }}>
              <div>
                <p className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: "#2a2010" }}>
                  Invite-Code
                </p>
                <p className="font-black tracking-widest text-lg" style={{ color: "#f5a623" }}>
                  {league?.invite_code}
                </p>
              </div>
              <button onClick={() => navigator.clipboard.writeText(league?.invite_code || "")}
                className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase"
                style={{ background: "#2a2010", color: "#c8b080" }}>
                Kopieren
              </button>
            </div>

            <button onClick={saveSettings} disabled={saving}
              className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
              style={{ background: saving ? "#2a2010" : "#f5a623", color: saving ? "#5a4020" : "#0c0900" }}>
              {saving ? "Speichern..." : settingsSaved ? "✓ Gespeichert" : "Einstellungen speichern"}
            </button>
          </div>

          {/* Kader & Spots */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: "#141008", border: "1px solid #2a2010" }}>
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
              Kader-Einstellungen
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Kader-Größe", val: squadSize, set: setSquadSize, min: 10, max: 25 },
                { label: "Bank-Plätze", val: benchSize, set: setBenchSize, min: 2, max: 7 },
                { label: "IR-Spots", val: irSpots, set: setIrSpots, min: 0, max: 4 },
                { label: "Taxi-Spots (U21)", val: taxiSpots, set: setTaxiSpots, min: 0, max: 5 },
              ].map(({ label, val, set, min, max }) => (
                <div key={label}>
                  <p className="text-[8px] font-black uppercase mb-1" style={{ color: "#8a6a40" }}>{label}</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => set(Math.max(min, val - 1))}
                      className="w-7 h-7 rounded-lg font-black text-sm flex items-center justify-center"
                      style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }}>−</button>
                    <span className="flex-1 text-center font-black text-sm" style={{ color: "#f5a623" }}>{val}</span>
                    <button onClick={() => set(Math.min(max, val + 1))}
                      className="w-7 h-7 rounded-lg font-black text-sm flex items-center justify-center"
                      style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div>
              <p className="text-[8px] font-black uppercase mb-1" style={{ color: "#8a6a40" }}>
                Max. Spieler vom selben Club (leer = kein Limit)
              </p>
              <input type="number" value={maxPerClub} min={1} max={10}
                onChange={e => setMaxPerClub(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="kein Limit"
                className="w-full p-2.5 rounded-xl text-sm font-black focus:outline-none"
                style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }} />
            </div>
          </div>

          {/* Positions-Limits */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: "#141008", border: "1px solid #2a2010" }}>
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
              Positions-Limits im Kader
            </p>
            {(["GK","DF","MF","FW"] as const).map(pos => {
              const colors: Record<string,string> = { GK:"#f5a623", DF:"#4a9eff", MF:"#00ce7d", FW:"#ff4d6d" };
              return (
                <div key={pos} className="flex items-center gap-3">
                  <span className="w-8 text-center text-[9px] font-black rounded-lg py-1"
                    style={{ background: colors[pos] + "20", color: colors[pos] }}>{pos}</span>
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    {(["min","max"] as const).map(field => (
                      <div key={field}>
                        <p className="text-[7px] font-black uppercase mb-0.5" style={{ color: "#8a6a40" }}>{field}</p>
                        <input type="number" min={0} max={10}
                          value={posLimits[pos][field]}
                          onChange={e => setPosLimits(prev => ({
                            ...prev,
                            [pos]: { ...prev[pos], [field]: Number(e.target.value) }
                          }))}
                          className="w-full p-1.5 rounded-lg text-sm font-black text-center focus:outline-none"
                          style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Erlaubte Formationen */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: "#141008", border: "1px solid #2a2010" }}>
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
              Erlaubte Formationen
            </p>
            <div className="flex flex-wrap gap-2">
              {["4-3-3","4-4-2","4-5-1","3-5-2","3-4-3","3-6-1","5-3-2","5-4-1","5-2-3"].map(f => {
                const on = allowedFormations.includes(f);
                return (
                  <button key={f} onClick={() => setAllowedFormations(prev =>
                    on ? prev.filter(x => x !== f) : [...prev, f]
                  )}
                    className="px-3 py-1.5 rounded-xl text-[10px] font-black transition-all"
                    style={{
                      background: on ? "#1a1208" : "#0c0900",
                      border: `1px solid ${on ? "#f5a623" : "#2a2010"}`,
                      color: on ? "#f5a623" : "#2a2010",
                    }}>
                    {f}
                  </button>
                );
              })}
            </div>
            <p className="text-[8px] font-black uppercase tracking-widest mt-3" style={{ color: "#3a2a10" }}>
              Seltene Formationen
            </p>
            <div className="flex flex-wrap gap-2">
              {["4-2-4","3-3-4","4-6-0"].map(f => {
                const on = allowedFormations.includes(f);
                return (
                  <button key={f} onClick={() => setAllowedFormations(prev =>
                    on ? prev.filter(x => x !== f) : [...prev, f]
                  )}
                    className="px-3 py-1.5 rounded-xl text-[10px] font-black transition-all"
                    style={{
                      background: on ? "#1a0a1a" : "#0c0900",
                      border: `1px solid ${on ? "#c060ff" : "#2a1a2a"}`,
                      color: on ? "#c060ff" : "#3a1a3a",
                    }}>
                    {f} ✦
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={saveLigaSettings} disabled={saving}
            className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            style={{ background: saving ? "#2a2010" : settingsSaved ? "#00ce7d" : "#f5a623", color: "#0c0900" }}>
            {saving ? "Speichern..." : settingsSaved ? "✓ Kader-Einstellungen gespeichert" : "Kader-Einstellungen speichern"}
          </button>

          {/* Liga löschen */}
          <div className="rounded-xl p-4 space-y-3"
            style={{ background: "#1a0808", border: "1px solid #3a1010" }}>
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#ff4d6d" }}>
              Gefahrenzone
            </p>
            <p className="text-xs" style={{ color: "#5a4020" }}>
              Die Liga, alle Teams, Drafts, Spieltage und Punkte werden unwiderruflich gelöscht.
            </p>

            {!deleteConfirm ? (
              <button onClick={() => setDeleteConfirm(true)}
                className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest"
                style={{ background: "#0c0900", border: "1px solid #3a1010", color: "#ff4d6d" }}>
                Liga löschen
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-black text-center" style={{ color: "#ff4d6d" }}>
                  Wirklich löschen? Das kann nicht rückgängig gemacht werden.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setDeleteConfirm(false)}
                    className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase"
                    style={{ background: "#2a2010", color: "#c8b080" }}>
                    Abbrechen
                  </button>
                  <button onClick={deleteLeague}
                    className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase"
                    style={{ background: "#ff4d6d", color: "#0c0900" }}>
                    Ja, löschen
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
