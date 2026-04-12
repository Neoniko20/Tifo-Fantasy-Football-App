"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { FORMATIONS, validateFormation } from "@/lib/wm-formations";
import type { Position } from "@/lib/wm-types";
import { LeagueTopNav } from "@/app/components/LeagueTopNav";
import { BottomNav } from "@/app/components/BottomNav";
import { PlayerCard } from "@/app/components/PlayerCard";
import tsdbClubs from "@/lib/tsdb-clubs.json";
import { useToast } from "@/app/components/ToastProvider";

const clubAsset = (teamName: string) => (tsdbClubs as Record<string, any>)[teamName] || null;

const POS_COLOR: Record<string, string> = {
  GK: "#f5a623",
  DF: "#4a9eff",
  MF: "#00ce7d",
  FW: "#ff4d6d",
};

const LEAGUE_NAMES: Record<number, string> = {
  78: "Bundesliga", 39: "Premier League",
  140: "La Liga", 135: "Serie A", 61: "Ligue 1",
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
  minutes?: number;
  shots_on?: number;
  key_passes?: number;
  tackles?: number;
  interceptions?: number;
  yellow_cards?: number;
  red_cards?: number;
  saves?: number;
};

type IRSlotData = {
  id: string;
  player_id: number;
  placed_at_gw: number;
  min_return_gw: number;
  player?: Player;
};

type ModalData = {
  player: Player;
  slotType: "xi" | "bench" | "none";
  slotIndex: number;
};

