"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { BottomNav } from "@/app/components/BottomNav";
import tsdbClubs from "@/lib/tsdb-clubs.json";
import tsdbLeagues from "@/lib/tsdb-leagues.json";
import { TransactionsFeed } from "@/app/components/TransactionsFeed";
import { PlayerCard } from "@/app/components/PlayerCard";
import { Spinner } from "@/app/components/ui/Spinner";
import { EmptyState } from "@/app/components/ui/EmptyState";

// Helper: club assets by team_name
const clubAsset = (teamName: string) => (tsdbClubs as Record<string, any>)[teamName] || null;
// Helper: league assets by api-sports league id (as string key)
const leagueAsset = (apId: number) => (tsdbLeagues as Record<string, any>)[String(apId)] || null;

const POS_COLOR: Record<string, string> = {
  GK: "var(--color-primary)", DF: "var(--color-info)", MF: "var(--color-success)", FW: "var(--color-error)",
};

const POS_ORDER: Record<string, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };

type Player = {
  id: number;
  name: string;
  photo_url: string;
  position: string;
  team_name: string;
  api_team_id?: number;
  fpts: number;
};

type Transfer = {
  id: string;
  team_id: string;
  teamName?: string;
  player_in?: { name: string; position: string };
  player_out?: { name: string; position: string };
  created_at: string;
  gameweek?: number;
  // legacy type — only used for player history tab

};

