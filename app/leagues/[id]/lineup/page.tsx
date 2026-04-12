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
  GK: "var(--color-primary)",
  DF: "var(--color-info)",
  MF: "var(--color-success)",
  FW: "var(--color-error)",
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
      style={{ background: "var(--bg-page)", color: "var(--color-border)" }}>
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
    <main className="flex min-h-screen flex-col items-center p-4 pb-24" style={{ background: "var(--bg-page)", paddingTop: 80 }}>
      <LeagueTopNav
        leagueId={leagueId}
        leagueName={league?.name}
        leagueStatus={league?.status}
        isOwner={league?.owner_id === user?.id}
      />
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "var(--color-primary)" }} />

      {/* ── Header ── */}
      <div className="w-full max-w-md flex justify-between items-center mb-4">
        <button onClick={() => window.location.href = `/leagues/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          ← Liga
        </button>
        <div className="text-center">
          <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            {league?.name}
          </p>
          <p className="text-sm font-black" style={{ color: "var(--color-primary)" }}>
            {myTeam?.name || "Mein Team"}
          </p>
        </div>
        <button onClick={saveLineup} disabled={saving || activeTab !== "lineup" || isLocked}
          className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-40 transition-all"
          style={{
            background: isLocked ? "var(--bg-elevated)" : saved ? "var(--color-success)" : activeTab === "lineup" ? "var(--color-primary)" : "var(--bg-elevated)",
            color: isLocked ? "var(--color-muted)" : "var(--bg-page)",
          }}>
          {isLocked ? "🔒" : saving ? "..." : saved ? "✓" : "Speichern"}
        </button>
      </div>

      {/* ── Tab-Navigation ── */}
      <div className="flex w-full max-w-md mb-4 rounded-xl overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
        {([
          { id: "lineup",  label: "Aufstellung" },
          { id: "squad",   label: "Kader" },
          { id: "matches", label: "Spieltag" },
        ] as const).map(tab => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id); setSelectedSlot(null); setSelectingIR(false); setSelectingTaxi(false); }}
            className="flex-1 py-2.5 text-[9px] font-black uppercase tracking-widest transition-all"
            style={{
              background: activeTab === tab.id ? "var(--color-primary)" : "var(--bg-card)",
              color: activeTab === tab.id ? "var(--bg-page)" : "var(--color-muted)",
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Squad-Warnungen (immer sichtbar) ── */}
      {squadWarnings.length > 0 && (
        <div className="w-full max-w-md mb-4 rounded-xl overflow-hidden" style={{ border: "1px solid var(--color-error)" }}>
          <div className="px-3 py-2 flex items-center gap-2" style={{ background: "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))" }}>
            <span className="text-sm">⚠️</span>
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-error)" }}>
              Kader-Problem
            </p>
          </div>
          {squadWarnings.map((w, i) => (
            <div key={i} className="px-3 py-2 flex items-start gap-2"
              style={{ background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))", borderTop: "1px solid #3a1010" }}>
              <span className="text-[9px] font-black flex-shrink-0"
                style={{ color: w.type === "overflow" ? "var(--color-error)" : "var(--color-primary)" }}>
                {w.type === "overflow" ? "● Überfüllt" : "● Position"}
              </span>
              <p className="text-[9px] leading-relaxed" style={{ color: "var(--color-text)" }}>{w.message}</p>
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
                background: activeGW === gw.gameweek ? "var(--color-primary)" : "var(--bg-card)",
                color: activeGW === gw.gameweek ? "var(--bg-page)" : "var(--color-muted)",
                border: `1px solid ${activeGW === gw.gameweek ? "var(--color-primary)" : gw.status === "active" ? "var(--color-border-subtle)" : "var(--color-border)"}`,
              }}>
              GW{gw.gameweek}
            </button>
          ))}
        </div>
      )}
      {gameweeks.length === 0 && (
        <div className="w-full max-w-md rounded-xl p-3 mb-4 text-center"
          style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
          <p className="text-[9px] font-black uppercase" style={{ color: "var(--color-muted)" }}>Noch keine Spieltage angelegt</p>
          <p className="text-[8px] mt-1" style={{ color: "var(--color-border)" }}>Liga-Owner kann Spieltage im Admin anlegen</p>
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
                style={{ background: "color-mix(in srgb, var(--color-success) 8%, var(--bg-page))", border: "1px solid var(--color-primary)50" }}>
                <span className="text-base">⚡</span>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-primary)" }}>
                    Live-Tausch aktiv
                  </p>
                  <p className="text-[8px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                    Tausche Starter die noch nicht gespielt haben. Bereits gespielte Spieler sind gesperrt.
                  </p>
                </div>
              </div>
            );
            if (lockMode === "pre_sub" && activeGWStatus === "upcoming") return (
              <div className="w-full max-w-md mb-3 rounded-xl px-3 py-2.5 flex items-center gap-2"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-info)40" }}>
                <span className="text-base">🔄</span>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-info)" }}>
                    Auto-Sub Modus
                  </p>
                  <p className="text-[8px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                    Bankreihenfolge = Auto-Sub Priorität. Stelle sicher dass die Bank richtig sortiert ist.
                  </p>
                </div>
              </div>
            );
            if (isLocked && activeGWStatus === "finished") return (
              <div className="w-full max-w-md mb-3 rounded-xl px-3 py-2.5 flex items-center gap-2"
                style={{ background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))", border: "1px solid var(--color-success)40" }}>
                <span className="text-base">✅</span>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-success)" }}>
                    Spieltag abgeschlossen
                  </p>
                  <p className="text-[8px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                    Punkte berechnet. Auto-Subs wurden angewendet.
                  </p>
                </div>
              </div>
            );
            if (isLocked) return (
              <div className="w-full max-w-md mb-3 rounded-xl px-3 py-2.5 flex items-center gap-2"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-primary)40" }}>
                <span className="text-base">🔒</span>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-primary)" }}>
                    {lockMode === "pre_sub" ? "Live — Auto-Sub läuft" : "Live — Aufstellung gesperrt"}
                  </p>
                  <p className="text-[8px] mt-0.5" style={{ color: "var(--color-muted)" }}>
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
            <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              GW{activeGW} · {startingXI.filter(Boolean).length}/11
            </p>
            <p className="text-sm font-black" style={{ color: "var(--color-primary)" }}>
              {xiPoints.toFixed(1)} <span className="text-[9px]" style={{ color: "var(--color-muted)" }}>FPTS (Vorschau)</span>
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
                    background: formation === f ? "var(--color-primary)" : "var(--bg-card)",
                    color: formation === f ? "var(--bg-page)" : "var(--color-muted)",
                    border: `1px solid ${formation === f ? "var(--color-primary)" : "var(--color-border)"}`,
                  }}>
                  {f}
                </button>
              )
            ))}
          </div>

          {/* Spielfeld */}
          <div className="w-full max-w-md rounded-2xl overflow-hidden mb-4"
            style={{ background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))", border: "1px solid #1a2a1a", minHeight: 340 }}>
            <div className="relative p-3"
              style={{ background: "linear-gradient(180deg, #0a1a0a 0%, #081408 100%)" }}>
              <div className="absolute left-3 right-3 top-1/2 h-px opacity-20" style={{ background: "var(--color-success)" }} />
              <div className="absolute left-1/2 top-1/2 w-16 h-16 rounded-full border opacity-10 -translate-x-1/2 -translate-y-1/2"
                style={{ borderColor: "var(--color-success)" }} />

              {rows.map(({ row, slots }) => (
                <div key={row} className="flex justify-center gap-2 mb-3">
                  {slots.map(({ position, slotIndex }) => {
                    const player = startingXI[slotIndex];
                    const isSelected = selectedSlot?.type === "xi" && selectedSlot.index === slotIndex;
                    const posColor = POS_COLOR[position] || "var(--color-text)";
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
                          style={{ color: player ? "var(--color-text)" : "var(--color-border)" }}>
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
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                    Bank · {bench.filter(Boolean).length}/{benchSize}
                  </p>
                  {bench.length > benchSize && (
                    <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full"
                      style={{ background: "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))", color: "var(--color-error)", border: "1px solid var(--color-error)40" }}>
                      +{bench.length - benchSize} überschuss
                    </span>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  {Array.from({ length: displayCount }).map((_, i) => {
                    const player = bench[i];
                    const isSelected = selectedSlot?.type === "bench" && selectedSlot.index === i;
                    const isOverflow = i >= benchSize;
                    const posColor = player ? (POS_COLOR[player.position] || "var(--color-text)") : "var(--color-border)";
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
                          background: isOverflow ? "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))" : isSelected ? "var(--bg-elevated)" : "var(--bg-card)",
                          border: `1px solid ${isOverflow ? "var(--color-error)40" : isSelected ? "var(--color-primary)" : "var(--color-border)"}`,
                        }}>
                        <PlayerCircle
                          player={player} size={36} posColor={isOverflow ? "var(--color-error)" : posColor}
                          selected={isSelected} posLabel={String(i + 1)}
                        />
                        {isOverflow && player && (
                          <span className="text-[6px] font-black mt-0.5" style={{ color: "var(--color-error)" }}>!</span>
                        )}
                        <p className="text-[7px] font-black text-center mt-0.5 truncate w-full leading-tight"
                          style={{ color: isOverflow ? "var(--color-error)" : player ? "var(--color-text)" : "var(--color-border)" }}>
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
                    style={{ background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))", border: "1px solid var(--color-error)", color: "var(--color-error)" }}>IR</span>
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                    Injured Reserve · min. {ligaSettings.ir_min_gameweeks || 4} GWs
                  </p>
                </div>
                {irSlots.length < ligaSettings.ir_spots && (
                  <button
                    onClick={() => { setSelectingIR(v => !v); setSelectedSlot(null); }}
                    className="text-[8px] font-black px-2 py-1 rounded-lg transition-all"
                    style={{
                      background: selectingIR ? "var(--color-error)" : "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))",
                      color: selectingIR ? "var(--bg-page)" : "var(--color-error)",
                      border: "1px solid var(--color-error)",
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
                      style={{ background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))", border: `1px solid ${canReturn ? "var(--color-error)40" : "color-mix(in srgb, var(--color-error) 20%, var(--bg-page))"}` }}>
                      {slot.player?.photo_url ? (
                        <img src={slot.player.photo_url} className="w-9 h-9 rounded-full object-cover"
                          style={{ border: `2px solid ${canReturn ? "var(--color-error)60" : "var(--color-error)20"}` }} alt="" />
                      ) : (
                        <div className="w-9 h-9 rounded-full flex items-center justify-center"
                          style={{ border: "2px solid #3a1010", background: "var(--bg-page)" }}>
                          <span className="text-[10px] font-black" style={{ color: "var(--color-error)" }}>IR</span>
                        </div>
                      )}
                      <p className="text-[7px] font-black text-center mt-1 truncate w-full leading-tight"
                        style={{ color: "var(--color-text)" }}>
                        {slot.player?.name.split(" ").pop() || "—"}
                      </p>
                      <p className="text-[7px] font-black text-center"
                        style={{ color: canReturn ? "var(--color-error)" : "var(--color-muted)" }}>
                        {canReturn ? "✓ Bereit" : `noch ${gwsLeft} GW${gwsLeft !== 1 ? "s" : ""}`}
                      </p>
                      <button onClick={() => returnFromIR(slot)}
                        className="text-[7px] font-black mt-1 px-1.5 py-0.5 rounded transition-all"
                        style={{
                          background: canReturn ? "color-mix(in srgb, var(--color-error) 20%, var(--bg-page))" : "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))",
                          color: canReturn ? "var(--color-error)" : "color-mix(in srgb, var(--color-error) 20%, var(--bg-page))",
                          border: `1px solid ${canReturn ? "var(--color-error)" : "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))"}`,
                          cursor: canReturn ? "pointer" : "not-allowed",
                        }}>
                        Zurück
                      </button>
                    </div>
                  );
                })}
                {Array.from({ length: ligaSettings.ir_spots - irSlots.length }).map((_, i) => (
                  <div key={`empty-${i}`} className="flex-1 min-w-[100px] flex flex-col items-center p-2 rounded-xl"
                    style={{ background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))", border: "1px solid #2a1010" }}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center"
                      style={{ border: "2px solid #2a1010", background: "var(--bg-page)" }}>
                      <span className="text-[10px] font-black" style={{ color: "color-mix(in srgb, var(--color-error) 20%, var(--bg-page))" }}>IR</span>
                    </div>
                    <p className="text-[7px] font-black text-center mt-1" style={{ color: "color-mix(in srgb, var(--color-error) 20%, var(--bg-page))" }}>Leer</p>
                  </div>
                ))}
              </div>
              {selectingIR && (
                <div className="mt-3 space-y-1 max-h-48 overflow-y-auto">
                  <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-error)" }}>
                    Spieler auf IR setzen (mind. {ligaSettings.ir_min_gameweeks || 4} GWs gesperrt)
                  </p>
                  {draftPicks.filter(p => !irSlots.find(s => s.player_id === p.id)).map(p => (
                    <div key={p.id} onClick={() => placeOnIR(p)}
                      className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all"
                      style={{ background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))", border: "1px solid #2a1010" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--color-error)"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))"}>
                      <img src={p.photo_url} className="w-7 h-7 rounded-full object-cover" alt=""
                        style={{ border: `1px solid ${POS_COLOR[p.position]}40` }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black truncate" style={{ color: "var(--color-text)" }}>{p.name}</p>
                        <p className="text-[7px]" style={{ color: "var(--color-muted)" }}>{p.position} · {p.team_name}</p>
                      </div>
                      <span className="text-[8px] font-black" style={{ color: "var(--color-error)" }}>+ IR</span>
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
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-text)", color: "var(--color-text)" }}>U21</span>
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                    Taxi Squad · {taxiSquad.length}/{ligaSettings.taxi_spots}
                  </p>
                </div>
                {taxiSquad.length < ligaSettings.taxi_spots && (
                  <button
                    onClick={() => { setSelectingTaxi(v => !v); setSelectedSlot(null); setSelectingIR(false); }}
                    className="text-[8px] font-black px-2 py-1 rounded-lg transition-all"
                    style={{
                      background: selectingTaxi ? "var(--color-text)" : "var(--bg-elevated)",
                      color: selectingTaxi ? "var(--bg-page)" : "var(--color-text)",
                      border: "1px solid var(--color-text)",
                    }}>
                    {selectingTaxi ? "Abbrechen" : "+ Spieler"}
                  </button>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                {taxiSquad.map((player) => (
                  <div key={player.id} className="flex-1 min-w-[100px] flex flex-col items-center p-2 rounded-xl"
                    style={{ background: "var(--bg-elevated)", border: "1px solid #3a3010" }}>
                    {player.photo_url ? (
                      <img src={player.photo_url} className="w-9 h-9 rounded-full object-cover"
                        style={{ border: "2px solid var(--color-text)40" }} alt="" />
                    ) : (
                      <div className="w-9 h-9 rounded-full flex items-center justify-center"
                        style={{ border: "2px solid #3a3010", background: "var(--bg-page)" }}>
                        <span className="text-[8px] font-black" style={{ color: "var(--color-text)" }}>
                          {player.position}
                        </span>
                      </div>
                    )}
                    <p className="text-[7px] font-black text-center mt-1 truncate w-full leading-tight"
                      style={{ color: "var(--color-text)" }}>
                      {player.name.split(" ").pop() || "—"}
                    </p>
                    <p className="text-[7px] text-center" style={{ color: "var(--color-muted)" }}>
                      {player.fpts?.toFixed(0)} pts
                    </p>
                    <button onClick={() => promoteFromTaxi(player)}
                      className="text-[7px] font-black mt-1 px-1.5 py-0.5 rounded transition-all"
                      style={{
                        background: "var(--color-border)",
                        color: "var(--color-primary)",
                        border: "1px solid #3a3010",
                      }}>
                      ↑ Befördern
                    </button>
                  </div>
                ))}
                {Array.from({ length: Math.max(0, ligaSettings.taxi_spots - taxiSquad.length) }).map((_, i) => (
                  <div key={`empty-taxi-${i}`} className="flex-1 min-w-[100px] flex flex-col items-center p-2 rounded-xl"
                    style={{ background: "var(--bg-elevated)", border: "1px solid #2a2a10" }}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center"
                      style={{ border: "2px solid #2a2a10", background: "var(--bg-page)" }}>
                      <span className="text-[9px] font-black" style={{ color: "var(--color-muted)" }}>U21</span>
                    </div>
                    <p className="text-[7px] font-black text-center mt-1" style={{ color: "var(--color-muted)" }}>Leer</p>
                  </div>
                ))}
              </div>
              {selectingTaxi && (
                <div className="mt-3 space-y-1 max-h-48 overflow-y-auto">
                  <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
                    Spieler auf Taxi Squad setzen (kann nicht aufgestellt werden)
                  </p>
                  {draftPicks.filter(p => !irPlayerIds.has(p.id)).map(p => (
                    <div key={p.id} onClick={() => moveToTaxi(p)}
                      className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all"
                      style={{ background: "var(--bg-elevated)", border: "1px solid #2a2a10" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--color-text)"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border)"}>
                      <img src={p.photo_url} className="w-7 h-7 rounded-full object-cover" alt=""
                        style={{ border: `1px solid ${POS_COLOR[p.position]}40` }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black truncate" style={{ color: "var(--color-text)" }}>{p.name}</p>
                        <p className="text-[7px]" style={{ color: "var(--color-muted)" }}>{p.position} · {p.team_name}</p>
                      </div>
                      <span className="text-[8px] font-black" style={{ color: "var(--color-text)" }}>+ U21</span>
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
                          style={{ background: (POS_COLOR[neededPos] || "var(--color-text)") + "20", color: POS_COLOR[neededPos] || "var(--color-text)" }}>
                          {neededPos}
                        </span>
                      )}
                      <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                        {neededPos ? `${neededPos} wählen` : "Bank-Spieler wählen"}
                        <span className="ml-1 normal-case font-normal" style={{ color: "var(--color-border-subtle)" }}>
                          ({count} verfügbar)
                        </span>
                      </p>
                    </div>
                    <button onClick={() => setSelectedSlot(null)}
                      className="text-[9px] font-black px-2 py-1 rounded-lg"
                      style={{ background: "var(--bg-elevated)", color: "var(--color-muted)" }}>✕</button>
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
                    <p className="text-center text-[9px] py-4 font-black uppercase" style={{ color: "var(--color-border)" }}>
                      Keine {neededPos || ""}-Spieler verfügbar
                    </p>
                  );
                  return filtered.map(p => {
                    const posColor = POS_COLOR[p.position];
                    const status   = playerStatus(p.id);
                    return (
                      <div key={p.id} onClick={() => assignPlayer(p)}
                        className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all"
                        style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--color-primary)"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border)"}>
                        <div className="relative flex-shrink-0">
                          <img src={p.photo_url} className="w-8 h-8 rounded-full object-cover"
                            style={{ border: `1px solid ${posColor}40` }} alt="" />
                          {p.api_team_id && (
                            <img src={`https://media.api-sports.io/football/teams/${p.api_team_id}.png`}
                              className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full object-contain"
                              style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }} alt="" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-xs truncate" style={{ color: "var(--color-text)" }}>{p.name}</p>
                          <p className="text-[8px] truncate" style={{ color: "var(--color-muted)" }}>{p.team_name}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="text-right">
                            <p className="text-xs font-black" style={{ color: "var(--color-primary)" }}>{p.fpts?.toFixed(0)}</p>
                            <span className="text-[7px] font-black px-1 rounded"
                              style={{ background: posColor + "20", color: posColor }}>{p.position}</span>
                          </div>
                          {status && (
                            <span className="text-[7px] font-black px-1.5 py-0.5 rounded"
                              style={{
                                background: status === "XI" ? "var(--color-success)20" : "var(--color-info)20",
                                color: status === "XI" ? "var(--color-success)" : "var(--color-info)",
                              }}>{status}</span>
                          )}
                          <button onClick={e => {
                            e.stopPropagation();
                            setSelectedSlot(null);
                            setModalData({ player: p, slotType: "none", slotIndex: -1 });
                          }}
                            className="text-[8px] font-black px-1.5 py-1 rounded"
                            style={{ background: "var(--color-border)", color: "var(--color-muted)" }}>↗</button>
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
                  background: squadSort === key ? "var(--color-primary)" : "var(--bg-card)",
                  color: squadSort === key ? "var(--bg-page)" : "var(--color-muted)",
                  border: `1px solid ${squadSort === key ? "var(--color-primary)" : "var(--color-border)"}`,
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
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <p className="text-sm font-black" style={{ color: "var(--color-primary)" }}>{item.value}</p>
                <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>{item.label}</p>
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
                  const posColor = POS_COLOR[p.position] || "var(--color-text)";
                  const status   = inXI.has(p.id) ? "XI" : inBench.has(p.id) ? "Bank" : inIR.has(p.id) ? "IR" : inTaxi.has(p.id) ? "Taxi" : "—";
                  const gwPts    = gwPoints[p.id];
                  const isCap    = captainId === p.id;
                  const isVC     = viceCaptainId === p.id;

                  return (
                    <div key={p.id}
                      onClick={() => setModalData({ player: p, slotType: "none", slotIndex: -1 })}
                      className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all"
                      style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--color-primary)"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border)"}>
                      <div className="relative flex-shrink-0">
                        {p.photo_url ? (
                          <img src={p.photo_url} className="w-10 h-10 rounded-full object-cover"
                            style={{ border: `2px solid ${posColor}40` }} alt="" />
                        ) : (
                          <div className="w-10 h-10 rounded-full flex items-center justify-center"
                            style={{ border: `2px solid ${posColor}40`, background: "var(--bg-page)" }}>
                            <span className="text-xs font-black" style={{ color: posColor }}>{p.position}</span>
                          </div>
                        )}
                        {p.api_team_id && (
                          <img src={`https://media.api-sports.io/football/teams/${p.api_team_id}.png`}
                            className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full object-contain"
                            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }} alt="" />
                        )}
                        {isCap && (
                          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[7px] font-black flex items-center justify-center"
                            style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>C</span>
                        )}
                        {isVC && !isCap && (
                          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[7px] font-black flex items-center justify-center"
                            style={{ background: "var(--color-muted)", color: "var(--color-primary)" }}>V</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-xs truncate" style={{ color: "var(--color-text)" }}>{p.name}</p>
                        <p className="text-[8px] truncate" style={{ color: "var(--color-muted)" }}>{p.team_name}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="text-right">
                          <p className="text-xs font-black" style={{ color: "var(--color-primary)" }}>{p.fpts?.toFixed(1)}</p>
                          {gwPts !== undefined && (
                            <p className="text-[7px] font-black" style={{ color: "var(--color-success)" }}>GW {gwPts}pts</p>
                          )}
                        </div>
                        <span className="text-[7px] font-black px-1.5 py-0.5 rounded"
                          style={{ background: posColor + "20", color: posColor }}>{p.position}</span>
                        <span className="text-[7px] font-black px-1.5 py-0.5 rounded"
                          style={{
                            background: status === "XI" ? "var(--color-success)20" : status === "Bank" ? "var(--color-info)20" : status === "IR" ? "var(--color-error)20" : status === "Taxi" ? "var(--color-text)20" : "var(--color-border)",
                            color:      status === "XI" ? "var(--color-success)"   : status === "Bank" ? "var(--color-info)"   : status === "IR" ? "var(--color-error)"   : status === "Taxi" ? "var(--color-text)"   : "var(--color-muted)",
                          }}>
                          {status}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {sorted.length === 0 && (
                  <p className="text-center text-[9px] py-6 font-black uppercase" style={{ color: "var(--color-border)" }}>
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
            <div className="rounded-xl p-4 text-center" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
              <p className="text-[9px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
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
                    background: isActive ? "var(--bg-elevated)" : "var(--bg-card)",
                    border: `1px solid ${isActive ? "var(--color-primary)" : isSelected ? "var(--color-border-subtle)" : "var(--color-border)"}`,
                  }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black" style={{ color: isActive ? "var(--color-primary)" : "var(--color-text)" }}>
                        Spieltag {gw.gameweek}
                      </span>
                      {isActive && (
                        <span className="text-[7px] font-black px-1.5 py-0.5 rounded-full"
                          style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>AKTIV</span>
                      )}
                      {isPast && (
                        <span className="text-[7px] font-black px-1.5 py-0.5 rounded-full"
                          style={{ background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))", color: "var(--color-success)" }}>✓ Abgeschlossen</span>
                      )}
                    </div>
                    {isSelected && (
                      <span className="text-[7px] font-black px-1.5 py-0.5 rounded"
                        style={{ background: "var(--color-border)", color: "var(--color-primary)" }}>● Ausgewählt</span>
                    )}
                  </div>

                  {activeLeagues.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1">
                      {activeLeagues.map((lid: number) => (
                        <span key={lid}
                          className="text-[7px] font-black px-1.5 py-0.5 rounded"
                          style={{
                            background: doubleLeagues.includes(lid) ? "color-mix(in srgb, var(--color-primary) 15%, var(--bg-page))" : "var(--bg-page)",
                            color: doubleLeagues.includes(lid) ? "var(--color-primary)" : "var(--color-muted)",
                            border: `1px solid ${doubleLeagues.includes(lid) ? "var(--color-primary)40" : "var(--color-border)"}`,
                          }}>
                          {LEAGUE_NAMES[lid] || `Liga ${lid}`}
                          {doubleLeagues.includes(lid) && " ×2"}
                        </span>
                      ))}
                    </div>
                  )}

                  {gw.notes && (
                    <p className="text-[8px] mt-1" style={{ color: "var(--color-muted)" }}>{gw.notes}</p>
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
        const posColor = POS_COLOR[p.position] || "var(--color-text)";
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
              style={{ background: "var(--bg-page)", maxHeight: "90vh" }}
              onClick={e => e.stopPropagation()}>

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
                  <img src={photoSrc} alt={p.name}
                    className={`w-full h-full object-contain ${isCutout ? "" : "rounded-2xl"}`}
                    style={isCutout ? { filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.6))" } : { border: `2px solid ${posColor}60` }}
                  />
                  {/* Cap / VC badge */}
                  {isCap && (
                    <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full text-[9px] font-black flex items-center justify-center z-10"
                      style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>C</span>
                  )}
                  {isVC && !isCap && (
                    <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full text-[9px] font-black flex items-center justify-center z-10"
                      style={{ background: "var(--color-muted)", color: "var(--color-primary)" }}>V</span>
                  )}
                </div>
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {club?.badge && (
                      <img src={club.badge} alt={p.team_name} className="w-4 h-4 object-contain flex-shrink-0" />
                    )}
                    <p className="text-[8px] font-black uppercase tracking-widest truncate" style={{ color: c1 || "var(--color-muted)" }}>
                      {p.team_name}
                    </p>
                  </div>
                  <p className="text-xl font-black leading-tight" style={{ color: "var(--color-text)" }}>{p.name}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-[8px] font-black px-2 py-0.5 rounded"
                      style={{ background: posColor, color: "var(--bg-page)" }}>{p.position}</span>
                    <span className="text-sm font-black" style={{ color: "var(--color-primary)" }}>
                      {p.fpts?.toFixed(1)}
                      <span className="text-[8px] ml-1" style={{ color: "var(--color-muted)" }}>FPTS</span>
                    </span>
                    {gwPts !== undefined && (
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded"
                        style={{ background: "color-mix(in srgb, var(--color-success) 12%, var(--bg-page))", color: "var(--color-success)", border: "1px solid var(--color-success)30" }}>
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
                  style={{ background: "var(--bg-elevated)", color: "var(--color-muted)" }}>✕</button>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 px-5 pb-3 pt-2 flex-shrink-0"
                style={{ borderBottom: "1px solid var(--bg-elevated)" }}>
                {modalData.slotType === "xi" && (
                  <>
                    <button onClick={() => { toggleCaptain(p.id); setModalData(null); }}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all"
                      style={{
                        background: isCap ? "var(--color-primary)" : "var(--bg-elevated)",
                        color: isCap ? "var(--bg-page)" : "var(--color-primary)",
                        border: `1px solid ${isCap ? "var(--color-primary)" : "var(--color-primary)40"}`,
                      }}>
                      {isCap ? "★ Kein Kapitän" : "★ Kapitän"}
                    </button>
                    <button onClick={() => { toggleVC(p.id); setModalData(null); }}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all"
                      style={{
                        background: isVC ? "var(--color-muted)" : "var(--bg-card)",
                        color: isVC ? "var(--color-primary)" : "var(--color-muted)",
                        border: `1px solid ${isVC ? "var(--color-muted)" : "var(--color-border)"}`,
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
                      style={{ background: "var(--bg-card)", color: "var(--color-info)", border: "1px solid var(--color-info)40" }}>
                      ⇄ Tauschen
                    </button>
                    <button onClick={() => {
                      removeFromSlot(modalData.slotType as "xi" | "bench", modalData.slotIndex);
                      setModalData(null);
                    }}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all"
                      style={{ background: "var(--bg-card)", color: "var(--color-text)", border: "1px solid var(--color-border-subtle)" }}>
                      ← Herausnehmen
                    </button>
                  </>
                )}
                {/* Taxi Squad actions */}
                {(ligaSettings?.taxi_spots || 0) > 0 && (
                  taxiPlayerIds.has(p.id) ? (
                    <button onClick={() => promoteFromTaxi(p)}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all"
                      style={{ background: "var(--bg-elevated)", color: "var(--color-text)", border: "1px solid var(--color-text)40" }}>
                      ↑ Aus Taxi befördern
                    </button>
                  ) : (
                    <button onClick={() => moveToTaxi(p)}
                      disabled={taxiSquad.length >= (ligaSettings?.taxi_spots || 0)}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all disabled:opacity-40"
                      style={{ background: "var(--bg-elevated)", color: "var(--color-text)", border: "1px solid var(--color-text)40" }}>
                      → Taxi Squad
                    </button>
                  )
                )}
                <button onClick={() => dropPlayer(p.id)} disabled={dropping === p.id}
                  className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all disabled:opacity-50"
                  style={{ background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))", color: "var(--color-error)", border: "1px solid var(--color-error)40" }}>
                  {dropping === p.id ? "..." : "✕ Aus Kader"}
                </button>
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
                          <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-border)" }}>Saison-Statistiken</p>
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
                                <span className="text-[9px]" style={{ color: "var(--color-muted)" }}>{label}</span>
                                <span className="text-sm font-black" style={{ color: "var(--color-text)" }}>{val}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* Cards highlight */}
                        {((p.yellow_cards || 0) > 0 || (p.red_cards || 0) > 0) && (
                          <div className="flex gap-2">
                            {(p.yellow_cards || 0) > 0 && (
                              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                                style={{ background: "color-mix(in srgb, var(--color-primary) 15%, var(--bg-page))", border: "1px solid var(--color-primary)40" }}>
                                <div className="w-3 h-4 rounded-sm" style={{ background: "var(--color-primary)" }} />
                                <span className="text-[9px] font-black" style={{ color: "var(--color-primary)" }}>{p.yellow_cards}× Gelb</span>
                              </div>
                            )}
                            {(p.red_cards || 0) > 0 && (
                              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                                style={{ background: "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))", border: "1px solid var(--color-error)40" }}>
                                <div className="w-3 h-4 rounded-sm" style={{ background: "var(--color-error)" }} />
                                <span className="text-[9px] font-black" style={{ color: "var(--color-error)" }}>{p.red_cards}× Rot</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

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
                              {[["TOR", g.goals||0],["ASS",g.assists||0],["MIN",g.minutes||0],["CS",g.clean_sheet?"✓":"—"],["KP",g.key_passes||0]].map(([l,v])=>(
                                <div key={String(l)} className="text-center">
                                  <p className="text-[7px] uppercase" style={{ color: "var(--color-border)" }}>{l}</p>
                                  <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>{v}</p>
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
                          <p className="text-center py-10 text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>Keine Historie vorhanden</p>
                        ) : (
                          <div className="relative pl-5">
                            <div className="absolute left-2 top-2 bottom-2 w-px" style={{ background: "var(--color-border)" }} />
                            {playerHistory.map((h, i) => {
                              const hColor = { draft: "var(--color-primary)", transfer_in: "var(--color-success)", transfer_out: "var(--color-error)", trade: "var(--color-info)" }[h.type as string] || "var(--color-text)";
                              const hIcon = { draft: "🏈", transfer_in: "▲", transfer_out: "▼", trade: "⇄" }[h.type as string] || "·";
                              return (
                                <div key={i} className="relative mb-3">
                                  <div className="absolute -left-3 top-3 w-2.5 h-2.5 rounded-full" style={{ background: hColor }} />
                                  <div className="p-3 rounded-xl ml-2" style={{ background: "var(--bg-card)", border: `1px solid ${hColor}25` }}>
                                    <div className="flex items-center justify-between mb-0.5">
                                      <span className="text-[9px] font-black uppercase" style={{ color: hColor }}>{hIcon} {h.detail}</span>
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
