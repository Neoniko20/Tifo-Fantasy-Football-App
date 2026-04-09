"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { LeagueTopNav } from "@/app/components/LeagueTopNav";
import { BottomNav } from "@/app/components/BottomNav";
import tsdbClubs from "@/lib/tsdb-clubs.json";
import tsdbLeagues from "@/lib/tsdb-leagues.json";
import { TransactionsFeed } from "@/app/components/TransactionsFeed";

// Helper: club assets by team_name
const clubAsset = (teamName: string) => (tsdbClubs as Record<string, any>)[teamName] || null;
// Helper: league assets by api-sports league id (as string key)
const leagueAsset = (apId: number) => (tsdbLeagues as Record<string, any>)[String(apId)] || null;

const POS_COLOR: Record<string, string> = {
  GK: "#f5a623", DF: "#4a9eff", MF: "#00ce7d", FW: "#ff4d6d",
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
    <main className="flex min-h-screen items-center justify-center text-[9px] font-black uppercase tracking-widest animate-pulse"
      style={{ background: "#0c0900", color: "#2a2010" }}>
      Lade...
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
      style={{ background: "#0c0900", paddingTop: 80 }}>

      <LeagueTopNav
        leagueId={leagueId}
        leagueName={league?.name}
        leagueStatus={league?.status}
        isOwner={isOwner}
      />

      <div className="w-full max-w-md px-4 pt-4">

        {/* Tab row */}
        <div className="flex gap-1.5 mb-4">
          {(["tabelle", "info", "transfers"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
              style={{
                background: tab === t ? "#f5a623" : "#141008",
                color: tab === t ? "#0c0900" : "#5a4020",
                border: `1px solid ${tab === t ? "#f5a623" : "#2a2010"}`,
              }}>
              {t === "tabelle" ? "Tabelle" : t === "info" ? "Liga Info" : "Trans."}
            </button>
          ))}
        </div>

        {tab === "tabelle" && (
          <>
            {teams.length === 0 ? (
              <div className="text-center py-16" style={{ color: "#2a2010" }}>
                <p className="text-3xl mb-3">🏆</p>
                <p className="text-[9px] font-black uppercase tracking-widest">Noch keine Teams</p>
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden mb-3"
                style={{ background: "#141008", border: "1px solid #2a2010" }}>
                {/* Header row */}
                <div className="flex items-center gap-3 px-4 py-2.5"
                  style={{ borderBottom: "1px solid #2a2010" }}>
                  <span className="text-[7px] font-black uppercase tracking-widest w-4 text-right flex-shrink-0"
                    style={{ color: "#2a2010" }}>#</span>
                  <span className="flex-1 text-[7px] font-black uppercase tracking-widest"
                    style={{ color: "#2a2010" }}>Team</span>
                  {isH2H && <>
                    <span className="text-[7px] font-black uppercase w-6 text-center" style={{ color: "#2a2010" }}>S</span>
                    <span className="text-[7px] font-black uppercase w-6 text-center" style={{ color: "#2a2010" }}>U</span>
                    <span className="text-[7px] font-black uppercase w-6 text-center" style={{ color: "#2a2010" }}>N</span>
                  </>}
                  <span className="text-[7px] font-black uppercase w-14 text-right" style={{ color: "#2a2010" }}>
                    {isH2H ? "Pts" : "FPTS"}
                  </span>
                  <span className="w-3 flex-shrink-0" />
                </div>
                {teams.map((t, i) => {
                  const isMine = t.user_id === user?.id;
                  const rankColor = i === 0 ? "#f5a623" : i === 1 ? "#c8b080" : i === 2 ? "#a07040" : "#3a2a10";
                  const pts = isH2H
                    ? (t.wins ?? 0) * 3 + (t.draws ?? 0)
                    : (t.total_points ?? 0);
                  return (
                    <button key={t.id}
                      onClick={() => openTeam(t)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all hover:opacity-80"
                      style={{
                        borderBottom: i < teams.length - 1 ? "1px solid #1a1208" : "none",
                        background: isMine ? "#161008" : "transparent",
                      }}>
                      <span className="text-[9px] font-black w-4 text-right flex-shrink-0"
                        style={{ color: rankColor }}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black truncate"
                          style={{ color: isMine ? "#f5a623" : "#c8b080" }}>
                          {t.name}
                          {isMine && <span className="ml-1 text-[7px]" style={{ color: "#f5a623" }}>·Du</span>}
                          {!t.user_id && <span className="ml-1 text-[7px]" style={{ color: "#3a2a10" }}>·Bot</span>}
                        </p>
                      </div>
                      {isH2H && <>
                        <span className="text-[9px] font-black w-6 text-center" style={{ color: "#00ce7d" }}>{t.wins ?? 0}</span>
                        <span className="text-[9px] font-black w-6 text-center" style={{ color: "#5a4020" }}>{t.draws ?? 0}</span>
                        <span className="text-[9px] font-black w-6 text-center" style={{ color: "#ff4d6d" }}>{t.losses ?? 0}</span>
                      </>}
                      <span className="text-[9px] font-black w-14 text-right"
                        style={{ color: "#c8b080" }}>
                        {isH2H ? pts : (pts as number).toFixed(1)}
                      </span>
                      <span className="text-[10px] w-3 flex-shrink-0" style={{ color: "#2a2010" }}>›</span>
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
              style={{ background: "#141008", border: "1px solid #2a2010" }}>
              <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "#3a2a10" }}>
                Liga-Name
              </p>
              <p className="text-base font-black" style={{ color: "#c8b080" }}>{league?.name}</p>
              <p className="text-[8px] font-black uppercase mt-1" style={{ color: "#5a4020" }}>
                {teams.length} Teams · {league?.status === "active" ? "Aktiv" : league?.status === "setup" ? "Setup" : league?.status || "–"}
              </p>
            </div>

            {/* Invite code (owner only) */}
            {isOwner && league?.invite_code && (
              <div className="rounded-2xl p-4 mb-3"
                style={{ background: "#141008", border: "1px solid #f5a62340" }}>
                <p className="text-[8px] font-black uppercase tracking-widest mb-2" style={{ color: "#3a2a10" }}>
                  Einladungscode
                </p>
                <div className="flex items-center gap-3">
                  <p className="font-black text-lg tracking-widest flex-1" style={{ color: "#f5a623" }}>
                    {league.invite_code}
                  </p>
                  <button onClick={copyInviteCode}
                    className="px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                    style={{
                      background: copied ? "#00ce7d20" : "#2a1a00",
                      color: copied ? "#00ce7d" : "#f5a623",
                      border: `1px solid ${copied ? "#00ce7d40" : "#f5a62340"}`,
                    }}>
                    {copied ? "✓ Kopiert" : "Kopieren"}
                  </button>
                </div>
              </div>
            )}

            {/* Settings overview */}
            {ligaSettings && (
              <div className="rounded-2xl p-4 mb-3"
                style={{ background: "#141008", border: "1px solid #2a2010" }}>
                <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "#3a2a10" }}>
                  Einstellungen
                  {isOwner && (
                    <a href={`/leagues/${leagueId}/admin`}
                      className="ml-2 text-[7px] uppercase tracking-widest"
                      style={{ color: "#f5a623" }}>
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
                      <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "#3a2a10" }}>{label}</p>
                      <p className="text-xs font-black" style={{ color: "#c8b080" }}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Admin link */}
            {isOwner && (
              <a href={`/leagues/${leagueId}/admin`}
                className="block w-full py-3 rounded-2xl text-center text-[9px] font-black uppercase tracking-widest"
                style={{ background: "#141008", color: "#f5a623", border: "1px solid #f5a62330" }}>
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
            style={{ background: "#0f0d08", maxHeight: "90vh" }}>

            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full" style={{ background: "#2a2010" }} />
            </div>

            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-2 pb-4 flex-shrink-0">
              {/* Team avatar placeholder */}
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: "#1a1208", border: "2px solid #2a2010" }}>
                <span className="text-lg font-black" style={{ color: "#f5a623" }}>
                  {selectedTeam.name?.[0]?.toUpperCase() || "T"}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-base leading-tight truncate" style={{ color: "#c8b080" }}>
                  {selectedTeam.name}
                </p>
                <p className="text-[9px] font-black uppercase tracking-widest mt-0.5" style={{ color: "#5a4020" }}>
                  {isH2H
                    ? `${selectedTeam.wins ?? 0}-${selectedTeam.losses ?? 0}${(selectedTeam.draws ?? 0) > 0 ? `-${selectedTeam.draws}` : ""}`
                    : `${(selectedTeam.total_points ?? 0).toFixed(1)} FPTS`
                  }
                </p>
              </div>
              <button onClick={() => { setSelectedTeam(null); setSelectedPlayer(null); }}
                className="w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0"
                style={{ color: "#5a4020", background: "#1a1208" }}>✕</button>
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
                      style={{ background: "#1a1208", color: "#c8b080", border: "1px solid #2a2010" }}>
                      <span>{icon}</span>{label}
                    </a>
                  ) : (
                    <button key={label}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest"
                      style={{ background: "#1a1208", color: "#5a4020", border: "1px solid #2a2010" }}>
                      <span>{icon}</span>{label}
                    </button>
                  )
                ))}
              </div>
            )}

            {/* Divider */}
            <div style={{ borderTop: "1px solid #1a1208" }} />

            {loadingTeam ? (
              <div className="flex-1 flex items-center justify-center py-16 text-[9px] font-black uppercase tracking-widest animate-pulse"
                style={{ color: "#2a2010" }}>Lade Kader...</div>
            ) : teamSquad.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-16">
                <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#2a2010" }}>
                  Kein Kader vorhanden
                </p>
              </div>
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
                      style={{ borderBottom: "1px solid #1a1208" }}>
                      <span className="text-[8px] font-black w-7 text-center flex-shrink-0 py-1 rounded"
                        style={{ background: `${POS_COLOR[p.position] || "#2a2010"}20`, color: POS_COLOR[p.position] || "#5a4020" }}>
                        {p.position}
                      </span>
                      <div className="relative flex-shrink-0">
                        <img src={p.photo_url || "/player-placeholder.png"} alt={p.name}
                          className="w-10 h-10 rounded-full object-cover"
                          style={{ border: `2px solid ${POS_COLOR[p.position] || "#2a2010"}60` }} />
                        {p.api_team_id && (
                          <img src={`https://media.api-sports.io/football/teams/${p.api_team_id}.png`}
                            alt="" className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full object-contain"
                            style={{ background: "#0c0900", padding: 1 }} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black truncate" style={{ color: "#c8b080" }}>{p.name}</p>
                        <p className="text-[8px] font-black uppercase" style={{ color: "#5a4020" }}>
                          <span style={{ color: POS_COLOR[p.position] }}>{p.position}</span>
                          {" · "}{p.team_name}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-black" style={{ color: "#c8b080" }}>{(p.fpts ?? 0).toFixed(1)}</p>
                        <p className="text-[7px] uppercase" style={{ color: "#2a2010" }}>FPTS</p>
                      </div>
                    </button>
                  );
                  return hasLineup ? (
                    <>
                      <div className="px-5 pt-4 pb-2">
                        <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "#3a2a10" }}>
                          Startelf {teamFormation && <span style={{ color: "#f5a623" }}>· {teamFormation}</span>}
                        </p>
                      </div>
                      {starters.map(p => renderPlayer(p, "s"))}
                      {bench.length > 0 && (
                        <>
                          <div className="px-5 pt-5 pb-2">
                            <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "#3a2a10" }}>
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
                        <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "#3a2a10" }}>
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
        const posColor = POS_COLOR[selectedPlayer.position] || "#c8b080";
        const seasonPts = playerGameLog.reduce((s, g) => s + (g.points || 0), 0);
        const avgPts = playerGameLog.length > 0 ? seasonPts / playerGameLog.length : 0;
        const isMine = playerOwner?.user_id === user?.id;
        const formatD = (d: string) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
        return (
          <div className="fixed inset-0 flex items-end justify-center"
            style={{ zIndex: 60, background: "rgba(0,0,0,0.6)" }}
            onClick={e => { if (e.target === e.currentTarget) setSelectedPlayer(null); }}>
            <div className="w-full max-w-md rounded-t-3xl flex flex-col"
              style={{ background: "#0f0d08", maxHeight: "90vh" }}>

              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-0 flex-shrink-0">
                <div className="w-10 h-1 rounded-full" style={{ background: "#2a2010" }} />
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
                        <p className="text-[8px] font-black uppercase tracking-widest truncate" style={{ color: c1 || "#5a4020" }}>
                          {selectedPlayer.team_name}
                        </p>
                      </div>
                      <p className="text-xl font-black leading-tight" style={{ color: "#f5f0e8" }}>
                        {selectedPlayer.name}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[8px] font-black px-2 py-0.5 rounded"
                          style={{ background: posColor, color: "#0c0900" }}>
                          {selectedPlayer.position}
                        </span>
                        {(playerDetail?.nationality || tsdbPlayer?.nationality) && (
                          <span className="text-[8px] font-black uppercase" style={{ color: "#3a2a10" }}>
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
                      style={{ background: "#1a1208", color: "#5a4020" }}>✕</button>
                  </div>
                );
              })()}

              {/* Owner band */}
              <div className="mx-5 mb-3 px-3 py-2 rounded-xl flex items-center justify-between flex-shrink-0"
                style={{ background: "#141008", border: `1px solid ${playerOwner ? (isMine ? "#f5a62340" : "#2a2010") : "#00ce7d30"}` }}>
                {playerOwner ? (
                  <>
                    <div>
                      <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "#2a2010" }}>Besitzer</p>
                      <p className="text-xs font-black" style={{ color: isMine ? "#f5a623" : "#c8b080" }}>
                        {playerOwner.name} {isMine && "· Mein Team"}
                      </p>
                    </div>
                    {!isMine && (
                      <a href={`/leagues/${leagueId}/trades?target=${playerOwner.id}&player=${selectedPlayer.id}`}
                        className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase"
                        style={{ background: "#2a1a00", color: "#f5a623", border: "1px solid #f5a62330" }}>
                        Trade anfragen
                      </a>
                    )}
                    {isMine && (
                      <a href={`/leagues/${leagueId}/transfers`}
                        className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase"
                        style={{ background: "#141008", color: "#c8b080", border: "1px solid #2a2010" }}>
                        Transfer
                      </a>
                    )}
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "#2a2010" }}>Status</p>
                      <p className="text-xs font-black" style={{ color: "#00ce7d" }}>Freier Spieler</p>
                    </div>
                    <a href={`/leagues/${leagueId}/transfers`}
                      className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase"
                      style={{ background: "#0a1a0a", color: "#00ce7d", border: "1px solid #00ce7d30" }}>
                      Verpflichten
                    </a>
                  </>
                )}
              </div>

              {/* Tabs */}
              <div className="flex border-b flex-shrink-0" style={{ borderColor: "#1a1208" }}>
                {(["summary", "gamelog", "history", "news"] as const).map(t => (
                  <button key={t} onClick={() => setPlayerTab(t)}
                    className="flex-1 py-2.5 text-[8px] font-black uppercase tracking-widest transition-all"
                    style={{
                      color: playerTab === t ? posColor : "#2a2010",
                      borderBottom: playerTab === t ? `2px solid ${posColor}` : "2px solid transparent",
                    }}>
                    {t === "summary" ? "Übersicht" : t === "gamelog" ? "Log" : t === "history" ? "Historie" : "News"}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="overflow-y-auto flex-1 pb-6">
                {playerDetailLoading ? (
                  <div className="flex items-center justify-center py-12 text-[9px] font-black uppercase tracking-widest animate-pulse"
                    style={{ color: "#2a2010" }}>Lade...</div>
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
                              style={{ background: "#141008", border: `1px solid ${hi ? posColor + "40" : "#2a2010"}` }}>
                              <p className="text-lg font-black" style={{ color: hi ? posColor : "#c8b080" }}>{value}</p>
                              <p className="text-[7px] font-black uppercase tracking-widest mt-0.5" style={{ color: "#2a2010" }}>{label}</p>
                            </div>
                          ))}
                        </div>
                        <div className="rounded-xl p-3" style={{ background: "#141008", border: "1px solid #2a2010" }}>
                          <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "#2a2010" }}>
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
                                <span className="text-[9px]" style={{ color: "#5a4020" }}>{label}</span>
                                <span className="text-sm font-black" style={{ color: "#c8b080" }}>{val}</span>
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
                          <p className="text-center py-10 text-[9px] font-black uppercase tracking-widest" style={{ color: "#2a2010" }}>
                            Noch keine Spieltag-Daten
                          </p>
                        ) : playerGameLog.map(g => (
                          <div key={g.id} className="rounded-xl overflow-hidden"
                            style={{ background: "#141008", border: "1px solid #2a2010" }}>
                            <div className="px-3 py-1.5 flex items-center justify-between"
                              style={{ borderBottom: "1px solid #1a1208" }}>
                              <span className="text-[9px] font-black" style={{ color: posColor }}>GW{g.gameweek}</span>
                              <span className="text-sm font-black" style={{ color: posColor }}>{g.points?.toFixed(1) || "0.0"} Pts</span>
                            </div>
                            <div className="grid grid-cols-5 gap-1 px-3 py-2">
                              {[["TOR", g.goals||0], ["ASS", g.assists||0], ["MIN", g.minutes||0], ["CS", g.clean_sheet?"✓":"—"], ["KP", g.key_passes||0]].map(([l, v]) => (
                                <div key={String(l)} className="text-center">
                                  <p className="text-[7px] uppercase" style={{ color: "#2a2010" }}>{l}</p>
                                  <p className="text-xs font-black" style={{ color: "#c8b080" }}>{v}</p>
                                </div>
                              ))}
                            </div>
                            {g.is_captain && (
                              <div className="px-3 pb-2">
                                <span className="text-[7px] font-black px-2 py-0.5 rounded-full"
                                  style={{ background: "#f5a62320", color: "#f5a623" }}>C Kapitän ×2</span>
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
                          <p className="text-center py-10 text-[9px] font-black uppercase tracking-widest" style={{ color: "#2a2010" }}>
                            Keine Historie vorhanden
                          </p>
                        ) : (
                          <div className="relative pl-5">
                            <div className="absolute left-2 top-2 bottom-2 w-px" style={{ background: "#2a2010" }} />
                            {playerHistory.map((h, i) => {
                              const hColor = { draft: "#f5a623", transfer_in: "#00ce7d", transfer_out: "#ff4d6d", trade: "#4a9eff" }[h.type as string] || "#c8b080";
                              const hIcon = { draft: "🏈", transfer_in: "▲", transfer_out: "▼", trade: "⇄" }[h.type as string] || "·";
                              return (
                                <div key={i} className="relative mb-3">
                                  <div className="absolute -left-3 top-3 w-2.5 h-2.5 rounded-full"
                                    style={{ background: hColor }} />
                                  <div className="p-3 rounded-xl ml-2"
                                    style={{ background: "#141008", border: `1px solid ${hColor}25` }}>
                                    <div className="flex items-center justify-between mb-0.5">
                                      <span className="text-[9px] font-black uppercase" style={{ color: hColor }}>
                                        {hIcon} {h.detail}
                                      </span>
                                      <span className="text-[7px]" style={{ color: "#2a2010" }}>{formatD(h.date)}</span>
                                    </div>
                                    <p className="text-xs font-black" style={{ color: "#c8b080" }}>{h.team}</p>
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
                          <p className="text-center py-10 text-[9px] font-black uppercase tracking-widest animate-pulse" style={{ color: "#2a2010" }}>Lade News...</p>
                        ) : playerNews.length === 0 ? (
                          <div className="text-center py-10">
                            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#2a2010" }}>Keine News gefunden</p>
                            <a href={`/leagues/${leagueId}/players/${selectedPlayer.id}`}
                              className="inline-block mt-4 px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest"
                              style={{ background: "#141008", color: "#f5a623", border: "1px solid #f5a62330" }}>
                              Vollständiges Profil →
                            </a>
                          </div>
                        ) : playerNews.slice(0, 5).map((n: any, i: number) => (
                          <a key={i} href={n.link || "#"} target="_blank" rel="noopener noreferrer"
                            className="block p-3 rounded-xl transition-opacity hover:opacity-80"
                            style={{ background: "#141008", border: "1px solid #2a2010" }}>
                            <p className="text-xs font-black leading-snug" style={{ color: "#c8b080" }}>{n.title}</p>
                            {n.pubDate && (
                              <p className="text-[7px] font-black uppercase mt-1" style={{ color: "#3a2a10" }}>
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
