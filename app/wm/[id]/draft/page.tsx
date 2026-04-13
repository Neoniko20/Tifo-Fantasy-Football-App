"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { UserBadge } from "@/app/components/UserBadge";
import type { WMLeagueSettings } from "@/lib/wm-types";
import { useToast } from "@/app/components/ToastProvider";
import { PlayerCard } from "@/app/components/PlayerCard";

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
  GK: "var(--color-primary)",
  DF: "var(--color-info)",
  MF: "var(--color-success)",
  FW: "var(--color-error)",
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

export default function WMDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [user, setUser] = useState<any>(null);
  const [league, setLeague] = useState<any>(null);
  const [settings, setSettings] = useState<WMLeagueSettings | null>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [myTeam, setMyTeam] = useState<any>(null);
  const [draftSession, setDraftSession] = useState<any>(null);
  const [draftPicks, setDraftPicks] = useState<any[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [nations, setNations] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [nationFilter, setNationFilter] = useState("ALL");
  const [timeLeft, setTimeLeft] = useState(60);
  const [isOwner, setIsOwner] = useState(false);
  const [view, setView] = useState<"board" | "list">("board");
  const [draftType, setDraftType] = useState<"snake" | "linear">("snake");
  const [timerSeconds, setTimerSeconds] = useState(60);
  const { toast } = useToast();

  const channelRef = useRef<any>(null);
  const botTimerRef = useRef<any>(null);
  const pollRef = useRef<any>(null);
  const isOwnerRef = useRef(false);
  const playersRef = useRef<Player[]>([]);
  const draftPicksRef = useRef<any[]>([]);
  const teamsRef = useRef<any[]>([]);
  const draftSessionRef = useRef<any>(null);
  const userIdRef = useRef<string>("");
  const settingsRef = useRef<WMLeagueSettings | null>(null);
  const botRunningRef = useRef(false);

  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { draftPicksRef.current = draftPicks; }, [draftPicks]);
  useEffect(() => { teamsRef.current = teams; }, [teams]);
  useEffect(() => { draftSessionRef.current = draftSession; }, [draftSession]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

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

  function totalRounds(s: WMLeagueSettings | null) {
    if (!s) return 15;
    return (s.squad_size || 11) + (s.bench_size || 4);
  }

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

    const { data: settingsData } = await supabase
      .from("wm_league_settings")
      .select("*")
      .eq("league_id", leagueId)
      .maybeSingle();
    setSettings(settingsData);
    settingsRef.current = settingsData;

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
    // 1. Nationen für dieses Turnier laden
    const { data: settingsData } = await supabase
      .from("wm_league_settings")
      .select("tournament_id")
      .eq("league_id", leagueId)
      .maybeSingle();

    let nationNames: string[] = [];
    if (settingsData?.tournament_id) {
      const { data: nationsData } = await supabase
        .from("wm_nations")
        .select("name, code, flag_url, group_letter")
        .eq("tournament_id", settingsData.tournament_id);
      setNations(nationsData || []);
      nationNames = (nationsData || []).map((n: any) => n.name);
    }

    // 2. Nur WM-Spieler laden (team_name muss einer Nation entsprechen)
    let query = supabase.from("players").select("*").order("fpts", { ascending: false });
    if (nationNames.length > 0) {
      query = query.in("team_name", nationNames);
    }

    const { data } = await query;
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
      .channel("wm-draft-" + leagueId + "-" + Date.now())
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

  function triggerBot(session: any, picks: any[], allTeams: any[], userId: string) {
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
    if (!session || session.status !== "active") return;
    const currentTeam = getTeamForPick(session, allTeams);
    if (!currentTeam) return;
    if (currentTeam.user_id !== null) return;
    if (botRunningRef.current) return;

    console.log(`🤖 WM Bot pickt für ${currentTeam.name} (Pick ${session.current_pick})`);
    botRunningRef.current = true;

    botTimerRef.current = setTimeout(async () => {
      if (draftSessionRef.current?.status !== "active") { botRunningRef.current = false; return; }

      const picked = new Set(draftPicksRef.current.map((p: any) => p.player_id));
      const available = playersRef.current.filter(p => !picked.has(p.id));
      if (available.length === 0) { botRunningRef.current = false; return; }

      const best = available[0];
      const n = allTeams.length;
      const round = Math.floor(session.current_pick / n);

      const { error } = await supabase.from("draft_picks").insert({
        draft_session_id: session.id,
        team_id: currentTeam.id,
        player_id: best.id,
        pick_number: session.current_pick,
        round,
      });

      botRunningRef.current = false;
      if (error) { console.error("Bot error:", error.message); return; }

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
    if (teams.length < 1) { toast("Mindestens 1 Team!", "error"); return; }

    let allTeams = [...teams];
    const botCount = (league?.max_teams || 8) - teams.length;
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

    const rounds = totalRounds(settingsRef.current);
    const totalPicksCount = allTeams.length * rounds;

    const { data: session } = await supabase.from("draft_sessions").insert({
      league_id: leagueId, status: "active", current_pick: 0,
      total_picks: totalPicksCount, seconds_per_pick: timerSeconds,
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
  const rounds = totalRounds(settings);
  const noLimit = (draftSession?.seconds_per_pick || 0) === 0;

  const timerColor = noLimit ? "var(--color-primary)"
    : timeLeft > 30 ? "var(--color-success)"
    : timeLeft > 10 ? "var(--color-primary)"
    : "var(--color-error)";

  const availablePlayers = players.filter(p => {
    if (pickedIds.has(p.id)) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) &&
        !p.team_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (posFilter !== "ALL" && p.position !== posFilter) return false;
    if (nationFilter !== "ALL" && p.team_name !== nationFilter) return false;
    return true;
  });

  function buildBoard() {
    if (!draftSession) return [];
    const order = draftSession.draft_order || [];
    const n = order.length;
    if (n === 0) return [];
    const rows: any[][] = [];
    const isSnake = draftSession.draft_type !== "linear";
    for (let round = 0; round < rounds; round++) {
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

  /* ── PRE-DRAFT ──────────────────────────────────────── */
  if (!draftSession) {
    return (
      <main className="flex min-h-screen flex-col items-center p-4" style={{ background: "var(--bg-page)" }}>
        <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ background: "var(--color-primary)" }} />

        <div className="w-full max-w-lg flex justify-between items-center mb-8">
          <button onClick={() => window.location.href = `/wm/${leagueId}`}
            className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            ← WM
          </button>
          <div className="text-center">
            <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>WM 2026</p>
            <h1 className="text-sm font-black uppercase tracking-widest" style={{ color: "var(--color-primary)" }}>Draft</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[9px] font-black uppercase" style={{ color: "var(--color-muted)" }}>{league?.name}</span>
            <UserBadge teamName={myTeam?.name} />
          </div>
        </div>

        <div className="w-full max-w-lg">
          {/* WM Settings summary */}
          {settings && (
            <div className="rounded-xl p-4 mb-6 flex gap-4"
              style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
              <div className="text-center">
                <p className="text-2xl font-black" style={{ color: "var(--color-primary)" }}>{rounds}</p>
                <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Runden</p>
              </div>
              <div className="w-px" style={{ background: "var(--color-border)" }} />
              <div className="text-center">
                <p className="text-2xl font-black" style={{ color: "var(--color-text)" }}>{settings.squad_size}</p>
                <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Startelf</p>
              </div>
              <div className="w-px" style={{ background: "var(--color-border)" }} />
              <div className="text-center">
                <p className="text-2xl font-black" style={{ color: "var(--color-text)" }}>{settings.bench_size}</p>
                <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Bank</p>
              </div>
              <div className="w-px" style={{ background: "var(--color-border)" }} />
              <div className="text-center">
                <p className="text-2xl font-black" style={{ color: "var(--color-text)" }}>{teams.length}</p>
                <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Teams</p>
              </div>
            </div>
          )}

          {/* Draft type */}
          <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
            Draft-Modus
          </p>
          <div className="flex gap-3 mb-6">
            {([
              { id: "snake", label: "Snake Draft", desc: "Runde 2 von rechts, Runde 3 von links, …" },
              { id: "linear", label: "Linear Draft", desc: "Gleiche Reihenfolge · Schlechtestes Team zuerst" },
            ] as const).map((t) => (
              <button key={t.id} onClick={() => setDraftType(t.id)}
                className="flex-1 p-4 rounded-xl text-left transition-all"
                style={{
                  border: `1px solid ${draftType === t.id ? "var(--color-primary)" : "var(--color-border)"}`,
                  background: draftType === t.id ? "var(--bg-elevated)" : "var(--bg-card)",
                }}>
                <p className="text-sm font-black" style={{ color: draftType === t.id ? "var(--color-primary)" : "var(--color-text)" }}>{t.label}</p>
                <p className="text-[10px] mt-1 leading-relaxed" style={{ color: "var(--color-muted)" }}>{t.desc}</p>
              </button>
            ))}
          </div>

          {/* Timer */}
          <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
            Zeit pro Pick
          </p>
          <div className="flex flex-wrap gap-2 mb-6">
            {TIMER_OPTIONS.map((opt) => (
              <button key={opt.value} onClick={() => setTimerSeconds(opt.value)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black transition-all"
                style={{
                  background: timerSeconds === opt.value ? "var(--color-primary)" : "var(--bg-card)",
                  color: timerSeconds === opt.value ? "var(--bg-page)" : "var(--color-muted)",
                  border: `1px solid ${timerSeconds === opt.value ? "var(--color-primary)" : "var(--color-border)"}`,
                }}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* Teams */}
          <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
            {teams.length} echte Teams
            {(league?.max_teams || 8) - teams.length > 0 && (
              <span style={{ color: "var(--color-border)" }}> · {(league?.max_teams || 8) - teams.length} Bot-Teams beim Start</span>
            )}
          </p>
          <div className="flex flex-wrap gap-2 mb-8">
            {teams.map((t: any) => (
              <div key={t.id} className="rounded-xl px-4 py-2.5 text-center"
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <p className="font-black text-xs" style={{ color: "var(--color-text)" }}>{t.name}</p>
                <p className="text-[9px] mt-0.5" style={{ color: "var(--color-muted)" }}>{t.profiles?.username}</p>
              </div>
            ))}
          </div>

          {isOwner ? (
            <button onClick={startDraft}
              className="w-full py-4 rounded-xl text-sm font-black uppercase tracking-widest"
              style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
              WM Draft starten 🌍
            </button>
          ) : (
            <p className="text-center text-sm font-black" style={{ color: "var(--color-muted)" }}>
              Warte auf Liga-Ersteller...
            </p>
          )}
        </div>
      </main>
    );
  }

  /* ── ACTIVE DRAFT ───────────────────────────────────── */
  const draftN = draftSession.draft_order?.length || 1;
  const currentRound = Math.floor(draftSession.current_pick / draftN) + 1;
  const draftTypeLabel = draftSession.draft_type === "linear" ? "Linear" : "Snake";

  return (
    <main className="flex flex-col overflow-hidden" style={{ background: "var(--bg-page)", height: "100dvh" }}>
      {/* Header bar */}
      <div className="flex justify-between items-center px-4 py-2.5 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--color-border)" }}>
        <button onClick={() => window.location.href = `/wm/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          ← WM
        </button>

        <div className="text-center">
          {draftSession.status === "finished" ? (
            <p className="font-black text-sm" style={{ color: "var(--color-primary)" }}>🎉 Draft beendet!</p>
          ) : draftSession.status === "paused" ? (
            <>
              <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                {draftTypeLabel} · R{currentRound}/{rounds} · Pick {draftSession.current_pick + 1}
              </p>
              <p className="font-black text-xs mt-0.5" style={{ color: "var(--color-primary)" }}>⏸ Pausiert</p>
            </>
          ) : (
            <>
              <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                {draftTypeLabel} · R{currentRound}/{rounds} · Pick {draftSession.current_pick + 1}
              </p>
              <p className="font-black text-xs mt-0.5" style={{ color: isMyTurn ? "var(--color-primary)" : "var(--color-text)" }}>
                {isMyTurn ? "🟢 Du bist dran!" : `${currentTeam?.name || "—"} pickt...`}
              </p>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {draftSession.status === "active" && (
            <p className="font-black text-xl leading-none" style={{ color: timerColor }}>
              {noLimit ? "∞" : `${timeLeft}s`}
            </p>
          )}
          {isOwner && draftSession.status === "active" && (
            <button onClick={pauseDraft}
              className="px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors"
              style={{ background: "color-mix(in srgb, var(--color-primary) 15%, var(--bg-page))", border: "1px solid var(--color-primary)", color: "var(--color-primary)" }}>
              ⏸
            </button>
          )}
          {isOwner && draftSession.status === "paused" && (
            <button onClick={resumeDraft}
              className="px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors"
              style={{ background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))", border: "1px solid var(--color-success)", color: "var(--color-success)" }}>
              ▶
            </button>
          )}
          {draftSession.status === "finished" && (
            <button onClick={() => window.location.href = `/wm/${leagueId}`}
              className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase"
              style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
              WM →
            </button>
          )}
          <UserBadge teamName={myTeam?.name} />
        </div>
      </div>

      {/* Body: board + player list */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Board / Kader */}
        <div className="flex-1 overflow-auto p-3">
          <div className="flex gap-2 mb-3">
            <button onClick={() => setView("board")}
              className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all"
              style={{
                background: view === "board" ? "var(--color-primary)" : "var(--bg-card)",
                color: view === "board" ? "var(--bg-page)" : "var(--color-muted)",
                border: `1px solid ${view === "board" ? "var(--color-primary)" : "var(--color-border)"}`,
              }}>
              Board
            </button>
            <button onClick={() => setView("list")}
              className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all"
              style={{
                background: view === "list" ? "var(--color-primary)" : "var(--bg-card)",
                color: view === "list" ? "var(--bg-page)" : "var(--color-muted)",
                border: `1px solid ${view === "list" ? "var(--color-primary)" : "var(--color-border)"}`,
              }}>
              Kader
            </button>
            <span className="ml-auto text-[9px] font-black self-center" style={{ color: "var(--color-border)" }}>
              {draftPicks.length}/{draftSession.total_picks} Picks
            </span>
          </div>

          {/* BOARD VIEW */}
          {view === "board" && (
            <div className="overflow-x-auto">
              <div className="flex gap-1 mb-1 min-w-max sticky top-0 pb-1 z-10" style={{ background: "var(--bg-page)" }}>
                {(draftSession.draft_order || []).map((teamId: string) => {
                  const team = teams.find((t: any) => t.id === teamId);
                  const isMe = team?.user_id === user?.id;
                  return (
                    <div key={teamId}
                      className="w-28 p-2 rounded-lg text-center text-[9px] font-black uppercase truncate"
                      style={{
                        background: isMe ? "var(--bg-elevated)" : "var(--bg-card)",
                        border: `1px solid ${isMe ? "var(--color-primary)" : "var(--color-border)"}`,
                        color: isMe ? "var(--color-primary)" : "var(--color-muted)",
                      }}>
                      {team?.name || "—"}
                    </div>
                  );
                })}
              </div>

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
                          border: `1px solid ${isCurrent ? "var(--color-primary)" : pick ? (posColor ? posColor + "40" : "var(--color-border)") : isMe ? "var(--color-border)" : "var(--color-border)"}`,
                          background: isCurrent ? "var(--bg-elevated)" : pick ? (posColor ? posColor + "15" : "var(--bg-card)") : isMe ? "var(--bg-card)" : "var(--bg-page)",
                          animation: isCurrent ? "pulse 2s infinite" : undefined,
                        }}>
                        {pick ? (
                          <div className="flex flex-col h-full justify-between">
                            <p className="text-[9px] font-black truncate leading-tight" style={{ color: "var(--color-text)" }}>
                              {pick.players?.name}
                            </p>
                            <div className="flex items-center justify-between">
                              <span className="text-[7px] font-black px-1 rounded-sm"
                                style={{ background: posColor ? posColor + "30" : "var(--color-border)", color: posColor || "var(--color-muted)" }}>
                                {pos}
                              </span>
                              <div className="flex items-center gap-1">
                                <span className="text-[7px] font-bold" style={{ color: "var(--color-border)" }}>{pickLabel}</span>
                                <span className="text-[8px] font-black" style={{ color: "var(--color-muted)" }}>{pick.players?.fpts?.toFixed(0)}</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col h-full justify-between">
                            <p className="text-[8px] font-black" style={{ color: isCurrent ? "var(--color-primary)" : "var(--color-border)" }}>{pickLabel}</p>
                            {isCurrent && (
                              <p className="text-[8px] font-black animate-pulse" style={{ color: "var(--color-primary)" }}>← jetzt</p>
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
                    style={{ background: "var(--bg-card)", border: `1px solid ${isMe ? "var(--color-border-subtle)" : "var(--color-border)"}` }}>
                    <p className="text-[9px] font-black uppercase mb-2"
                      style={{ color: isMe ? "var(--color-primary)" : "var(--color-muted)" }}>
                      {team.name} ({teamPicks.length}/{rounds})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {teamPicks.map((pick: any) => {
                        const pos = pick.players?.position || "";
                        const posColor = POS_COLOR[pos];
                        return (
                          <span key={pick.id}
                            className="text-[8px] font-bold px-2 py-0.5 rounded"
                            style={{
                              background: posColor ? posColor + "20" : "var(--color-border)",
                              border: `1px solid ${posColor ? posColor + "40" : "var(--color-border)"}`,
                              color: posColor || "var(--color-muted)",
                            }}>
                            {pick.players?.name?.split(" ").pop()}
                          </span>
                        );
                      })}
                      {Array.from({ length: rounds - teamPicks.length }).map((_, i) => (
                        <span key={i} className="text-[8px] px-2 py-0.5 rounded"
                          style={{ border: "1px solid var(--color-border)", color: "var(--color-border)" }}>—</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Player picker */}
        <div className="w-64 flex flex-col flex-shrink-0" style={{ borderLeft: "1px solid var(--color-border)" }}>
          <div className="p-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
            <p className="text-[8px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-border)" }}>
              {availablePlayers.length} verfügbar · {players.length} WM-Spieler
            </p>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Name oder Nation..."
              className="w-full p-2 rounded-lg text-xs focus:outline-none mb-2"
              style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
            <div className="flex gap-0.5 mb-2">
              {(["ALL", "GK", "DF", "MF", "FW"] as const).map(pos => (
                <button key={pos} onClick={() => setPosFilter(pos)}
                  className="flex-1 py-1 rounded text-[8px] font-black transition-all"
                  style={{
                    background: posFilter === pos ? (POS_COLOR[pos] || "var(--color-border)") : "transparent",
                    color: posFilter === pos ? "var(--bg-page)" : "var(--color-muted)",
                  }}>
                  {pos}
                </button>
              ))}
            </div>
            {nations.length > 0 && (
              <select
                value={nationFilter}
                onChange={e => setNationFilter(e.target.value)}
                className="w-full p-1.5 rounded-lg text-[9px] font-black focus:outline-none"
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}>
                <option value="ALL">Alle Nationen</option>
                {nations.sort((a, b) => (a.group_letter || "").localeCompare(b.group_letter || "") || a.name.localeCompare(b.name))
                  .map((n: any) => (
                    <option key={n.name} value={n.name}>
                      {n.group_letter ? `[${n.group_letter}] ` : ""}{n.name}
                    </option>
                  ))}
              </select>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {availablePlayers.slice(0, 150).map(p => {
              const posColor = POS_COLOR[p.position];
              const nation = nations.find((n: any) => n.name === p.team_name);
              return (
                <div key={p.id}
                  onClick={() => isMyTurn && pickPlayer(p.id)}
                  className="flex items-center gap-2 p-2 transition-all"
                  style={{
                    borderBottom: "1px solid var(--color-border)",
                    opacity: isMyTurn ? 1 : 0.4,
                    cursor: isMyTurn ? "pointer" : "not-allowed",
                    background: "transparent",
                  }}
                  onMouseEnter={e => { if (isMyTurn) (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  <PlayerCard player={p} posColor={posColor} size={32} nationFlagUrl={nation?.flag_url} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black truncate" style={{ color: "var(--color-text)" }}>{p.name}</p>
                    <p className="text-[8px] truncate" style={{ color: "var(--color-muted)" }}>
                      {nation?.code || p.team_name}
                      {nation?.group_letter && <span style={{ color: "var(--color-border)" }}> · Gr.{nation.group_letter}</span>}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-black" style={{ color: "var(--color-primary)" }}>{p.fpts?.toFixed(0)}</p>
                    <span className="text-[7px] font-black px-1 rounded-sm"
                      style={{
                        background: posColor ? posColor + "20" : "var(--color-border)",
                        color: posColor || "var(--color-muted)",
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
