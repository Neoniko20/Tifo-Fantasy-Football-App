"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/app/components/ui/Spinner";
import { BottomNav } from "@/app/components/BottomNav";
import { LiveStatusBanner } from "@/app/components/wm/LiveStatusBanner";
import { LiveTickerStrip } from "@/app/components/wm/LiveTickerStrip";
import { MyGWCard } from "@/app/components/wm/MyGWCard";
import { LiveLeaderboard, type LiveTeamRow } from "@/app/components/wm/LiveLeaderboard";
import { FixtureStrip } from "@/app/components/wm/FixtureStrip";
import { PlayerStatusGrid, type PlayerLiveRow, type PlayerLiveStatus } from "@/app/components/wm/PlayerStatusGrid";
import { LiveEventFeed } from "@/app/components/wm/LiveEventFeed";
import type { WMFixture, WMGameweek, WMNation } from "@/lib/wm-types";
import type { LeagueMessage } from "@/lib/chat";

export default function LiveCenterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [loading, setLoading]               = useState(true);
  const [user, setUser]                     = useState<any>(null);
  const [myTeamId, setMyTeamId]             = useState<string | null>(null);
  const [activeGW, setActiveGW]             = useState<WMGameweek | null>(null);
  const [fixtures, setFixtures]             = useState<WMFixture[]>([]);
  const [leaderboard, setLeaderboard]       = useState<LiveTeamRow[]>([]);
  const [myPlayers, setMyPlayers]           = useState<PlayerLiveRow[]>([]);
  const [messages, setMessages]             = useState<LeagueMessage[]>([]);
  const [nations, setNations]               = useState<WMNation[]>([]);
  const [realtimeStatus, setRealtimeStatus] = useState<"connected" | "disconnected">("connected");
  const [tournamentId, setTournamentId]     = useState<string | null>(null);

  // ── Ticker events (derived from last 3 messages) ───────────────────────────
  const tickerEvents = messages.slice(0, 3).map(m => ({
    id: m.id,
    text: (m.metadata as any)?.ticker_text ?? m.content,
    priority: ((m.metadata as any)?.priority ?? "low") as "high" | "medium" | "low",
  }));

  // ── Initial load ───────────────────────────────────────────────────────────
  const loadAll = useCallback(async (userId: string) => {
    const { data: settings } = await supabase
      .from("wm_league_settings").select("tournament_id").eq("league_id", leagueId).maybeSingle();
    if (!settings?.tournament_id) { setLoading(false); return; }
    const tid = settings.tournament_id;
    setTournamentId(tid);

    const { data: myTeam } = await supabase
      .from("teams").select("id").eq("league_id", leagueId).eq("user_id", userId).maybeSingle();
    setMyTeamId(myTeam?.id ?? null);

    const [gwRes, fixtureRes, teamsRes, nationsRes, messagesRes] = await Promise.all([
      supabase.from("wm_gameweeks").select("*").eq("tournament_id", tid)
        .in("status", ["active", "upcoming"]).order("gameweek").limit(1),
      supabase.from("wm_fixtures").select("*, home_nation:home_nation_id(*), away_nation:away_nation_id(*)")
        .eq("tournament_id", tid).in("status", ["live", "finished"]).order("kickoff"),
      supabase.from("teams").select("id, name").eq("league_id", leagueId),
      supabase.from("wm_nations").select("*").eq("tournament_id", tid),
      supabase.from("league_messages").select("*").eq("league_id", leagueId)
        .order("created_at", { ascending: false }).limit(50),
    ]);

    const gw = gwRes.data?.[0] ?? null;
    setActiveGW(gw);
    setFixtures((fixtureRes.data ?? []) as WMFixture[]);
    setNations((nationsRes.data ?? []) as WMNation[]);
    setMessages((messagesRes.data ?? []) as LeagueMessage[]);

    if (gw && teamsRes.data) {
      await loadLeaderboard(gw.gameweek, leagueId, teamsRes.data, myTeam?.id ?? null);
      if (myTeam?.id) {
        await loadMyPlayers(myTeam.id, gw.gameweek, tid, (fixtureRes.data ?? []) as WMFixture[], (nationsRes.data ?? []) as WMNation[]);
      }
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  async function loadLeaderboard(
    gw: number, lid: string, teams: any[], myTId: string | null
  ) {
    const teamIds = teams.map((t: any) => t.id);
    if (!teamIds.length) return;
    const { data: pts } = await supabase
      .from("wm_gameweek_points").select("team_id, points").in("team_id", teamIds).eq("gameweek", gw);

    const totals: Record<string, number> = {};
    for (const row of (pts ?? [])) {
      totals[row.team_id] = (totals[row.team_id] ?? 0) + (row.points ?? 0);
    }
    const { data: teamsWithTotal } = await supabase
      .from("teams").select("id, name, total_points").in("id", teamIds);

    const rows: LiveTeamRow[] = (teamsWithTotal ?? []).map((t: any) => ({
      team_id:               t.id,
      team_name:             t.name,
      gw_points:             Math.round((totals[t.id] ?? 0) * 10) / 10,
      total_points:          t.total_points ?? 0,
      rank_delta:            0,
      players_playing:       0,
      players_total:         11,
      is_my_team:            t.id === myTId,
      has_nation_eliminated: false,
    }));
    setLeaderboard(rows);
  }

  async function loadMyPlayers(
    teamId: string, gw: number, tid: string,
    fixturesData: WMFixture[], nationsData: WMNation[]
  ) {
    const { data: lineup } = await supabase
      .from("team_lineups").select("starting_xi, captain_id, vice_captain_id")
      .eq("team_id", teamId).eq("gameweek", gw).maybeSingle();
    if (!lineup?.starting_xi?.length) return;

    const playerIds = lineup.starting_xi as number[];
    const [playersRes, ptsRes, nationMappingsRes] = await Promise.all([
      supabase.from("players").select("id, name, position").in("id", playerIds),
      supabase.from("wm_gameweek_points").select("player_id, points").eq("team_id", teamId).eq("gameweek", gw),
      supabase.from("wm_player_nations").select("player_id, nation_id").eq("tournament_id", tid).in("player_id", playerIds),
    ]);

    const ptsMap: Record<number, number> = {};
    for (const p of (ptsRes.data ?? [])) ptsMap[p.player_id] = p.points;
    const nationMap: Record<number, string> = {};
    for (const n of (nationMappingsRes.data ?? [])) nationMap[n.player_id] = n.nation_id;

    const liveNations = new Set(
      fixturesData.filter(f => f.status === "live").flatMap(f => [f.home_nation_id, f.away_nation_id])
    );
    const finishedNations = new Set(
      fixturesData.filter(f => f.status === "finished").flatMap(f => [f.home_nation_id, f.away_nation_id])
    );

    const rows: PlayerLiveRow[] = (playersRes.data ?? []).map((p: any) => {
      const nationId = nationMap[p.id];
      const nation = nationsData.find(n => n.id === nationId);
      const isElim = nation?.eliminated_after_gameweek != null && gw > (nation.eliminated_after_gameweek ?? 999);
      let status: PlayerLiveStatus = "upcoming";
      if (isElim) status = "eliminated";
      else if (nationId && liveNations.has(nationId)) status = "playing";
      else if (nationId && finishedNations.has(nationId)) status = "finished";

      return {
        player_id:      p.id,
        player_name:    p.name,
        position:       p.position ?? "MF",
        gw_points:      ptsMap[p.id] ?? 0,
        status,
        is_captain:     lineup.captain_id === p.id,
        is_vc:          lineup.vice_captain_id === p.id,
        is_auto_subbed: false,
        nation_flag:    nation?.flag_url ?? undefined,
      };
    });
    setMyPlayers(rows);
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
    });
  }, [loadAll]);

  // ── Realtime subscriptions ─────────────────────────────────────────────────
  useEffect(() => {
    if (!tournamentId || !activeGW) return;

    const channel = supabase.channel("wm-live-center")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "wm_gameweek_points", filter: `league_id=eq.${leagueId}` },
        () => { if (user) loadAll(user.id); }
      )
      .on("postgres_changes",
        { event: "*", schema: "public", table: "wm_fixtures", filter: `tournament_id=eq.${tournamentId}` },
        (payload) => {
          setFixtures(prev =>
            prev.map(f => f.id === (payload.new as any).id ? { ...f, ...(payload.new as any) } : f)
          );
        }
      )
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "league_messages", filter: `league_id=eq.${leagueId}` },
        (payload) => {
          setMessages(prev => [payload.new as LeagueMessage, ...prev].slice(0, 50));
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeStatus("connected");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setRealtimeStatus("disconnected");
      });

    return () => { supabase.removeChannel(channel); };
  }, [tournamentId, activeGW?.gameweek, leagueId, user]);

  // ── Soft-polling fallback (10s when disconnected) ─────────────────────────
  useEffect(() => {
    if (realtimeStatus !== "disconnected" || !user) return;
    const interval = setInterval(() => loadAll(user.id), 10_000);
    return () => clearInterval(interval);
  }, [realtimeStatus, user, loadAll]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <Spinner />
    </div>
  );

  if (!activeGW) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4"
      style={{ background: "var(--bg-page)" }}>
      <p className="text-sm font-black" style={{ color: "var(--color-text)" }}>Kein Spieltag aktiv</p>
      <p className="text-[9px]" style={{ color: "var(--color-muted)" }}>
        Das Live Center öffnet wenn ein Gameweek startet.
      </p>
      <Link href={`/wm/${leagueId}/matchday`}
        className="text-[9px] font-black uppercase tracking-widest px-4 py-2 rounded-xl"
        style={{ background: "var(--bg-card)", color: "var(--color-primary)", border: "1px solid var(--color-border)" }}>
        Spielplan ansehen →
      </Link>
      <BottomNav />
    </div>
  );

  const nationNames: Record<string, string> = {};
  const nationFlags: Record<string, string | undefined> = {};
  for (const n of nations) { nationNames[n.id] = n.name; nationFlags[n.id] = n.flag_url ?? undefined; }

  const fixturesFinished = fixtures.filter(f => f.status === "finished").length;
  const myTeamRow = leaderboard.find(r => r.is_my_team);
  const myCapPlayer = myPlayers.find(p => p.is_captain);
  const myVcPlayer = myPlayers.find(p => p.is_vc);

  return (
    <div className="min-h-screen pb-24" style={{ background: "var(--bg-page)" }}>
      <div className="max-w-xl mx-auto px-4 pt-4 space-y-3">

        <LiveTickerStrip events={tickerEvents} />

        <LiveStatusBanner
          gwNumber={activeGW.gameweek}
          fixturesTotal={fixtures.length}
          fixturesFinished={fixturesFinished}
          realtimeStatus={realtimeStatus}
          onRefresh={() => user && loadAll(user.id)}
        />

        {myTeamRow && (
          <MyGWCard
            teamName={myTeamRow.team_name}
            gwPoints={myTeamRow.gw_points}
            totalPoints={myTeamRow.total_points}
            captainName={myCapPlayer?.player_name}
            captainPoints={myCapPlayer ? myCapPlayer.gw_points * 2 : undefined}
            vcName={myVcPlayer?.player_name}
            hasEliminatedPlayer={myPlayers.some(p => p.status === "eliminated")}
          />
        )}

        <LiveLeaderboard rows={leaderboard} />

        <FixtureStrip fixtures={fixtures} nationNames={nationNames} nationFlags={nationFlags} />

        {myPlayers.length > 0 && <PlayerStatusGrid players={myPlayers} />}

        <LiveEventFeed messages={messages} />

      </div>
      <BottomNav />
    </div>
  );
}
