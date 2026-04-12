"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { LeagueTopNav } from "@/app/components/LeagueTopNav";
import { BottomNav } from "@/app/components/BottomNav";
import tsdbClubs from "@/lib/tsdb-clubs.json";
import tsdbLeagues from "@/lib/tsdb-leagues.json";

const clubAsset = (teamName: string) => (tsdbClubs as Record<string, any>)[teamName] || null;
const leagueAsset = (apId: number) => (tsdbLeagues as Record<string, any>)[String(apId)] || null;

const POS_COLOR: Record<string, string> = {
  GK: "var(--color-primary)",
  DF: "var(--color-info)",
  MF: "var(--color-success)",
  FW: "var(--color-error)",
};

const POS_LABEL: Record<string, string> = {
  GK: "TW", DF: "ABW", MF: "MF", FW: "ST",
};

type Player = {
  id: number;
  name: string;
  photo_url: string;
  position: string;
  team_name: string;
  api_team_id?: number;
  fpts: number;
  goals?: number;
  assists?: number;
};

type PlayerWithOwner = Player & {
  ownerTeamId?: number;
  ownerTeamName?: string;
  isMine?: boolean;
};

export default function PlayersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [user, setUser] = useState<any>(null);
  const [league, setLeague] = useState<any>(null);
  const [myTeam, setMyTeam] = useState<any>(null);
  const [mySquadIds, setMySquadIds] = useState<Set<number>>(new Set());
  const [takenMap, setTakenMap] = useState<Map<number, { teamId: number; teamName: string }>>(new Map());
  // Refs so fetchPlayers always has the latest values without stale closure issues
  const takenMapRef = useRef<Map<number, { teamId: number; teamName: string }>>(new Map());
  const mySquadIdsRef = useRef<Set<number>>(new Set());

  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [viewMode, setViewMode] = useState<"available" | "all">("available");
  const [sortBy, setSortBy] = useState<"fpts" | "goals" | "assists" | "name">("fpts");

  const [players, setPlayers] = useState<PlayerWithOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);

  const [ligaSettings, setLigaSettings] = useState<any>(null);

  const [actionPlayer, setActionPlayer] = useState<PlayerWithOwner | null>(null);
  const [playerOut, setPlayerOut] = useState<Player | null>(null);
  const [mySquad, setMySquad] = useState<Player[]>([]);
  const [actionMode, setActionMode] = useState<"add" | "drop" | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [showSwap, setShowSwap] = useState(false);

  // Player card detail states
  const [tsdbPlayer, setTsdbPlayer] = useState<any>(null);
  const [playerDetail, setPlayerDetail] = useState<any>(null);
  const [playerGameLog, setPlayerGameLog] = useState<any[]>([]);
  const [playerHistory, setPlayerHistory] = useState<any[]>([]);
  const [playerNews, setPlayerNews] = useState<any[]>([]);
  const [playerNewsLoading, setPlayerNewsLoading] = useState(false);
  const [playerDetailLoading, setPlayerDetailLoading] = useState(false);
  const [playerTab, setPlayerTab] = useState<"summary" | "gamelog" | "history" | "news">("summary");

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

    // Load all teams in the league (including bot teams)
    const { data: teamsData } = await supabase
      .from("teams").select("id, name, user_id").eq("league_id", leagueId);
    const allTeamIds = (teamsData || []).map((t: any) => t.id);

    const { data: teamData } = await supabase
      .from("teams").select("*").eq("league_id", leagueId).eq("user_id", userId).maybeSingle();
    setMyTeam(teamData);

    // Load my squad
    let squad: Player[] = [];
    if (teamData) {
      const { data: myPicks } = await supabase
        .from("squad_players")
        .select("player_id, players(id, name, photo_url, position, team_name, api_team_id, fpts, goals, assists)")
        .eq("team_id", teamData.id);
      squad = (myPicks || []).map((p: any) => p.players).filter(Boolean) as Player[];
      setMySquad(squad);
    }

    // Build taken map from BOTH draft_picks AND squad_players for ALL teams (including bots)
    // — always runs regardless of whether user has a team
    const tMap = new Map<number, { teamId: number; teamName: string }>();
    const findTeamName = (tid: string) =>
      (teamsData || []).find((tm: any) => tm.id === tid)?.name || "Unbekannt";

    if (allTeamIds.length > 0) {
      // 1. draft_picks — filter by team_id (no league_id column in draft_picks!)
      const { data: allPicks } = await supabase
        .from("draft_picks").select("player_id, team_id").in("team_id", allTeamIds);
      for (const pick of (allPicks || [])) {
        tMap.set(pick.player_id, { teamId: pick.team_id, teamName: findTeamName(pick.team_id) });
      }

      // 2. squad_players — covers any gaps (direct adds, waiver, etc.)
      const { data: allSquadRows } = await supabase
        .from("squad_players").select("player_id, team_id").in("team_id", allTeamIds);
      for (const sp of (allSquadRows || [])) {
        if (!tMap.has(sp.player_id)) {
          tMap.set(sp.player_id, { teamId: sp.team_id, teamName: findTeamName(sp.team_id) });
        }
      }
    }

    // Sync refs FIRST so fetchPlayers always reads fresh data
    const squadIds = new Set(squad.map(p => p.id));
    mySquadIdsRef.current = squadIds;
    takenMapRef.current = tMap;

    // Update state (for UI reactivity)
    setMySquadIds(squadIds);
    setTakenMap(tMap);

    // Trigger player load directly with the built data (no stale-closure risk)
    // Use current search/filter state if this is a refresh (not initial load)
    const isRefresh = !loading;
    const q    = isRefresh ? search    : "";
    const pos  = isRefresh ? posFilter : "ALL";
    const mode = isRefresh ? viewMode  : "available";
    const sort = isRefresh ? sortBy    : "fpts";
    await fetchPlayersWithData(q, pos, mode, sort, tMap, squadIds);
    setLoading(false);
  }

  // Core fetch — accepts explicit maps (no stale closure risk)
  async function fetchPlayersWithData(
    q: string, pos: string, mode: string, sort: string,
    tm: Map<number, { teamId: number; teamName: string }>,
    sids: Set<number>
  ) {
    if (mode === "all" && q.length < 2 && pos === "ALL") {
      setPlayers([]);
      return;
    }
    setSearching(true);

    const orderCol = sort === "goals" ? "goals" : sort === "assists" ? "assists" : sort === "name" ? "name" : "fpts";
    const orderAsc = sort === "name";

    let query = supabase
      .from("players")
      .select("id, name, photo_url, position, team_name, api_team_id, fpts, goals, assists")
      .order(orderCol, { ascending: orderAsc })
      .limit(60);

    if (q.length >= 2) query = query.ilike("name", `%${q}%`);
    if (pos !== "ALL") query = query.eq("position", pos);

    // For "available" mode: exclude taken players server-side for accurate results
    if (mode === "available") {
      const takenIds = Array.from(tm.keys());
      if (takenIds.length > 0) {
        query = query.not("id", "in", `(${takenIds.join(",")})`);
      }
    }

    const { data } = await query;
    const results = (data || []) as PlayerWithOwner[];

    const enriched = results.map(p => {
      const owner = tm.get(p.id);
      return {
        ...p,
        ownerTeamId: owner?.teamId,
        ownerTeamName: owner?.teamName,
        isMine: sids.has(p.id),
      };
    });

    // "all" mode: client-side ownership labeling (no exclusion)
    setPlayers(enriched);
    setSearching(false);
  }

  // Load player detail whenever a player card opens
  useEffect(() => {
    if (!actionPlayer) {
      setPlayerDetail(null); setPlayerGameLog([]); setPlayerHistory([]); setPlayerNews([]);
      setTsdbPlayer(null); setShowSwap(false);
      return;
    }
    setPlayerTab("summary");
    setPlayerDetailLoading(true);
    setShowSwap(false);
    setTsdbPlayer(null);
    loadPlayerDetail(actionPlayer.id);
    fetch(`/api/tsdb-player?name=${encodeURIComponent(actionPlayer.name)}&team=${encodeURIComponent(actionPlayer.team_name || "")}`)
      .then(r => r.json()).then(d => setTsdbPlayer(d)).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionPlayer?.id]);

  async function loadPlayerDetail(pid: number) {
    const { data: p } = await supabase.from("players").select("*").eq("id", pid).single();
    setPlayerDetail(p);

    // Game log
    const { data: gwPts } = await supabase.from("liga_gameweek_points")
      .select("*").eq("league_id", leagueId).eq("player_id", pid).order("gameweek");
    setPlayerGameLog(gwPts || []);

    // History
    const { data: leagueTeams } = await supabase.from("teams").select("id, name, user_id").eq("league_id", leagueId);
    const leagueTeamIds = (leagueTeams || []).map((t: any) => t.id);
    const hist: any[] = [];
    if (leagueTeamIds.length > 0) {
      const { data: dp } = await supabase.from("draft_picks")
        .select("pick_number, round, created_at, teams(name)")
        .in("team_id", leagueTeamIds).eq("player_id", pid).maybeSingle();
      if (dp) hist.push({ type: "draft", date: dp.created_at, team: (dp as any).teams?.name, detail: `Pick ${dp.pick_number} · Runde ${dp.round}` });
    }
    const { data: txs } = await supabase.from("liga_transfers")
      .select("id, team_id, player_in_id, player_out_id, created_at")
      .eq("league_id", leagueId)
      .or(`player_in_id.eq.${pid},player_out_id.eq.${pid}`)
      .order("created_at");
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

  // Wrapper using refs (always fresh)
  const fetchPlayers = useCallback((q: string, pos: string, mode: string, sort: string) => {
    return fetchPlayersWithData(q, pos, mode, sort, takenMapRef.current, mySquadIdsRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch when any filter/sort/mode changes
  useEffect(() => {
    if (!loading) fetchPlayers(search, posFilter, viewMode, sortBy);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, posFilter, viewMode, sortBy, loading]);

  async function addPlayer(playerIn: PlayerWithOwner, playerOutId?: number) {
    if (!myTeam) return;
    setSaving(true);

    if (playerOutId) {
      // Transfer: swap in squad_players
      await supabase.from("squad_players")
        .update({ player_id: playerIn.id })
        .eq("team_id", myTeam.id)
        .eq("player_id", playerOutId);

      // Also update draft_picks if present
      const { data: pickRow } = await supabase
        .from("draft_picks").select("id")
        .eq("team_id", myTeam.id).eq("player_id", playerOutId).maybeSingle();
      if (pickRow) {
        await supabase.from("draft_picks")
          .update({ player_id: playerIn.id }).eq("id", pickRow.id);
      }

      await supabase.from("liga_transfers").insert({
        team_id: myTeam.id,
        league_id: leagueId,
        player_out_id: playerOutId,
        player_in_id: playerIn.id,
      });

      setSavedMsg(`✓ ${playerIn.name} wurde ins Team geholt`);
    } else {
      // Direct add
      await supabase.from("squad_players").insert({
        team_id: myTeam.id,
        player_id: playerIn.id,
      });
      setSavedMsg(`✓ ${playerIn.name} zum Kader hinzugefügt`);
    }

    setSaving(false);
    setActionPlayer(null);
    setPlayerOut(null);
    setActionMode(null);
    await loadAll(user.id);
    setTimeout(() => setSavedMsg(""), 3000);
  }

  async function dropPlayerDirect(playerId: number) {
    if (!myTeam) return;
    setSaving(true);
    await supabase.from("squad_players")
      .delete().eq("team_id", myTeam.id).eq("player_id", playerId);
    // Also remove from draft_picks if present
    await supabase.from("draft_picks")
      .delete().eq("team_id", myTeam.id).eq("player_id", playerId);
    setSavedMsg("✓ Spieler aus dem Kader entfernt");
    setSaving(false);
    setActionPlayer(null);
    setActionMode(null);
    await loadAll(user.id);
    setTimeout(() => setSavedMsg(""), 3000);
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center text-[9px] font-black uppercase tracking-widest animate-pulse"
      style={{ background: "var(--bg-page)", color: "var(--color-border)" }}>
      Lade...
    </main>
  );

  const isOwner = league?.owner_id === user?.id;

  return (
    <main className="flex min-h-screen flex-col items-center pb-24"
      style={{ background: "var(--bg-page)", paddingTop: 80 }}>

      <LeagueTopNav
        leagueId={leagueId}
        leagueName={league?.name}
        leagueStatus={league?.status}
        isOwner={isOwner}
      />

      <div className="w-full max-w-md px-4 pt-4">

        {/* Success message */}
        {savedMsg && (
          <div className="mb-3 px-4 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-center"
            style={{ background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))", color: "var(--color-success)", border: "1px solid var(--color-success)40" }}>
            {savedMsg}
          </div>
        )}

        {/* View mode toggle */}
        <div className="flex gap-1.5 mb-3">
          {(["available", "all"] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)}
              className="flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
              style={{
                background: viewMode === m ? "var(--color-primary)" : "var(--bg-card)",
                color: viewMode === m ? "var(--bg-page)" : "var(--color-muted)",
                border: `1px solid ${viewMode === m ? "var(--color-primary)" : "var(--color-border)"}`,
              }}>
              {m === "available" ? "Verfügbar" : "Alle Spieler"}
            </button>
          ))}
        </div>

        {/* Search bar */}
        <div className="relative mb-2">
          <input
            type="text"
            placeholder="Spieler suchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-xs font-black outline-none"
            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
          />
          {search && (
            <button onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm"
              style={{ color: "var(--color-muted)" }}>✕</button>
          )}
        </div>

        {/* Position + Sort filters */}
        <div className="flex gap-1.5 mb-1.5">
          {(["ALL", "GK", "DF", "MF", "FW"] as const).map(pos => (
            <button key={pos} onClick={() => setPosFilter(pos)}
              className="flex-1 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all"
              style={{
                background: posFilter === pos ? "var(--color-primary)" : "var(--bg-card)",
                color: posFilter === pos ? "var(--bg-page)" : "var(--color-muted)",
                border: `1px solid ${posFilter === pos ? "var(--color-primary)" : "var(--color-border)"}`,
              }}>
              {pos === "ALL" ? "Alle" : pos === "GK" ? "TW" : pos === "DF" ? "ABW" : pos}
            </button>
          ))}
        </div>

        {/* Sort row */}
        <div className="flex gap-1.5 mb-3">
          {([
            ["fpts",    "FPTS"],
            ["goals",   "Tore"],
            ["assists", "Assists"],
            ["name",    "Name"],
          ] as const).map(([key, label]) => (
            <button key={key} onClick={() => setSortBy(key)}
              className="flex-1 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all"
              style={{
                background: sortBy === key ? "var(--bg-elevated)" : "transparent",
                color: sortBy === key ? "var(--color-primary)" : "var(--color-border-subtle)",
                border: `1px solid ${sortBy === key ? "var(--color-primary)40" : "transparent"}`,
              }}>
              {sortBy === key ? "▾ " : ""}{label}
            </button>
          ))}
        </div>

        {/* Empty state — only for "all" with no filter */}
        {viewMode === "all" && search.length < 2 && posFilter === "ALL" ? (
          <div className="text-center py-12" style={{ color: "var(--color-border)" }}>
            <p className="text-3xl mb-3">🔍</p>
            <p className="text-[9px] font-black uppercase tracking-widest">
              Name eingeben oder Position wählen
            </p>
          </div>
        ) : searching ? (
          <div className="text-center py-8 text-[9px] font-black uppercase tracking-widest animate-pulse"
            style={{ color: "var(--color-border)" }}>Suche...</div>
        ) : players.length === 0 ? (
          <div className="text-center py-12" style={{ color: "var(--color-border)" }}>
            <p className="text-[9px] font-black uppercase tracking-widest">Keine Spieler gefunden</p>
          </div>
        ) : (
          <>
            {/* Column header */}
            <div className="flex items-center gap-3 px-3 mb-1">
              <div className="w-10 flex-shrink-0" />
              <div className="flex-1" />
              <div className="flex gap-3 flex-shrink-0 text-right">
                <span className="text-[7px] font-black uppercase w-7"
                  style={{ color: sortBy === "goals" ? "var(--color-primary)" : "var(--color-border)" }}>Tore</span>
                <span className="text-[7px] font-black uppercase w-7"
                  style={{ color: sortBy === "assists" ? "var(--color-primary)" : "var(--color-border)" }}>Ass</span>
                <span className="text-[7px] font-black uppercase w-10"
                  style={{ color: sortBy === "fpts" ? "var(--color-primary)" : "var(--color-border)" }}>FPTS</span>
              </div>
              <div className="w-5 flex-shrink-0" />
            </div>

            <div className="space-y-1.5">
              {players.map(p => {
                const isMine = mySquadIds.has(p.id);
                const isTaken = !!p.ownerTeamId && !isMine;
                return (
                  <button key={p.id}
                    onClick={() => {
                      setActionPlayer(p);
                      setActionMode(isMine ? "drop" : isTaken ? null : "add");
                      setPlayerOut(null);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left"
                    style={{
                      background: isMine ? "color-mix(in srgb, var(--color-success) 8%, var(--bg-page))" : isTaken ? "var(--bg-elevated)" : "var(--bg-card)",
                      border: `1px solid ${isMine ? "var(--color-success)40" : "var(--color-border)"}`,
                      opacity: isTaken ? 0.55 : 1,
                    }}>

                    {/* Photo */}
                    <div className="relative flex-shrink-0">
                      <img src={p.photo_url || "/player-placeholder.png"} alt={p.name}
                        className="w-10 h-10 rounded-full object-cover"
                        style={{ border: `2px solid ${POS_COLOR[p.position] || "var(--color-border)"}` }} />
                      {p.api_team_id && (
                        <img
                          src={`https://media.api-sports.io/football/teams/${p.api_team_id}.png`}
                          alt=""
                          className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full object-contain"
                          style={{ background: "var(--bg-page)", padding: 1 }}
                        />
                      )}
                    </div>

                    {/* Name + club */}
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-xs truncate"
                        style={{ color: isMine ? "var(--color-success)" : isTaken ? "var(--color-muted)" : "var(--color-text)" }}>
                        {p.name}
                      </p>
                      <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                        <span style={{ color: POS_COLOR[p.position] }}>{POS_LABEL[p.position] || p.position}</span>
                        {" · "}{p.team_name}
                      </p>
                      {isTaken && p.ownerTeamName && (
                        <p className="text-[7px] font-black uppercase tracking-widest mt-0.5" style={{ color: "var(--color-border-subtle)" }}>
                          @ {p.ownerTeamName}
                        </p>
                      )}
                    </div>

                    {/* Stats */}
                    <div className="flex gap-3 flex-shrink-0 text-right">
                      <div className="w-7">
                        <p className="font-black text-xs"
                          style={{ color: (p.goals ?? 0) > 0 ? "var(--color-text)" : "var(--color-border)" }}>
                          {p.goals ?? 0}
                        </p>
                      </div>
                      <div className="w-7">
                        <p className="font-black text-xs"
                          style={{ color: (p.assists ?? 0) > 0 ? "var(--color-text)" : "var(--color-border)" }}>
                          {p.assists ?? 0}
                        </p>
                      </div>
                      <div className="w-10">
                        <p className="font-black text-xs"
                          style={{ color: "var(--color-text)" }}>
                          {p.fpts?.toFixed(1)}
                        </p>
                      </div>
                    </div>

                    {/* Status badge */}
                    <div className="flex-shrink-0">
                      {isMine ? (
                        <span className="text-[7px] font-black px-1.5 py-0.5 rounded"
                          style={{ background: "var(--color-success)20", color: "var(--color-success)" }}>✓</span>
                      ) : isTaken ? (
                        <span className="text-[7px] font-black px-1.5 py-0.5 rounded"
                          style={{ background: "var(--color-border)", color: "var(--color-border-subtle)" }}>•</span>
                      ) : (
                        <span className="text-[7px] font-black px-1.5 py-0.5 rounded"
                          style={{ background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))", color: "var(--color-success)" }}>+</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Full Player Card Overlay */}
      {actionPlayer && (() => {
        const posColor = POS_COLOR[actionPlayer.position] || "var(--color-text)";
        const club = clubAsset(actionPlayer.team_name);
        const c1 = club?.colour1 || null;
        const heroBg = c1
          ? `linear-gradient(160deg, ${c1}22 0%, ${posColor}12 50%, transparent 80%)`
          : `linear-gradient(160deg, ${posColor}18 0%, transparent 60%)`;
        const photoSrc = tsdbPlayer?.cutout || tsdbPlayer?.render || actionPlayer.photo_url || "/player-placeholder.png";
        const isCutout = !!(tsdbPlayer?.cutout || tsdbPlayer?.render);
        const seasonPts = playerGameLog.reduce((s, g) => s + (g.points || 0), 0);
        const avgPts = playerGameLog.length > 0 ? seasonPts / playerGameLog.length : 0;
        const maxSquad = ligaSettings?.squad_size || 15;
        const squadFull = mySquad.length >= maxSquad;
        const formatD = (d: string) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
        return (
          <div className="fixed inset-0 flex items-end justify-center"
            style={{ zIndex: 60, background: "rgba(0,0,0,0.7)" }}
            onClick={e => { if (e.target === e.currentTarget) { setActionPlayer(null); setPlayerOut(null); setActionMode(null); } }}>
            <div className="w-full max-w-md rounded-t-3xl flex flex-col"
              style={{ background: "var(--bg-page)", maxHeight: "90vh" }}>

              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-0 flex-shrink-0">
                <div className="w-10 h-1 rounded-full" style={{ background: "var(--color-border)" }} />
              </div>

              {/* Hero */}
              <div className="relative flex gap-4 px-5 pt-2 pb-3 flex-shrink-0" style={{ background: heroBg }}>
                {club?.fanart1 && (
                  <div className="absolute inset-0 overflow-hidden opacity-5 pointer-events-none">
                    <img src={club.fanart1} alt="" className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="relative flex-shrink-0" style={{ width: 88, height: 88 }}>
                  <img
                    src={photoSrc}
                    alt={actionPlayer.name}
                    className={`w-full h-full object-contain ${isCutout ? "" : "rounded-2xl"}`}
                    style={isCutout ? { filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.6))" } : { border: `2px solid ${posColor}60` }}
                  />
                </div>
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {club?.badge && (
                      <img src={club.badge} alt={actionPlayer.team_name} className="w-4 h-4 object-contain flex-shrink-0" />
                    )}
                    <p className="text-[8px] font-black uppercase tracking-widest truncate" style={{ color: c1 || "var(--color-muted)" }}>
                      {actionPlayer.team_name}
                    </p>
                  </div>
                  <p className="text-xl font-black leading-tight" style={{ color: "var(--color-text)" }}>
                    {actionPlayer.name}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[8px] font-black px-2 py-0.5 rounded"
                      style={{ background: posColor, color: "var(--bg-page)" }}>
                      {actionPlayer.position}
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
                <button onClick={() => { setActionPlayer(null); setPlayerOut(null); setActionMode(null); }}
                  className="absolute top-3 right-4 w-7 h-7 flex items-center justify-center rounded-full z-10"
                  style={{ background: "var(--bg-elevated)", color: "var(--color-muted)" }}>✕</button>
              </div>

              {/* Action band */}
              <div className="mx-5 mb-3 px-3 py-2.5 rounded-xl flex-shrink-0"
                style={{ background: "var(--bg-card)", border: `1px solid ${actionPlayer.isMine ? "var(--color-primary)40" : actionPlayer.ownerTeamId ? "var(--color-border)" : "var(--color-success)30"}` }}>
                {/* Taken by another team */}
                {actionPlayer.ownerTeamId && !actionPlayer.isMine && (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>Vergeben an</p>
                      <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>{actionPlayer.ownerTeamName}</p>
                    </div>
                    {myTeam && (
                      <a href={`/leagues/${leagueId}/trades?target=${actionPlayer.ownerTeamId}&player=${actionPlayer.id}`}
                        className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase"
                        style={{ background: "color-mix(in srgb, var(--color-primary) 15%, var(--bg-page))", color: "var(--color-primary)", border: "1px solid var(--color-primary)30" }}>
                        Trade anfragen
                      </a>
                    )}
                  </div>
                )}

                {/* My player → drop */}
                {actionPlayer.isMine && (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>Status</p>
                      <p className="text-xs font-black" style={{ color: "var(--color-primary)" }}>Mein Spieler</p>
                    </div>
                    <button onClick={() => dropPlayerDirect(actionPlayer.id)} disabled={saving}
                      className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all disabled:opacity-50"
                      style={{ background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))", color: "var(--color-error)", border: "1px solid var(--color-error)40" }}>
                      {saving ? "..." : "✕ Entfernen"}
                    </button>
                  </div>
                )}

                {/* Free agent → add or swap */}
                {!actionPlayer.ownerTeamId && myTeam && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>Status</p>
                        <p className="text-xs font-black" style={{ color: "var(--color-success)" }}>Freier Spieler</p>
                      </div>
                      <div className="flex gap-2">
                        {!squadFull && (
                          <button onClick={() => addPlayer(actionPlayer)} disabled={saving}
                            className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all disabled:opacity-50"
                            style={{ background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))", color: "var(--color-success)", border: "1px solid var(--color-success)40" }}>
                            {saving ? "..." : "▲ Hinzufügen"}
                          </button>
                        )}
                        {mySquad.length > 0 && (
                          <button onClick={() => setShowSwap(v => !v)} disabled={saving}
                            className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all disabled:opacity-50"
                            style={{
                              background: showSwap ? "color-mix(in srgb, var(--color-primary) 15%, var(--bg-page))" : "var(--bg-elevated)",
                              color: showSwap ? "var(--color-primary)" : "var(--color-text)",
                              border: `1px solid ${showSwap ? "var(--color-primary)40" : "var(--color-border)"}`,
                            }}>
                            ⇄ Austauschen
                          </button>
                        )}
                      </div>
                    </div>
                    {showSwap && mySquad.length > 0 && (
                      <div className="space-y-1 max-h-40 overflow-y-auto pt-1"
                        style={{ borderTop: "1px solid var(--color-border)" }}>
                        <p className="text-[7px] font-black uppercase tracking-widest pt-1 pb-0.5" style={{ color: "var(--color-border)" }}>
                          Wen möchtest du rausnehmen?
                        </p>
                        {mySquad.map(sq => (
                          <button key={sq.id}
                            onClick={() => { setPlayerOut(sq); addPlayer(actionPlayer, sq.id); }}
                            disabled={saving}
                            className="w-full flex items-center gap-3 p-2 rounded-xl text-left transition-all"
                            style={{
                              background: playerOut?.id === sq.id ? "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))" : "var(--bg-elevated)",
                              border: `1px solid ${playerOut?.id === sq.id ? "var(--color-error)" : "var(--color-border)"}`,
                            }}>
                            <img src={sq.photo_url || "/player-placeholder.png"} alt={sq.name}
                              className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                              style={{ border: `1px solid ${POS_COLOR[sq.position]}` }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-black truncate" style={{ color: "var(--color-text)" }}>{sq.name}</p>
                              <p className="text-[7px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                                {POS_LABEL[sq.position] || sq.position} · {sq.fpts?.toFixed(1)} pts
                              </p>
                            </div>
                            <span className="text-[8px] font-black flex-shrink-0" style={{ color: "var(--color-error)" }}>▼ Raus</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* No team (spectator) */}
                {!myTeam && !actionPlayer.ownerTeamId && (
                  <p className="text-xs font-black" style={{ color: "var(--color-success)" }}>Freier Spieler</p>
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
                  <div className="flex items-center justify-center py-12 text-[9px] font-black uppercase tracking-widest animate-pulse"
                    style={{ color: "var(--color-border)" }}>Lade...</div>
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
                              ...(actionPlayer.position === "GK" ? [["Paraden", playerGameLog.reduce((s,g)=>s+(g.saves||0),0)]] : []),
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
                          <p className="text-center py-10 text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>
                            Noch keine Spieltag-Daten
                          </p>
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
                          <p className="text-center py-10 text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>
                            Keine Historie vorhanden
                          </p>
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
                          <p className="text-center py-10 text-[9px] font-black uppercase tracking-widest animate-pulse" style={{ color: "var(--color-border)" }}>Lade News...</p>
                        ) : playerNews.length === 0 ? (
                          <p className="text-center py-10 text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>Keine News gefunden</p>
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
