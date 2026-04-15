"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/app/components/ui/Spinner";
import { BottomNav } from "@/app/components/BottomNav";
import { useToast } from "@/app/components/ToastProvider";
import {
  calcPoints, DEFAULT_SCORING_RULES, mergeRules, RULE_GROUPS,
  type ScoringRules,
} from "@/lib/scoring";
import tsdbLeagues from "@/lib/tsdb-leagues.json";
import { GameweeksTab } from "@/app/components/admin/GameweeksTab";

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

export default function LigaAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [user, setUser] = useState<any>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [league, setLeague] = useState<any>(null);
  // Populated via GameweeksTab's onGameweeksChange callback — needed for the Points tab GW selector
  const [gameweeks, setGameweeks] = useState<any[]>([]);
  const [selectedGW, setSelectedGW] = useState<number>(1);
  const [squadPlayers, setSquadPlayers] = useState<any[]>([]);
  const [playerStats, setPlayerStats] = useState<Record<number, typeof EMPTY_STATS>>({});
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"gameweeks" | "points" | "settings" | "import">("gameweeks");
  const [importLeague, setImportLeague] = useState<string>("all");
  const [importRunning, setImportRunning] = useState(false);
  const [importLog, setImportLog] = useState<string[]>([]);
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [importStatus, setImportStatus] = useState<any>(null);
  // Liga-Einstellungen (Basis)
  const [settingsName, setSettingsName] = useState("");
  const [settingsMaxTeams, setSettingsMaxTeams] = useState(8);
  const [settingsScoringType, setSettingsScoringType] = useState("h2h");
  const [settingsStatus, setSettingsStatus] = useState("setup");
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [irOverview, setIrOverview] = useState<any[]>([]);
  const { toast } = useToast();

  // Liga-Settings (erweitert)
  const [ligaSettings, setLigaSettings] = useState<any>(null);
  const [initializing, setInitializing] = useState(false);
  const [processingWaivers, setProcessingWaivers] = useState(false);
  const [scoringRules, setScoringRules] = useState<ScoringRules>(DEFAULT_SCORING_RULES);
  const [scoringSaved, setScoringSaved] = useState(false);
  const [squadSize, setSquadSize] = useState(15);
  const [benchSize, setBenchSize] = useState(4);
  const [irSpots, setIrSpots] = useState(0);
  const [irMinGW, setIrMinGW] = useState(4);
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
  const [lineupLockMode, setLineupLockMode] = useState<"locked" | "pre_sub" | "live_swap">("locked");

  // Dynasty-Modus
  const [dynastyMode, setDynastyMode] = useState(false);
  const [dynastyRookieRounds, setDynastyRookieRounds] = useState(5);
  const [dynastySeasonHistory, setDynastySeasonHistory] = useState<any[]>([]);
  const [rollingOver, setRollingOver] = useState(false);
  const [loading, setLoading] = useState(true);


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
      setIrMinGW(ls.ir_min_gameweeks || 4);
      setTaxiSpots(ls.taxi_spots || 0);
      setMaxPerClub(ls.max_players_per_club ?? 3);
      if (ls.position_limits) setPosLimits(ls.position_limits);
      if (ls.allowed_formations) setAllowedFormations(ls.allowed_formations);
      setScoringRules(mergeRules(ls.scoring_rules));
      if (ls.lineup_lock_mode) setLineupLockMode(ls.lineup_lock_mode);
      setDynastyMode(ls.dynasty_mode || false);
      setDynastyRookieRounds(ls.dynasty_rookie_rounds || 5);
    }

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

      // IR-Übersicht laden
      await loadIROverview(teamIds);
    }

    // Dynasty: Saison-Historie laden
    const { data: history } = await supabase
      .from("team_season_history")
      .select("*, teams(name)")
      .eq("league_id", leagueId)
      .order("season", { ascending: false })
      .order("final_rank");
    setDynastySeasonHistory(history || []);

    setLoading(false);
  }

  async function loadIROverview(teamIds?: string[]) {
    const ids: string[] = teamIds ?? (await supabase
      .from("teams").select("id").eq("league_id", leagueId)
      .then(r => (r.data ?? []).map((t: any) => t.id)));
    if (!ids.length) return;

    const { data } = await supabase
      .from("liga_ir_slots")
      .select("id, team_id, player_id, placed_at_gw, min_return_gw, teams(name), players(name, position, photo_url)")
      .in("team_id", ids)
      .is("returned_at_gw", null)
      .order("placed_at_gw");
    setIrOverview(data || []);
  }

  async function adminForceReturn(irSlotId: string) {
    await supabase.from("liga_ir_slots")
      .update({ returned_at_gw: -1 })   // -1 = admin override
      .eq("id", irSlotId);
    toast("Spieler von IR befreit", "success");
    await loadIROverview();
  }

  // ── F-33: Dynasty Season Rollover ─────────────────────────────────
  async function startNewSeason() {
    const currentSeason = league?.current_season ?? 1;
    const nextSeason    = currentSeason + 1;

    setRollingOver(true);
    try {
      // 1. Alle Teams laden (für Ranking + Reset)
      const { data: allTeams } = await supabase
        .from("teams")
        .select("id, name, total_points, wins, losses, draws")
        .eq("league_id", leagueId)
        .order("total_points", { ascending: false });

      if (!allTeams || allTeams.length === 0) {
        toast("Keine Teams gefunden", "error"); setRollingOver(false); return;
      }

      // 2. Saison-Statistiken speichern (bester zuerst = Rang 1)
      for (let i = 0; i < allTeams.length; i++) {
        const t = allTeams[i];
        await supabase.from("team_season_history").upsert({
          league_id:    leagueId,
          team_id:      t.id,
          season:       currentSeason,
          total_points: t.total_points || 0,
          wins:         t.wins    || 0,
          losses:       t.losses  || 0,
          draws:        t.draws   || 0,
          final_rank:   i + 1,
        }, { onConflict: "team_id,season" });
      }

      // 3. Team-Stats zurücksetzen
      for (const t of allTeams) {
        await supabase.from("teams")
          .update({ total_points: 0, wins: 0, losses: 0, draws: 0 })
          .eq("id", t.id);
      }

      // 4. Neue Saison-Nummer hochsetzen
      await supabase.from("leagues")
        .update({ current_season: nextSeason, status: "active" })
        .eq("id", leagueId);

      // 5. Draft Order = schlechteste Saison → erste Pick (umgekehrte Standings)
      const draftOrder = [...allTeams].reverse().map(t => t.id);
      const rookieRounds = dynastyRookieRounds;
      const totalPicks   = draftOrder.length * rookieRounds;

      // Alten Draft löschen, neuen anlegen
      await supabase.from("draft_sessions").delete().eq("league_id", leagueId);
      await supabase.from("draft_sessions").insert({
        league_id:       leagueId,
        status:          "pending",
        draft_type:      "dynasty",
        season:          nextSeason,
        draft_order:     draftOrder,
        current_pick:    0,
        total_picks:     totalPicks,
        seconds_per_pick: 86400, // 24h default
      });

      // 6. Spieltage der alten Saison archivieren (Status setzen)
      await supabase.from("liga_gameweeks")
        .update({ status: "finished" })
        .eq("league_id", leagueId)
        .neq("status", "finished");

      setLeague((prev: any) => ({ ...prev, current_season: nextSeason, status: "active" }));

      // Saison-Historie neu laden
      const { data: history } = await supabase
        .from("team_season_history")
        .select("*, teams(name)")
        .eq("league_id", leagueId)
        .order("season", { ascending: false })
        .order("final_rank");
      setDynastySeasonHistory(history || []);

      toast(`✅ Saison ${nextSeason} gestartet! Rookie-Draft bereit.`, "success");
    } catch (e: any) {
      toast("Fehler: " + e.message, "error");
    }
    setRollingOver(false);
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

  async function saveSettings() {
    setSaving(true);
    const { error } = await supabase.from("leagues").update({
      name: settingsName.trim(),
      max_teams: settingsMaxTeams,
      scoring_type: settingsScoringType,
      status: settingsStatus,
    }).eq("id", leagueId);
    if (error) { toast("Fehler: " + error.message, "error"); setSaving(false); return; }
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
      ir_min_gameweeks: irMinGW,
      taxi_spots: taxiSpots,
      max_players_per_club: maxPerClub === "" ? null : Number(maxPerClub),
      position_limits: posLimits,
      allowed_formations: allowedFormations,
      lineup_lock_mode: lineupLockMode,
      dynasty_mode: dynastyMode,
      dynasty_rookie_rounds: dynastyRookieRounds,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("liga_settings")
      .upsert(payload, { onConflict: "league_id" });
    if (error) { toast("Fehler: " + error.message, "error"); setSaving(false); return; }
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
      toast("Fehler beim Löschen: " + error.message, "error");
      setDeleteConfirm(false);
      return;
    }
    if (count === 0) {
      toast("Liga konnte nicht gelöscht werden. Fehlende Berechtigung?", "error");
      setDeleteConfirm(false);
      return;
    }
    window.location.href = "/leagues";
  }

  async function updateSetting(key: string, value: unknown) {
    await supabase.from("liga_settings")
      .upsert({ league_id: leagueId, [key]: value, updated_at: new Date().toISOString() }, { onConflict: "league_id" });
    setLigaSettings((prev: any) => ({ ...(prev || {}), [key]: value }));
  }

  async function initWaiverWire() {
    setInitializing(true);
    const res = await fetch("/api/waiver-init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leagueId }),
    });
    const json = await res.json();
    if (json.ok) toast(`${json.inserted} Spieler auf Waiver Wire geschrieben`, "success");
    else toast(`Fehler: ${json.error}`, "error");
    setInitializing(false);
  }

  async function saveScoringRules() {
    setSaving(true);
    await supabase.from("liga_settings")
      .upsert({ league_id: leagueId, scoring_rules: scoringRules, updated_at: new Date().toISOString() }, { onConflict: "league_id" });
    setScoringSaved(true);
    setTimeout(() => setScoringSaved(false), 3000);
    setSaving(false);
  }

  async function resetScoringRules() {
    setScoringRules(DEFAULT_SCORING_RULES);
  }

  async function processWaivers() {
    setProcessingWaivers(true);
    try {
      const res = await fetch("/api/process-waivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId }),
      });
      const json = await res.json();
      if (json.ok) {
        toast(`✅ Waivers verarbeitet: ${json.approved} genehmigt, ${json.rejected} abgelehnt`, "success");
      } else {
        toast(`Fehler: ${json.error}`, "error");
      }
    } catch (e: any) {
      toast(`Fehler: ${e.message}`, "error");
    }
    setProcessingWaivers(false);
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
          const pts = calcPoints(stats, player.position, isCaptain, scoringRules);

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

      toast(`GW${selectedGW} Punkte gespeichert!`, "success");
    } catch (e: any) { toast("Fehler: " + e.message, "error"); }
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
    <main className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <Spinner text="Lade Admin..." />
    </main>
  );

  if (!isOwner) return (
    <main className="flex min-h-screen items-center justify-center flex-col gap-4" style={{ background: "var(--bg-page)" }}>
      <p className="text-sm font-black" style={{ color: "var(--color-error)" }}>Kein Zugriff</p>
      <button onClick={() => window.location.href = `/leagues/${leagueId}`}
        className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>← Zurück</button>
    </main>
  );

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "var(--bg-page)" }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "var(--color-primary)" }} />

      {/* Header */}
      <div className="w-full max-w-xl flex justify-between items-center mb-5">
        <button onClick={() => window.location.href = `/leagues/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>← Liga</button>
        <div className="text-center">
          <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Admin</p>
          <p className="text-sm font-black" style={{ color: "var(--color-primary)" }}>{league?.name}</p>
        </div>
        <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
          style={{ background: "color-mix(in srgb, var(--color-primary) 10%, var(--bg-page))", border: "1px solid var(--color-primary)", color: "var(--color-primary)" }}>Owner</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 w-full max-w-xl mb-5 p-1 rounded-xl" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
        {([
          { id: "gameweeks", label: "Spieltage" },
          { id: "points",    label: "Punkte" },
          { id: "settings",  label: "Einstellungen" },
          { id: "import",    label: "Import" },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex-1 py-2 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all"
            style={{ background: tab === t.id ? "var(--color-primary)" : "transparent", color: tab === t.id ? "var(--bg-page)" : "var(--color-muted)" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* SPIELTAGE VERWALTEN */}
      {tab === "gameweeks" && (
        <GameweeksTab
          leagueId={leagueId}
          userId={user.id}
          onGWSelect={setSelectedGW}
          onGameweeksChange={setGameweeks}
        />
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
                  background: selectedGW === gw.gameweek ? "var(--color-primary)" : "var(--bg-card)",
                  color: selectedGW === gw.gameweek ? "var(--bg-page)" : "var(--color-muted)",
                  border: `1px solid ${selectedGW === gw.gameweek ? "var(--color-primary)" : "var(--color-border)"}`,
                }}>
                GW{gw.gameweek}
              </button>
            ))}
          </div>

          {gameweeks.length === 0 ? (
            <p className="text-center text-sm font-black py-8" style={{ color: "var(--color-border)" }}>
              Erst Spieltage anlegen
            </p>
          ) : (
            <>
              <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
                GW{selectedGW} · {squadPlayers.length} Spieler im Pool
              </p>
              <div className="space-y-2 mb-4">
                {squadPlayers.map(({ player_id, players: p }) => {
                  if (!p) return null;
                  const s = getStat(player_id);
                  const pts = calcPoints(s, p.position, false, scoringRules);
                  return (
                    <div key={player_id} className="rounded-xl p-3"
                      style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {p.photo_url && <img src={p.photo_url} className="w-7 h-7 rounded-full" alt="" />}
                          <div>
                            <p className="font-black text-sm" style={{ color: "var(--color-text)" }}>{p.name}</p>
                            <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                              {p.position} · {p.team_name}
                            </p>
                          </div>
                        </div>
                        <span className="text-sm font-black" style={{ color: "var(--color-primary)" }}>{pts.toFixed(1)}</span>
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
                            <p className="text-[7px] font-black uppercase mb-0.5" style={{ color: "var(--color-dim)" }}>{label}</p>
                            <input type="number" min={0}
                              value={s[key as keyof typeof s] as number}
                              onChange={e => updateStat(player_id, key as any, Number(e.target.value))}
                              className="w-full p-1 rounded text-xs text-center font-black focus:outline-none"
                              style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
                          </div>
                        ))}
                        <div className="col-span-4 flex items-center gap-2 mt-1">
                          <input type="checkbox" id={`cs-${player_id}`} checked={s.clean_sheet}
                            onChange={e => updateStat(player_id, "clean_sheet", e.target.checked)} className="w-4 h-4" />
                          <label htmlFor={`cs-${player_id}`} className="text-[9px] font-black uppercase"
                            style={{ color: "var(--color-muted)" }}>Clean Sheet</label>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button onClick={savePoints} disabled={saving}
                className="w-full py-4 rounded-xl text-sm font-black uppercase tracking-widest transition-all"
                style={{ background: saving ? "var(--color-border)" : "var(--color-primary)", color: saving ? "var(--color-muted)" : "var(--bg-page)" }}>
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
          <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                Spieler-Datenbank
              </p>
              <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-border-subtle)" }}>Saison 2024/25</p>
            </div>
            <p className="text-4xl font-black mb-1" style={{ color: "var(--color-primary)" }}>
              {playerCount?.toLocaleString("de-DE") ?? "–"}
            </p>
            <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>
              Spieler total
            </p>
          </div>

          {/* Per-League Progress */}
          {importStatus?.leagues && (
            <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
              <p className="text-[9px] font-black uppercase tracking-widest px-4 pt-3 pb-2" style={{ color: "var(--color-muted)" }}>
                Fortschritt pro Liga
              </p>
              {importStatus.leagues.map((lg: any) => {
                const pct = lg.totalPages ? Math.round((lg.pagesDone / lg.totalPages) * 100) : 0;
                const statusColor = lg.done ? "var(--color-success)" : lg.pagesDone > 0 ? "var(--color-primary)" : "var(--color-border-subtle)";
                return (
                  <div key={lg.key} className="px-4 py-2.5 flex items-center gap-3"
                    style={{ borderTop: "1px solid var(--bg-elevated)" }}>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          {LEAGUE_BADGES[LEAGUE_KEY_TO_APID[lg.key]] && (
                            <img src={LEAGUE_BADGES[LEAGUE_KEY_TO_APID[lg.key]]} alt="" className="w-4 h-4 object-contain" />
                          )}
                          <p className="text-[9px] font-black" style={{ color: "var(--color-text)" }}>{lg.name}</p>
                        </div>
                        <p className="text-[8px] font-black" style={{ color: statusColor }}>
                          {lg.done ? "✅ Fertig" : lg.pagesDone > 0
                            ? `${lg.pagesDone}/${lg.totalPages ?? "?"} Seiten`
                            : "Ausstehend"}
                        </p>
                      </div>
                      {/* Progress bar */}
                      <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${lg.done ? 100 : pct}%`, background: statusColor }} />
                      </div>
                    </div>
                    <button onClick={() => setImportLeague(lg.key)}
                      className="text-[7px] font-black uppercase px-2 py-1 rounded-lg flex-shrink-0"
                      style={{
                        background: importLeague === lg.key ? "var(--color-primary)20" : "var(--bg-elevated)",
                        color: importLeague === lg.key ? "var(--color-primary)" : "var(--color-border-subtle)",
                        border: `1px solid ${importLeague === lg.key ? "var(--color-primary)40" : "var(--color-border)"}`,
                      }}>
                      {lg.done ? "Neu" : lg.pagesDone > 0 ? "Weiter" : "Starten"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Import starten */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                Import ausführen
              </p>
              <p className="text-[8px] font-black" style={{ color: "var(--color-border-subtle)" }}>
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
                    background: importLeague === key ? "var(--color-primary)20" : "var(--bg-page)",
                    color: importLeague === key ? "var(--color-primary)" : "var(--color-muted)",
                    border: `1px solid ${importLeague === key ? "var(--color-primary)" : "var(--color-border)"}`,
                  }}>
                  {apId && LEAGUE_BADGES[apId] && (
                    <img src={LEAGUE_BADGES[apId]} alt="" className="w-3.5 h-3.5 object-contain" />
                  )}
                  {label}
                </button>
              ))}
            </div>

            <div className="p-3 rounded-xl text-[8px]" style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}>
              💡 Der Import merkt sich den Fortschritt. Bei Tageslimit einfach morgen neu starten — er macht dort weiter wo er aufgehört hat.
              {importStatus?.needsProgressTable && (
                <p className="mt-2" style={{ color: "var(--color-primary)" }}>
                  ⚠ Für Fortschritts-Tracking: Tabelle <code>import_progress</code> in Supabase anlegen
                  (Spalten: league_key text PK, pages_done int, total_pages int, done bool, updated_at text)
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button onClick={() => runImport(false)} disabled={importRunning}
                className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                style={{
                  background: importRunning ? "var(--color-border)" : "var(--color-primary)",
                  color: importRunning ? "var(--color-muted)" : "var(--bg-page)",
                }}>
                {importRunning ? "⏳ Läuft..." : "▶ Fortsetzen"}
              </button>
              <button onClick={() => runImport(true)} disabled={importRunning}
                className="py-3 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}>
                ↺ Neu
              </button>
            </div>
          </div>

          {/* Log */}
          {importLog.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
              <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
                Ergebnis
              </p>
              <div className="space-y-1">
                {importLog.map((line, i) => (
                  <p key={i} className="text-[10px] font-black"
                    style={{
                      color: line.startsWith("✅") ? "var(--color-success)"
                           : line.startsWith("❌") ? "var(--color-error)"
                           : line.startsWith("⏸") ? "var(--color-primary)"
                           : line.startsWith("📅") ? "var(--color-info)"
                           : line.startsWith("  →") ? "var(--color-info)"
                           : "var(--color-text)",
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
          <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              Liga-Einstellungen
            </p>

            <div>
              <p className="text-[8px] font-black uppercase mb-1" style={{ color: "var(--color-dim)" }}>Liga-Name</p>
              <input type="text" value={settingsName} onChange={e => setSettingsName(e.target.value)}
                className="w-full p-3 rounded-xl text-sm font-black focus:outline-none"
                style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[8px] font-black uppercase mb-1" style={{ color: "var(--color-dim)" }}>Max. Teams</p>
                <select value={settingsMaxTeams} onChange={e => setSettingsMaxTeams(Number(e.target.value))}
                  className="w-full p-3 rounded-xl text-sm font-black focus:outline-none"
                  style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}>
                  {[4,6,8,10,12,14,16].map(n => <option key={n} value={n}>{n} Teams</option>)}
                </select>
              </div>
              <div>
                <p className="text-[8px] font-black uppercase mb-1" style={{ color: "var(--color-dim)" }}>Wertung</p>
                <select value={settingsScoringType} onChange={e => setSettingsScoringType(e.target.value)}
                  className="w-full p-3 rounded-xl text-sm font-black focus:outline-none"
                  style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}>
                  <option value="h2h">Head-to-Head</option>
                  <option value="standard">Gesamtpunkte</option>
                </select>
              </div>
            </div>

            <div>
              <p className="text-[8px] font-black uppercase mb-1" style={{ color: "var(--color-dim)" }}>Liga-Status</p>
              <div className="flex gap-2">
                {(["setup", "drafting", "active", "finished"] as const).map(s => (
                  <button key={s} onClick={() => setSettingsStatus(s)}
                    className="flex-1 py-2 rounded-xl text-[8px] font-black uppercase transition-all"
                    style={{
                      background: settingsStatus === s ? "var(--color-primary)" : "var(--bg-page)",
                      color: settingsStatus === s ? "var(--bg-page)" : "var(--color-muted)",
                      border: `1px solid ${settingsStatus === s ? "var(--color-primary)" : "var(--color-border)"}`,
                    }}>
                    {s === "setup" ? "Aufbau" : s === "drafting" ? "Draft" : s === "active" ? "Aktiv" : "Beendet"}
                  </button>
                ))}
              </div>
            </div>

            {/* Invite Code */}
            <div className="flex items-center justify-between p-3 rounded-xl"
              style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)" }}>
              <div>
                <p className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: "var(--color-border)" }}>
                  Invite-Code
                </p>
                <p className="font-black tracking-widest text-lg" style={{ color: "var(--color-primary)" }}>
                  {league?.invite_code}
                </p>
              </div>
              <button onClick={() => navigator.clipboard.writeText(league?.invite_code || "")}
                className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase"
                style={{ background: "var(--color-border)", color: "var(--color-text)" }}>
                Kopieren
              </button>
            </div>

            <button onClick={saveSettings} disabled={saving}
              className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
              style={{ background: saving ? "var(--color-border)" : "var(--color-primary)", color: saving ? "var(--color-muted)" : "var(--bg-page)" }}>
              {saving ? "Speichern..." : settingsSaved ? "✓ Gespeichert" : "Einstellungen speichern"}
            </button>
          </div>

          {/* Kader & Spots */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              Kader-Einstellungen
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Kader-Größe",       val: squadSize,  set: setSquadSize,  min: 10, max: 25 },
                { label: "Bank-Plätze",        val: benchSize,  set: setBenchSize,  min: 2,  max: 7  },
                { label: "IR-Spots",           val: irSpots,    set: setIrSpots,    min: 0,  max: 4  },
                { label: "IR Min. GWs (Sperre)", val: irMinGW, set: setIrMinGW,   min: 1,  max: 12 },
                { label: "Taxi-Spots (U21)",   val: taxiSpots,  set: setTaxiSpots,  min: 0,  max: 5  },
              ].map(({ label, val, set, min, max }) => (
                <div key={label}>
                  <p className="text-[8px] font-black uppercase mb-1" style={{ color: "var(--color-dim)" }}>{label}</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => set(Math.max(min, val - 1))}
                      className="w-7 h-7 rounded-lg font-black text-sm flex items-center justify-center"
                      style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}>−</button>
                    <span className="flex-1 text-center font-black text-sm" style={{ color: "var(--color-primary)" }}>{val}</span>
                    <button onClick={() => set(Math.min(max, val + 1))}
                      className="w-7 h-7 rounded-lg font-black text-sm flex items-center justify-center"
                      style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div>
              <p className="text-[8px] font-black uppercase mb-1" style={{ color: "var(--color-dim)" }}>
                Max. Spieler vom selben Club (leer = kein Limit)
              </p>
              <input type="number" value={maxPerClub} min={1} max={10}
                onChange={e => setMaxPerClub(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="kein Limit"
                className="w-full p-2.5 rounded-xl text-sm font-black focus:outline-none"
                style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
            </div>

            {/* Dynasty-Modus Toggle */}
            <div>
              <p className="text-[8px] font-black uppercase mb-2" style={{ color: "var(--color-dim)" }}>
                Liga-Modus
              </p>
              <button onClick={() => setDynastyMode(v => !v)}
                className="w-full flex items-center justify-between p-2.5 rounded-xl transition-all"
                style={{
                  background: dynastyMode ? "color-mix(in srgb, var(--color-info) 8%, var(--bg-page))" : "var(--bg-page)",
                  border: `1px solid ${dynastyMode ? "var(--color-info)" : "var(--color-border)"}`,
                }}>
                <div className="flex items-center gap-2">
                  <span className="text-base">👑</span>
                  <div className="text-left">
                    <p className="text-[9px] font-black uppercase tracking-widest"
                      style={{ color: dynastyMode ? "var(--color-info)" : "var(--color-dim)" }}>
                      Dynasty-Modus
                    </p>
                    <p className="text-[7px]" style={{ color: "var(--color-muted)" }}>
                      Spieler bleiben zwischen Saisons. Rookie-Draft jede Saison.
                    </p>
                  </div>
                </div>
                <div className={`w-10 h-5 rounded-full transition-all ${dynastyMode ? "bg-[var(--color-info)]" : "bg-[var(--color-border)]"}`}>
                  <div className={`w-5 h-5 rounded-full bg-white shadow transition-all ${dynastyMode ? "translate-x-5" : "translate-x-0"}`} />
                </div>
              </button>
            </div>

            {/* Aufstellungs-Lock-Modus */}
            <div>
              <p className="text-[8px] font-black uppercase mb-2" style={{ color: "var(--color-dim)" }}>
                Aufstellungs-Modus
              </p>
              <div className="flex flex-col gap-1.5">
                {([
                  { id: "locked",    icon: "🔒", label: "Gesperrt",    desc: "Mit Spieltagsbeginn gesperrt. Auto-Sub nach Bankreihenfolge." },
                  { id: "pre_sub",   icon: "🔄", label: "Vorab-Sub",   desc: "Gesperrt bei GW-Start. Bank-Reihenfolge = Auto-Sub Priorität (sichtbar im Lineup)." },
                  { id: "live_swap", icon: "⚡", label: "Live-Tausch", desc: "Während Spieltag: nicht gespielte Starter gegen nicht gespielte Bank tauschen." },
                ] as const).map(opt => (
                  <button key={opt.id} onClick={() => setLineupLockMode(opt.id)}
                    className="flex items-start gap-2.5 p-2.5 rounded-xl text-left transition-all"
                    style={{
                      background: lineupLockMode === opt.id ? "var(--bg-elevated)" : "var(--bg-page)",
                      border: `1px solid ${lineupLockMode === opt.id ? "var(--color-primary)" : "var(--color-border)"}`,
                    }}>
                    <span className="text-base flex-shrink-0 mt-0.5">{opt.icon}</span>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest"
                        style={{ color: lineupLockMode === opt.id ? "var(--color-primary)" : "var(--color-dim)" }}>
                        {opt.label}
                      </p>
                      <p className="text-[8px] leading-relaxed mt-0.5" style={{ color: "var(--color-muted)" }}>
                        {opt.desc}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Positions-Limits */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              Positions-Limits im Kader
            </p>
            {(["GK","DF","MF","FW"] as const).map(pos => {
              const colors: Record<string,string> = { GK:"var(--color-primary)", DF:"var(--color-info)", MF:"var(--color-success)", FW:"var(--color-error)" };
              return (
                <div key={pos} className="flex items-center gap-3">
                  <span className="w-8 text-center text-[9px] font-black rounded-lg py-1"
                    style={{ background: colors[pos] + "20", color: colors[pos] }}>{pos}</span>
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    {(["min","max"] as const).map(field => (
                      <div key={field}>
                        <p className="text-[7px] font-black uppercase mb-0.5" style={{ color: "var(--color-dim)" }}>{field}</p>
                        <input type="number" min={0} max={10}
                          value={posLimits[pos][field]}
                          onChange={e => setPosLimits(prev => ({
                            ...prev,
                            [pos]: { ...prev[pos], [field]: Number(e.target.value) }
                          }))}
                          className="w-full p-1.5 rounded-lg text-sm font-black text-center focus:outline-none"
                          style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Erlaubte Formationen */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
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
                      background: on ? "var(--bg-elevated)" : "var(--bg-page)",
                      border: `1px solid ${on ? "var(--color-primary)" : "var(--color-border)"}`,
                      color: on ? "var(--color-primary)" : "var(--color-border)",
                    }}>
                    {f}
                  </button>
                );
              })}
            </div>
            <p className="text-[8px] font-black uppercase tracking-widest mt-3" style={{ color: "var(--color-border-subtle)" }}>
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
                      background: on ? "color-mix(in srgb, var(--color-info) 8%, var(--bg-page))" : "var(--bg-page)",
                      border: `1px solid ${on ? "var(--color-info)" : "var(--color-border)"}`,
                      color: on ? "var(--color-info)" : "var(--color-muted)",
                    }}>
                    {f} ✦
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={saveLigaSettings} disabled={saving}
            className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            style={{ background: saving ? "var(--color-border)" : settingsSaved ? "var(--color-success)" : "var(--color-primary)", color: "var(--bg-page)" }}>
            {saving ? "Speichern..." : settingsSaved ? "✓ Kader-Einstellungen gespeichert" : "Kader-Einstellungen speichern"}
          </button>

          {/* Waiver Wire */}
          <div className="w-full mt-2 p-4 rounded-2xl"
            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--color-primary)" }}>
                Waiver Wire
              </p>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox"
                  checked={!!ligaSettings?.waiver_enabled}
                  onChange={e => updateSetting("waiver_enabled", e.target.checked)}
                  className="sr-only peer" />
                <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-[var(--color-primary)]" />
              </label>
            </div>

            {ligaSettings?.waiver_enabled && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black uppercase" style={{ color: "var(--color-muted)" }}>Startet ab GW</span>
                  <input type="number" min="1" max="38"
                    value={ligaSettings.waiver_mode_starts_gameweek || 4}
                    onChange={e => updateSetting("waiver_mode_starts_gameweek", Number(e.target.value))}
                    className="w-16 px-2 py-1 rounded text-xs font-black text-right"
                    style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black uppercase" style={{ color: "var(--color-muted)" }}>FAAB-Budget</span>
                  <label className="inline-flex items-center cursor-pointer">
                    <input type="checkbox"
                      checked={!!ligaSettings.waiver_budget_enabled}
                      onChange={e => updateSetting("waiver_budget_enabled", e.target.checked)}
                      className="sr-only peer" />
                    <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-[var(--color-primary)]" />
                  </label>
                </div>
                {ligaSettings.waiver_budget_enabled && (
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black uppercase" style={{ color: "var(--color-muted)" }}>Start-Bucks</span>
                    <input type="number" min="1" max="1000"
                      value={ligaSettings.waiver_budget_starting || 100}
                      onChange={e => updateSetting("waiver_budget_starting", Number(e.target.value))}
                      className="w-20 px-2 py-1 rounded text-xs font-black text-right"
                      style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black uppercase" style={{ color: "var(--color-muted)" }}>Max. Claims / GW</span>
                  <input type="number" min="1" max="20"
                    value={ligaSettings.waiver_max_claims_per_gameweek || 3}
                    onChange={e => updateSetting("waiver_max_claims_per_gameweek", Number(e.target.value))}
                    className="w-16 px-2 py-1 rounded text-xs font-black text-right"
                    style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={initWaiverWire} disabled={initializing}
                    className="flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest"
                    style={{ background: initializing ? "var(--color-border)" : "var(--bg-elevated)", color: initializing ? "var(--color-muted)" : "var(--color-text)", border: "1px solid var(--color-border)" }}>
                    {initializing ? "Initialisiere..." : "Wire initialisieren"}
                  </button>
                  <button onClick={processWaivers} disabled={processingWaivers}
                    className="flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest"
                    style={{ background: processingWaivers ? "var(--color-border)" : "var(--color-primary)", color: "var(--bg-page)" }}>
                    {processingWaivers ? "Verarbeite..." : "Waivers verarbeiten"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Punkteschema */}
          <div className="rounded-xl p-4 space-y-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                Punkteschema
              </p>
              <button onClick={resetScoringRules}
                className="text-[8px] font-black uppercase tracking-wider px-2 py-1 rounded-lg"
                style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}>
                Reset
              </button>
            </div>

            {RULE_GROUPS.map(group => (
              <div key={group.label}>
                <p className="text-[8px] font-black uppercase tracking-widest mb-2"
                  style={{ color: group.color + "aa" }}>
                  {group.label}
                </p>
                <div className="grid gap-2"
                  style={{ gridTemplateColumns: `repeat(${Math.min(group.fields.length, 4)}, 1fr)` }}>
                  {group.fields.map(f => (
                    <div key={f.key}>
                      <p className="text-[7px] font-black uppercase mb-1" style={{ color: "var(--color-muted)" }}>
                        {f.label}
                      </p>
                      <input
                        type="number"
                        step={f.step}
                        min={f.min}
                        max={f.max}
                        value={scoringRules[f.key]}
                        onChange={e => setScoringRules(prev => ({
                          ...prev,
                          [f.key]: parseFloat(e.target.value) || 0,
                        }))}
                        className="w-full p-2 rounded-lg text-xs font-black text-center focus:outline-none"
                        style={{
                          background: "var(--bg-page)",
                          border: `1px solid ${scoringRules[f.key] !== DEFAULT_SCORING_RULES[f.key] ? group.color + "88" : "var(--color-border)"}`,
                          color: scoringRules[f.key] !== DEFAULT_SCORING_RULES[f.key] ? group.color : "var(--color-text)",
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <button onClick={saveScoringRules} disabled={saving}
              className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
              style={{ background: saving ? "var(--color-border)" : scoringSaved ? "var(--color-success)" : "var(--color-primary)", color: "var(--bg-page)" }}>
              {saving ? "Speichern..." : scoringSaved ? "✓ Punkteschema gespeichert" : "Punkteschema speichern"}
            </button>
          </div>

          {/* IR-Übersicht */}
          {irOverview.length > 0 && (
            <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                  Aktive IR-Sperren ({irOverview.length})
                </p>
                <button onClick={() => loadIROverview()}
                  className="text-[8px] font-black px-2 py-1 rounded-lg"
                  style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}>
                  ↻
                </button>
              </div>
              <div className="space-y-2">
                {irOverview.map((slot: any) => {
                  const player = slot.players;
                  const team   = slot.teams;
                  return (
                    <div key={slot.id} className="flex items-center gap-3 p-2.5 rounded-xl"
                      style={{ background: "var(--bg-page)", border: "1px solid var(--color-error)20" }}>
                      {player?.photo_url ? (
                        <img src={player.photo_url} className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                          style={{ border: "1px solid var(--color-error)30" }} alt="" />
                      ) : (
                        <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center"
                          style={{ background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))", border: "1px solid var(--color-error)30" }}>
                          <span className="text-[8px] font-black" style={{ color: "var(--color-error)" }}>
                            {player?.position || "?"}
                          </span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black truncate" style={{ color: "var(--color-text)" }}>
                          {player?.name || "—"}
                        </p>
                        <p className="text-[7px]" style={{ color: "var(--color-muted)" }}>
                          {team?.name} · GW{slot.placed_at_gw} → frei ab GW{slot.min_return_gw}
                        </p>
                      </div>
                      <button onClick={() => adminForceReturn(slot.id)}
                        className="flex-shrink-0 text-[8px] font-black px-2 py-1 rounded-lg transition-all"
                        style={{ background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))", border: "1px solid var(--color-error)40", color: "var(--color-error)" }}>
                        Freigeben
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── F-33: Dynasty-Einstellungen ── */}
          {dynastyMode && (
            <div className="rounded-xl p-4 space-y-4" style={{ background: "color-mix(in srgb, var(--color-info) 8%, var(--bg-page))", border: "1px solid var(--color-info)30" }}>
              <div className="flex items-center gap-2">
                <span className="text-base">👑</span>
                <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-info)" }}>
                  Dynasty — Saison {league?.current_season ?? 1}
                </p>
              </div>

              {/* Rookie-Draft Runden */}
              <div>
                <p className="text-[8px] font-black uppercase mb-1" style={{ color: "var(--color-info)" }}>
                  Rookie-Draft Runden
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setDynastyRookieRounds(r => Math.max(1, r - 1))}
                    className="w-7 h-7 rounded-lg font-black text-sm flex items-center justify-center"
                    style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}>−</button>
                  <span className="flex-1 text-center font-black text-sm" style={{ color: "var(--color-info)" }}>
                    {dynastyRookieRounds}
                  </span>
                  <button onClick={() => setDynastyRookieRounds(r => Math.min(15, r + 1))}
                    className="w-7 h-7 rounded-lg font-black text-sm flex items-center justify-center"
                    style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}>+</button>
                </div>
              </div>

              {/* Neue Saison starten */}
              <div className="rounded-xl p-3" style={{ background: "var(--bg-page)", border: "1px solid var(--color-info)20" }}>
                <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-info)" }}>
                  Neue Saison starten
                </p>
                <p className="text-[8px] leading-relaxed mb-3" style={{ color: "var(--color-muted)" }}>
                  Speichert Saisonstatistiken. Setzt Punkte zurück. Erstellt Rookie-Draft (schlechteste Mannschaft wählt zuerst). Alle Spieler bleiben im Kader.
                </p>
                <button onClick={startNewSeason} disabled={rollingOver}
                  className="w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-40 transition-all"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-info)60", color: "var(--color-info)" }}>
                  {rollingOver ? "Wird verarbeitet..." : `→ Saison ${(league?.current_season ?? 1) + 1} starten`}
                </button>
              </div>

              {/* Saison-Historik */}
              {dynastySeasonHistory.length > 0 && (() => {
                const seasons = [...new Set(dynastySeasonHistory.map((r: any) => r.season))].sort((a, b) => b - a);
                return (
                  <div>
                    <p className="text-[8px] font-black uppercase mb-2" style={{ color: "var(--color-info)" }}>
                      Saison-Historie
                    </p>
                    {seasons.map(s => {
                      const rows = dynastySeasonHistory.filter((r: any) => r.season === s);
                      return (
                        <div key={s} className="mb-3 rounded-xl overflow-hidden"
                          style={{ border: "1px solid var(--color-border)" }}>
                          <div className="px-3 py-1.5" style={{ background: "var(--bg-elevated)" }}>
                            <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-info)" }}>
                              Saison {s}
                            </p>
                          </div>
                          {rows.map((r: any) => (
                            <div key={r.id} className="flex items-center justify-between px-3 py-1.5"
                              style={{ background: "var(--bg-page)", borderTop: "1px solid var(--color-border)" }}>
                              <div className="flex items-center gap-2">
                                <span className="text-[8px] font-black w-4 text-center"
                                  style={{ color: r.final_rank <= 3 ? "var(--color-primary)" : "var(--color-muted)" }}>
                                  #{r.final_rank}
                                </span>
                                <span className="text-[9px] font-black" style={{ color: "var(--color-text)" }}>
                                  {r.teams?.name}
                                </span>
                              </div>
                              <span className="text-[9px] font-black" style={{ color: "var(--color-primary)" }}>
                                {r.total_points?.toFixed(1)} pts
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Liga löschen */}
          <div className="rounded-xl p-4 space-y-3"
            style={{ background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))", border: "1px solid color-mix(in srgb, var(--color-error) 20%, var(--bg-page))" }}>
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-error)" }}>
              Gefahrenzone
            </p>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              Die Liga, alle Teams, Drafts, Spieltage und Punkte werden unwiderruflich gelöscht.
            </p>

            {!deleteConfirm ? (
              <button onClick={() => setDeleteConfirm(true)}
                className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest"
                style={{ background: "var(--bg-page)", border: "1px solid color-mix(in srgb, var(--color-error) 20%, var(--bg-page))", color: "var(--color-error)" }}>
                Liga löschen
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-black text-center" style={{ color: "var(--color-error)" }}>
                  Wirklich löschen? Das kann nicht rückgängig gemacht werden.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setDeleteConfirm(false)}
                    className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase"
                    style={{ background: "var(--color-border)", color: "var(--color-text)" }}>
                    Abbrechen
                  </button>
                  <button onClick={deleteLeague}
                    className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase"
                    style={{ background: "var(--color-error)", color: "var(--bg-page)" }}>
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
