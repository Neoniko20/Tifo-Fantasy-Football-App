"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { UserBadge } from "@/app/components/UserBadge";

const TIMER_OPTIONS = [
  { label: "60 Sek", value: 60 },
  { label: "2 Min", value: 120 },
  { label: "3 Min", value: 180 },
  { label: "5 Min", value: 300 },
  { label: "10 Min", value: 600 },
  { label: "1 Std", value: 3600 },
  { label: "4 Std", value: 14400 },
  { label: "8 Std", value: 28800 },
  { label: "∞ Kein Limit", value: 0 },
];

const POS_COLOR: Record<string, string> = {
  GK: "#f5a623",
  DF: "#4a9eff",
  MF: "#00ce7d",
  FW: "#ff4d6d",
};

type Player = {
  id: number;
  name: string;
  photo_url: string;
  position: string;
  team_name: string;
  goals: number;
  assists: number;
  fpts: number;
};

export default function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [user, setUser] = useState<any>(null);
  const [league, setLeague] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [myTeam, setMyTeam] = useState<any>(null);
  const [draftSession, setDraftSession] = useState<any>(null);
  const [draftPicks, setDraftPicks] = useState<any[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [timeLeft, setTimeLeft] = useState(60);
  const [isOwner, setIsOwner] = useState(false);
  const [view, setView] = useState<"board" | "list">("board");
  const [draftType, setDraftType] = useState<"snake" | "linear">("snake");
  const [timerSeconds, setTimerSeconds] = useState(60);

  const channelRef = useRef<any>(null);
  const botTimerRef = useRef<any>(null);
  const pollRef = useRef<any>(null);
  const isOwnerRef = useRef(false);
  const playersRef = useRef<Player[]>([]);
  const draftPicksRef = useRef<any[]>([]);
  const teamsRef = useRef<any[]>([]);
  const draftSessionRef = useRef<any>(null);
  const userIdRef = useRef<string>("");
  const botRunningRef = useRef(false);

  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { draftPicksRef.current = draftPicks; }, [draftPicks]);
  useEffect(() => { teamsRef.current = teams; }, [teams]);
  useEffect(() => { draftSessionRef.current = draftSession; }, [draftSession]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      userIdRef.current = data.user.id;
      loadAll(data.user.id);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (botTimerRef.current) clearTimeout(botTimerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function loadAll(userId: string) {
    const { data: leagueData } = await supabase
      .from("leagues").select("*").eq("id", leagueId).single();
    setLeague(leagueData);
    const ownerCheck = leagueData?.owner_id === userId;
    setIsOwner(ownerCheck);
    isOwnerRef.current = ownerCheck;

    const { data: teamsData } = await supabase
      .from("teams")
      .select("id, name, user_id, profiles(username)")
      .eq("league_id", leagueId);
    setTeams(teamsData || []);
    teamsRef.current = teamsData || [];

    const myT = (teamsData || []).find((t: any) => t.user_id === userId);
    setMyTeam(myT);

    const { data: session } = await supabase
      .from("draft_sessions").select("*").eq("league_id", leagueId).maybeSingle();

    if (session) {
      setDraftSession(session);
      draftSessionRef.current = session;
      const picks = await loadPicks(session.id);
      subscribeToRealtime(session.id);
      startPolling(session.id);
      if (ownerCheck && session.status === "active") {
        triggerBot(session, picks, teamsData || [], userId);
      }
    }

    loadPlayers();
  }

  async function loadPicks(sessionId: string) {
    const { data: picks } = await supabase
      .from("draft_picks")
      .select("*, players(name, photo_url, position, team_name, fpts)")
      .eq("draft_session_id", sessionId)
      .order("pick_number");
    setDraftPicks(picks || []);
    draftPicksRef.current = picks || [];
    return picks || [];
  }

  async function loadPlayers() {
    const { data } = await supabase
      .from("players").select("*").order("fpts", { ascending: false });
    if (data) {
      setPlayers(data);
      playersRef.current = data;
    }
  }

  function startPolling(sessionId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const { data: session } = await supabase
        .from("draft_sessions").select("*").eq("id", sessionId).single();
      if (!session) return;

      const currentPick = draftSessionRef.current?.current_pick;
      const currentStatus = draftSessionRef.current?.status;

      if (session.current_pick !== currentPick || session.status !== currentStatus) {
        setDraftSession(session);
        draftSessionRef.current = session;
        const picks = await loadPicks(sessionId);
        if (isOwnerRef.current && session.status === "active") {
          triggerBot(session, picks, teamsRef.current, userIdRef.current);
        }
      }
    }, 2000);
  }

  function subscribeToRealtime(sessionId: string) {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    const channel = supabase
      .channel("draft-" + leagueId + "-" + Date.now())
      .on("postgres_changes",
        { event: "*", schema: "public", table: "draft_sessions", filter: `id=eq.${sessionId}` },
        async (payload) => {
          const newSession = payload.new as any;
          setDraftSession(newSession);
          draftSessionRef.current = newSession;
          const picks = await loadPicks(sessionId);
          if (isOwnerRef.current && newSession.status === "active") {
            triggerBot(newSession, picks, teamsRef.current, userIdRef.current);
          }
        }
      )
      .subscribe();
    channelRef.current = channel;
  }

  function getTeamForPick(session: any, allTeams: any[]) {
    if (!session) return null;
    const order = session.draft_order || [];
    const n = order.length;
    if (n === 0) return null;
    const pick = session.current_pick;
    const round = Math.floor(pick / n);
    const posInRound = pick % n;
    const isSnake = session.draft_type !== "linear";
    const idx = (isSnake && round % 2 !== 0) ? (n - 1 - posInRound) : posInRound;
    return allTeams.find((t: any) => t.id === order[idx]);
  }

  // Positions-bewusste Bot-Auswahl
  // Ziel: ausgewogener Kader (2 GK, 5 DF, 5 MF, 3 FW bei 15 Spielern)
  function botSelectPlayer(
    available: Player[],
    botPicks: any[],
    totalRounds: number,
  ): Player | null {
    if (available.length === 0) return null;

    // Aktuelle Positionsverteilung des Bot-Teams
    const posCounts: Record<string, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
    for (const p of botPicks) {
      const pos = p.players?.position;
      if (pos) posCounts[pos] = (posCounts[pos] || 0) + 1;
    }

    // Ziel-Verteilung: skaliert auf totalRounds
    const ratio = totalRounds / 15;
    const targets: Record<string, number> = {
      GK: Math.max(1, Math.round(2 * ratio)),
      DF: Math.max(2, Math.round(5 * ratio)),
      MF: Math.max(2, Math.round(5 * ratio)),
      FW: Math.max(1, Math.round(3 * ratio)),
    };

    const picksRemaining = totalRounds - botPicks.length;

    // Noch benötigte Spieler pro Position
    const stillNeeded: Record<string, number> = {};
    let totalNeeded = 0;
    for (const [pos, target] of Object.entries(targets)) {
      const need = Math.max(0, target - (posCounts[pos] || 0));
      stillNeeded[pos] = need;
      totalNeeded += need;
    }

    // Positionen die bereits am Ziel oder drüber sind → ausschließen
    const atMax = Object.entries(targets)
      .filter(([pos, target]) => (posCounts[pos] || 0) >= target)
      .map(([pos]) => pos);

    // Wenn picks_remaining ≤ total_needed: nur noch benötigte Positionen picken
    if (picksRemaining <= totalNeeded) {
      const neededPositions = Object.entries(stillNeeded)
        .filter(([, n]) => n > 0)
        .map(([pos]) => pos);
      const mustPick = available.filter(p => neededPositions.includes(p.position));
      return mustPick[0] || available[0];
    }

    // Normalfall: beste verfügbare Spieler, aber keine überfüllten Positionen
    const filtered = available.filter(p => !atMax.includes(p.position));
    return filtered[0] || available[0];
  }

  function triggerBot(session: any, picks: any[], allTeams: any[], userId: string) {
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
    if (!session || session.status !== "active") return;
    const currentTeam = getTeamForPick(session, allTeams);
    if (!currentTeam) return;

    if (currentTeam.user_id !== null) return;
    if (botRunningRef.current) return;

    console.log(`🤖 Bot pickt für ${currentTeam.name} (Pick ${session.current_pick})`);
    botRunningRef.current = true;

    botTimerRef.current = setTimeout(async () => {
      if (draftSessionRef.current?.status !== "active") { botRunningRef.current = false; return; }

      // Spieler noch nicht geladen → retry in 2s
      if (playersRef.current.length === 0) {
        botRunningRef.current = false;
        setTimeout(() => triggerBot(
          draftSessionRef.current, draftPicksRef.current,
          teamsRef.current, userIdRef.current
        ), 2000);
        return;
      }

      // Doppel-Pick verhindern: wurde dieser Slot bereits gespielt?
      const alreadyPicked = draftPicksRef.current.some(
        (p: any) => p.pick_number === session.current_pick
      );
      if (alreadyPicked) { botRunningRef.current = false; return; }

      const picked = new Set(draftPicksRef.current.map((p: any) => p.player_id));
      const available = playersRef.current.filter(p => !picked.has(p.id));
      if (available.length === 0) { botRunningRef.current = false; return; }

      const botTeamPicks = draftPicksRef.current.filter((p: any) => p.team_id === currentTeam.id);
      const totalRounds = session.total_picks / allTeams.length;
      const best = botSelectPlayer(available, botTeamPicks, totalRounds) || available[0];
      const n = allTeams.length;
      const round = Math.floor(session.current_pick / n);

      const { error } = await supabase.from("draft_picks").insert({
        draft_session_id: session.id,
        team_id: currentTeam.id,
        player_id: best.id,
        pick_number: session.current_pick,
        round,
      });

      if (error) { botRunningRef.current = false; console.error("Bot error:", error.message); return; }

      await supabase.from("squad_players").insert({
        team_id: currentTeam.id,
        player_id: best.id,
        is_captain: false,
        is_on_bench: false,
      });

      const nextPick = session.current_pick + 1;
      const finished = nextPick >= session.total_picks;

      await supabase.from("draft_sessions").update({
        current_pick: nextPick,
        status: finished ? "finished" : "active",
      }).eq("id", session.id);

      // Erst nach Session-Update freigeben (verhindert Race Condition)
      botRunningRef.current = false;

      if (finished) {
        await supabase.from("leagues").update({ status: "active" }).eq("id", leagueId);
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 1500);
  }

  useEffect(() => {
    if (!draftSession || draftSession.status !== "active") return;
    const secs = draftSession.seconds_per_pick || 0;
    if (secs === 0) { setTimeLeft(0); return; }
    setTimeLeft(secs);
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [draftSession?.current_pick, draftSession?.status]);

  useEffect(() => {
    if (timeLeft !== 0 || !draftSession || draftSession.status !== "active") return;
    if (draftSession.seconds_per_pick === 0) return;
    if (!isMyTurn) return;
    const picked = new Set(draftPicks.map((p: any) => p.player_id));
    const best = players.find(p => !picked.has(p.id));
    if (best) pickPlayer(best.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft]);

  async function startDraft() {
    if (teams.length < 1) { alert("Mindestens 1 Team!"); return; }

    let allTeams = [...teams];
    const botCount = (league?.max_teams || 10) - teams.length;
    if (botCount > 0) {
      const botInserts = Array.from({ length: botCount }, (_, i) => ({
        league_id: leagueId,
        user_id: null,
        name: `Bot ${i + 1}`,
      }));
      const { data: newBots } = await supabase
        .from("teams").insert(botInserts).select();
      allTeams = [...allTeams, ...(newBots || [])];
      setTeams(allTeams);
      teamsRef.current = allTeams;
    }

    const ordered = draftType === "linear"
      ? [...allTeams].reverse()
      : [...allTeams].sort(() => Math.random() - 0.5);
    const totalPicks = allTeams.length * 15;
    const { data: session } = await supabase.from("draft_sessions").insert({
      league_id: leagueId, status: "active", current_pick: 0,
      total_picks: totalPicks, seconds_per_pick: timerSeconds,
      draft_order: ordered.map((t: any) => t.id),
      draft_type: draftType,
    }).select().single();
    await supabase.from("leagues").update({ status: "drafting" }).eq("id", leagueId);
    if (session) {
      setDraftSession(session);
      draftSessionRef.current = session;
      subscribeToRealtime(session.id);
      startPolling(session.id);
      triggerBot(session, [], allTeams, userIdRef.current);
    }
  }

  async function pickPlayer(playerId: number) {
    if (!isMyTurn || !draftSession || !myTeam) return;
    const n = teams.length;
    const round = Math.floor(draftSession.current_pick / n);

    const { error } = await supabase.from("draft_picks").insert({
      draft_session_id: draftSession.id,
      team_id: myTeam.id,
      player_id: playerId,
      pick_number: draftSession.current_pick,
      round,
    });

    if (error) { console.error("Pick error:", error.message); return; }

    await supabase.from("squad_players").insert({
      team_id: myTeam.id,
      player_id: playerId,
      is_captain: false,
      is_on_bench: false,
    });

    const nextPick = draftSession.current_pick + 1;
    const finished = nextPick >= draftSession.total_picks;
    const newStatus = finished ? "finished" : "active";

    await supabase.from("draft_sessions").update({
      current_pick: nextPick,
      status: newStatus,
    }).eq("id", draftSession.id);

    const updatedSession = { ...draftSession, current_pick: nextPick, status: newStatus };
    setDraftSession(updatedSession);
    draftSessionRef.current = updatedSession;
    const updatedPicks = await loadPicks(draftSession.id);

    if (finished) {
      await supabase.from("leagues").update({ status: "active" }).eq("id", leagueId);
      if (pollRef.current) clearInterval(pollRef.current);
    } else {
      triggerBot(updatedSession, updatedPicks, teamsRef.current, userIdRef.current);
    }
  }

  async function pauseDraft() {
    if (!draftSession || !isOwner) return;
    await supabase.from("draft_sessions").update({ status: "paused" }).eq("id", draftSession.id);
    const updated = { ...draftSession, status: "paused" };
    setDraftSession(updated);
    draftSessionRef.current = updated;
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
  }

  async function resumeDraft() {
    if (!draftSession || !isOwner) return;
    await supabase.from("draft_sessions").update({ status: "active" }).eq("id", draftSession.id);
    const updated = { ...draftSession, status: "active" };
    setDraftSession(updated);
    draftSessionRef.current = updated;
    botRunningRef.current = false;
    const freshPicks = await loadPicks(draftSession.id);
    triggerBot(updated, freshPicks, teamsRef.current, userIdRef.current);
  }

  const currentTeam = draftSession ? getTeamForPick(draftSession, teams) : null;
  const isMyTurn = currentTeam?.user_id === user?.id;
  const pickedIds = new Set(draftPicks.map((p: any) => p.player_id));
  const myPicks = draftPicks.filter((p: any) => p.team_id === myTeam?.id);
  const totalRounds = 15;
  const noLimit = (draftSession?.seconds_per_pick || 0) === 0;

  const timerColor = noLimit ? "#f5a623"
    : timeLeft > 30 ? "#00ce7d"
    : timeLeft > 10 ? "#f5a623"
    : "#ff4d6d";

  const availablePlayers = players.filter(p => {
    if (pickedIds.has(p.id)) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (posFilter !== "ALL" && p.position !== posFilter) return false;
    return true;
  });

  function buildBoard() {
    if (!draftSession) return [];
    const order = draftSession.draft_order || [];
    const n = order.length;
    if (n === 0) return [];
    const rows: any[][] = [];
    const isSnake = draftSession.draft_type !== "linear";
    for (let round = 0; round < totalRounds; round++) {
      const row: any[] = [];
      for (let i = 0; i < n; i++) {
        const teamId = order[i];
        const pickPos = (isSnake && round % 2 !== 0) ? (n - 1 - i) : i;
        const pickNum = round * n + pickPos;
        const roundLabel = round + 1;
        const pickLabel = `${roundLabel}.${String(pickPos + 1).padStart(2, "0")}`;
        const pick = draftPicks.find(p => p.pick_number === pickNum);
        row.push({ teamId, pickNum, pickLabel, pick });
      }
      rows.push(row);
    }
    return rows;
  }

  const board = buildBoard();

  /* ── PRE-DRAFT SCREEN ───────────────────────────────── */
  if (!draftSession) {
    return (
      <main className="flex min-h-screen flex-col items-center p-4" style={{ background: "#0c0900" }}>
        {/* Glow */}
        <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ background: "#f5a623" }} />

        {/* Header */}
        <div className="w-full max-w-lg flex justify-between items-center mb-8">
          <button onClick={() => window.location.href = `/leagues/${leagueId}`}
            className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
            ← Liga
          </button>
          <h1 className="text-sm font-black uppercase tracking-widest" style={{ color: "#f5a623" }}>Draft</h1>
          <div className="flex items-center gap-3">
            <span className="text-[9px] font-black uppercase" style={{ color: "#5a4020" }}>{league?.name}</span>
            <UserBadge teamName={myTeam?.name} />
          </div>
        </div>

        <div className="w-full max-w-lg">
          {/* Draft type selector */}
          <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "#5a4020" }}>
            Draft-Modus
          </p>
          <div className="flex gap-3 mb-6">
            {([
              { id: "snake", label: "Snake Draft", desc: "Runde 2 von rechts, Runde 3 von links, …" },
              { id: "linear", label: "Dynasty Draft", desc: "Gleiche Reihenfolge · Schlechtestes Team zuerst" },
            ] as const).map((t) => (
              <button key={t.id} onClick={() => setDraftType(t.id)}
                className="flex-1 p-4 rounded-xl text-left transition-all"
                style={{
                  border: `1px solid ${draftType === t.id ? "#f5a623" : "#2a2010"}`,
                  background: draftType === t.id ? "#1a1208" : "#141008",
                }}>
                <p className="text-sm font-black" style={{ color: draftType === t.id ? "#f5a623" : "#c8b080" }}>{t.label}</p>
                <p className="text-[10px] mt-1 leading-relaxed" style={{ color: "#5a4020" }}>{t.desc}</p>
              </button>
            ))}
          </div>

          {/* Timer selector */}
          <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "#5a4020" }}>
            Zeit pro Pick (echte Spieler)
          </p>
          <div className="flex flex-wrap gap-2 mb-6">
            {TIMER_OPTIONS.map((opt) => (
              <button key={opt.value} onClick={() => setTimerSeconds(opt.value)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black transition-all"
                style={{
                  background: timerSeconds === opt.value ? "#f5a623" : "#141008",
                  color: timerSeconds === opt.value ? "#0c0900" : "#5a4020",
                  border: `1px solid ${timerSeconds === opt.value ? "#f5a623" : "#2a2010"}`,
                }}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* Teams preview */}
          <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "#5a4020" }}>
            {teams.length} echte Teams
            {(league?.max_teams || 10) - teams.length > 0 && (
              <span style={{ color: "#2a2010" }}> · {(league?.max_teams || 10) - teams.length} Bot-Teams werden beim Start erstellt</span>
            )}
          </p>
          <div className="flex flex-wrap gap-2 mb-8">
            {teams.map((t: any) => (
              <div key={t.id} className="rounded-xl px-4 py-2.5 text-center"
                style={{ background: "#141008", border: "1px solid #2a2010" }}>
                <p className="font-black text-xs" style={{ color: "#c8b080" }}>{t.name}</p>
                <p className="text-[9px] mt-0.5" style={{ color: "#5a4020" }}>{t.profiles?.username}</p>
              </div>
            ))}
          </div>

          {isOwner ? (
            <button onClick={startDraft}
              className="w-full py-4 rounded-xl text-sm font-black uppercase tracking-widest"
              style={{ background: "#f5a623", color: "#0c0900" }}>
              Draft starten ⚽
            </button>
          ) : (
            <p className="text-center text-sm font-black" style={{ color: "#5a4020" }}>
              Warte auf Liga-Ersteller...
            </p>
          )}
        </div>
      </main>
    );
  }

  /* ── ACTIVE DRAFT SCREEN ────────────────────────────── */
  const draftN = draftSession.draft_order?.length || 1;
  const currentRound = Math.floor(draftSession.current_pick / draftN) + 1;
  const draftTypeLabel = draftSession.draft_type === "linear" ? "Dynasty" : "Snake";

  return (
    <main className="flex flex-col overflow-hidden" style={{ background: "#0c0900", height: "100dvh" }}>
      {/* Header bar */}
      <div className="flex justify-between items-center px-4 py-2.5 flex-shrink-0"
        style={{ borderBottom: "1px solid #2a2010" }}>
        <button onClick={() => window.location.href = `/leagues/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
          ← Liga
        </button>

        {/* Center status */}
        <div className="text-center">
          {draftSession.status === "finished" ? (
            <p className="font-black text-sm" style={{ color: "#f5a623" }}>🎉 Draft beendet!</p>
          ) : draftSession.status === "paused" ? (
            <>
              <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
                {draftTypeLabel} · R{currentRound} · Pick {draftSession.current_pick + 1}
              </p>
              <p className="font-black text-xs mt-0.5" style={{ color: "#f5a623" }}>⏸ Pausiert</p>
            </>
          ) : (
            <>
              <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
                {draftTypeLabel} · R{currentRound} · Pick {draftSession.current_pick + 1}
              </p>
              <p className="font-black text-xs mt-0.5" style={{ color: isMyTurn ? "#f5a623" : "#c8b080" }}>
                {isMyTurn ? "🟢 Du bist dran!" : `${currentTeam?.name || "—"} pickt...`}
              </p>
            </>
          )}
        </div>

        {/* Right: timer + controls */}
        <div className="flex items-center gap-2">
          {draftSession.status === "active" && (
            <p className="font-black text-xl leading-none" style={{ color: timerColor }}>
              {noLimit ? "∞" : `${timeLeft}s`}
            </p>
          )}
          {isOwner && draftSession.status === "active" && (
            <button onClick={pauseDraft}
              className="px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors"
              style={{ background: "#2a1808", border: "1px solid #f5a623", color: "#f5a623" }}>
              ⏸
            </button>
          )}
          {isOwner && draftSession.status === "paused" && (
            <button onClick={resumeDraft}
              className="px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors"
              style={{ background: "#0a1a0a", border: "1px solid #00ce7d", color: "#00ce7d" }}>
              ▶
            </button>
          )}
          {draftSession.status === "finished" && (
            <button onClick={() => window.location.href = `/leagues/${leagueId}`}
              className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase"
              style={{ background: "#f5a623", color: "#0c0900" }}>
              Liga →
            </button>
          )}
          <UserBadge teamName={myTeam?.name} />
        </div>
      </div>

      {/* Body: board + player list */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Board / Kader */}
        <div className="flex-1 overflow-auto p-3">
          {/* View toggle */}
          <div className="flex gap-2 mb-3">
            <button onClick={() => setView("board")}
              className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all"
              style={{
                background: view === "board" ? "#f5a623" : "#141008",
                color: view === "board" ? "#0c0900" : "#5a4020",
                border: `1px solid ${view === "board" ? "#f5a623" : "#2a2010"}`,
              }}>
              Board
            </button>
            <button onClick={() => setView("list")}
              className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all"
              style={{
                background: view === "list" ? "#f5a623" : "#141008",
                color: view === "list" ? "#0c0900" : "#5a4020",
                border: `1px solid ${view === "list" ? "#f5a623" : "#2a2010"}`,
              }}>
              Kader
            </button>
            <span className="ml-auto text-[9px] font-black self-center" style={{ color: "#2a2010" }}>
              {draftPicks.length}/{draftSession.total_picks} Picks
            </span>
          </div>

          {/* BOARD VIEW */}
          {view === "board" && (
            <div className="overflow-x-auto">
              {/* Team headers */}
              <div className="flex gap-1 mb-1 min-w-max sticky top-0 pb-1 z-10" style={{ background: "#0c0900" }}>
                {(draftSession.draft_order || []).map((teamId: string) => {
                  const team = teams.find((t: any) => t.id === teamId);
                  const isMe = team?.user_id === user?.id;
                  return (
                    <div key={teamId}
                      className="w-28 p-2 rounded-lg text-center text-[9px] font-black uppercase truncate"
                      style={{
                        background: isMe ? "#1a1208" : "#141008",
                        border: `1px solid ${isMe ? "#f5a623" : "#2a2010"}`,
                        color: isMe ? "#f5a623" : "#5a4020",
                      }}>
                      {team?.name || "—"}
                    </div>
                  );
                })}
              </div>

              {/* Rows */}
              {board.map((row, roundIdx) => (
                <div key={roundIdx} className="flex gap-1 mb-1 min-w-max">
                  {row.map(({ teamId, pickNum, pickLabel, pick }: any) => {
                    const team = teams.find((t: any) => t.id === teamId);
                    const isMe = team?.user_id === user?.id;
                    const isCurrent = draftSession.current_pick === pickNum && draftSession.status === "active";
                    const pos = pick?.players?.position || "";
                    const posColor = POS_COLOR[pos];

                    return (
                      <div key={pickNum}
                        className="w-28 h-16 rounded-lg p-1.5 transition-all"
                        style={{
                          border: `1px solid ${isCurrent ? "#f5a623" : pick ? (posColor ? posColor + "40" : "#2a2010") : isMe ? "#2a2010" : "#1a1610"}`,
                          background: isCurrent ? "#1a1208" : pick ? (posColor ? posColor + "15" : "#141008") : isMe ? "#141008" : "#0e0c07",
                          animation: isCurrent ? "pulse 2s infinite" : undefined,
                        }}>
                        {pick ? (
                          <div className="flex flex-col h-full justify-between">
                            <p className="text-[9px] font-black truncate leading-tight" style={{ color: "#c8b080" }}>
                              {pick.players?.name}
                            </p>
                            <div className="flex items-center justify-between">
                              <span className="text-[7px] font-black px-1 rounded-sm"
                                style={{ background: posColor ? posColor + "30" : "#2a2010", color: posColor || "#5a4020" }}>
                                {pos}
                              </span>
                              <div className="flex items-center gap-1">
                                <span className="text-[7px] font-bold" style={{ color: "#2a2010" }}>{pickLabel}</span>
                                <span className="text-[8px] font-black" style={{ color: "#5a4020" }}>{pick.players?.fpts?.toFixed(0)}</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col h-full justify-between">
                            <p className="text-[8px] font-black" style={{ color: isCurrent ? "#f5a623" : "#2a2010" }}>{pickLabel}</p>
                            {isCurrent && (
                              <p className="text-[8px] font-black animate-pulse" style={{ color: "#f5a623" }}>← jetzt</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* KADER VIEW */}
          {view === "list" && (
            <div className="space-y-2">
              {teams.map((team: any) => {
                const teamPicks = draftPicks.filter((p: any) => p.team_id === team.id);
                const isMe = team.user_id === user?.id;
                return (
                  <div key={team.id} className="rounded-xl p-3"
                    style={{
                      background: "#141008",
                      border: `1px solid ${isMe ? "#3a2a10" : "#2a2010"}`,
                    }}>
                    <p className="text-[9px] font-black uppercase mb-2"
                      style={{ color: isMe ? "#f5a623" : "#5a4020" }}>
                      {team.name} ({teamPicks.length}/15)
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {teamPicks.map((pick: any) => {
                        const pos = pick.players?.position || "";
                        const posColor = POS_COLOR[pos];
                        return (
                          <span key={pick.id}
                            className="text-[8px] font-bold px-2 py-0.5 rounded"
                            style={{
                              background: posColor ? posColor + "20" : "#2a2010",
                              border: `1px solid ${posColor ? posColor + "40" : "#2a2010"}`,
                              color: posColor || "#5a4020",
                            }}>
                            {pick.players?.name?.split(" ").pop()}
                          </span>
                        );
                      })}
                      {Array.from({ length: 15 - teamPicks.length }).map((_, i) => (
                        <span key={i} className="text-[8px] px-2 py-0.5 rounded"
                          style={{ border: "1px solid #1a1610", color: "#1a1610" }}>—</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Player picker */}
        <div className="w-64 flex flex-col flex-shrink-0" style={{ borderLeft: "1px solid #2a2010" }}>
          {/* Search + filter */}
          <div className="p-3 flex-shrink-0" style={{ borderBottom: "1px solid #2a2010" }}>
            <p className="text-[8px] font-black uppercase tracking-widest mb-2" style={{ color: "#2a2010" }}>
              {availablePlayers.length} verfügbar
            </p>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Suchen..."
              className="w-full p-2 rounded-lg text-xs focus:outline-none mb-2"
              style={{ background: "#141008", border: "1px solid #2a2010", color: "#c8b080" }} />
            <div className="flex gap-0.5">
              {(["ALL", "GK", "DF", "MF", "FW"] as const).map(pos => (
                <button key={pos} onClick={() => setPosFilter(pos)}
                  className="flex-1 py-1 rounded text-[8px] font-black transition-all"
                  style={{
                    background: posFilter === pos ? (POS_COLOR[pos] || "#2a2010") : "transparent",
                    color: posFilter === pos ? "#0c0900" : "#5a4020",
                  }}>
                  {pos}
                </button>
              ))}
            </div>
          </div>

          {/* Player list */}
          <div className="flex-1 overflow-y-auto">
            {availablePlayers.slice(0, 100).map(p => {
              const posColor = POS_COLOR[p.position];
              return (
                <div key={p.id}
                  onClick={() => isMyTurn && pickPlayer(p.id)}
                  className="flex items-center gap-2 p-2 transition-all"
                  style={{
                    borderBottom: "1px solid #1a1610",
                    opacity: isMyTurn ? 1 : 0.4,
                    cursor: isMyTurn ? "pointer" : "not-allowed",
                    background: "transparent",
                  }}
                  onMouseEnter={e => { if (isMyTurn) (e.currentTarget as HTMLElement).style.background = "#1a1208"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  <img src={p.photo_url} className="w-8 h-8 rounded-full flex-shrink-0"
                    style={{ border: "1px solid #2a2010" }} alt="" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black truncate" style={{ color: "#c8b080" }}>{p.name}</p>
                    <p className="text-[8px] truncate" style={{ color: "#5a4020" }}>{p.team_name}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-black" style={{ color: "#f5a623" }}>{p.fpts?.toFixed(0)}</p>
                    <span className="text-[7px] font-black px-1 rounded-sm"
                      style={{
                        background: posColor ? posColor + "20" : "#2a2010",
                        color: posColor || "#5a4020",
                      }}>
                      {p.position}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
