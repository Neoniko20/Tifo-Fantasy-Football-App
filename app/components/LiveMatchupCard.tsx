"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { LivePlayerRow } from "./LivePlayerRow";
import { liveStateOf, allFixturesFinished } from "@/lib/fixture-status";

type Matchup = {
  id: string;
  league_id: string;
  gameweek: number;
  home_team_id: string;
  away_team_id: string;
  home_points: number;
  away_points: number;
  home?: { name: string; user_id: string };
  away?: { name: string; user_id: string };
};

type PlayerWithPoints = {
  id: number;
  name: string;
  position: string;
  photo_url: string | null;
  api_team_id: number | null;
  points: number;
  minutes: number;
  is_captain: boolean;
  fixtureShort?: string | null;
};

interface Props {
  matchup: Matchup;
  currentUserId?: string | null;
  gwIsActive: boolean;
  onPointsChange?: (homePts: number, awayPts: number) => void;
}

export function LiveMatchupCard({ matchup, currentUserId, gwIsActive, onPointsChange }: Props) {
  const [homePlayers, setHomePlayers] = useState<PlayerWithPoints[]>([]);
  const [awayPlayers, setAwayPlayers] = useState<PlayerWithPoints[]>([]);
  const [fixtureMap, setFixtureMap] = useState<Record<number, string>>({}); // api_team_id → fixture.status.short
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const isHomeMe = matchup.home?.user_id === currentUserId;
  const isAwayMe = matchup.away?.user_id === currentUserId;
  const highlightBorder = (isHomeMe || isAwayMe) ? "#3a2a10" : "#2a2010";

  async function loadTeamRoster(teamId: string): Promise<PlayerWithPoints[]> {
    // 1. Get this team's starting XI for this GW from liga_lineups
    const { data: lineup } = await supabase
      .from("liga_lineups")
      .select("starting_xi, captain_id")
      .eq("team_id", teamId)
      .eq("gameweek", matchup.gameweek)
      .maybeSingle();

    const playerIds: number[] = lineup?.starting_xi || [];
    const captainId: number | null = lineup?.captain_id || null;
    if (playerIds.length === 0) return [];

    // 2. Fetch player master data
    const { data: players } = await supabase
      .from("players")
      .select("id, name, position, photo_url, api_team_id")
      .in("id", playerIds);

    // 3. Fetch this GW's points per player
    const { data: pts } = await supabase
      .from("liga_gameweek_points")
      .select("player_id, points, minutes")
      .eq("league_id", matchup.league_id)
      .eq("gameweek", matchup.gameweek)
      .in("player_id", playerIds);

    const ptsMap = new Map((pts || []).map((p: any) => [p.player_id, p]));

    return (players || []).map((p: any) => {
      const pt = ptsMap.get(p.id);
      return {
        id: p.id,
        name: p.name,
        position: p.position,
        photo_url: p.photo_url,
        api_team_id: p.api_team_id,
        points: Number(pt?.points || 0),
        minutes: Number(pt?.minutes || 0),
        is_captain: p.id === captainId,
        fixtureShort: p.api_team_id ? fixtureMap[p.api_team_id] : null,
      };
    });
  }

  async function loadFixtures() {
    const res  = await fetch(`/api/fixtures?leagueId=${matchup.league_id}&gameweek=${matchup.gameweek}`, { cache: "no-store" });
    const json = await res.json();
    const m: Record<number, string> = {};
    for (const f of (json?.fixtures || [])) {
      const short  = f?.fixture?.status?.short;
      const homeId = f?.teams?.home?.id;
      const awayId = f?.teams?.away?.id;
      if (homeId) m[homeId] = short;
      if (awayId) m[awayId] = short;
    }
    setFixtureMap(m);
  }

  async function pollLivePoints() {
    try {
      await fetch(`/api/live-gw-points?leagueId=${matchup.league_id}&gameweek=${matchup.gameweek}`, { cache: "no-store" });
    } catch { /* ignore, next tick will retry */ }
  }

  async function reload() {
    const [h, a] = await Promise.all([
      loadTeamRoster(matchup.home_team_id),
      loadTeamRoster(matchup.away_team_id),
    ]);
    setHomePlayers(h);
    setAwayPlayers(a);
    setLastSync(new Date());

    const homeSum = h.reduce((s, p) => s + (p.is_captain ? p.points * 2 : p.points), 0);
    const awaySum = a.reduce((s, p) => s + (p.is_captain ? p.points * 2 : p.points), 0);
    onPointsChange?.(homeSum, awaySum);
  }

  // Initial load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadFixtures(); }, [matchup.id]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [fixtureMap, matchup.id]);

  // Polling — only while GW is active and not all fixtures are FT
  useEffect(() => {
    if (!gwIsActive) return;
    const allShorts = [...homePlayers, ...awayPlayers].map(p => p.fixtureShort);
    if (allShorts.length > 0 && allFixturesFinished(allShorts)) return;

    const tick = async () => {
      await pollLivePoints();
      await loadFixtures();
      await reload();
    };
    const intervalId = setInterval(tick, 60_000);
    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gwIsActive, matchup.id, homePlayers.length, awayPlayers.length]);

  const counts = useMemo(() => {
    const all = [...homePlayers, ...awayPlayers];
    let upcoming = 0, live = 0, finished = 0;
    for (const p of all) {
      const st = liveStateOf(p.fixtureShort);
      if (st === "upcoming") upcoming++;
      else if (st === "live") live++;
      else if (st === "finished") finished++;
    }
    return { upcoming, live, finished };
  }, [homePlayers, awayPlayers]);

  const homeSum = homePlayers.reduce((s, p) => s + (p.is_captain ? p.points * 2 : p.points), 0);
  const awaySum = awayPlayers.reduce((s, p) => s + (p.is_captain ? p.points * 2 : p.points), 0);

  return (
    <div className="rounded-2xl p-4"
      style={{ background: "#141008", border: `1px solid ${highlightBorder}` }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex-1 text-right">
          <p className="font-black text-sm truncate" style={{ color: isHomeMe ? "#f5a623" : "#c8b080" }}>
            {matchup.home?.name}
          </p>
          <p className="text-2xl font-black" style={{ color: homeSum > awaySum ? "#f5a623" : "#c8b080" }}>
            {homeSum.toFixed(1)}
          </p>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
            style={{ background: "#141008", color: "#2a2010", border: "1px solid #2a2010" }}>
            VS
          </span>
        </div>
        <div className="flex-1 text-left">
          <p className="font-black text-sm truncate" style={{ color: isAwayMe ? "#f5a623" : "#c8b080" }}>
            {matchup.away?.name}
          </p>
          <p className="text-2xl font-black" style={{ color: awaySum > homeSum ? "#f5a623" : "#c8b080" }}>
            {awaySum.toFixed(1)}
          </p>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between text-[8px] font-black uppercase tracking-widest mb-3 px-2 py-1.5 rounded-lg"
        style={{ background: "#0c0900", border: "1px solid #2a2010" }}>
        <span style={{ color: "#5a4020" }}>● {counts.finished} FT</span>
        <span style={{ color: "#ff6b00" }}>● {counts.live} LIVE</span>
        <span style={{ color: "#5a4020" }}>○ {counts.upcoming} –</span>
        {lastSync && (
          <span style={{ color: "#2a2010" }}>
            {lastSync.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      {/* Player breakdown — 2 columns on wider screens, 1 column on mobile */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
        <div>
          <p className="text-[7px] font-black uppercase tracking-widest mb-1 text-right sm:text-left" style={{ color: "#2a2010" }}>
            {matchup.home?.name}
          </p>
          {homePlayers.map(p => (
            <LivePlayerRow key={p.id}
              name={p.name} position={p.position}
              photoUrl={p.photo_url} points={p.points} minutes={p.minutes}
              fixtureShort={p.fixtureShort} isCaptain={p.is_captain}
              dim={liveStateOf(p.fixtureShort) === "upcoming"} />
          ))}
        </div>
        <div>
          <p className="text-[7px] font-black uppercase tracking-widest mb-1" style={{ color: "#2a2010" }}>
            {matchup.away?.name}
          </p>
          {awayPlayers.map(p => (
            <LivePlayerRow key={p.id}
              name={p.name} position={p.position}
              photoUrl={p.photo_url} points={p.points} minutes={p.minutes}
              fixtureShort={p.fixtureShort} isCaptain={p.is_captain}
              dim={liveStateOf(p.fixtureShort) === "upcoming"} />
          ))}
        </div>
      </div>
    </div>
  );
}
