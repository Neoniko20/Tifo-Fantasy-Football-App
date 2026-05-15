"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/app/components/ui/Spinner";
import { BottomNav } from "@/app/components/BottomNav";
import { calculateWMGameweekPoints } from "@/lib/wm-points";
import { mergeRules, RULE_GROUPS, DEFAULT_SCORING_RULES, type ScoringRules } from "@/lib/scoring";
import { FORMATION_KEYS } from "@/lib/wm-formations";
import type { WMNation, WMGameweek, WMLeagueSettings } from "@/lib/wm-types";
import type { GWStats } from "@/lib/wm-points";
import { useToast } from "@/app/components/ToastProvider";

const PHASE_LABEL: Record<string, string> = {
  group:        "Gruppenphase",
  round_of_32:  "Sechzehntelfinale",
  round_of_16:  "Achtelfinale",
  quarter:      "Viertelfinale",
  semi:         "Halbfinale",
  final:        "Finale",
};

const EMPTY_STATS: Omit<GWStats, "position"> = {
  goals: 0, assists: 0, minutes: 0, shots_on: 0, key_passes: 0,
  pass_accuracy: 0, dribbles: 0, tackles: 0, interceptions: 0,
  saves: 0, clean_sheet: false, yellow_cards: 0, red_cards: 0,
};

type AdminTab = "general" | "points" | "waiver" | "autosubs" | "nations" | "debug";

const TABS: { id: AdminTab; label: string }[] = [
  { id: "general",  label: "Allgemein"      },
  { id: "points",   label: "Spieltage"      },
  { id: "waiver",   label: "Waiver"         },
  { id: "autosubs", label: "Auto-Subs"      },
  { id: "nations",  label: "Ausscheidungen" },
  { id: "debug",    label: "Debug"          },
];