export default function LigaLineupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [user, setUser] = useState<any>(null);
  const [league, setLeague] = useState<any>(null);
  const [myTeam, setMyTeam] = useState<any>(null);
  const [gameweeks, setGameweeks] = useState<any[]>([]);
  const [activeGW, setActiveGW] = useState<number>(1);
  const [draftPicks, setDraftPicks] = useState<Player[]>([]);
  const [formation, setFormation] = useState("4-3-3");
  const [startingXI, setStartingXI] = useState<(Player | null)[]>(Array(11).fill(null));
  const [bench, setBench] = useState<Player[]>([]);
  const [captainId, setCaptainId] = useState<number | null>(null);
  const [viceCaptainId, setViceCaptainId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ type: "xi" | "bench"; index: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [ligaSettings, setLigaSettings] = useState<any>(null);
  const [irSlots, setIrSlots] = useState<IRSlotData[]>([]);
  const [selectingIR, setSelectingIR] = useState(false);
  const [squadWarnings, setSquadWarnings] = useState<{ type: string; message: string }[]>([]);
  const [gwPoints, setGwPoints] = useState<Record<number, number>>({});
  const [activeTab, setActiveTab] = useState<"lineup" | "squad" | "matches">("lineup");
  const [modalData, setModalData] = useState<ModalData | null>(null);
  const [squadSort, setSquadSort] = useState<"fpts" | "position" | "name" | "club">("fpts");
  const [dropping, setDropping] = useState<number | null>(null);
  const [taxiSquad, setTaxiSquad] = useState<Player[]>([]);
  const [selectingTaxi, setSelectingTaxi] = useState(false);
  const [gwMinutes, setGwMinutes] = useState<Record<number, number>>({}); // current GW minutes (live)
  const [originalXIIds, setOriginalXIIds] = useState<number[]>([]); // snapshot at load time
  const { toast } = useToast();

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

  useEffect(() => {
    if (myTeam && activeGW) {
      loadLineup(activeGW);
      loadGWPoints(myTeam.id, activeGW);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGW]);

  // Load player detail + TheSportsDB when modal opens
  useEffect(() => {
    if (!modalData) {
      setPlayerDetail(null); setPlayerGameLog([]); setPlayerHistory([]); setPlayerNews([]);
      setTsdbPlayer(null);
      return;
    }
    setPlayerTab("summary");
    setPlayerDetailLoading(true);
    setTsdbPlayer(null);
    const p = modalData.player;
    loadPlayerDetail(p.id);
    fetch(`/api/tsdb-player?name=${encodeURIComponent(p.name)}&team=${encodeURIComponent(p.team_name || "")}`)
      .then(r => r.json()).then(d => setTsdbPlayer(d)).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalData?.player.id]);

  async function loadPlayerDetail(pid: number) {
    const { data: p } = await supabase.from("players").select("*").eq("id", pid).single();
    setPlayerDetail(p);

    const { data: gwPts } = await supabase.from("liga_gameweek_points")
      .select("*").eq("league_id", leagueId).eq("player_id", pid).order("gameweek");
    setPlayerGameLog(gwPts || []);

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

    if (p?.name) {
      setPlayerNewsLoading(true);
      fetch(`/api/player-news?name=${encodeURIComponent(p.name)}`)
        .then(r => r.json()).then(d => { setPlayerNews(d.items || []); setPlayerNewsLoading(false); })
        .catch(() => setPlayerNewsLoading(false));
    }
  }

  async function loadAll(userId: string) {
    const { data: leagueData } = await supabase
      .from("leagues").select("*").eq("id", leagueId).single();
    setLeague(leagueData);

    const { data: team } = await supabase
      .from("teams").select("*").eq("league_id", leagueId).eq("user_id", userId).single();
    setMyTeam(team);

    const { data: ls } = await supabase
      .from("liga_settings").select("*").eq("league_id", leagueId).maybeSingle();
    setLigaSettings(ls);

    const { data: gwData } = await supabase
      .from("liga_gameweeks").select("*").eq("league_id", leagueId).order("gameweek");
    setGameweeks(gwData || []);

    const active = (gwData || []).find((g: any) => g.status === "active") || (gwData || [])[0];
    const gw = active?.gameweek || 1;
    setActiveGW(gw);

    if (!team) { setLoading(false); return; }

    const { data: picks } = await supabase
      .from("squad_players").select("player_id, is_taxi").eq("team_id", team.id);

    let playersData: Player[] = [];
    let taxiData: Player[] = [];
    if (picks && picks.length > 0) {
      const allIds = picks.map((p: any) => p.player_id);
      const taxiIds = new Set(picks.filter((p: any) => p.is_taxi).map((p: any) => p.player_id));
      const { data: fetched } = await supabase
        .from("players")
        .select("id, name, photo_url, position, team_name, api_team_id, fpts, goals, assists, minutes, shots_on, key_passes, tackles, interceptions, yellow_cards, red_cards, saves")
        .in("id", allIds);
      const all = (fetched || []) as Player[];
      taxiData    = all.filter(p => taxiIds.has(p.id));
      playersData = all.filter(p => !taxiIds.has(p.id));
      setTaxiSquad(taxiData);
      setDraftPicks(playersData);
    }

    checkSquadWarnings(playersData, ls, taxiData);
    await loadLineupWithPlayers(team.id, gw, playersData, ls);
    await loadIRSlots(team.id, playersData);
    await loadGWPoints(team.id, gw);
    setLoading(false);
  }

  function checkSquadWarnings(players: Player[], settings: any, taxi?: Player[]) {
    const warnings: { type: string; message: string }[] = [];
    const squadSize = settings?.squad_size || 15;
    const benchSize = settings?.bench_size || 4;
    const irSpots   = settings?.ir_spots   || 0;
    const taxiSpots = settings?.taxi_spots || 0;
    const taxiCount = taxi !== undefined ? taxi.length : taxiSquad.length;
    const maxTotal  = squadSize + benchSize + irSpots;

    if (players.length > maxTotal) {
      warnings.push({
        type: "overflow",
        message:
          `Dein Kader hat ${players.length} Spieler, aber nur ${maxTotal} Plätze ` +
          `(${squadSize} Kader + ${benchSize} Bank${irSpots ? ` + ${irSpots} IR` : ""}). ` +
          `Bitte ${players.length - maxTotal} Spieler abgeben.`,
      });
    }

    if (taxiSpots > 0 && taxiCount > taxiSpots) {
      warnings.push({
        type: "taxi",
        message: `Zu viele Taxi-Spieler: ${taxiCount} (Max: ${taxiSpots}). Bitte ${taxiCount - taxiSpots} befördern oder entlassen.`,
      });
    }

    const posLimits = settings?.position_limits || {
      GK: { min: 1, max: 2 }, DF: { min: 3, max: 5 },
      MF: { min: 2, max: 5 }, FW: { min: 1, max: 4 },
    };
    const posCounts: Record<string, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
    players.forEach(p => { if (p.position in posCounts) posCounts[p.position]++; });

    for (const [pos, limits] of Object.entries(posLimits) as [string, { min: number; max: number }][]) {
      if (posCounts[pos] > limits.max) {
        warnings.push({
          type: "position",
          message:
            `Zu viele ${pos}: ${posCounts[pos]} (Max: ${limits.max}). ` +
            `Bitte ${posCounts[pos] - limits.max} abgeben.`,
        });
      }
    }
    setSquadWarnings(warnings);
  }

  async function loadIRSlots(teamId: string, players: Player[]) {
    const { data } = await supabase
      .from("liga_ir_slots")
      .select("id, player_id, placed_at_gw, min_return_gw")
      .eq("team_id", teamId)
      .is("returned_at_gw", null);
    const slots = (data || []).map((s: any) => ({
      ...s,
      player: players.find(p => p.id === s.player_id),
    }));
    setIrSlots(slots);
  }

  async function loadGWPoints(teamId: string, gw: number) {
    // Previous GW → season form badges
    const prevGW = gw - 1;
    if (prevGW >= 1) {
      const { data } = await supabase
        .from("liga_gameweek_points")
        .select("player_id, points")
        .eq("team_id", teamId)
        .eq("gameweek", prevGW);
      const map: Record<number, number> = {};
      (data || []).forEach((row: any) => { map[row.player_id] = row.points; });
      setGwPoints(map);
    } else {
      setGwPoints({});
    }

    // Current GW → minutes played (for live swap validation + badges)
    const { data: cur } = await supabase
      .from("liga_gameweek_points")
      .select("player_id, minutes")
      .eq("team_id", teamId)
      .eq("gameweek", gw);
    const minMap: Record<number, number> = {};
    (cur || []).forEach((row: any) => { minMap[row.player_id] = row.minutes ?? 0; });
    setGwMinutes(minMap);
  }

  async function dropPlayer(playerId: number) {
    if (!myTeam) return;
    setDropping(playerId);
    await supabase.from("squad_players")
      .delete()
      .eq("team_id", myTeam.id)
      .eq("player_id", playerId);
    const updated = draftPicks.filter(p => p.id !== playerId);
    const updatedTaxi = taxiSquad.filter(p => p.id !== playerId);
    setDraftPicks(updated);
    setTaxiSquad(updatedTaxi);
    setStartingXI(prev => prev.map(p => p?.id === playerId ? null : p));
    setBench(prev => prev.filter(p => p.id !== playerId));
    setIrSlots(prev => prev.filter(s => s.player_id !== playerId));
    checkSquadWarnings(updated, ligaSettings, updatedTaxi);
    setModalData(null);
    setDropping(null);
  }

  async function placeOnIR(player: Player) {
    if (!myTeam) return;
    const minReturn = activeGW + (ligaSettings?.ir_min_gameweeks || 4);
    await supabase.from("liga_ir_slots").insert({
      team_id: myTeam.id,
      league_id: leagueId,
      player_id: player.id,
      placed_at_gw: activeGW,
      min_return_gw: minReturn,
    });
    setStartingXI(prev => prev.map(p => p?.id === player.id ? null : p));
    setBench(prev => prev.filter(p => p.id !== player.id));
    await loadIRSlots(myTeam.id, draftPicks);
    setSelectingIR(false);
  }

  async function returnFromIR(slot: IRSlotData) {
    if (!myTeam) return;
    if (activeGW < slot.min_return_gw) {
      toast(`Frühestens ab GW${slot.min_return_gw} reaktivierbar.`, "info");
      return;
    }
    await supabase.from("liga_ir_slots")
      .update({ returned_at_gw: activeGW })
      .eq("id", slot.id);
    await loadIRSlots(myTeam.id, draftPicks);
  }

  async function moveToTaxi(player: Player) {
    if (!myTeam) return;
    await supabase.from("squad_players")
      .update({ is_taxi: true })
      .eq("team_id", myTeam.id)
      .eq("player_id", player.id);
    setStartingXI(prev => prev.map(p => p?.id === player.id ? null : p));
    setBench(prev => prev.filter(p => p.id !== player.id));
    const updated = draftPicks.filter(p => p.id !== player.id);
    const updatedTaxi = [...taxiSquad, player];
    setDraftPicks(updated);
    setTaxiSquad(updatedTaxi);
    checkSquadWarnings(updated, ligaSettings, updatedTaxi);
    setSelectingTaxi(false);
    setModalData(null);
  }

  async function promoteFromTaxi(player: Player) {
    if (!myTeam) return;
    await supabase.from("squad_players")
      .update({ is_taxi: false })
      .eq("team_id", myTeam.id)
      .eq("player_id", player.id);
    const updatedTaxi = taxiSquad.filter(p => p.id !== player.id);
    const updated = [...draftPicks, player];
    setTaxiSquad(updatedTaxi);
    setDraftPicks(updated);
    checkSquadWarnings(updated, ligaSettings, updatedTaxi);
  }

  async function loadLineup(gw: number) {
    if (!myTeam || draftPicks.length === 0) return;
    await loadLineupWithPlayers(myTeam.id, gw, draftPicks);
  }

  async function loadLineupWithPlayers(teamId: string, gw: number, players: Player[], settings?: any) {
    const { data: lineup } = await supabase
      .from("liga_lineups").select("*")
      .eq("team_id", teamId).eq("gameweek", gw).maybeSingle();

    if (lineup) {
      setFormation(lineup.formation);
      setCaptainId(lineup.captain_id);
      setViceCaptainId(lineup.vice_captain_id);
      const xi = (lineup.starting_xi as number[]).map(
        (id: number) => players.find(p => p.id === id) || null
      );
      const benchArr = (lineup.bench as number[])
        .map((id: number) => players.find(p => p.id === id))
        .filter(Boolean) as Player[];
      setStartingXI(xi.length === 11 ? xi : Array(11).fill(null));
      setBench(benchArr);
      setOriginalXIIds(lineup.starting_xi as number[]);
    } else {
      if (players.length > 0) {
        const config = FORMATIONS[formation];
        const sorted = [...players].sort((a, b) => (b.fpts || 0) - (a.fpts || 0));
        const used = new Set<number>();
        const newXI: (Player | null)[] = Array(11).fill(null);
        if (config) {
          for (let i = 0; i < config.layout.length; i++) {
            const slot = config.layout[i];
            const best = sorted.find(p => p.position === slot.position && !used.has(p.id));
            if (best) { newXI[i] = best; used.add(best.id); }
          }
        }
        const benchArr = sorted.filter(p => !used.has(p.id));
        const captain = newXI.find(Boolean);
        const viceCap = newXI.filter(Boolean).find(p => p!.id !== captain?.id);
        setStartingXI(newXI);
        setBench(benchArr);
        setCaptainId(captain?.id || null);
        setViceCaptainId(viceCap?.id || null);
      } else {
        setStartingXI(Array(11).fill(null));
        setBench([]);
        setCaptainId(null);
        setViceCaptainId(null);
      }
    }
  }

  function assignPlayer(player: Player) {
    if (!selectedSlot) return;
    const config = FORMATIONS[formation];
    if (!config) return;

    const newXI    = [...startingXI];
    const newBench = [...bench];
    const fromXI    = newXI.findIndex(p => p?.id === player.id);
    const fromBench = newBench.findIndex(p => p.id === player.id);

    if (selectedSlot.type === "xi") {
      const targetSlot = config.layout[selectedSlot.index];
      if (targetSlot && targetSlot.position !== player.position) {
        toast(`Slot benötigt ${targetSlot.position}, Spieler ist ${player.position}`, "error");
        return;
      }

      const displaced = newXI[selectedSlot.index]; // Spieler der verdrängt wird

      if (fromXI !== -1) {
        // XI ↔ XI Tausch: verdrängter Spieler geht in den alten Slot
        newXI[fromXI] = displaced ?? null;
      } else if (fromBench !== -1) {
        // Bank → XI: verdrängter Spieler kommt auf Bank-Position des eingesetzten
        newBench.splice(fromBench, 1);
        if (displaced) newBench.splice(fromBench, 0, displaced);
      } else {
        // Unzugewiesen → XI: verdrängter Spieler kommt auf Bank
        if (displaced) newBench.unshift(displaced);
      }

      newXI[selectedSlot.index] = player;

    } else { // Bank-Slot
      if (fromXI !== -1) {
        // XI → Bank: XI-Slot wird leer
        newXI[fromXI] = null;
      } else if (fromBench !== -1) {
        // Umordnen innerhalb der Bank
        newBench.splice(fromBench, 1);
        const adj = fromBench < selectedSlot.index ? selectedSlot.index - 1 : selectedSlot.index;
        newBench.splice(adj, 0, player);
        setStartingXI(newXI);
        setBench(newBench);
        setSelectedSlot(null);
        return;
      }
      // An Zielposition einfügen
      const insertAt = Math.min(selectedSlot.index, newBench.length);
      newBench.splice(insertAt, 0, player);
    }

    setStartingXI(newXI);
    setBench(newBench);
    setSelectedSlot(null);
  }

  function removeFromSlot(type: "xi" | "bench", index: number) {
    if (type === "xi") {
      const newXI = [...startingXI];
      newXI[index] = null;
      setStartingXI(newXI);
    } else {
      const newBench = [...bench];
      newBench.splice(index, 1);
      setBench(newBench);
    }
    setSelectedSlot(null);
  }

  function changeFormation(f: string) {
    const newConfig = FORMATIONS[f];
    if (!newConfig) return;

    // Aktuelle XI-Spieler sammeln
    const currentXI = startingXI.filter(Boolean) as Player[];
    const newXI: (Player | null)[] = Array(11).fill(null);
    const used = new Set<number>();

    // Jeden Slot der neuen Formation mit passendem Spieler befüllen
    for (let i = 0; i < newConfig.layout.length; i++) {
      const needed = newConfig.layout[i].position;
      const match = currentXI.find(p => p.position === needed && !used.has(p.id));
      if (match) { newXI[i] = match; used.add(match.id); }
    }

    // Spieler die keinen Platz gefunden haben → auf die Bank
    const displaced = currentXI.filter(p => !used.has(p.id));
    const newBench = [...bench];
    for (const p of displaced) {
      if (!newBench.find(b => b.id === p.id)) newBench.push(p);
    }

    setFormation(f);
    setStartingXI(newXI);
    setBench(newBench);
    setSelectedSlot(null);
  }

  function toggleCaptain(playerId: number) {
    if (captainId === playerId) { setCaptainId(null); return; }
    if (viceCaptainId === playerId) setViceCaptainId(null);
    setCaptainId(playerId);
  }

  function toggleVC(playerId: number) {
    if (viceCaptainId === playerId) { setViceCaptainId(null); return; }
    if (captainId === playerId) setCaptainId(null);
    setViceCaptainId(playerId);
  }

  async function saveLineup() {
    if (!myTeam) return;
    const xi = startingXI.filter(Boolean) as Player[];
    if (xi.length < 11) { toast("11 Spieler für die Startelf benötigt", "error"); return; }
    const validation = validateFormation(xi.map(p => p.position as Position), formation);
    if (!validation.valid) { toast(`Formation nicht erfüllt: ${validation.errors.join(", ")}`, "error"); return; }

    // ── Live-Swap Validierung ──────────────────────────────────────────
    if (canLiveSwap) {
      const newXIIds = xi.map(p => p.id);
      // Spieler die aus dem XI entfernt wurden
      const removed = originalXIIds.filter(id => !newXIIds.includes(id));
      const playedAndRemoved = removed.filter(id => (gwMinutes[id] ?? -1) > 0);
      if (playedAndRemoved.length > 0) {
        toast("Bereits gespielte Starter können nicht getauscht werden.", "error");
        return;
      }
      // Spieler die neu ins XI kamen
      const added = newXIIds.filter(id => !originalXIIds.includes(id));
      const playedAndAdded = added.filter(id => (gwMinutes[id] ?? -1) > 0);
      if (playedAndAdded.length > 0) {
        toast("Bereits gespielte Bankspieler können nicht eingewechselt werden.", "error");
        return;
      }
    }

    setSaving(true);
    await supabase.from("liga_lineups").upsert({
      team_id: myTeam.id,
      league_id: leagueId,
      gameweek: activeGW,
      formation,
      starting_xi: startingXI.filter(Boolean).map(p => p!.id),
      bench: bench.map(p => p.id),
      captain_id: captainId,
      vice_captain_id: viceCaptainId,
      locked: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: "team_id,gameweek" });
    setSaving(false);
    setSaved(true);
    // Update snapshot so next live-swap validation uses the new XI
    if (canLiveSwap) setOriginalXIIds(startingXI.filter(Boolean).map(p => p!.id));
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center text-[9px] font-black uppercase tracking-widest animate-pulse"
      style={{ background: "#0c0900", color: "#2a2010" }}>
      Lade Aufstellung...
    </main>
  );

  const config = FORMATIONS[formation];
  const irPlayerIds   = new Set(irSlots.map(s => s.player_id));
  const taxiPlayerIds = new Set(taxiSquad.map(p => p.id));

  // ── F-37: Lineup Lock ───────────────────────────────────────────────
  const activeGWData   = gameweeks.find((g: any) => g.gameweek === activeGW);
  const activeGWStatus = activeGWData?.status as string | undefined;
  const lockMode       = (ligaSettings?.lineup_lock_mode || "locked") as "locked" | "pre_sub" | "live_swap";

  // live_swap: only lock when finished; locked/pre_sub: lock when active OR finished
  const isLocked = lockMode === "live_swap"
    ? activeGWStatus === "finished"
    : (activeGWStatus === "active" || activeGWStatus === "finished");

  // live swap mode: during active GW, allow non-played ↔ non-played swaps
  const canLiveSwap = lockMode === "live_swap" && activeGWStatus === "active";

  // Für den Selektor: alle Spieler außer IR, Taxi und dem aktuellen Slot-Inhaber
  const currentSlotPlayerId = selectedSlot
    ? (selectedSlot.type === "xi"
        ? startingXI[selectedSlot.index]?.id
        : bench[selectedSlot.index]?.id)
    : undefined;
  const selectorCandidates = draftPicks.filter(p =>
    !irPlayerIds.has(p.id) && !taxiPlayerIds.has(p.id) && p.id !== currentSlotPlayerId
  );

  // Status-Helper für Selektor-Badges
  const xiIds    = new Set(startingXI.filter(Boolean).map(p => p!.id));
  const benchIds = new Set(bench.map(p => p.id));
  function playerStatus(id: number) {
    if (xiIds.has(id))    return "XI";
    if (benchIds.has(id)) return "Bank";
    return null;
  }

  const rows = config
    ? Array.from(new Set(config.layout.map(s => s.row)))
        .sort((a, b) => b - a)
        .map(row => ({
          row,
          slots: config.layout
            .map((s, i) => ({ ...s, slotIndex: i }))
            .filter(s => s.row === row)
            .sort((a, b) => a.col - b.col),
        }))
    : [];

  const xiPoints = startingXI.filter(Boolean).reduce((s, p) => {
    const base = p!.fpts || 0;
    return s + (p!.id === captainId ? base * 2 : base);
  }, 0);

  const benchSize = ligaSettings?.bench_size || 4;

  // ── PlayerCircle: thin wrapper around shared <PlayerCard> ───────────
  function PlayerCircle(props: {
    player: Player | null; size?: number; posColor: string;
    selected?: boolean; posLabel?: string; isCap?: boolean; isVC?: boolean;
  }) {
    return (
      <PlayerCard
        {...props}
        gwPoints={gwPoints}
        canLiveSwap={canLiveSwap}
        gwMinutes={gwMinutes}
      />
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-24" style={{ background: "#0c0900", paddingTop: 80 }}>
      <LeagueTopNav
        leagueId={leagueId}
        leagueName={league?.name}
        leagueStatus={league?.status}
        isOwner={league?.owner_id === user?.id}
      />
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "#f5a623" }} />

      {/* ── Header ── */}
      <div className="w-full max-w-md flex justify-between items-center mb-4">
        <button onClick={() => window.location.href = `/leagues/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
          ← Liga
        </button>
        <div className="text-center">
          <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
            {league?.name}
          </p>
          <p className="text-sm font-black" style={{ color: "#f5a623" }}>
            {myTeam?.name || "Mein Team"}
          </p>
        </div>
        <button onClick={saveLineup} disabled={saving || activeTab !== "lineup" || isLocked}
          className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-40 transition-all"
          style={{
            background: isLocked ? "#1a1208" : saved ? "#00ce7d" : activeTab === "lineup" ? "#f5a623" : "#1a1208",
            color: isLocked ? "#5a4020" : "#0c0900",
          }}>
          {isLocked ? "🔒" : saving ? "..." : saved ? "✓" : "Speichern"}
        </button>
      </div>

      {/* ── Tab-Navigation ── */}
      <div className="flex w-full max-w-md mb-4 rounded-xl overflow-hidden" style={{ border: "1px solid #2a2010" }}>
        {([
          { id: "lineup",  label: "Aufstellung" },
          { id: "squad",   label: "Kader" },
          { id: "matches", label: "Spieltag" },
        ] as const).map(tab => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id); setSelectedSlot(null); setSelectingIR(false); setSelectingTaxi(false); }}
            className="flex-1 py-2.5 text-[9px] font-black uppercase tracking-widest transition-all"
            style={{
              background: activeTab === tab.id ? "#f5a623" : "#141008",
              color: activeTab === tab.id ? "#0c0900" : "#5a4020",
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Squad-Warnungen (immer sichtbar) ── */}
      {squadWarnings.length > 0 && (
        <div className="w-full max-w-md mb-4 rounded-xl overflow-hidden" style={{ border: "1px solid #ff4d6d" }}>
          <div className="px-3 py-2 flex items-center gap-2" style={{ background: "#2a0808" }}>
            <span className="text-sm">⚠️</span>
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#ff4d6d" }}>
              Kader-Problem
            </p>
          </div>
          {squadWarnings.map((w, i) => (
            <div key={i} className="px-3 py-2 flex items-start gap-2"
              style={{ background: "#1a0808", borderTop: "1px solid #3a1010" }}>
              <span className="text-[9px] font-black flex-shrink-0"
                style={{ color: w.type === "overflow" ? "#ff4d6d" : "#f5a623" }}>
                {w.type === "overflow" ? "● Überfüllt" : "● Position"}
              </span>
              <p className="text-[9px] leading-relaxed" style={{ color: "#c8b080" }}>{w.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── GW-Selector (immer sichtbar) ── */}
      {gameweeks.length > 0 && (
        <div className="flex gap-1.5 w-full max-w-md mb-4 overflow-x-auto pb-1">
          {gameweeks.map((gw: any) => (
            <button key={gw.gameweek} onClick={() => setActiveGW(gw.gameweek)}
              className="px-3 py-1.5 rounded-lg text-[9px] font-black whitespace-nowrap flex-shrink-0 transition-all"
              style={{
                background: activeGW === gw.gameweek ? "#f5a623" : "#141008",
                color: activeGW === gw.gameweek ? "#0c0900" : "#5a4020",
                border: `1px solid ${activeGW === gw.gameweek ? "#f5a623" : gw.status === "active" ? "#3a2a10" : "#2a2010"}`,
              }}>
              GW{gw.gameweek}
            </button>
          ))}
        </div>
      )}
      {gameweeks.length === 0 && (
        <div className="w-full max-w-md rounded-xl p-3 mb-4 text-center"
          style={{ background: "#141008", border: "1px solid #2a2010" }}>
          <p className="text-[9px] font-black uppercase" style={{ color: "#5a4020" }}>Noch keine Spieltage angelegt</p>
          <p className="text-[8px] mt-1" style={{ color: "#2a2010" }}>Liga-Owner kann Spieltage im Admin anlegen</p>
        </div>
      )}

      {/* ════════════════════════════════
          TAB: AUFSTELLUNG
      ════════════════════════════════ */}
      {activeTab === "lineup" && (
        <>
          {/* F-37: Status-Banner */}
          {(() => {
            if (canLiveSwap) return (
              <div className="w-full max-w-md mb-3 rounded-xl px-3 py-2.5 flex items-center gap-2"
                style={{ background: "#0e1a10", border: "1px solid #f5a62350" }}>
                <span className="text-base">⚡</span>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#f5a623" }}>
                    Live-Tausch aktiv
                  </p>
                  <p className="text-[8px] mt-0.5" style={{ color: "#5a4020" }}>
                    Tausche Starter die noch nicht gespielt haben. Bereits gespielte Spieler sind gesperrt.
                  </p>
                </div>
              </div>
            );
            if (lockMode === "pre_sub" && activeGWStatus === "upcoming") return (
              <div className="w-full max-w-md mb-3 rounded-xl px-3 py-2.5 flex items-center gap-2"
                style={{ background: "#0e1008", border: "1px solid #4a9eff40" }}>
                <span className="text-base">🔄</span>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#4a9eff" }}>
                    Auto-Sub Modus
                  </p>
                  <p className="text-[8px] mt-0.5" style={{ color: "#5a4020" }}>
                    Bankreihenfolge = Auto-Sub Priorität. Stelle sicher dass die Bank richtig sortiert ist.
                  </p>
                </div>
              </div>
            );
            if (isLocked && activeGWStatus === "finished") return (
              <div className="w-full max-w-md mb-3 rounded-xl px-3 py-2.5 flex items-center gap-2"
                style={{ background: "#0a1a0a", border: "1px solid #00ce7d40" }}>
                <span className="text-base">✅</span>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#00ce7d" }}>
                    Spieltag abgeschlossen
                  </p>
                  <p className="text-[8px] mt-0.5" style={{ color: "#5a4020" }}>
                    Punkte berechnet. Auto-Subs wurden angewendet.
                  </p>
                </div>
              </div>
            );
            if (isLocked) return (
              <div className="w-full max-w-md mb-3 rounded-xl px-3 py-2.5 flex items-center gap-2"
                style={{ background: "#1a1208", border: "1px solid #f5a62340" }}>
                <span className="text-base">🔒</span>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#f5a623" }}>
                    {lockMode === "pre_sub" ? "Live — Auto-Sub läuft" : "Live — Aufstellung gesperrt"}
                  </p>
                  <p className="text-[8px] mt-0.5" style={{ color: "#5a4020" }}>
                    {lockMode === "pre_sub"
                      ? "Spieltag läuft. Auto-Subs werden nach Bankreihenfolge angewendet."
                      : "Spieltag läuft. Aufstellung kann nicht mehr geändert werden."}
                  </p>
                </div>
              </div>
            );
            return null;
          })()}

          {/* Punkte-Vorschau */}
          <div className="w-full max-w-md flex items-center justify-between mb-3 px-1">
            <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
              GW{activeGW} · {startingXI.filter(Boolean).length}/11
            </p>
            <p className="text-sm font-black" style={{ color: "#f5a623" }}>
              {xiPoints.toFixed(1)} <span className="text-[9px]" style={{ color: "#5a4020" }}>FPTS (Vorschau)</span>
            </p>
          </div>

          {/* Formation-Selector */}
          <div className="flex gap-1.5 flex-wrap w-full max-w-md mb-3">
            {(ligaSettings?.allowed_formations ||
              Object.keys(FORMATIONS).filter(f => !FORMATIONS[f].rare)
            ).map((f: string) => (
              FORMATIONS[f] && (
                <button key={f} onClick={() => { if (!isLocked) changeFormation(f); }}
                  disabled={isLocked}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-black transition-all disabled:opacity-30"
                  style={{
                    background: formation === f ? "#f5a623" : "#141008",
                    color: formation === f ? "#0c0900" : "#5a4020",
                    border: `1px solid ${formation === f ? "#f5a623" : "#2a2010"}`,
                  }}>
                  {f}
                </button>
              )
            ))}
          </div>

          {/* Spielfeld */}
          <div className="w-full max-w-md rounded-2xl overflow-hidden mb-4"
            style={{ background: "#0a1a0a", border: "1px solid #1a2a1a", minHeight: 340 }}>
            <div className="relative p-3"
              style={{ background: "linear-gradient(180deg, #0a1a0a 0%, #081408 100%)" }}>
              <div className="absolute left-3 right-3 top-1/2 h-px opacity-20" style={{ background: "#00ce7d" }} />
              <div className="absolute left-1/2 top-1/2 w-16 h-16 rounded-full border opacity-10 -translate-x-1/2 -translate-y-1/2"
                style={{ borderColor: "#00ce7d" }} />

              {rows.map(({ row, slots }) => (
                <div key={row} className="flex justify-center gap-2 mb-3">
                  {slots.map(({ position, slotIndex }) => {
                    const player = startingXI[slotIndex];
                    const isSelected = selectedSlot?.type === "xi" && selectedSlot.index === slotIndex;
                    const posColor = POS_COLOR[position] || "#c8b080";
                    const isCap = player?.id === captainId;
                    const isVC = player?.id === viceCaptainId;

                    return (
                      <div key={slotIndex}
                        onClick={() => {
                          if (isLocked) return;
                          if (player) {
                            setSelectedSlot(null);
                            setModalData({ player, slotType: "xi", slotIndex });
                          } else {
                            setSelectedSlot(isSelected ? null : { type: "xi", index: slotIndex });
                          }
                        }}
                        className="flex flex-col items-center transition-all"
                        style={{ width: 60, cursor: isLocked ? "default" : "pointer" }}>
                        <PlayerCircle
                          player={player} posColor={posColor}
                          selected={isSelected} posLabel={position}
                          isCap={isCap} isVC={isVC}
                        />
                        <p className="text-[7px] font-black text-center leading-tight mt-1 truncate w-full"
                          style={{ color: player ? "#c8b080" : "#2a2010" }}>
                          {player ? player.name.split(" ").pop() : position}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Bank */}
          {(() => {
            const displayCount = Math.max(bench.length, benchSize);
            return (
              <div className="w-full max-w-md mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
                    Bank · {bench.filter(Boolean).length}/{benchSize}
                  </p>
                  {bench.length > benchSize && (
                    <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full"
                      style={{ background: "#2a0808", color: "#ff4d6d", border: "1px solid #ff4d6d40" }}>
                      +{bench.length - benchSize} überschuss
                    </span>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  {Array.from({ length: displayCount }).map((_, i) => {
                    const player = bench[i];
                    const isSelected = selectedSlot?.type === "bench" && selectedSlot.index === i;
                    const isOverflow = i >= benchSize;
                    const posColor = player ? (POS_COLOR[player.position] || "#c8b080") : "#2a2010";
                    return (
                      <div key={i}
                        onClick={() => {
                          if (isLocked) return;
                          if (player) {
                            setSelectedSlot(null);
                            setModalData({ player, slotType: "bench", slotIndex: i });
                          } else {
                            setSelectedSlot(isSelected ? null : { type: "bench", index: i });
                          }
                        }}
                        className="flex flex-col items-center p-2 rounded-xl transition-all"
                        style={{
                          cursor: isLocked ? "default" : "pointer",
                          width: "calc(25% - 6px)", minWidth: 64,
                          background: isOverflow ? "#1a0808" : isSelected ? "#1a1208" : "#141008",
                          border: `1px solid ${isOverflow ? "#ff4d6d40" : isSelected ? "#f5a623" : "#2a2010"}`,
                        }}>
                        <PlayerCircle
                          player={player} size={36} posColor={isOverflow ? "#ff4d6d" : posColor}
                          selected={isSelected} posLabel={String(i + 1)}
                        />
                        {isOverflow && player && (
                          <span className="text-[6px] font-black mt-0.5" style={{ color: "#ff4d6d" }}>!</span>
                        )}
                        <p className="text-[7px] font-black text-center mt-0.5 truncate w-full leading-tight"
                          style={{ color: isOverflow ? "#c06060" : player ? "#c8b080" : "#2a2010" }}>
                          {player ? player.name.split(" ").pop() : "—"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* IR-Spots */}
          {(ligaSettings?.ir_spots || 0) > 0 && (
            <div className="w-full max-w-md mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
                    style={{ background: "#1a0808", border: "1px solid #ff4d6d", color: "#ff4d6d" }}>IR</span>
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
                    Injured Reserve · min. {ligaSettings.ir_min_gameweeks || 4} GWs
                  </p>
                </div>
                {irSlots.length < ligaSettings.ir_spots && (
                  <button
                    onClick={() => { setSelectingIR(v => !v); setSelectedSlot(null); }}
                    className="text-[8px] font-black px-2 py-1 rounded-lg transition-all"
                    style={{
                      background: selectingIR ? "#ff4d6d" : "#1a0808",
                      color: selectingIR ? "#0c0900" : "#ff4d6d",
                      border: "1px solid #ff4d6d",
                    }}>
                    {selectingIR ? "Abbrechen" : "+ Spieler"}
                  </button>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                {irSlots.map((slot) => {
                  const canReturn   = activeGW >= slot.min_return_gw;
                  const gwsLeft     = Math.max(0, slot.min_return_gw - activeGW);
                  return (
                    <div key={slot.id} className="flex-1 min-w-[100px] flex flex-col items-center p-2 rounded-xl"
                      style={{ background: "#1a0808", border: `1px solid ${canReturn ? "#ff4d6d40" : "#3a1010"}` }}>
                      {slot.player?.photo_url ? (
                        <img src={slot.player.photo_url} className="w-9 h-9 rounded-full object-cover"
                          style={{ border: `2px solid ${canReturn ? "#ff4d6d60" : "#ff4d6d20"}` }} alt="" />
                      ) : (
                        <div className="w-9 h-9 rounded-full flex items-center justify-center"
                          style={{ border: "2px solid #3a1010", background: "#0c0900" }}>
                          <span className="text-[10px] font-black" style={{ color: "#5a1010" }}>IR</span>
                        </div>
                      )}
                      <p className="text-[7px] font-black text-center mt-1 truncate w-full leading-tight"
                        style={{ color: "#c8b080" }}>
                        {slot.player?.name.split(" ").pop() || "—"}
                      </p>
                      <p className="text-[7px] font-black text-center"
                        style={{ color: canReturn ? "#ff4d6d" : "#5a3010" }}>
                        {canReturn ? "✓ Bereit" : `noch ${gwsLeft} GW${gwsLeft !== 1 ? "s" : ""}`}
                      </p>
                      <button onClick={() => returnFromIR(slot)}
                        className="text-[7px] font-black mt-1 px-1.5 py-0.5 rounded transition-all"
                        style={{
                          background: canReturn ? "#3a1010" : "#1a0808",
                          color: canReturn ? "#ff4d6d" : "#3a1010",
                          border: `1px solid ${canReturn ? "#ff4d6d" : "#2a1010"}`,
                          cursor: canReturn ? "pointer" : "not-allowed",
                        }}>
                        Zurück
                      </button>
                    </div>
                  );
                })}
                {Array.from({ length: ligaSettings.ir_spots - irSlots.length }).map((_, i) => (
                  <div key={`empty-${i}`} className="flex-1 min-w-[100px] flex flex-col items-center p-2 rounded-xl"
                    style={{ background: "#1a0808", border: "1px solid #2a1010" }}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center"
                      style={{ border: "2px solid #2a1010", background: "#0c0900" }}>
                      <span className="text-[10px] font-black" style={{ color: "#3a1010" }}>IR</span>
                    </div>
                    <p className="text-[7px] font-black text-center mt-1" style={{ color: "#3a1010" }}>Leer</p>
                  </div>
                ))}
              </div>
              {selectingIR && (
                <div className="mt-3 space-y-1 max-h-48 overflow-y-auto">
                  <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "#5a1010" }}>
                    Spieler auf IR setzen (mind. {ligaSettings.ir_min_gameweeks || 4} GWs gesperrt)
                  </p>
                  {draftPicks.filter(p => !irSlots.find(s => s.player_id === p.id)).map(p => (
                    <div key={p.id} onClick={() => placeOnIR(p)}
                      className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all"
                      style={{ background: "#1a0808", border: "1px solid #2a1010" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "#ff4d6d"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "#2a1010"}>
                      <img src={p.photo_url} className="w-7 h-7 rounded-full object-cover" alt=""
                        style={{ border: `1px solid ${POS_COLOR[p.position]}40` }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black truncate" style={{ color: "#c8b080" }}>{p.name}</p>
                        <p className="text-[7px]" style={{ color: "#5a4020" }}>{p.position} · {p.team_name}</p>
                      </div>
                      <span className="text-[8px] font-black" style={{ color: "#ff4d6d" }}>+ IR</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Taxi Squad */}
          {(ligaSettings?.taxi_spots || 0) > 0 && (
            <div className="w-full max-w-md mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
                    style={{ background: "#1a1a08", border: "1px solid #c8b080", color: "#c8b080" }}>U21</span>
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
                    Taxi Squad · {taxiSquad.length}/{ligaSettings.taxi_spots}
                  </p>
                </div>
                {taxiSquad.length < ligaSettings.taxi_spots && (
                  <button
                    onClick={() => { setSelectingTaxi(v => !v); setSelectedSlot(null); setSelectingIR(false); }}
                    className="text-[8px] font-black px-2 py-1 rounded-lg transition-all"
                    style={{
                      background: selectingTaxi ? "#c8b080" : "#1a1a08",
                      color: selectingTaxi ? "#0c0900" : "#c8b080",
                      border: "1px solid #c8b080",
                    }}>
                    {selectingTaxi ? "Abbrechen" : "+ Spieler"}
                  </button>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                {taxiSquad.map((player) => (
                  <div key={player.id} className="flex-1 min-w-[100px] flex flex-col items-center p-2 rounded-xl"
                    style={{ background: "#1a1a08", border: "1px solid #3a3010" }}>
                    {player.photo_url ? (
                      <img src={player.photo_url} className="w-9 h-9 rounded-full object-cover"
                        style={{ border: "2px solid #c8b08040" }} alt="" />
                    ) : (
                      <div className="w-9 h-9 rounded-full flex items-center justify-center"
                        style={{ border: "2px solid #3a3010", background: "#0c0900" }}>
                        <span className="text-[8px] font-black" style={{ color: "#c8b080" }}>
                          {player.position}
                        </span>
                      </div>
                    )}
                    <p className="text-[7px] font-black text-center mt-1 truncate w-full leading-tight"
                      style={{ color: "#c8b080" }}>
                      {player.name.split(" ").pop() || "—"}
                    </p>
                    <p className="text-[7px] text-center" style={{ color: "#5a4020" }}>
                      {player.fpts?.toFixed(0)} pts
                    </p>
                    <button onClick={() => promoteFromTaxi(player)}
                      className="text-[7px] font-black mt-1 px-1.5 py-0.5 rounded transition-all"
                      style={{
                        background: "#2a2010",
                        color: "#f5a623",
                        border: "1px solid #3a3010",
                      }}>
                      ↑ Befördern
                    </button>
                  </div>
                ))}
                {Array.from({ length: Math.max(0, ligaSettings.taxi_spots - taxiSquad.length) }).map((_, i) => (
                  <div key={`empty-taxi-${i}`} className="flex-1 min-w-[100px] flex flex-col items-center p-2 rounded-xl"
                    style={{ background: "#1a1a08", border: "1px solid #2a2a10" }}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center"
                      style={{ border: "2px solid #2a2a10", background: "#0c0900" }}>
                      <span className="text-[9px] font-black" style={{ color: "#3a3010" }}>U21</span>
                    </div>
                    <p className="text-[7px] font-black text-center mt-1" style={{ color: "#3a3010" }}>Leer</p>
                  </div>
                ))}
              </div>
              {selectingTaxi && (
                <div className="mt-3 space-y-1 max-h-48 overflow-y-auto">
                  <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "#5a4020" }}>
                    Spieler auf Taxi Squad setzen (kann nicht aufgestellt werden)
                  </p>
                  {draftPicks.filter(p => !irPlayerIds.has(p.id)).map(p => (
                    <div key={p.id} onClick={() => moveToTaxi(p)}
                      className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all"
                      style={{ background: "#1a1a08", border: "1px solid #2a2a10" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "#c8b080"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "#2a2a10"}>
                      <img src={p.photo_url} className="w-7 h-7 rounded-full object-cover" alt=""
                        style={{ border: `1px solid ${POS_COLOR[p.position]}40` }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black truncate" style={{ color: "#c8b080" }}>{p.name}</p>
                        <p className="text-[7px]" style={{ color: "#5a4020" }}>{p.position} · {p.team_name}</p>
                      </div>
                      <span className="text-[8px] font-black" style={{ color: "#c8b080" }}>+ U21</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Spieler-Auswahl Panel (wenn Slot selektiert) */}
          {selectedSlot && (
            <div className="w-full max-w-md">
              {(() => {
                const neededPos = selectedSlot.type === "xi"
                  ? config?.layout[selectedSlot.index]?.position
                  : null;
                const count = selectorCandidates.filter(p => !neededPos || p.position === neededPos).length;
                return (
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {neededPos && (
                        <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
                          style={{ background: (POS_COLOR[neededPos] || "#c8b080") + "20", color: POS_COLOR[neededPos] || "#c8b080" }}>
                          {neededPos}
                        </span>
                      )}
                      <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
                        {neededPos ? `${neededPos} wählen` : "Bank-Spieler wählen"}
                        <span className="ml-1 normal-case font-normal" style={{ color: "#3a2a10" }}>
                          ({count} verfügbar)
                        </span>
                      </p>
                    </div>
                    <button onClick={() => setSelectedSlot(null)}
                      className="text-[9px] font-black px-2 py-1 rounded-lg"
                      style={{ background: "#1a1208", color: "#5a4020" }}>✕</button>
                  </div>
                );
              })()}
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {(() => {
                  const neededPos = selectedSlot.type === "xi"
                    ? config?.layout[selectedSlot.index]?.position
                    : null;
                  const filtered = selectorCandidates.filter(p =>
                    !neededPos || p.position === neededPos
                  );
                  if (filtered.length === 0) return (
                    <p className="text-center text-[9px] py-4 font-black uppercase" style={{ color: "#2a2010" }}>
                      Keine {neededPos || ""}-Spieler verfügbar
                    </p>
                  );
                  return filtered.map(p => {
                    const posColor = POS_COLOR[p.position];
                    const status   = playerStatus(p.id);
                    return (
                      <div key={p.id} onClick={() => assignPlayer(p)}
                        className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all"
                        style={{ background: "#141008", border: "1px solid #2a2010" }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "#f5a623"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "#2a2010"}>
                        <div className="relative flex-shrink-0">
                          <img src={p.photo_url} className="w-8 h-8 rounded-full object-cover"
                            style={{ border: `1px solid ${posColor}40` }} alt="" />
                          {p.api_team_id && (
                            <img src={`https://media.api-sports.io/football/teams/${p.api_team_id}.png`}
                              className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full object-contain"
                              style={{ background: "#141008", border: "1px solid #2a2010" }} alt="" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-xs truncate" style={{ color: "#c8b080" }}>{p.name}</p>
                          <p className="text-[8px] truncate" style={{ color: "#5a4020" }}>{p.team_name}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="text-right">
                            <p className="text-xs font-black" style={{ color: "#f5a623" }}>{p.fpts?.toFixed(0)}</p>
                            <span className="text-[7px] font-black px-1 rounded"
                              style={{ background: posColor + "20", color: posColor }}>{p.position}</span>
                          </div>
                          {status && (
                            <span className="text-[7px] font-black px-1.5 py-0.5 rounded"
                              style={{
                                background: status === "XI" ? "#00ce7d20" : "#4a9eff20",
                                color: status === "XI" ? "#00ce7d" : "#4a9eff",
                              }}>{status}</span>
                          )}
                          <button onClick={e => {
                            e.stopPropagation();
                            setSelectedSlot(null);
                            setModalData({ player: p, slotType: "none", slotIndex: -1 });
                          }}
                            className="text-[8px] font-black px-1.5 py-1 rounded"
                            style={{ background: "#2a2010", color: "#5a4020" }}>↗</button>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════
          TAB: KADER
      ════════════════════════════════ */}
      {activeTab === "squad" && (
        <div className="w-full max-w-md">
          {/* Sort-Buttons */}
          <div className="flex gap-1.5 flex-wrap mb-3">
            {([
              ["fpts",     "FPTS"],
              ["position", "Position"],
              ["name",     "Name"],
              ["club",     "Verein"],
            ] as const).map(([key, label]) => (
              <button key={key} onClick={() => setSquadSort(key)}
                className="px-3 py-1.5 rounded-lg text-[9px] font-black transition-all"
                style={{
                  background: squadSort === key ? "#f5a623" : "#141008",
                  color: squadSort === key ? "#0c0900" : "#5a4020",
                  border: `1px solid ${squadSort === key ? "#f5a623" : "#2a2010"}`,
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* Kader-Stats */}
          <div className="flex gap-2 mb-3">
            {[
              { label: "Gesamt", value: draftPicks.length + taxiSquad.length },
              { label: "XI",     value: startingXI.filter(Boolean).length },
              { label: "Bank",   value: bench.length },
              { label: "IR",     value: irSlots.length },
              ...(taxiSquad.length > 0 || (ligaSettings?.taxi_spots || 0) > 0
                ? [{ label: "Taxi", value: taxiSquad.length }]
                : []),
            ].map(item => (
              <div key={item.label} className="flex-1 rounded-xl p-2 text-center"
                style={{ background: "#141008", border: "1px solid #2a2010" }}>
                <p className="text-sm font-black" style={{ color: "#f5a623" }}>{item.value}</p>
                <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>{item.label}</p>
              </div>
            ))}
          </div>

          {/* Spieler-Liste */}
          {(() => {
            const inXI    = new Set(startingXI.filter(Boolean).map(p => p!.id));
            const inBench = new Set(bench.map(p => p.id));
            const inIR    = new Set(irSlots.map(s => s.player_id));
            const inTaxi  = new Set(taxiSquad.map(p => p.id));

            const allPlayers = [...draftPicks, ...taxiSquad];
            const sorted = [...allPlayers].sort((a, b) => {
              if (squadSort === "fpts")     return (b.fpts || 0) - (a.fpts || 0);
              if (squadSort === "position") {
                const ord: Record<string, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };
                return (ord[a.position] ?? 9) - (ord[b.position] ?? 9);
              }
              if (squadSort === "name")    return a.name.localeCompare(b.name);
              if (squadSort === "club")    return (a.team_name || "").localeCompare(b.team_name || "");
              return 0;
            });

            return (
              <div className="space-y-1.5">
                {sorted.map(p => {
                  const posColor = POS_COLOR[p.position] || "#c8b080";
                  const status   = inXI.has(p.id) ? "XI" : inBench.has(p.id) ? "Bank" : inIR.has(p.id) ? "IR" : inTaxi.has(p.id) ? "Taxi" : "—";
                  const gwPts    = gwPoints[p.id];
                  const isCap    = captainId === p.id;
                  const isVC     = viceCaptainId === p.id;

                  return (
                    <div key={p.id}
                      onClick={() => setModalData({ player: p, slotType: "none", slotIndex: -1 })}
                      className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all"
                      style={{ background: "#141008", border: "1px solid #2a2010" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "#f5a623"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "#2a2010"}>
                      <div className="relative flex-shrink-0">
                        {p.photo_url ? (
                          <img src={p.photo_url} className="w-10 h-10 rounded-full object-cover"
                            style={{ border: `2px solid ${posColor}40` }} alt="" />
                        ) : (
                          <div className="w-10 h-10 rounded-full flex items-center justify-center"
                            style={{ border: `2px solid ${posColor}40`, background: "#0c0900" }}>
                            <span className="text-xs font-black" style={{ color: posColor }}>{p.position}</span>
                          </div>
                        )}
                        {p.api_team_id && (
                          <img src={`https://media.api-sports.io/football/teams/${p.api_team_id}.png`}
                            className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full object-contain"
                            style={{ background: "#141008", border: "1px solid #2a2010" }} alt="" />
                        )}
                        {isCap && (
                          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[7px] font-black flex items-center justify-center"
                            style={{ background: "#f5a623", color: "#0c0900" }}>C</span>
                        )}
                        {isVC && !isCap && (
                          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[7px] font-black flex items-center justify-center"
                            style={{ background: "#5a4020", color: "#f5a623" }}>V</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-xs truncate" style={{ color: "#c8b080" }}>{p.name}</p>
                        <p className="text-[8px] truncate" style={{ color: "#5a4020" }}>{p.team_name}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="text-right">
                          <p className="text-xs font-black" style={{ color: "#f5a623" }}>{p.fpts?.toFixed(1)}</p>
                          {gwPts !== undefined && (
                            <p className="text-[7px] font-black" style={{ color: "#00ce7d" }}>GW {gwPts}pts</p>
                          )}
                        </div>
                        <span className="text-[7px] font-black px-1.5 py-0.5 rounded"
                          style={{ background: posColor + "20", color: posColor }}>{p.position}</span>
                        <span className="text-[7px] font-black px-1.5 py-0.5 rounded"
                          style={{
                            background: status === "XI" ? "#00ce7d20" : status === "Bank" ? "#4a9eff20" : status === "IR" ? "#ff4d6d20" : status === "Taxi" ? "#c8b08020" : "#2a2010",
                            color:      status === "XI" ? "#00ce7d"   : status === "Bank" ? "#4a9eff"   : status === "IR" ? "#ff4d6d"   : status === "Taxi" ? "#c8b080"   : "#5a4020",
                          }}>
                          {status}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {sorted.length === 0 && (
                  <p className="text-center text-[9px] py-6 font-black uppercase" style={{ color: "#2a2010" }}>
                    Kein Spieler im Kader
                  </p>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ════════════════════════════════
          TAB: SPIELTAG
      ════════════════════════════════ */}
      {activeTab === "matches" && (
        <div className="w-full max-w-md space-y-2">
          {gameweeks.length === 0 ? (
            <div className="rounded-xl p-4 text-center" style={{ background: "#141008", border: "1px solid #2a2010" }}>
              <p className="text-[9px] font-black uppercase" style={{ color: "#5a4020" }}>
                Noch keine Spieltage angelegt
              </p>
            </div>
          ) : (
            gameweeks.map((gw: any) => {
              const isActive  = gw.status === "active";
              const isPast    = gw.status === "finished";
              const isSelected = activeGW === gw.gameweek;
              const activeLeagues: number[] = gw.active_leagues  || [];
              const doubleLeagues: number[] = gw.double_gw_leagues || [];

              return (
                <div key={gw.gameweek}
                  onClick={() => setActiveGW(gw.gameweek)}
                  className="rounded-xl p-3 cursor-pointer transition-all"
                  style={{
                    background: isActive ? "#1a1208" : "#141008",
                    border: `1px solid ${isActive ? "#f5a623" : isSelected ? "#3a2a10" : "#2a2010"}`,
                  }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black" style={{ color: isActive ? "#f5a623" : "#c8b080" }}>
                        Spieltag {gw.gameweek}
                      </span>
                      {isActive && (
                        <span className="text-[7px] font-black px-1.5 py-0.5 rounded-full"
                          style={{ background: "#f5a623", color: "#0c0900" }}>AKTIV</span>
                      )}
                      {isPast && (
                        <span className="text-[7px] font-black px-1.5 py-0.5 rounded-full"
                          style={{ background: "#1a2a1a", color: "#00ce7d" }}>✓ Abgeschlossen</span>
                      )}
                    </div>
                    {isSelected && (
                      <span className="text-[7px] font-black px-1.5 py-0.5 rounded"
                        style={{ background: "#2a2010", color: "#f5a623" }}>● Ausgewählt</span>
                    )}
                  </div>

                  {activeLeagues.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1">
                      {activeLeagues.map((lid: number) => (
                        <span key={lid}
                          className="text-[7px] font-black px-1.5 py-0.5 rounded"
                          style={{
                            background: doubleLeagues.includes(lid) ? "#2a1a08" : "#0c0900",
                            color: doubleLeagues.includes(lid) ? "#f5a623" : "#5a4020",
                            border: `1px solid ${doubleLeagues.includes(lid) ? "#f5a62340" : "#2a2010"}`,
                          }}>
                          {LEAGUE_NAMES[lid] || `Liga ${lid}`}
                          {doubleLeagues.includes(lid) && " ×2"}
                        </span>
                      ))}
                    </div>
                  )}

                  {gw.notes && (
                    <p className="text-[8px] mt-1" style={{ color: "#5a4020" }}>{gw.notes}</p>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ════════════════════════════════
          SPIELER-KARTE MODAL
      ════════════════════════════════ */}
      {modalData && (() => {
        const p        = modalData.player;
        const posColor = POS_COLOR[p.position] || "#c8b080";
        const isCap    = captainId === p.id;
        const isVC     = viceCaptainId === p.id;
        const gwPts    = gwPoints[p.id];
        const club     = clubAsset(p.team_name);
        const c1       = club?.colour1 || null;
        const heroBg   = c1
          ? `linear-gradient(160deg, ${c1}22 0%, ${posColor}12 50%, transparent 80%)`
          : `linear-gradient(160deg, ${posColor}18 0%, transparent 60%)`;
        const photoSrc  = tsdbPlayer?.cutout || tsdbPlayer?.render || p.photo_url || "/player-placeholder.png";
        const isCutout  = !!(tsdbPlayer?.cutout || tsdbPlayer?.render);
        const seasonPts = playerGameLog.reduce((s, g) => s + (g.points || 0), 0);
        const avgPts    = playerGameLog.length > 0 ? seasonPts / playerGameLog.length : 0;
        const formatD   = (d: string) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });

        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center"
            style={{ background: "rgba(0,0,0,0.85)" }}
            onClick={() => setModalData(null)}>
            <div className="w-full max-w-md rounded-t-3xl flex flex-col"
              style={{ background: "#0f0d08", maxHeight: "90vh" }}
              onClick={e => e.stopPropagation()}>

              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-0 flex-shrink-0">
                <div className="w-10 h-1 rounded-full" style={{ background: "#2a2010" }} />
              </div>

              {/* Hero */}
              <div className="relative flex gap-4 px-5 pt-2 pb-3 flex-shrink-0" style={{ background: heroBg }}>
                {club?.fanart1 && (
                  <div className="absolute inset-0 overflow-hidden opacity-5 pointer-events-none">
                    <img src={club.fanart1} alt="" className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="relative flex-shrink-0" style={{ width: 88, height: 88 }}>
                  <img src={photoSrc} alt={p.name}
                    className={`w-full h-full object-contain ${isCutout ? "" : "rounded-2xl"}`}
                    style={isCutout ? { filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.6))" } : { border: `2px solid ${posColor}60` }}
                  />
                  {/* Cap / VC badge */}
                  {isCap && (
                    <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full text-[9px] font-black flex items-center justify-center z-10"
                      style={{ background: "#f5a623", color: "#0c0900" }}>C</span>
                  )}
                  {isVC && !isCap && (
                    <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full text-[9px] font-black flex items-center justify-center z-10"
                      style={{ background: "#5a4020", color: "#f5a623" }}>V</span>
                  )}
                </div>
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {club?.badge && (
                      <img src={club.badge} alt={p.team_name} className="w-4 h-4 object-contain flex-shrink-0" />
                    )}
                    <p className="text-[8px] font-black uppercase tracking-widest truncate" style={{ color: c1 || "#5a4020" }}>
                      {p.team_name}
                    </p>
                  </div>
                  <p className="text-xl font-black leading-tight" style={{ color: "#f5f0e8" }}>{p.name}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-[8px] font-black px-2 py-0.5 rounded"
                      style={{ background: posColor, color: "#0c0900" }}>{p.position}</span>
                    <span className="text-sm font-black" style={{ color: "#f5a623" }}>
                      {p.fpts?.toFixed(1)}
                      <span className="text-[8px] ml-1" style={{ color: "#5a4020" }}>FPTS</span>
                    </span>
                    {gwPts !== undefined && (
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded"
                        style={{ background: "#001a0d", color: "#00ce7d", border: "1px solid #00ce7d30" }}>
                        GW{activeGW > 1 ? activeGW - 1 : activeGW}: {gwPts}pts
                      </span>
                    )}
                    {club?.kit && (
                      <img src={club.kit} alt="kit" className="h-5 object-contain opacity-70" />
                    )}
                  </div>
                </div>
                <button onClick={() => setModalData(null)}
                  className="absolute top-3 right-4 w-7 h-7 flex items-center justify-center rounded-full z-10"
                  style={{ background: "#1a1208", color: "#5a4020" }}>✕</button>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 px-5 pb-3 pt-2 flex-shrink-0"
                style={{ borderBottom: "1px solid #1a1208" }}>
                {modalData.slotType === "xi" && (
                  <>
                    <button onClick={() => { toggleCaptain(p.id); setModalData(null); }}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all"
                      style={{
                        background: isCap ? "#f5a623" : "#1a1208",
                        color: isCap ? "#0c0900" : "#f5a623",
                        border: `1px solid ${isCap ? "#f5a623" : "#f5a62340"}`,
                      }}>
                      {isCap ? "★ Kein Kapitän" : "★ Kapitän"}
                    </button>
                    <button onClick={() => { toggleVC(p.id); setModalData(null); }}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all"
                      style={{
                        background: isVC ? "#5a4020" : "#141008",
                        color: isVC ? "#f5a623" : "#5a4020",
                        border: `1px solid ${isVC ? "#5a4020" : "#2a2010"}`,
                      }}>
                      {isVC ? "V Kein Vize" : "V Vize-Kap."}
                    </button>
                  </>
                )}
                {modalData.slotType !== "none" && (
                  <>
                    <button onClick={() => {
                      setModalData(null);
                      setSelectedSlot({ type: modalData.slotType as "xi" | "bench", index: modalData.slotIndex });
                    }}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all"
                      style={{ background: "#141008", color: "#4a9eff", border: "1px solid #4a9eff40" }}>
                      ⇄ Tauschen
                    </button>
                    <button onClick={() => {
                      removeFromSlot(modalData.slotType as "xi" | "bench", modalData.slotIndex);
                      setModalData(null);
                    }}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all"
                      style={{ background: "#141008", color: "#c8b080", border: "1px solid #3a2a10" }}>
                      ← Herausnehmen
                    </button>
                  </>
                )}
                {/* Taxi Squad actions */}
                {(ligaSettings?.taxi_spots || 0) > 0 && (
                  taxiPlayerIds.has(p.id) ? (
                    <button onClick={() => promoteFromTaxi(p)}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all"
                      style={{ background: "#1a1a08", color: "#c8b080", border: "1px solid #c8b08040" }}>
                      ↑ Aus Taxi befördern
                    </button>
                  ) : (
                    <button onClick={() => moveToTaxi(p)}
                      disabled={taxiSquad.length >= (ligaSettings?.taxi_spots || 0)}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all disabled:opacity-40"
                      style={{ background: "#1a1a08", color: "#c8b080", border: "1px solid #c8b08040" }}>
                      → Taxi Squad
                    </button>
                  )
                )}
                <button onClick={() => dropPlayer(p.id)} disabled={dropping === p.id}
                  className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all disabled:opacity-50"
                  style={{ background: "#1a0808", color: "#ff4d6d", border: "1px solid #ff4d6d40" }}>
                  {dropping === p.id ? "..." : "✕ Aus Kader"}
                </button>
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
                          <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "#2a2010" }}>Saison-Statistiken</p>
                          <div className="grid grid-cols-2 gap-y-2">
                            {[
                              ["Schüsse aufs Tor", playerGameLog.reduce((s,g)=>s+(g.shots_on||0),0)],
                              ["Key Passes", playerGameLog.reduce((s,g)=>s+(g.key_passes||0),0)],
                              ["Tackles", playerGameLog.reduce((s,g)=>s+(g.tackles||0),0)],
                              ["Abfangen", playerGameLog.reduce((s,g)=>s+(g.interceptions||0),0)],
                              ["Gelbe Karten", playerGameLog.reduce((s,g)=>s+(g.yellow_cards||0),0)],
                              ["Rote Karten", playerGameLog.reduce((s,g)=>s+(g.red_cards||0),0)],
                              ...(p.position === "GK" ? [["Paraden", playerGameLog.reduce((s,g)=>s+(g.saves||0),0)]] : []),
                              ["Clean Sheets", playerGameLog.filter(g=>g.clean_sheet).length],
                            ].map(([label, val]) => (
                              <div key={String(label)} className="flex items-center justify-between">
                                <span className="text-[9px]" style={{ color: "#5a4020" }}>{label}</span>
                                <span className="text-sm font-black" style={{ color: "#c8b080" }}>{val}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* Cards highlight */}
                        {((p.yellow_cards || 0) > 0 || (p.red_cards || 0) > 0) && (
                          <div className="flex gap-2">
                            {(p.yellow_cards || 0) > 0 && (
                              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                                style={{ background: "#2a2000", border: "1px solid #f5a62340" }}>
                                <div className="w-3 h-4 rounded-sm" style={{ background: "#f5a623" }} />
                                <span className="text-[9px] font-black" style={{ color: "#f5a623" }}>{p.yellow_cards}× Gelb</span>
                              </div>
                            )}
                            {(p.red_cards || 0) > 0 && (
                              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                                style={{ background: "#2a0000", border: "1px solid #ff4d6d40" }}>
                                <div className="w-3 h-4 rounded-sm" style={{ background: "#ff4d6d" }} />
                                <span className="text-[9px] font-black" style={{ color: "#ff4d6d" }}>{p.red_cards}× Rot</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

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
                              {[["TOR", g.goals||0],["ASS",g.assists||0],["MIN",g.minutes||0],["CS",g.clean_sheet?"✓":"—"],["KP",g.key_passes||0]].map(([l,v])=>(
                                <div key={String(l)} className="text-center">
                                  <p className="text-[7px] uppercase" style={{ color: "#2a2010" }}>{l}</p>
                                  <p className="text-xs font-black" style={{ color: "#c8b080" }}>{v}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {playerTab === "history" && (
                      <div className="p-4">
                        {playerHistory.length === 0 ? (
                          <p className="text-center py-10 text-[9px] font-black uppercase tracking-widest" style={{ color: "#2a2010" }}>Keine Historie vorhanden</p>
                        ) : (
                          <div className="relative pl-5">
                            <div className="absolute left-2 top-2 bottom-2 w-px" style={{ background: "#2a2010" }} />
                            {playerHistory.map((h, i) => {
                              const hColor = { draft: "#f5a623", transfer_in: "#00ce7d", transfer_out: "#ff4d6d", trade: "#4a9eff" }[h.type as string] || "#c8b080";
                              const hIcon = { draft: "🏈", transfer_in: "▲", transfer_out: "▼", trade: "⇄" }[h.type as string] || "·";
                              return (
                                <div key={i} className="relative mb-3">
                                  <div className="absolute -left-3 top-3 w-2.5 h-2.5 rounded-full" style={{ background: hColor }} />
                                  <div className="p-3 rounded-xl ml-2" style={{ background: "#141008", border: `1px solid ${hColor}25` }}>
                                    <div className="flex items-center justify-between mb-0.5">
                                      <span className="text-[9px] font-black uppercase" style={{ color: hColor }}>{hIcon} {h.detail}</span>
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

                    {playerTab === "news" && (
                      <div className="p-4 space-y-2">
                        {playerNewsLoading ? (
                          <p className="text-center py-10 text-[9px] font-black uppercase tracking-widest animate-pulse" style={{ color: "#2a2010" }}>Lade News...</p>
                        ) : playerNews.length === 0 ? (
                          <p className="text-center py-10 text-[9px] font-black uppercase tracking-widest" style={{ color: "#2a2010" }}>Keine News gefunden</p>
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