export default function LigaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [user, setUser] = useState<any>(null);
  const [league, setLeague] = useState<any>(null);
  const [ligaSettings, setLigaSettings] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [activeGW, setActiveGW] = useState<number | null>(null);
  const [gwPointsMap, setGwPointsMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"tabelle" | "info" | "transfers">("tabelle");

  // Team detail sheet
  const [selectedTeam, setSelectedTeam] = useState<any>(null);
  const [teamSquad, setTeamSquad] = useState<Player[]>([]);
  const [teamLineup, setTeamLineup] = useState<(Player | null)[]>([]);
  const [teamFormation, setTeamFormation] = useState<string>("");
  const [loadingTeam, setLoadingTeam] = useState(false);
  // Player card overlay
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [playerDetail, setPlayerDetail] = useState<any>(null);
  const [playerOwner, setPlayerOwner] = useState<any>(null);
  const [playerGameLog, setPlayerGameLog] = useState<any[]>([]);
  const [playerHistory, setPlayerHistory] = useState<any[]>([]);
  const [playerNews, setPlayerNews] = useState<any[]>([]);
  const [playerNewsLoading, setPlayerNewsLoading] = useState(false);
  const [playerDetailLoading, setPlayerDetailLoading] = useState(false);
  const [playerTab, setPlayerTab] = useState<"summary" | "gamelog" | "history" | "news">("summary");
  const [tsdbPlayer, setTsdbPlayer] = useState<any>(null);

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

    const { data: ls } = await supabase
      .from("liga_settings").select("*").eq("league_id", leagueId).maybeSingle();
    setLigaSettings(ls);

    const { data: teamsData } = await supabase
      .from("teams").select("id, name, user_id, total_points")
      .eq("league_id", leagueId)
      .order("total_points", { ascending: false, nullsFirst: false });

    // Calculate W/U/N from matchup history
    const teamIds = (teamsData || []).map((t: any) => t.id);
    const wun: Record<string, { wins: number; draws: number; losses: number }> = {};
    for (const tid of teamIds) wun[tid] = { wins: 0, draws: 0, losses: 0 };

    if (teamIds.length > 0) {
      const { data: allMatchups } = await supabase
        .from("liga_matchups")
        .select("home_team_id, away_team_id, winner_id, home_points, away_points")
        .eq("league_id", leagueId);
      for (const m of allMatchups || []) {
        const played = m.home_points !== null || m.away_points !== null;
        if (!played) continue;
        if (m.winner_id) {
          if (wun[m.winner_id]) wun[m.winner_id].wins++;
          const loser = m.winner_id === m.home_team_id ? m.away_team_id : m.home_team_id;
          if (wun[loser]) wun[loser].losses++;
        } else {
          if (wun[m.home_team_id]) wun[m.home_team_id].draws++;
          if (wun[m.away_team_id]) wun[m.away_team_id].draws++;
        }
      }
    }

    const teamsWithStats = (teamsData || []).map((t: any) => ({ ...t, ...(wun[t.id] || {}) }));
    setTeams(teamsWithStats);

    // Load active GW points
    const { data: gwData } = await supabase
      .from("liga_gameweeks")
      .select("gameweek, status")
      .eq("league_id", leagueId)
      .eq("status", "active")
      .maybeSingle();
    if (gwData) {
      setActiveGW(gwData.gameweek);
      const { data: pts } = await supabase
        .from("liga_gameweek_points")
        .select("team_id, points")
        .eq("league_id", leagueId)
        .eq("gameweek", gwData.gameweek);
      const m: Record<string, number> = {};
      for (const r of (pts || [])) m[r.team_id] = (m[r.team_id] || 0) + r.points;
      setGwPointsMap(m);
    }

    setLoading(false);
  }

  async function openTeam(team: any) {
    setSelectedTeam(team);
    setLoadingTeam(true);
    setTeamSquad([]);
    setTeamLineup([]);
    setTeamFormation("");

    // Load squad — try squad_players first, fall back to draft_picks (RLS may block other teams)
    let playerIds: number[] = [];
    const { data: squadRows } = await supabase
      .from("squad_players").select("player_id").eq("team_id", team.id);
    if (squadRows && squadRows.length > 0) {
      playerIds = squadRows.map((r: any) => r.player_id);
    } else {
      const { data: pickRows } = await supabase
        .from("draft_picks").select("player_id").eq("team_id", team.id);
      playerIds = (pickRows || []).map((r: any) => r.player_id);
    }

    if (playerIds.length > 0) {
      const { data: playersData } = await supabase
        .from("players")
        .select("id, name, photo_url, position, team_name, api_team_id, fpts")
        .in("id", playerIds);
      const squad = (playersData || []) as Player[];
      setTeamSquad(squad.sort((a, b) =>
        (POS_ORDER[a.position] ?? 4) - (POS_ORDER[b.position] ?? 4) || b.fpts - a.fpts
      ));

      // Load last saved lineup
      const { data: gwData } = await supabase
        .from("liga_gameweeks").select("gameweek")
        .eq("league_id", leagueId).order("gameweek", { ascending: false }).limit(1);
      const latestGW = gwData?.[0]?.gameweek || 1;

      let lineupData: any = null;
      const { data: ld1, error: le1 } = await supabase
        .from("liga_lineups").select("lineup_json, formation")
        .eq("team_id", team.id).eq("gameweek", latestGW).maybeSingle();
      if (!le1) {
        lineupData = ld1;
      } else {
        // formation column might not exist — retry without it
        const { data: ld2 } = await supabase
          .from("liga_lineups").select("lineup_json")
          .eq("team_id", team.id).eq("gameweek", latestGW).maybeSingle();
        lineupData = ld2;
      }

      if (lineupData?.lineup_json) {
        try {
          const parsed: (number | null)[] = JSON.parse(lineupData.lineup_json);
          const squadMap = new Map(squad.map(p => [p.id, p]));
          setTeamLineup(parsed.map(id => (id ? squadMap.get(id) || null : null)));
          setTeamFormation(lineupData.formation || "");
        } catch {}
      }
    }
    setLoadingTeam(false);
  }

  // Load player detail when card opens
  useEffect(() => {
    if (!selectedPlayer) {
      setPlayerDetail(null); setPlayerGameLog([]); setPlayerHistory([]); setPlayerNews([]);
      setTsdbPlayer(null);
      return;
    }
    setPlayerTab("summary");
    setPlayerDetailLoading(true);
    setPlayerOwner(null);
    setTsdbPlayer(null);
    loadPlayerDetail(selectedPlayer.id);
    // Fetch TheSportsDB cutout/render in the background
    fetch(`/api/tsdb-player?name=${encodeURIComponent(selectedPlayer.name)}&team=${encodeURIComponent(selectedPlayer.team_name || "")}`)
      .then(r => r.json())
      .then(d => setTsdbPlayer(d))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlayer]);

  async function loadPlayerDetail(pid: number) {
    // Full player data
    const { data: p } = await supabase.from("players").select("*").eq("id", pid).single();
    setPlayerDetail(p);

    // Owner lookup
    const { data: leagueTeams } = await supabase.from("teams").select("id, name, user_id").eq("league_id", leagueId);
    const leagueTeamIds = (leagueTeams || []).map((t: any) => t.id);
    if (leagueTeamIds.length > 0) {
      const { data: pick } = await supabase.from("draft_picks").select("team_id").in("team_id", leagueTeamIds).eq("player_id", pid).maybeSingle();
      if (pick) setPlayerOwner((leagueTeams || []).find((t: any) => t.id === pick.team_id) || null);
      else {
        const { data: sp } = await supabase.from("squad_players").select("team_id").in("team_id", leagueTeamIds).eq("player_id", pid).maybeSingle();
        if (sp) setPlayerOwner((leagueTeams || []).find((t: any) => t.id === sp.team_id) || null);
      }
    }

    // Game log
    const { data: gwPts } = await supabase.from("liga_gameweek_points").select("*").eq("league_id", leagueId).eq("player_id", pid).order("gameweek");
    setPlayerGameLog(gwPts || []);

    // History
    const hist: any[] = [];
    const { data: dp } = leagueTeamIds.length > 0 ? await supabase.from("draft_picks").select("pick_number, round, created_at, teams(name)").in("team_id", leagueTeamIds).eq("player_id", pid).maybeSingle() : { data: null };
    if (dp) hist.push({ type: "draft", date: dp.created_at, team: (dp as any).teams?.name, detail: `Pick ${dp.pick_number} · Runde ${dp.round}` });
    const { data: txs } = await supabase.from("liga_transfers").select("id, team_id, player_in_id, player_out_id, created_at").eq("league_id", leagueId).or(`player_in_id.eq.${pid},player_out_id.eq.${pid}`).order("created_at");
    for (const t of (txs || [])) {
      const tm = (leagueTeams || []).find((x: any) => x.id === t.team_id);
      hist.push({ type: t.player_in_id === pid ? "transfer_in" : "transfer_out", date: t.created_at, team: tm?.name || "Unbekannt", detail: t.player_in_id === pid ? "Verpflichtet (Transfer)" : "Entlassen (Transfer)" });
    }
    hist.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    setPlayerHistory(hist);
    setPlayerDetailLoading(false);

    // News async
    if (p?.name) {
      setPlayerNewsLoading(true);
      fetch(`/api/player-news?name=${encodeURIComponent(p.name)}`)
        .then(r => r.json()).then(d => { setPlayerNews(d.items || []); setPlayerNewsLoading(false); })
        .catch(() => setPlayerNewsLoading(false));
    }
  }

  function copyInviteCode() {
    if (!league?.invite_code) return;
    navigator.clipboard.writeText(league.invite_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <Spinner text="Lade..." />
    </main>
  );

  const isOwner = league?.owner_id === user?.id;
  const isH2H = league?.scoring_type === "h2h";

  const scoringLabels: Record<string, string> = {
    standard: "Standard",
    ppr: "PPR",
    half_ppr: "Half PPR",
  };

  return (
    <main className="flex min-h-screen flex-col items-center pb-24"
      style={{ background: "var(--bg-page)", paddingTop: 16 }}>

      <div className="w-full max-w-md px-4 pt-4">

        {/* Tab row */}
        <div className="flex gap-1.5 mb-4">
          {(["tabelle", "info", "transfers"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
              style={{
                background: tab === t ? "var(--color-primary)" : "var(--bg-card)",
                color: tab === t ? "var(--bg-page)" : "var(--color-muted)",
                border: `1px solid ${tab === t ? "var(--color-primary)" : "var(--color-border)"}`,
              }}>
              {t === "tabelle" ? "Tabelle" : t === "info" ? "Liga Info" : "Trans."}
            </button>
          ))}
        </div>

        {tab === "tabelle" && (
          <>
            {teams.length === 0 ? (
              <EmptyState icon="🏆" title="Noch keine Teams" />
            ) : (
              <div className="rounded-2xl overflow-hidden mb-3"
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                {/* Header row */}
                <div className="flex items-center gap-3 px-4 py-2.5"
                  style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <span className="text-[7px] font-black uppercase tracking-widest w-4 text-right flex-shrink-0"
                    style={{ color: "var(--color-border)" }}>#</span>
                  <span className="flex-1 text-[7px] font-black uppercase tracking-widest"
                    style={{ color: "var(--color-border)" }}>Team</span>
                  {isH2H && <>
                    <span className="text-[7px] font-black uppercase w-6 text-center" style={{ color: "var(--color-border)" }}>S</span>
                    <span className="text-[7px] font-black uppercase w-6 text-center" style={{ color: "var(--color-border)" }}>U</span>
                    <span className="text-[7px] font-black uppercase w-6 text-center" style={{ color: "var(--color-border)" }}>N</span>
                  </>}
                  {activeGW && (
                    <span className="text-[7px] font-black uppercase w-12 text-right flex items-center justify-end gap-0.5" style={{ color: "var(--color-primary)" }}>
                      <span className="w-1 h-1 rounded-full animate-pulse inline-block" style={{ background: "var(--color-primary)" }} />
                      GW{activeGW}
                    </span>
                  )}
                  <span className="text-[7px] font-black uppercase w-14 text-right" style={{ color: "var(--color-border)" }}>
                    {isH2H ? "Pts" : "FPTS"}
                  </span>
                  <span className="w-3 flex-shrink-0" />
                </div>
                {teams.map((t, i) => {
                  const isMine = t.user_id === user?.id;
                  const rankColor = i === 0 ? "var(--color-primary)" : i === 1 ? "var(--color-text)" : i === 2 ? "var(--color-bronze)" : "var(--color-border-subtle)";
                  const pts = isH2H
                    ? (t.wins ?? 0) * 3 + (t.draws ?? 0)
                    : (t.total_points ?? 0);
                  const gwPts = gwPointsMap[t.id] ?? null;
                  return (
                    <button key={t.id}
                      onClick={() => openTeam(t)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all hover:opacity-80"
                      style={{
                        borderBottom: i < teams.length - 1 ? "1px solid var(--bg-elevated)" : "none",
                        background: isMine ? "var(--bg-elevated)" : "transparent",
                      }}>
                      <span className="text-[9px] font-black w-4 text-right flex-shrink-0"
                        style={{ color: rankColor }}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black truncate"
                          style={{ color: isMine ? "var(--color-primary)" : "var(--color-text)" }}>
                          {t.name}
                          {isMine && <span className="ml-1 text-[7px]" style={{ color: "var(--color-primary)" }}>·Du</span>}
                          {!t.user_id && <span className="ml-1 text-[7px]" style={{ color: "var(--color-border-subtle)" }}>·Bot</span>}
                        </p>
                      </div>
                      {isH2H && <>
                        <span className="text-[9px] font-black w-6 text-center" style={{ color: "var(--color-success)" }}>{t.wins ?? 0}</span>
                        <span className="text-[9px] font-black w-6 text-center" style={{ color: "var(--color-muted)" }}>{t.draws ?? 0}</span>
                        <span className="text-[9px] font-black w-6 text-center" style={{ color: "var(--color-error)" }}>{t.losses ?? 0}</span>
                      </>}
                      {activeGW && (
                        <span className="text-[9px] font-black w-12 text-right"
                          style={{ color: gwPts !== null ? "var(--color-primary)" : "var(--color-border)" }}>
                          {gwPts !== null ? gwPts.toFixed(1) : "–"}
                        </span>
                      )}
                      <span className="text-[9px] font-black w-14 text-right"
                        style={{ color: "var(--color-text)" }}>
                        {isH2H ? pts : (pts as number).toFixed(1)}
                      </span>
                      <span className="text-[10px] w-3 flex-shrink-0" style={{ color: "var(--color-border)" }}>›</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {tab === "info" && (
          <>
            {/* League name card */}
            <div className="rounded-2xl p-4 mb-3"
              style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
              <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-border-subtle)" }}>
                Liga-Name
              </p>
              <p className="text-base font-black" style={{ color: "var(--color-text)" }}>{league?.name}</p>
              <p className="text-[8px] font-black uppercase mt-1" style={{ color: "var(--color-muted)" }}>
                {teams.length} Teams · {league?.status === "active" ? "Aktiv" : league?.status === "setup" ? "Setup" : league?.status || "–"}
              </p>
            </div>

            {/* Invite code (owner only) */}
            {isOwner && league?.invite_code && (
              <div className="rounded-2xl p-4 mb-3"
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-primary)40" }}>
                <p className="text-[8px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-border-subtle)" }}>
                  Einladungscode
                </p>
                <div className="flex items-center gap-3">
                  <p className="font-black text-lg tracking-widest flex-1" style={{ color: "var(--color-primary)" }}>
                    {league.invite_code}
                  </p>
                  <button onClick={copyInviteCode}
                    className="px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                    style={{
                      background: copied ? "var(--color-success)20" : "color-mix(in srgb, var(--color-primary) 15%, var(--bg-page))",
                      color: copied ? "var(--color-success)" : "var(--color-primary)",
                      border: `1px solid ${copied ? "var(--color-success)40" : "var(--color-primary)40"}`,
                    }}>
                    {copied ? "✓ Kopiert" : "Kopieren"}
                  </button>
                </div>
              </div>
            )}

            {/* Settings overview */}
            {ligaSettings && (
              <div className="rounded-2xl p-4 mb-3"
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-border-subtle)" }}>
                  Einstellungen
                  {isOwner && (
                    <a href={`/leagues/${leagueId}/admin`}
                      className="ml-2 text-[7px] uppercase tracking-widest"
                      style={{ color: "var(--color-primary)" }}>
                      · Bearbeiten
                    </a>
                  )}
                </p>
                <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                  {[
                    ["Kadergröße", `${ligaSettings.squad_size || 15} Spieler`],
                    ["Bank", `${ligaSettings.bench_size || 4} Plätze`],
                    ["IR-Plätze", `${ligaSettings.ir_spots || 0}`],
                    ["Wertung", scoringLabels[ligaSettings.scoring_type] || ligaSettings.scoring_type || "Standard"],
                    ["Transfers/Woche", `${ligaSettings.max_transfers_per_week ?? "∞"}`],
                    ["Playoff-Teams", `${ligaSettings.playoff_teams || "–"}`],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>{label}</p>
                      <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Admin link */}
            {isOwner && (
              <a href={`/leagues/${leagueId}/admin`}
                className="block w-full py-3 rounded-2xl text-center text-[9px] font-black uppercase tracking-widest"
                style={{ background: "var(--bg-card)", color: "var(--color-primary)", border: "1px solid var(--color-primary)30" }}>
                ⚙ Liga-Einstellungen (Admin)
              </a>
            )}
          </>
        )}

        {tab === "transfers" && (
          <TransactionsFeed leagueId={leagueId} />
        )}
      </div>

      {/* Team detail bottom sheet */}
      {selectedTeam && (
        <div className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.8)" }}
          onClick={e => { if (e.target === e.currentTarget) { setSelectedTeam(null); setSelectedPlayer(null); } }}>
          <div className="w-full max-w-md rounded-t-3xl flex flex-col"
            style={{ background: "var(--bg-page)", maxHeight: "90vh" }}>

            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--color-border)" }} />
            </div>

            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-2 pb-4 flex-shrink-0">
              {/* Team avatar placeholder */}
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: "var(--bg-elevated)", border: "2px solid var(--color-border)" }}>
                <span className="text-lg font-black" style={{ color: "var(--color-primary)" }}>
                  {selectedTeam.name?.[0]?.toUpperCase() || "T"}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-base leading-tight truncate" style={{ color: "var(--color-text)" }}>
                  {selectedTeam.name}
                </p>
                <p className="text-[9px] font-black uppercase tracking-widest mt-0.5" style={{ color: "var(--color-muted)" }}>
                  {isH2H
                    ? `${selectedTeam.wins ?? 0}-${selectedTeam.losses ?? 0}${(selectedTeam.draws ?? 0) > 0 ? `-${selectedTeam.draws}` : ""}`
                    : `${(selectedTeam.total_points ?? 0).toFixed(1)} FPTS`
                  }
                </p>
              </div>
              <button onClick={() => { setSelectedTeam(null); setSelectedPlayer(null); }}
                className="w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0"
                style={{ color: "var(--color-muted)", background: "var(--bg-elevated)" }}>✕</button>
            </div>

            {/* Action buttons */}
            {selectedTeam.user_id !== user?.id && (
              <div className="flex gap-2 px-5 pb-4 flex-shrink-0">
                {[
                  { label: "Trade", icon: "⇄", href: `/leagues/${leagueId}/trades` },
                  { label: "Trans.", icon: "📋", href: null },
                  { label: "Chat", icon: "💬", href: null },
                ].map(({ label, icon, href }) => (
                  href ? (
                    <a key={label} href={href}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest"
                      style={{ background: "var(--bg-elevated)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>
                      <span>{icon}</span>{label}
                    </a>
                  ) : (
                    <button key={label}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest"
                      style={{ background: "var(--bg-elevated)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                      <span>{icon}</span>{label}
                    </button>
                  )
                ))}
              </div>
            )}

            {/* Divider */}
            <div style={{ borderTop: "1px solid var(--bg-elevated)" }} />

            {loadingTeam ? (
              <div className="flex-1 flex items-center justify-center">
                <Spinner text="Lade Kader..." />
              </div>
            ) : teamSquad.length === 0 ? (
              <EmptyState icon="👥" title="Kein Kader vorhanden" />
            ) : (
              <div className="overflow-y-auto flex-1 pb-6">
                {(() => {
                  const starters = teamLineup.filter((p): p is Player => p !== null);
                  const hasLineup = starters.length > 0;
                  const starterIds = new Set(starters.map(p => p.id));
                  const bench = teamSquad.filter(p => !starterIds.has(p.id));
                  const renderPlayer = (p: Player, keyPrefix: string) => (
                    <button
                      key={`${keyPrefix}-${p.id}`}
                      onClick={() => setSelectedPlayer(p)}
                      className="w-full flex items-center gap-3 px-5 py-3 text-left"
                      style={{ borderBottom: "1px solid var(--bg-elevated)" }}>
                      <span className="text-[8px] font-black w-7 text-center flex-shrink-0 py-1 rounded"
                        style={{ background: `${POS_COLOR[p.position] || "var(--color-border)"}20`, color: POS_COLOR[p.position] || "var(--color-muted)" }}>
                        {p.position}
                      </span>
                      <PlayerCard player={p} posColor={POS_COLOR[p.position] || "var(--color-border)"} size={40} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black truncate" style={{ color: "var(--color-text)" }}>{p.name}</p>
                        <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                          <span style={{ color: POS_COLOR[p.position] }}>{p.position}</span>
                          {" · "}{p.team_name}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-black" style={{ color: "var(--color-text)" }}>{(p.fpts ?? 0).toFixed(1)}</p>
                        <p className="text-[7px] uppercase" style={{ color: "var(--color-border)" }}>FPTS</p>
                      </div>
                    </button>
                  );
                  return hasLineup ? (
                    <>
                      <div className="px-5 pt-4 pb-2">
                        <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>
                          Startelf {teamFormation && <span style={{ color: "var(--color-primary)" }}>· {teamFormation}</span>}
                        </p>
                      </div>
                      {starters.map(p => renderPlayer(p, "s"))}
                      {bench.length > 0 && (
                        <>
                          <div className="px-5 pt-5 pb-2">
                            <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>
                              Bank · {bench.length}
                            </p>
                          </div>
                          {bench.map(p => renderPlayer(p, "b"))}
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="px-5 pt-4 pb-2">
                        <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>
                          Kader · {teamSquad.length} Spieler
                        </p>
                      </div>
                      {teamSquad.map(p => renderPlayer(p, "k"))}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Player card overlay */}
      {selectedPlayer && (() => {
        const posColor = POS_COLOR[selectedPlayer.position] || "var(--color-text)";
        const seasonPts = playerGameLog.reduce((s, g) => s + (g.points || 0), 0);
        const avgPts = playerGameLog.length > 0 ? seasonPts / playerGameLog.length : 0;
        const isMine = playerOwner?.user_id === user?.id;
        const formatD = (d: string) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
        return (
          <div className="fixed inset-0 flex items-end justify-center"
            style={{ zIndex: 60, background: "rgba(0,0,0,0.6)" }}
            onClick={e => { if (e.target === e.currentTarget) setSelectedPlayer(null); }}>
            <div className="w-full max-w-md rounded-t-3xl flex flex-col"
              style={{ background: "var(--bg-page)", maxHeight: "90vh" }}>

              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-0 flex-shrink-0">
                <div className="w-10 h-1 rounded-full" style={{ background: "var(--color-border)" }} />
              </div>

              {/* Hero */}
              {(() => {
                const club = clubAsset(selectedPlayer.team_name);
                const c1 = club?.colour1 || null;
                const heroBg = c1
                  ? `linear-gradient(160deg, ${c1}22 0%, ${posColor}12 50%, transparent 80%)`
                  : `linear-gradient(160deg, ${posColor}18 0%, transparent 60%)`;
                const photoSrc = tsdbPlayer?.cutout || tsdbPlayer?.render || selectedPlayer.photo_url || "/player-placeholder.png";
                const isCutout = !!(tsdbPlayer?.cutout || tsdbPlayer?.render);
                return (
                  <div className="relative flex gap-4 px-5 pt-2 pb-3 flex-shrink-0" style={{ background: heroBg }}>
                    {/* Club fanart background if available */}
                    {club?.fanart1 && (
                      <div className="absolute inset-0 overflow-hidden rounded-none opacity-5 pointer-events-none">
                        <img src={club.fanart1} alt="" className="w-full h-full object-cover" />
                      </div>
                    )}
                    {/* Player image: cutout (transparent PNG) or regular photo */}
                    <div className="relative flex-shrink-0" style={{ width: 88, height: 88 }}>
                      <img
                        src={photoSrc}
                        alt={selectedPlayer.name}
                        className={`w-full h-full object-contain ${isCutout ? "" : "rounded-2xl"}`}
                        style={isCutout ? { filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.6))" } : { border: `2px solid ${posColor}60` }}
                      />
                    </div>
                    <div className="flex-1 min-w-0 pt-1">
                      {/* Club badge + name row */}
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {club?.badge && (
                          <img src={club.badge} alt={selectedPlayer.team_name} className="w-4 h-4 object-contain flex-shrink-0" />
                        )}
                        <p className="text-[8px] font-black uppercase tracking-widest truncate" style={{ color: c1 || "var(--color-muted)" }}>
                          {selectedPlayer.team_name}
                        </p>
                      </div>
                      <p className="text-xl font-black leading-tight" style={{ color: "var(--color-text)" }}>
                        {selectedPlayer.name}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[8px] font-black px-2 py-0.5 rounded"
                          style={{ background: posColor, color: "var(--bg-page)" }}>
                          {selectedPlayer.position}
                        </span>
                        {(playerDetail?.nationality || tsdbPlayer?.nationality) && (
                          <span className="text-[8px] font-black uppercase" style={{ color: "var(--color-border-subtle)" }}>
                            {playerDetail?.nationality || tsdbPlayer?.nationality}
                          </span>
                        )}
                        {club?.kit && (
                          <img src={club.kit} alt="kit" className="h-5 object-contain opacity-70" />
                        )}
                      </div>
                    </div>
                    <button onClick={() => setSelectedPlayer(null)}
                      className="absolute top-3 right-4 w-7 h-7 flex items-center justify-center rounded-full z-10"
                      style={{ background: "var(--bg-elevated)", color: "var(--color-muted)" }}>✕</button>
                  </div>
                );
              })()}

              {/* Owner band */}
              <div className="mx-5 mb-3 px-3 py-2 rounded-xl flex items-center justify-between flex-shrink-0"
                style={{ background: "var(--bg-card)", border: `1px solid ${playerOwner ? (isMine ? "var(--color-primary)40" : "var(--color-border)") : "var(--color-success)30"}` }}>
                {playerOwner ? (
                  <>
                    <div>
                      <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>Besitzer</p>
                      <p className="text-xs font-black" style={{ color: isMine ? "var(--color-primary)" : "var(--color-text)" }}>
                        {playerOwner.name} {isMine && "· Mein Team"}
                      </p>
                    </div>
                    {!isMine && (
                      <a href={`/leagues/${leagueId}/trades?target=${playerOwner.id}&player=${selectedPlayer.id}`}
                        className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase"
                        style={{ background: "color-mix(in srgb, var(--color-primary) 15%, var(--bg-page))", color: "var(--color-primary)", border: "1px solid var(--color-primary)30" }}>
                        Trade anfragen
                      </a>
                    )}
                    {isMine && (
                      <a href={`/leagues/${leagueId}/transfers`}
                        className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase"
                        style={{ background: "var(--bg-card)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>
                        Transfer
                      </a>
                    )}
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>Status</p>
                      <p className="text-xs font-black" style={{ color: "var(--color-success)" }}>Freier Spieler</p>
                    </div>
                    <a href={`/leagues/${leagueId}/transfers`}
                      className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase"
                      style={{ background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))", color: "var(--color-success)", border: "1px solid var(--color-success)30" }}>
                      Verpflichten
                    </a>
                  </>
                )}
              </div>

              {/* Tabs */}
              <div className="flex border-b flex-shrink-0" style={{ borderColor: "var(--bg-elevated)" }}>
                {(["summary", "gamelog", "history", "news"] as const).map(t => (
                  <button key={t} onClick={() => setPlayerTab(t)}
                    className="flex-1 py-2.5 text-[8px] font-black uppercase tracking-widest transition-all"
                    style={{
                      color: playerTab === t ? posColor : "var(--color-border)",
                      borderBottom: playerTab === t ? `2px solid ${posColor}` : "2px solid transparent",
                    }}>
                    {t === "summary" ? "Übersicht" : t === "gamelog" ? "Log" : t === "history" ? "Historie" : "News"}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="overflow-y-auto flex-1 pb-6">
                {playerDetailLoading ? (
                  <Spinner text="Lade..." />
                ) : (
                  <>
                    {/* ÜBERSICHT */}
                    {playerTab === "summary" && (
                      <div className="p-4 space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: "Saison-Pts", value: seasonPts.toFixed(1), hi: true },
                            { label: "Ø / GW", value: avgPts.toFixed(1) },
                            { label: "Einsätze", value: playerGameLog.length },
                            { label: "Tore", value: playerGameLog.reduce((s, g) => s + (g.goals || 0), 0) },
                            { label: "Assists", value: playerGameLog.reduce((s, g) => s + (g.assists || 0), 0) },
                            { label: "Minuten", value: playerGameLog.reduce((s, g) => s + (g.minutes || 0), 0) },
                          ].map(({ label, value, hi }) => (
                            <div key={label} className="p-3 rounded-xl text-center"
                              style={{ background: "var(--bg-card)", border: `1px solid ${hi ? posColor + "40" : "var(--color-border)"}` }}>
                              <p className="text-lg font-black" style={{ color: hi ? posColor : "var(--color-text)" }}>{value}</p>
                              <p className="text-[7px] font-black uppercase tracking-widest mt-0.5" style={{ color: "var(--color-border)" }}>{label}</p>
                            </div>
                          ))}
                        </div>
                        <div className="rounded-xl p-3" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                          <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-border)" }}>
                            Saison-Statistiken
                          </p>
                          <div className="grid grid-cols-2 gap-y-2">
                            {[
                              ["Schüsse aufs Tor", playerGameLog.reduce((s,g)=>s+(g.shots_on||0),0)],
                              ["Key Passes", playerGameLog.reduce((s,g)=>s+(g.key_passes||0),0)],
                              ["Tackles", playerGameLog.reduce((s,g)=>s+(g.tackles||0),0)],
                              ["Abfangen", playerGameLog.reduce((s,g)=>s+(g.interceptions||0),0)],
                              ["Gelbe Karten", playerGameLog.reduce((s,g)=>s+(g.yellow_cards||0),0)],
                              ["Rote Karten", playerGameLog.reduce((s,g)=>s+(g.red_cards||0),0)],
                              ...(selectedPlayer.position === "GK" ? [["Paraden", playerGameLog.reduce((s,g)=>s+(g.saves||0),0)]] : []),
                              ["Clean Sheets", playerGameLog.filter(g=>g.clean_sheet).length],
                            ].map(([label, val]) => (
                              <div key={String(label)} className="flex items-center justify-between">
                                <span className="text-[9px]" style={{ color: "var(--color-muted)" }}>{label}</span>
                                <span className="text-sm font-black" style={{ color: "var(--color-text)" }}>{val}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* GAME LOG */}
                    {playerTab === "gamelog" && (
                      <div className="p-4 space-y-2">
                        {playerGameLog.length === 0 ? (
                          <EmptyState icon="📊" title="Noch keine Spieltag-Daten" />
                        ) : playerGameLog.map(g => (
                          <div key={g.id} className="rounded-xl overflow-hidden"
                            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                            <div className="px-3 py-1.5 flex items-center justify-between"
                              style={{ borderBottom: "1px solid var(--bg-elevated)" }}>
                              <span className="text-[9px] font-black" style={{ color: posColor }}>GW{g.gameweek}</span>
                              <span className="text-sm font-black" style={{ color: posColor }}>{g.points?.toFixed(1) || "0.0"} Pts</span>
                            </div>
                            <div className="grid grid-cols-5 gap-1 px-3 py-2">
                              {[["TOR", g.goals||0], ["ASS", g.assists||0], ["MIN", g.minutes||0], ["CS", g.clean_sheet?"✓":"—"], ["KP", g.key_passes||0]].map(([l, v]) => (
                                <div key={String(l)} className="text-center">
                                  <p className="text-[7px] uppercase" style={{ color: "var(--color-border)" }}>{l}</p>
                                  <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>{v}</p>
                                </div>
                              ))}
                            </div>
                            {g.is_captain && (
                              <div className="px-3 pb-2">
                                <span className="text-[7px] font-black px-2 py-0.5 rounded-full"
                                  style={{ background: "var(--color-primary)20", color: "var(--color-primary)" }}>C Kapitän ×2</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* HISTORIE */}
                    {playerTab === "history" && (
                      <div className="p-4">
                        {playerHistory.length === 0 ? (
                          <EmptyState icon="📋" title="Keine Historie vorhanden" />
                        ) : (
                          <div className="relative pl-5">
                            <div className="absolute left-2 top-2 bottom-2 w-px" style={{ background: "var(--color-border)" }} />
                            {playerHistory.map((h, i) => {
                              const hColor = { draft: "var(--color-primary)", transfer_in: "var(--color-success)", transfer_out: "var(--color-error)", trade: "var(--color-info)" }[h.type as string] || "var(--color-text)";
                              const hIcon = { draft: "🏈", transfer_in: "▲", transfer_out: "▼", trade: "⇄" }[h.type as string] || "·";
                              return (
                                <div key={i} className="relative mb-3">
                                  <div className="absolute -left-3 top-3 w-2.5 h-2.5 rounded-full"
                                    style={{ background: hColor }} />
                                  <div className="p-3 rounded-xl ml-2"
                                    style={{ background: "var(--bg-card)", border: `1px solid ${hColor}25` }}>
                                    <div className="flex items-center justify-between mb-0.5">
                                      <span className="text-[9px] font-black uppercase" style={{ color: hColor }}>
                                        {hIcon} {h.detail}
                                      </span>
                                      <span className="text-[7px]" style={{ color: "var(--color-border)" }}>{formatD(h.date)}</span>
                                    </div>
                                    <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>{h.team}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* NEWS */}
                    {playerTab === "news" && (
                      <div className="p-4 space-y-2">
                        {playerNewsLoading ? (
                          <Spinner text="Lade News..." />
                        ) : playerNews.length === 0 ? (
                          <EmptyState icon="📰" title="Keine News gefunden"
                            action={
                              <a href={`/leagues/${leagueId}/players/${selectedPlayer.id}`}
                                className="inline-block mt-1 px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest"
                                style={{ background: "var(--bg-card)", color: "var(--color-primary)", border: "1px solid var(--color-primary)30" }}>
                                Vollständiges Profil →
                              </a>
                            }
                          />
                        ) : playerNews.slice(0, 5).map((n: any, i: number) => (
                          <a key={i} href={n.link || "#"} target="_blank" rel="noopener noreferrer"
                            className="block p-3 rounded-xl transition-opacity hover:opacity-80"
                            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                            <p className="text-xs font-black leading-snug" style={{ color: "var(--color-text)" }}>{n.title}</p>
                            {n.pubDate && (
                              <p className="text-[7px] font-black uppercase mt-1" style={{ color: "var(--color-border-subtle)" }}>
                                {new Date(n.pubDate).toLocaleDateString("de-DE", { day: "2-digit", month: "short" })}
                              </p>
                            )}
                          </a>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      <BottomNav />
    </main>
  );
}