export default function WMAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  // ── Core state ────────────────────────────────────────────────
  const [user, setUser]             = useState<any>(null);
  const [isOwner, setIsOwner]       = useState(false);
  const [league, setLeague]         = useState<any>(null);
  const [settings, setSettings]     = useState<WMLeagueSettings | null>(null);
  const [gameweeks, setGameweeks]   = useState<WMGameweek[]>([]);
  const [nations, setNations]       = useState<WMNation[]>([]);
  const [selectedGW, setSelectedGW] = useState<number>(1);
  const [squadPlayers, setSquadPlayers] = useState<any[]>([]);
  const [playerStats, setPlayerStats]   = useState<Record<number, Omit<GWStats, "position">>>({});
  const [tournament, setTournament]     = useState<any>(null);
  const [teamsCount, setTeamsCount]     = useState(0);
  const [tab, setTab]   = useState<AdminTab>("general");
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // ── Operation state ───────────────────────────────────────────
  const [saving, setSaving]                     = useState(false);
  const [settingsSaved, setSettingsSaved]       = useState(false);
  const [processingWaivers, setProcessingWaivers]   = useState(false);
  const [processingAutoSubs, setProcessingAutoSubs] = useState(false);
  const [eliminateNation, setEliminateNation]   = useState<string>("");
  const [copied, setCopied]                     = useState(false);

  // ── Editable liga fields ──────────────────────────────────────
  const [editName, setEditName]     = useState("");
  const [editStatus, setEditStatus] = useState("active");

  // ── Editable wm_league_settings fields ───────────────────────
  const [editSquadSize, setEditSquadSize]   = useState(11);
  const [editBenchSize, setEditBenchSize]   = useState(4);
  const [editFormations, setEditFormations] = useState<string[]>([]);
  const [editTransfersPGW, setEditTransfersPGW]           = useState(1);
  const [editTransfersUnlimited, setEditTransfersUnlimited] = useState(false);
  const [editWaiverStartGW, setEditWaiverStartGW]         = useState(1);
  const [editWaiverBudget, setEditWaiverBudget]           = useState(false);
  const [editWaiverBudgetAmt, setEditWaiverBudgetAmt]     = useState(100);
  const [editWaiverClaimsLimit, setEditWaiverClaimsLimit] = useState(false);
  const [editWaiverMaxClaims, setEditWaiverMaxClaims]     = useState(3);
  const [editAutoSubs, setEditAutoSubs]                   = useState(false);

  // ── Scoring rules ─────────────────────────────────────────────
  const [scoringRules, setScoringRules] = useState<ScoringRules>(DEFAULT_SCORING_RULES);
  const [vcEnabled, setVcEnabled]       = useState<boolean>(true);
  const [scoringSaved, setScoringSaved] = useState(false);

  // ── Load ─────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
    });
  }, []);

  async function loadAll(userId: string) {
    const { data: leagueData } = await supabase
      .from("leagues").select("*").eq("id", leagueId).single();
    setLeague(leagueData);

    if (leagueData?.owner_id !== userId) {
      setIsOwner(false);
      setLoading(false);
      return;
    }
    setIsOwner(true);

    // Populate editable league fields
    setEditName(leagueData?.name || "");
    setEditStatus(leagueData?.status || "active");

    const { data: settingsData } = await supabase
      .from("wm_league_settings")
      .select("*, wm_tournaments(id, name, status, start_date, end_date)")
      .eq("league_id", leagueId)
      .maybeSingle();
    setSettings(settingsData);
    if (settingsData?.wm_tournaments) setTournament(settingsData.wm_tournaments);

    // Populate editable WM settings fields
    if (settingsData) {
      setEditSquadSize(settingsData.squad_size ?? 11);
      setEditBenchSize(settingsData.bench_size ?? 4);
      setEditFormations(settingsData.allowed_formations ?? []);
      setEditTransfersPGW(settingsData.transfers_per_gameweek ?? 1);
      setEditTransfersUnlimited(settingsData.transfers_unlimited ?? false);
      setEditWaiverStartGW(settingsData.waiver_mode_starts_gameweek ?? 1);
      setEditWaiverBudget(settingsData.waiver_budget_enabled ?? false);
      setEditWaiverBudgetAmt(settingsData.waiver_budget_starting ?? 100);
      setEditWaiverClaimsLimit(settingsData.waiver_claims_limit_enabled ?? false);
      setEditWaiverMaxClaims(settingsData.waiver_max_claims_per_gameweek ?? 3);
      setEditAutoSubs(settingsData.auto_subs_enabled ?? false);
      const rules = settingsData.scoring_rules;
      setScoringRules(mergeRules(rules));
      setVcEnabled((rules as any)?.vice_captain_enabled ?? true);
    }

    let activeGWNum = 1;
    if (settingsData?.tournament_id) {
      const { data: gws } = await supabase
        .from("wm_gameweeks")
        .select("*")
        .eq("tournament_id", settingsData.tournament_id)
        .order("gameweek");
      setGameweeks(gws || []);

      const active = (gws || []).find(g => g.status === "active");
      if (active) {
        activeGWNum = active.gameweek;
        setSelectedGW(active.gameweek);
      }

      const { data: nationsData } = await supabase
        .from("wm_nations")
        .select("*")
        .eq("tournament_id", settingsData.tournament_id)
        .order("group_letter");
      setNations(nationsData || []);
    }

    const { data: teamsData } = await supabase
      .from("teams").select("id").eq("league_id", leagueId);
    const teamIds = (teamsData || []).map((t: any) => t.id);
    setTeamsCount(teamIds.length);

    if (teamIds.length > 0) {
      const { data: picks } = await supabase
        .from("wm_squad_players")
        .select("player_id, players(id, name, position, team_name)")
        .in("team_id", teamIds);

      const seen = new Set<number>();
      const unique: any[] = [];
      for (const p of (picks || [])) {
        if (!seen.has(p.player_id)) { seen.add(p.player_id); unique.push(p); }
      }
      setSquadPlayers(unique);

      const playerIds = unique.map((p: any) => p.player_id);
      if (playerIds.length > 0) {
        const { data: existingStats } = await supabase
          .from("wm_gameweek_points")
          .select("player_id, goals, assists, minutes, shots_on, key_passes, pass_accuracy, dribbles, tackles, interceptions, saves, clean_sheet, yellow_cards, red_cards")
          .eq("gameweek", activeGWNum)
          .in("player_id", playerIds);

        const statsMap: Record<number, Omit<GWStats, "position">> = {};
        for (const s of (existingStats || [])) {
          statsMap[s.player_id] = {
            goals: s.goals || 0, assists: s.assists || 0, minutes: s.minutes || 0,
            shots_on: s.shots_on || 0, key_passes: s.key_passes || 0,
            pass_accuracy: s.pass_accuracy || 0, dribbles: s.dribbles || 0,
            tackles: s.tackles || 0, interceptions: s.interceptions || 0,
            saves: s.saves || 0, clean_sheet: s.clean_sheet || false,
            yellow_cards: s.yellow_cards || 0, red_cards: s.red_cards || 0,
          };
        }
        setPlayerStats(statsMap);
      }
    }

    setLoading(false);
  }

  // ── Save: leagues table ───────────────────────────────────────
  async function saveLeagueSettings() {
    const trimmed = editName.trim();
    if (trimmed.length < 2) { toast("Name zu kurz (mind. 2 Zeichen)", "error"); return; }
    setSaving(true);
    const { error } = await supabase
      .from("leagues")
      .update({ name: trimmed, status: editStatus })
      .eq("id", leagueId);
    if (error) { toast("Fehler: " + error.message, "error"); setSaving(false); return; }
    setLeague((prev: any) => ({ ...prev, name: trimmed, status: editStatus }));
    showSaved();
    setSaving(false);
  }

  // ── Save: wm_league_settings table ───────────────────────────
  async function saveWMSettings() {
    setSaving(true);
    const { error } = await supabase
      .from("wm_league_settings")
      .update({
        squad_size:                    editSquadSize,
        bench_size:                    editBenchSize,
        allowed_formations:            editFormations,
        transfers_per_gameweek:        editTransfersPGW,
        transfers_unlimited:           editTransfersUnlimited,
        waiver_mode_starts_gameweek:   editWaiverStartGW,
        waiver_budget_enabled:         editWaiverBudget,
        waiver_budget_starting:        editWaiverBudgetAmt,
        waiver_claims_limit_enabled:   editWaiverClaimsLimit,
        waiver_max_claims_per_gameweek: editWaiverMaxClaims,
        auto_subs_enabled:             editAutoSubs,
      })
      .eq("league_id", leagueId);
    if (error) { toast("Fehler: " + error.message, "error"); setSaving(false); return; }
    setSettings((prev: any) => prev ? {
      ...prev,
      squad_size: editSquadSize, bench_size: editBenchSize,
      allowed_formations: editFormations, transfers_per_gameweek: editTransfersPGW,
      transfers_unlimited: editTransfersUnlimited,
      waiver_mode_starts_gameweek: editWaiverStartGW,
      waiver_budget_enabled: editWaiverBudget, waiver_budget_starting: editWaiverBudgetAmt,
      waiver_claims_limit_enabled: editWaiverClaimsLimit,
      waiver_max_claims_per_gameweek: editWaiverMaxClaims,
      auto_subs_enabled: editAutoSubs,
    } : prev);
    showSaved();
    setSaving(false);
  }

  async function saveScoringRules() {
    setSaving(true);
    const { error } = await supabase
      .from("wm_league_settings")
      .update({
        scoring_rules: {
          ...scoringRules,
          vice_captain_enabled: vcEnabled,
        },
      })
      .eq("league_id", leagueId);
    if (error) { toast("Fehler: " + error.message, "error"); setSaving(false); return; }
    setScoringSaved(true);
    setTimeout(() => setScoringSaved(false), 2500);
    setSaving(false);
  }

  function resetScoringRules() {
    setScoringRules(DEFAULT_SCORING_RULES);
    setVcEnabled(true);
  }

  function showSaved() {
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2500);
  }

  // ── Points logic ──────────────────────────────────────────────
  function getStat(playerId: number): Omit<GWStats, "position"> {
    return playerStats[playerId] || { ...EMPTY_STATS };
  }

  function updateStat(playerId: number, field: keyof Omit<GWStats, "position">, value: number | boolean) {
    setPlayerStats(prev => ({ ...prev, [playerId]: { ...getStat(playerId), [field]: value } }));
  }

  async function savePoints() {
    setSaving(true);
    try {
      const { data: teamsData } = await supabase
        .from("teams").select("id").eq("league_id", leagueId);
      const teamIds = (teamsData || []).map((t: any) => t.id);

      for (const teamId of teamIds) {
        const { data: lineup } = await supabase
          .from("team_lineups")
          .select("starting_xi, bench, captain_id, vice_captain_id, formation")
          .eq("team_id", teamId).eq("gameweek", selectedGW).maybeSingle();

        const xi: number[]             = lineup?.starting_xi || [];
        const captainId: number | null = lineup?.captain_id || null;
        const vcId: number | null      = lineup?.vice_captain_id || null;

        // VC-Fallback: falls Kapitän nicht spielt (minutes=0), bekommt VC den Multiplikator
        const captainPlaying = captainId !== null && (getStat(captainId).minutes ?? 0) > 0;
        const effectiveCaptain = captainPlaying ? captainId : (vcEnabled ? vcId : captainId);

        let teamGWPoints = 0;

        for (const playerId of xi) {
          const stats  = getStat(playerId);
          const player = squadPlayers.find(p => p.player_id === playerId)?.players;
          if (!player) continue;

          const playerNation = nations.find(n => n.name === player.team_name);
          const isCaptain    = playerId === effectiveCaptain;

          const result = calculateWMGameweekPoints(
            { ...stats, position: player.position },
            playerNation || null,
            selectedGW,
            isCaptain,
            scoringRules,
          );

          await supabase.from("wm_gameweek_points").upsert({
            team_id: teamId, player_id: playerId, gameweek: selectedGW,
            points: result.points, nation_active: result.nation_active,
            is_captain: isCaptain, ...stats,
          }, { onConflict: "team_id,player_id,gameweek" });

          teamGWPoints += result.points;
        }

        const { data: allPoints } = await supabase
          .from("wm_gameweek_points").select("points").eq("team_id", teamId);
        const total = (allPoints || []).reduce((s: number, r: any) => s + (r.points || 0), 0);
        await supabase.from("teams")
          .update({ total_points: Math.round(total * 10) / 10 }).eq("id", teamId);
      }

      toast(`GW ${selectedGW} Punkte gespeichert!`, "success");
    } catch (e: any) {
      toast("Fehler: " + e.message, "error");
    }
    setSaving(false);
  }

  // ── Nations ───────────────────────────────────────────────────
  async function markEliminatedNation() {
    if (!eliminateNation) return;
    await supabase.from("wm_nations")
      .update({ eliminated_after_gameweek: selectedGW }).eq("id", eliminateNation);
    setNations(prev => prev.map(n =>
      n.id === eliminateNation ? { ...n, eliminated_after_gameweek: selectedGW } : n
    ));
    setEliminateNation("");
  }

  // ── Auto-Subs ─────────────────────────────────────────────────
  async function executeAutoSubs(gwId: string, gwNum: number) {
    if (processingAutoSubs) return;
    setProcessingAutoSubs(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/wm/${leagueId}/auto-subs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ gameweek_id: gwId }),
      });
      const data = await res.json();
      if (data.ok) {
        toast(
          `GW${gwNum} Auto-Subs: ${data.totalSubs} Einwechslungen${data.skipped ? `, ${data.skipped} Teams übersprungen` : ""}`,
          data.totalSubs > 0 ? "success" : "info",
        );
      } else {
        toast("Fehler: " + (data.error || "Unbekannt"), "error");
      }
    } catch (e: any) { toast("Fehler: " + e.message, "error"); }
    setProcessingAutoSubs(false);
  }

  // ── Waiver ────────────────────────────────────────────────────
  async function processWaivers(gwNum: number) {
    if (processingWaivers) return;
    setProcessingWaivers(true);
    try {
      const res = await fetch("/api/process-waivers-wm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId, gameweek: gwNum }),
      });
      const data = await res.json();
      if (data.ok) {
        toast(`Waivers verarbeitet: ${data.approved} genehmigt, ${data.rejected} abgelehnt`, "success");
      } else {
        toast("Fehler: " + (data.error || "Unbekannt"), "error");
      }
    } catch (e: any) { toast("Fehler: " + e.message, "error"); }
    setProcessingWaivers(false);
  }

  // ── GW status ────────────────────────────────────────────────
  async function updateGameweekStatus(gwNum: number, status: "upcoming" | "active" | "finished") {
    const gw = gameweeks.find(g => g.gameweek === gwNum);
    if (!gw) return;
    await supabase.from("wm_gameweeks").update({ status }).eq("id", gw.id);
    setGameweeks(prev => prev.map(g => g.gameweek === gwNum ? { ...g, status } : g));

    if (status === "active" || status === "finished") {
      const event = status === "active" ? "gw_started" : "gw_finished";
      const title = status === "active" ? `▶ WM GW ${gwNum} gestartet` : `■ WM GW ${gwNum} beendet`;
      const body  = status === "active" ? "Die WM-Spieltag-Wertung läuft!" : "Der WM-Spieltag ist abgeschlossen.";
      fetch("/api/notifications/push-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, gwId: gw.id, payload: { title, body, link: `/wm/${leagueId}` } }),
      }).catch((err) => console.warn("[push-dispatch] WM GW push failed:", err));
    }
  }

  // ── Tournament lifecycle ──────────────────────────────────────
  async function updateTournamentStatus(status: "upcoming" | "active" | "finished") {
    if (!settings?.tournament_id) return;
    const { error } = await supabase
      .from("wm_tournaments").update({ status }).eq("id", settings.tournament_id);
    if (error) { toast("Fehler: " + error.message, "error"); return; }
    setTournament((prev: any) => ({ ...prev, status }));
    toast(
      status === "active" ? "Turnier gestartet" : status === "finished" ? "Turnier beendet" : "Turnier zurückgesetzt",
      status === "finished" ? "success" : "info",
    );
  }

  function copyInviteCode() {
    if (!league?.invite_code) return;
    navigator.clipboard.writeText(league.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function toggleFormation(f: string) {
    setEditFormations(prev =>
      prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]
    );
  }

  // ── Loading / access guard ────────────────────────────────────
  if (loading) return (
    <main className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <Spinner text="Lade Admin..." />
    </main>
  );

  if (!isOwner) return (
    <main className="flex min-h-screen items-center justify-center flex-col gap-4" style={{ background: "var(--bg-page)" }}>
      <p className="text-sm font-black" style={{ color: "var(--color-error)" }}>Kein Zugriff</p>
      <button onClick={() => window.location.href = `/wm/${leagueId}`}
        className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
        ← Zurück
      </button>
    </main>
  );

  const activeNations    = nations.filter(n => !n.eliminated_after_gameweek);
  const selectedGWObj    = gameweeks.find(g => g.gameweek === selectedGW);

  // ── Shared GW Selector ────────────────────────────────────────
  const GWSelector = (
    <div className="w-full max-w-xl mb-4">
      <p className="text-[8px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>Spieltag</p>
      <div className="flex gap-2 flex-wrap">
        {gameweeks.map(gw => (
          <button key={gw.gameweek} onClick={() => setSelectedGW(gw.gameweek)}
            className="px-3 py-2 rounded-xl text-[10px] font-black transition-all"
            style={{
              background: selectedGW === gw.gameweek ? "var(--color-primary)" : "var(--bg-card)",
              color:      selectedGW === gw.gameweek ? "var(--bg-page)" : "var(--color-muted)",
              border:     `1px solid ${selectedGW === gw.gameweek ? "var(--color-primary)" : gw.status === "active" ? "var(--color-border-subtle)" : "var(--color-border)"}`,
            }}>
            GW{gw.gameweek}
            <span className="ml-1 text-[7px]"
              style={{ color: selectedGW === gw.gameweek ? "var(--bg-page)" : gw.status === "active" ? "var(--color-primary)" : "var(--color-border)" }}>
              {gw.status === "active" ? "●" : gw.status === "finished" ? "✓" : "○"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────
  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "var(--bg-page)" }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "var(--color-primary)" }} />

      {/* Header — identisch zum Liga-Admin */}
      <div className="w-full max-w-xl flex justify-between items-center mb-5">
        <div className="flex flex-col gap-1">
          <button onClick={() => window.location.href = `/wm/${leagueId}`}
            className="text-[9px] font-black uppercase tracking-widest text-left" style={{ color: "var(--color-muted)" }}>
            ← Liga
          </button>
          <button onClick={() => window.location.href = `/wm/${leagueId}/matchday`}
            className="text-[9px] font-black uppercase tracking-widest text-left" style={{ color: "var(--color-muted)" }}>
            Spielplan →
          </button>
        </div>
        <div className="text-center">
          <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Admin</p>
          <p className="text-sm font-black" style={{ color: "var(--color-primary)" }}>{league?.name}</p>
        </div>
        <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
          style={{ background: "color-mix(in srgb, var(--color-primary) 10%, var(--bg-page))", border: "1px solid var(--color-primary)", color: "var(--color-primary)" }}>
          Owner
        </span>
      </div>

      {/* Scrollable Tab Bar */}
      <div className="w-full max-w-xl mb-5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        <div className="flex gap-1 p-1 rounded-xl min-w-max" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all whitespace-nowrap"
              style={{
                background: tab === t.id ? "var(--color-primary)" : "transparent",
                color:      tab === t.id ? "var(--bg-page)" : "var(--color-muted)",
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ════════════════════════════════
          TAB: ALLGEMEIN
      ════════════════════════════════ */}
      {tab === "general" && (
        <div className="w-full max-w-xl space-y-4">

          {/* ── Liga-Name & Status ─────────────────────────────── */}
          <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Liga</p>
            </div>

            {/* Name */}
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <p className="text-[8px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--color-muted)" }}>Name</p>
              <input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                maxLength={40}
                className="w-full px-3 py-2 rounded-lg text-sm font-black focus:outline-none"
                style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
              />
            </div>

            {/* Status — kontrolliert, keine Freitexteingabe */}
            <div className="px-4 py-3">
              <p className="text-[8px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--color-muted)" }}>Status</p>
              <div className="flex gap-2">
                {(["setup", "drafting", "active", "finished"] as const).map(s => (
                  <button key={s} onClick={() => setEditStatus(s)}
                    className="flex-1 py-2 rounded-lg text-[8px] font-black uppercase transition-all"
                    style={{
                      background: editStatus === s ? "var(--color-primary)" : "var(--bg-page)",
                      color:      editStatus === s ? "var(--bg-page)" : "var(--color-muted)",
                      border:     `1px solid ${editStatus === s ? "var(--color-primary)" : "var(--color-border)"}`,
                    }}>
                    {s}
                  </button>
                ))}
              </div>
              <p className="text-[7px] mt-1.5" style={{ color: "var(--color-border)" }}>
                Vorsicht: Status-Änderung kann Draft- und Spieltagslogik beeinflussen
              </p>
            </div>
          </div>

          <button
            onClick={saveLeagueSettings}
            disabled={saving}
            className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
            style={{ background: settingsSaved ? "var(--color-success)" : "var(--color-primary)", color: "var(--bg-page)" }}>
            {saving ? "Speichern..." : settingsSaved ? "✓ Liga gespeichert" : "Liga-Einstellungen speichern"}
          </button>

          {/* ── Einladungscode ─────────────────────────────────── */}
          {league?.invite_code && (
            <div className="rounded-xl p-4 flex items-center justify-between"
              style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
              <div>
                <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
                  Einladungs-Code
                </p>
                <p className="text-base font-black tracking-widest" style={{ color: "var(--color-primary)" }}>
                  {league.invite_code}
                </p>
                <p className="text-[8px] mt-0.5" style={{ color: "var(--color-border)" }}>
                  {teamsCount} / {league?.max_teams ?? "?"} Teams beigetreten
                </p>
              </div>
              <button onClick={copyInviteCode}
                className="px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all"
                style={{
                  background: copied ? "color-mix(in srgb, var(--color-success) 15%, var(--bg-page))" : "color-mix(in srgb, var(--color-primary) 15%, var(--bg-page))",
                  border:     copied ? "1px solid var(--color-success)40" : "1px solid var(--color-primary)40",
                  color:      copied ? "var(--color-success)" : "var(--color-primary)",
                }}>
                {copied ? "✓ Kopiert" : "Kopieren"}
              </button>
            </div>
          )}

          {/* ── WM-Einstellungen editierbar ────────────────────── */}
          {settings && (
            <>
              {/* Kader */}
              <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Kader</p>
                </div>
                <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border)" }}>
                  {[
                    { label: "Startelf", value: editSquadSize, onChange: (v: number) => setEditSquadSize(v), min: 11, max: 15 },
                    { label: "Bank",     value: editBenchSize, onChange: (v: number) => setEditBenchSize(v), min: 0,  max: 7  },
                  ].map(({ label, value, onChange, min, max }) => (
                    <div key={label} className="px-4 py-3" style={{ background: "var(--bg-card)" }}>
                      <p className="text-[8px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--color-muted)" }}>{label}</p>
                      <input
                        type="number" min={min} max={max}
                        value={value}
                        onChange={e => onChange(Number(e.target.value))}
                        className="w-full px-2 py-1.5 rounded-lg text-sm font-black text-center focus:outline-none"
                        style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                      />
                    </div>
                  ))}
                </div>
                <p className="px-4 py-2 text-[7px]" style={{ color: "var(--color-border)", borderTop: "1px solid var(--color-border)" }}>
                  Draft-Runden = Startelf + Bank = {editSquadSize + editBenchSize}
                </p>
              </div>

              {/* Formationen */}
              <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
                  Erlaubte Formationen
                </p>
                <div className="flex flex-wrap gap-2">
                  {FORMATION_KEYS.map(f => {
                    const active = editFormations.includes(f);
                    return (
                      <button key={f} onClick={() => toggleFormation(f)}
                        className="px-3 py-1.5 rounded-lg text-[9px] font-black transition-all"
                        style={{
                          background: active ? "var(--color-primary)" : "var(--bg-page)",
                          color:      active ? "var(--bg-page)" : "var(--color-muted)",
                          border:     `1px solid ${active ? "var(--color-primary)" : "var(--color-border)"}`,
                        }}>
                        {f}
                      </button>
                    );
                  })}
                </div>
                {editFormations.length === 0 && (
                  <p className="text-[8px] mt-2" style={{ color: "var(--color-error)" }}>Mindestens eine Formation wählen</p>
                )}
              </div>

              {/* Transfers */}
              <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Transfers</p>
                </div>
                {/* Unlimited toggle */}
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>Unbegrenzt</p>
                  <button onClick={() => setEditTransfersUnlimited(v => !v)}
                    className="w-11 h-6 rounded-full transition-all relative"
                    style={{ background: editTransfersUnlimited ? "var(--color-primary)" : "var(--color-border)" }}>
                    <span className="absolute top-1 w-4 h-4 rounded-full transition-all"
                      style={{ left: editTransfersUnlimited ? "calc(100% - 20px)" : "4px", background: "white" }} />
                  </button>
                </div>
                {/* Per GW — nur wenn nicht unlimited */}
                {!editTransfersUnlimited && (
                  <div className="px-4 py-3">
                    <p className="text-[8px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--color-muted)" }}>Pro Spieltag</p>
                    <input type="number" min={0} max={10}
                      value={editTransfersPGW}
                      onChange={e => setEditTransfersPGW(Number(e.target.value))}
                      className="w-24 px-2 py-1.5 rounded-lg text-sm font-black text-center focus:outline-none"
                      style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                )}
              </div>

              {/* Waiver */}
              <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Waiver</p>
                </div>
                {/* Waiver ab GW */}
                <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <p className="text-[8px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--color-muted)" }}>Waiver startet ab GW</p>
                  <input type="number" min={1}
                    value={editWaiverStartGW}
                    onChange={e => setEditWaiverStartGW(Number(e.target.value))}
                    className="w-24 px-2 py-1.5 rounded-lg text-sm font-black text-center focus:outline-none"
                    style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                  />
                </div>
                {/* FAAB toggle */}
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>FAAB Budget</p>
                  <button onClick={() => setEditWaiverBudget(v => !v)}
                    className="w-11 h-6 rounded-full transition-all relative"
                    style={{ background: editWaiverBudget ? "var(--color-primary)" : "var(--color-border)" }}>
                    <span className="absolute top-1 w-4 h-4 rounded-full transition-all"
                      style={{ left: editWaiverBudget ? "calc(100% - 20px)" : "4px", background: "white" }} />
                  </button>
                </div>
                {/* Budget amount — nur wenn FAAB */}
                {editWaiverBudget && (
                  <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <p className="text-[8px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--color-muted)" }}>Startbudget</p>
                    <input type="number" min={1}
                      value={editWaiverBudgetAmt}
                      onChange={e => setEditWaiverBudgetAmt(Number(e.target.value))}
                      className="w-24 px-2 py-1.5 rounded-lg text-sm font-black text-center focus:outline-none"
                      style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                )}
                {/* Claims-Limit toggle */}
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>Claims-Limit</p>
                  <button onClick={() => setEditWaiverClaimsLimit(v => !v)}
                    className="w-11 h-6 rounded-full transition-all relative"
                    style={{ background: editWaiverClaimsLimit ? "var(--color-primary)" : "var(--color-border)" }}>
                    <span className="absolute top-1 w-4 h-4 rounded-full transition-all"
                      style={{ left: editWaiverClaimsLimit ? "calc(100% - 20px)" : "4px", background: "white" }} />
                  </button>
                </div>
                {/* Max claims — nur wenn Limit an */}
                {editWaiverClaimsLimit && (
                  <div className="px-4 py-3">
                    <p className="text-[8px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--color-muted)" }}>Max. Claims / GW</p>
                    <input type="number" min={1} max={20}
                      value={editWaiverMaxClaims}
                      onChange={e => setEditWaiverMaxClaims(Number(e.target.value))}
                      className="w-24 px-2 py-1.5 rounded-lg text-sm font-black text-center focus:outline-none"
                      style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                )}
              </div>

              {/* Auto-Subs */}
              <div className="rounded-xl p-4 flex items-center justify-between"
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <div>
                  <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>Auto-Subs</p>
                  <p className="text-[8px] mt-0.5" style={{ color: "var(--color-muted)" }}>Automatisch einwechseln bei 0 Minuten</p>
                </div>
                <button onClick={() => setEditAutoSubs(v => !v)}
                  className="w-11 h-6 rounded-full transition-all relative flex-shrink-0"
                  style={{ background: editAutoSubs ? "var(--color-primary)" : "var(--color-border)" }}>
                  <span className="absolute top-1 w-4 h-4 rounded-full transition-all"
                    style={{ left: editAutoSubs ? "calc(100% - 20px)" : "4px", background: "white" }} />
                </button>
              </div>

              <button
                onClick={saveWMSettings}
                disabled={saving || editFormations.length === 0}
                className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
                style={{ background: settingsSaved ? "var(--color-success)" : "var(--color-primary)", color: "var(--bg-page)" }}>
                {saving ? "Speichern..." : settingsSaved ? "✓ Einstellungen gespeichert" : "WM-Einstellungen speichern"}
              </button>

              {/* ── Scoring-Regeln ──────────────────────────────── */}
              <div className="rounded-2xl overflow-hidden mt-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Scoring-Regeln</p>
                  <button onClick={resetScoringRules}
                    className="text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg"
                    style={{ background: "var(--bg-elevated)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                    Reset
                  </button>
                </div>
                {RULE_GROUPS.map(group => (
                  <div key={group.label} className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <p className="text-[8px] font-black uppercase tracking-widest mb-2" style={{ color: group.color }}>
                      {group.label}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {group.fields.map(({ key, label, step, min, max }) => (
                        <div key={key} className="flex items-center justify-between gap-2">
                          <p className="text-[9px] font-black flex-1" style={{ color: "var(--color-text)" }}>{label}</p>
                          <input
                            type="number" step={step} min={min} max={max}
                            value={scoringRules[key]}
                            onChange={e => setScoringRules(prev => ({
                              ...prev,
                              [key]: parseFloat(e.target.value) || 0,
                            }))}
                            className="w-16 p-1.5 rounded-lg text-xs text-center font-black focus:outline-none"
                            style={{
                              background: "var(--bg-page)",
                              border: `1px solid ${scoringRules[key] !== DEFAULT_SCORING_RULES[key] ? "var(--color-primary)88" : "var(--color-border)"}`,
                              color: "var(--color-text)",
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Vizekapitän-Fallback ─────────────────────────── */}
              <div className="rounded-2xl overflow-hidden mt-2" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <div className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-[9px] font-black" style={{ color: "var(--color-text)" }}>Vizekapitän-Fallback</p>
                    <p className="text-[8px] mt-0.5" style={{ color: "var(--color-muted)" }}>VC bekommt C-Multiplikator wenn Kapitän nicht spielt</p>
                  </div>
                  <button
                    onClick={() => setVcEnabled(v => !v)}
                    className="w-10 h-5 rounded-full relative transition-colors flex-shrink-0"
                    style={{ background: vcEnabled ? "var(--color-primary)" : "var(--color-border)" }}>
                    <span className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                      style={{ background: "#fff", left: vcEnabled ? "calc(100% - 18px)" : "2px" }} />
                  </button>
                </div>
              </div>

              {/* ── Scoring speichern ───────────────────────────── */}
              <button onClick={saveScoringRules} disabled={saving}
                className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest mt-2 disabled:opacity-50 transition-opacity"
                style={{ background: scoringSaved ? "var(--color-success)" : "var(--color-primary)", color: "var(--bg-page)" }}>
                {scoringSaved ? "Scoring gespeichert ✓" : saving ? "Speichern…" : "Scoring speichern"}
              </button>
            </>
          )}

          {/* Turnier-Info (read-only) */}
          {tournament && (
            <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
              <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
                <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Turnier (read-only)</p>
              </div>
              {[
                { label: "Name",     value: tournament.name },
                { label: "Status",   value: tournament.status === "active" ? "● Aktiv" : tournament.status === "finished" ? "✓ Beendet" : "○ Geplant" },
                { label: "Nationen", value: `${nations.length} gesamt · ${activeNations.length} aktiv` },
                { label: "Spieltage",value: `${gameweeks.length}` },
              ].map(({ label, value }) => (
                <div key={label} className="px-4 py-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--color-border)" }}>
                  <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>{label}</p>
                  <span className="text-xs font-black" style={{ color: "var(--color-muted)" }}>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════
          TAB: SPIELTAGE / PUNKTE
      ════════════════════════════════ */}
      {tab === "points" && (
        <div className="w-full max-w-xl">
          {GWSelector}

          {/* GW-Status-Buttons für gewählten Spieltag */}
          {selectedGWObj && (
            <div className="mb-4 rounded-xl p-4" style={{ background: "var(--bg-card)", border: `1px solid ${selectedGWObj.status === "active" ? "var(--color-border-subtle)" : "var(--color-border)"}` }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-black text-sm" style={{ color: "var(--color-text)" }}>
                    GW{selectedGWObj.gameweek}
                    {selectedGWObj.label && <span className="ml-2 text-[9px]" style={{ color: "var(--color-muted)" }}>{selectedGWObj.label}</span>}
                  </p>
                  <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                    {PHASE_LABEL[selectedGWObj.phase] || selectedGWObj.phase}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {(["upcoming", "active", "finished"] as const).map(s => (
                    <button key={s} onClick={() => updateGameweekStatus(selectedGWObj.gameweek, s)}
                      className="px-2.5 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all"
                      style={{
                        background: selectedGWObj.status === s
                          ? s === "active" ? "var(--color-primary)" : s === "finished" ? "var(--color-success)" : "var(--color-border)"
                          : "var(--bg-page)",
                        color: selectedGWObj.status === s
                          ? s === "active" ? "var(--bg-page)" : s === "finished" ? "var(--bg-page)" : "var(--color-text)"
                          : "var(--color-muted)",
                        border: `1px solid ${selectedGWObj.status === s ? "transparent" : "var(--color-border)"}`,
                      }}>
                      {s === "upcoming" ? "Bald" : s === "active" ? "Aktiv" : "Fertig"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
            GW{selectedGW} · {squadPlayers.length} Spieler im Pool
          </p>
          <div className="space-y-2 mb-4">
            {squadPlayers.map(({ player_id, players: p }) => {
              if (!p) return null;
              const s      = getStat(player_id);
              const nation = nations.find(n => n.name === p.team_name);
              const isElim = nation?.eliminated_after_gameweek && selectedGW > nation.eliminated_after_gameweek;
              return (
                <div key={player_id} className="rounded-xl p-3"
                  style={{
                    background: "var(--bg-card)",
                    border: `1px solid ${isElim ? "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))" : "var(--color-border)"}`,
                    opacity: isElim ? 0.5 : 1,
                  }}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-black text-sm" style={{ color: isElim ? "var(--color-muted)" : "var(--color-text)" }}>{p.name}</p>
                      <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                        {p.position} · {p.team_name}
                        {isElim && <span style={{ color: "var(--color-error)" }}> · AUSGESCHIEDEN</span>}
                      </p>
                    </div>
                    {isElim ? (
                      <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))", color: "var(--color-error)" }}>0 Pts</span>
                    ) : (
                      <span className="text-sm font-black" style={{ color: "var(--color-primary)" }}>
                        {calculateWMGameweekPoints({ ...s, position: p.position }, nation || null, selectedGW, false, scoringRules).points.toFixed(1)}
                      </span>
                    )}
                  </div>
                  {!isElim && (
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { key: "minutes",       label: "Min"     },
                        { key: "goals",         label: "Tore"    },
                        { key: "assists",       label: "Assists" },
                        { key: "shots_on",      label: "Schüsse" },
                        { key: "key_passes",    label: "KeyPass" },
                        { key: "tackles",       label: "Tackles" },
                        { key: "interceptions", label: "Int."    },
                        { key: "saves",         label: "Saves"   },
                        { key: "yellow_cards",  label: "Gelb"    },
                        { key: "red_cards",     label: "Rot"     },
                        { key: "dribbles",      label: "Dribbl." },
                        { key: "pass_accuracy", label: "Pass%"   },
                      ].map(({ key, label }) => (
                        <div key={key}>
                          <p className="text-[7px] font-black uppercase mb-0.5" style={{ color: "var(--color-border)" }}>{label}</p>
                          <input
                            type="number" min={0}
                            max={key === "pass_accuracy" ? 100 : undefined}
                            value={s[key as keyof typeof s] as number}
                            onChange={e => updateStat(player_id, key as keyof Omit<GWStats, "position">, Number(e.target.value))}
                            className="w-full p-1 rounded text-xs text-center font-black focus:outline-none"
                            style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                          />
                        </div>
                      ))}
                      <div className="col-span-4 flex items-center gap-2 mt-1">
                        <input type="checkbox" id={`cs-${player_id}`} checked={s.clean_sheet}
                          onChange={e => updateStat(player_id, "clean_sheet", e.target.checked)} className="w-4 h-4" />
                        <label htmlFor={`cs-${player_id}`} className="text-[9px] font-black uppercase"
                          style={{ color: "var(--color-muted)" }}>Clean Sheet</label>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button onClick={savePoints} disabled={saving}
            className="w-full py-4 rounded-xl text-sm font-black uppercase tracking-widest transition-all"
            style={{ background: saving ? "var(--color-border)" : "var(--color-primary)", color: saving ? "var(--color-muted)" : "var(--bg-page)" }}>
            {saving ? "Speichern..." : `GW${selectedGW} Punkte berechnen & speichern`}
          </button>
        </div>
      )}

      {/* ════════════════════════════════
          TAB: WAIVER
      ════════════════════════════════ */}
      {tab === "waiver" && (
        <div className="w-full max-w-xl">
          {GWSelector}
          <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
              Waivers für GW{selectedGW} verarbeiten
            </p>
            <p className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>
              Waiver-Claims werden nach Priorität geprüft und Spieler entsprechend transferiert.
            </p>
            <button
              onClick={() => processWaivers(selectedGW)}
              disabled={processingWaivers}
              className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
              style={{ background: "color-mix(in srgb, var(--color-info) 15%, var(--bg-page))", color: "var(--color-info)", border: "1px solid var(--color-info)40" }}>
              {processingWaivers ? "Verarbeite..." : `GW${selectedGW} Waivers ▶`}
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════
          TAB: AUTO-SUBS
      ════════════════════════════════ */}
      {tab === "autosubs" && (
        <div className="w-full max-w-xl">
          {GWSelector}
          {selectedGWObj ? (
            <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
              <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
                Auto-Subs für GW{selectedGW}
              </p>
              <p className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>
                Spieler mit 0 Minuten werden automatisch durch Bankspieler ersetzt (sofern verfügbar und Formation gültig).
              </p>
              <button
                onClick={() => executeAutoSubs(selectedGWObj.id, selectedGW)}
                disabled={processingAutoSubs || selectedGWObj.status === "upcoming"}
                title={selectedGWObj.status === "upcoming" ? "GW muss aktiv oder beendet sein" : ""}
                className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
                style={{ background: "color-mix(in srgb, var(--color-success) 15%, var(--bg-page))", color: "var(--color-success)", border: "1px solid var(--color-success)40" }}>
                {processingAutoSubs ? "Verarbeite..." : `GW${selectedGW} Auto-Subs ▶`}
              </button>
              {selectedGWObj.status === "upcoming" && (
                <p className="text-[8px] mt-2 text-center" style={{ color: "var(--color-muted)" }}>GW muss aktiv oder beendet sein</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-center py-8" style={{ color: "var(--color-muted)" }}>Kein Spieltag ausgewählt</p>
          )}
        </div>
      )}

      {/* ════════════════════════════════
          TAB: AUSSCHEIDUNGEN / NATIONEN
      ════════════════════════════════ */}
      {tab === "nations" && (
        <div className="w-full max-w-xl space-y-3">
          {GWSelector}
          <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
              Nation nach GW{selectedGW} ausscheiden lassen
            </p>
            <select value={eliminateNation} onChange={e => setEliminateNation(e.target.value)}
              className="w-full p-2 rounded-lg text-sm font-black focus:outline-none mb-3"
              style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}>
              <option value="">Nation wählen...</option>
              {activeNations.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
            <button onClick={markEliminatedNation} disabled={!eliminateNation}
              className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest"
              style={{
                background: eliminateNation ? "var(--color-error)" : "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))",
                color: eliminateNation ? "var(--color-text)" : "var(--color-muted)",
              }}>
              Nach GW{selectedGW} ausscheiden
            </button>
          </div>

          <div className="space-y-1.5">
            {nations.map(n => (
              <div key={n.id} className="flex items-center justify-between p-3 rounded-xl"
                style={{
                  background: "var(--bg-card)",
                  border: `1px solid ${n.eliminated_after_gameweek ? "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))" : "var(--color-border)"}`,
                  opacity: n.eliminated_after_gameweek ? 0.6 : 1,
                }}>
                <p className="font-black text-sm" style={{ color: "var(--color-text)" }}>{n.name}</p>
                {n.eliminated_after_gameweek ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
                      style={{ background: "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))", color: "var(--color-error)" }}>
                      Raus nach GW{n.eliminated_after_gameweek}
                    </span>
                    <button onClick={async () => {
                      await supabase.from("wm_nations").update({ eliminated_after_gameweek: null }).eq("id", n.id);
                      setNations(prev => prev.map(x => x.id === n.id ? { ...x, eliminated_after_gameweek: null } : x));
                    }} className="text-[8px] font-black" style={{ color: "var(--color-muted)" }}>✕</button>
                  </div>
                ) : (
                  <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
                    style={{ background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))", color: "var(--color-success)", border: "1px solid var(--color-success)40" }}>
                    Aktiv
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ════════════════════════════════
          TAB: DEBUG / STATUS
      ════════════════════════════════ */}
      {tab === "debug" && (
        <div className="w-full max-w-xl space-y-4">

          {gameweeks.length > 0 && (
            <div className="space-y-2">
              <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Alle Spieltage</p>
              {gameweeks.map(gw => (
                <div key={gw.gameweek} className="flex items-center justify-between p-4 rounded-xl"
                  style={{ background: "var(--bg-card)", border: `1px solid ${gw.status === "active" ? "var(--color-border-subtle)" : "var(--color-border)"}` }}>
                  <div>
                    <p className="font-black text-sm" style={{ color: "var(--color-text)" }}>
                      GW{gw.gameweek}
                      {gw.label && <span className="ml-2 text-[9px]" style={{ color: "var(--color-muted)" }}>{gw.label}</span>}
                    </p>
                    <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                      {PHASE_LABEL[gw.phase] || gw.phase}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    {(["upcoming", "active", "finished"] as const).map(s => (
                      <button key={s} onClick={() => updateGameweekStatus(gw.gameweek, s)}
                        className="px-2.5 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all"
                        style={{
                          background: gw.status === s
                            ? s === "active" ? "var(--color-primary)" : s === "finished" ? "var(--color-success)" : "var(--color-border)"
                            : "var(--bg-page)",
                          color: gw.status === s
                            ? s === "active" ? "var(--bg-page)" : s === "finished" ? "var(--bg-page)" : "var(--color-text)"
                            : "var(--color-muted)",
                          border: `1px solid ${gw.status === s ? "transparent" : "var(--color-border)"}`,
                        }}>
                        {s === "upcoming" ? "Bald" : s === "active" ? "Aktiv" : "Fertig"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tournament && (
            <div>
              <p className="text-[8px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>Turnier-Lifecycle</p>
              <div className="flex items-center justify-between p-4 rounded-xl"
                style={{ background: "var(--bg-card)", border: `1px solid ${tournament.status === "active" ? "var(--color-primary)" : tournament.status === "finished" ? "var(--color-success)" : "var(--color-border)"}` }}>
                <div>
                  <p className="font-black text-sm" style={{ color: "var(--color-text)" }}>{tournament.name}</p>
                  <p className="text-[8px] font-black uppercase mt-0.5"
                    style={{ color: tournament.status === "active" ? "var(--color-primary)" : tournament.status === "finished" ? "var(--color-success)" : "var(--color-muted)" }}>
                    {tournament.status === "active" ? "● Aktiv" : tournament.status === "finished" ? "✓ Beendet" : "○ Geplant"}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {(["upcoming", "active", "finished"] as const).map(s => (
                    <button key={s} onClick={() => updateTournamentStatus(s)}
                      disabled={tournament.status === s}
                      className="px-2.5 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all disabled:opacity-40"
                      style={{
                        background: tournament.status === s
                          ? s === "active" ? "var(--color-primary)" : s === "finished" ? "var(--color-success)" : "var(--color-border)"
                          : "var(--bg-page)",
                        color: tournament.status === s
                          ? s === "active" || s === "finished" ? "var(--bg-page)" : "var(--color-text)"
                          : "var(--color-muted)",
                        border: `1px solid ${tournament.status === s ? "transparent" : "var(--color-border)"}`,
                      }}>
                      {s === "upcoming" ? "Geplant" : s === "active" ? "Starten" : "Beenden"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <BottomNav />
    </main>
  );
}
