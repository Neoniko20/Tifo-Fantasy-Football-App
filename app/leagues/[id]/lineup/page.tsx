"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { FORMATIONS, validateFormation } from "@/lib/wm-formations";
import type { Position } from "@/lib/wm-types";
import { BottomNav } from "@/app/components/BottomNav";
import { PlayerCard } from "@/app/components/PlayerCard";
import { Spinner } from "@/app/components/ui/Spinner";
import { EmptyState } from "@/app/components/ui/EmptyState";
import tsdbClubs from "@/lib/tsdb-clubs.json";
import { useToast } from "@/app/components/ToastProvider";
import type { LineupPlayer, LineupIRSlot } from "@/app/types/lineup";
import { LineupPitch } from "@/app/components/lineup/LineupPitch";
import { BenchSection } from "@/app/components/lineup/BenchSection";
import { IRSection } from "@/app/components/lineup/IRSection";
import { TaxiSection } from "@/app/components/lineup/TaxiSection";
import { MarketTab, type MarketPlayerInfo } from "@/app/components/lineup/MarketTab";
import { MarketSwapSheet } from "@/app/components/lineup/MarketSwapSheet";

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

type Player = LineupPlayer;
type IRSlotData = LineupIRSlot;

type ModalData = {
  player:         Player;
  slotType:       "xi" | "bench" | "none" | "market";
  slotIndex:      number;
  // Market context — only set when slotType === "market"
  marketStatus?:  "available" | "mine" | "taken";
  ownerTeamName?: string;
  ownerTeamId?:   string;
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
  const [showFormationPicker, setShowFormationPicker] = useState(false);
  const [gwPoints, setGwPoints] = useState<Record<number, number>>({});
  const [activeTab, setActiveTab] = useState<"lineup" | "squad" | "market">("lineup");
  const [modalData, setModalData] = useState<ModalData | null>(null);
  const [squadSort, setSquadSort] = useState<"fpts" | "position" | "name" | "club">("fpts");
  const [dropping, setDropping] = useState<number | null>(null);
  const [taxiSquad, setTaxiSquad] = useState<Player[]>([]);
  const [selectingTaxi, setSelectingTaxi] = useState(false);
  const [playerBorn, setPlayerBorn] = useState<Map<number, string>>(new Map());
  const [gwMinutes, setGwMinutes] = useState<Record<number, number>>({}); // current GW minutes (live)
  const [originalXIIds, setOriginalXIIds] = useState<number[]>([]); // snapshot at load time
  const [showSwapSheet,     setShowSwapSheet]     = useState(false);
  const [marketRefreshKey,  setMarketRefreshKey]  = useState(0);
  const [captainSheet, setCaptainSheet] = useState<{
    player: Player;
    slotType: "xi" | "bench";
    slotIndex: number;
  } | null>(null);
  const [swapSelection, setSwapSelection] = useState<{
    type: "xi" | "bench";
    index: number;
    player: Player;
  } | null>(null);
  const { toast } = useToast();

  // Player card detail states
  const [tsdbPlayer, setTsdbPlayer] = useState<any>(null);
  const [playerDetail, setPlayerDetail] = useState<any>(null);
  const [playerGameLog, setPlayerGameLog] = useState<any[]>([]);
  const [playerHistory, setPlayerHistory] = useState<any[]>([]);
  const [playerNews, setPlayerNews] = useState<any[]>([]);
  const [playerNewsLoading, setPlayerNewsLoading] = useState(false);
  const [injuredPlayerIds, setInjuredPlayerIds] = useState<Set<number | string>>(new Set());
  const [playerDetailLoading, setPlayerDetailLoading] = useState(false);
  const [playerTab, setPlayerTab] = useState<"summary" | "gamelog" | "history" | "news">("summary");

  // Transfer listings
  const [myListedIds,          setMyListedIds]          = useState<Set<number>>(new Set());
  const [listingActionLoading, setListingActionLoading] = useState(false);

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

  // Load myListedIds once myTeam is known
  useEffect(() => {
    if (myTeam?.id) fetchMyListedIds();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTeam?.id]);

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
        .then(r => r.json()).then(d => {
          const items = d.items || [];
          setPlayerNews(items);
          setPlayerNewsLoading(false);
          const injuryKeywords = /verletzt|gesperrt|fällt aus|ausfällt|injured|suspended|doubt|questionable|not available/i;
          const hasInjuryNews = items.some((n: any) => injuryKeywords.test(n.title));
          if (hasInjuryNews && pid) {
            setInjuredPlayerIds(prev => new Set([...prev, pid]));
          }
        })
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

      // Fetch born dates from tsdb_player_cache for age filtering in taxi selector
      if (ls?.taxi_spots > 0) {
        const names = all.map((p: any) => p.name);
        const { data: bornRows } = await supabase
          .from("tsdb_player_cache")
          .select("player_name, born")
          .in("player_name", names)
          .not("born", "is", null);
        if (bornRows) {
          const bornMap = new Map<number, string>();
          const nameToId = new Map(all.map((p: any) => [p.name, p.id]));
          for (const row of bornRows) {
            const pid = nameToId.get(row.player_name);
            if (pid && row.born) bornMap.set(pid, row.born);
          }
          setPlayerBorn(bornMap);
        }
      }
    }

    const { xi: freshXI, bench: freshBench } = await loadLineupWithPlayers(team.id, gw, playersData, ls);
    checkSquadWarnings(playersData, ls, taxiData, freshXI, freshBench);
    await loadIRSlots(team.id, playersData);
    await loadGWPoints(team.id, gw);
    setLoading(false);
  }

  function calcAge(born: string): number {
    const today = new Date();
    const b = new Date(born);
    let age = today.getFullYear() - b.getFullYear();
    const m = today.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
    return age;
  }

  function checkSquadWarnings(
    players: Player[], settings: any, taxi?: Player[],
    freshXI?: (Player | null)[], freshBench?: Player[],
  ) {
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

    // XI incomplete: null slots exist while squad has players
    if (freshXI && players.length > 0 && freshXI.some(p => !p)) {
      warnings.push({
        type: "xi_incomplete",
        message: "Aufstellung unvollständig – bitte freien Startplatz besetzen.",
      });
    }

    // Bench overflow
    if (freshBench && freshBench.length > benchSize) {
      warnings.push({
        type: "bench_full",
        message: "Bank zu voll – bitte Kader anpassen.",
      });
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
    setMarketRefreshKey(k => k + 1);
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
    if (ligaSettings?.ir_recall_requires_roster_space ?? true) {
      const maxRoster = (ligaSettings?.squad_size || 15) + (ligaSettings?.bench_size || 4);
      const nonIRCount = draftPicks.filter(p => !irSlots.some(s => s.player_id === p.id)).length;
      if (nonIRCount >= maxRoster) {
        toast(`Kein Kaderplatz frei (${maxRoster}/${maxRoster}). Bitte zuerst einen Spieler abgeben.`, "error");
        return;
      }
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
    const maxRoster = (ligaSettings?.squad_size || 15) + (ligaSettings?.bench_size || 4);
    if (draftPicks.length >= maxRoster) {
      toast(`Kader voll (${maxRoster} Plätze). Bitte zuerst einen Spieler abgeben.`, "error");
      return;
    }
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

  async function loadLineupWithPlayers(
    teamId: string, gw: number, players: Player[], settings?: any,
  ): Promise<{ xi: (Player | null)[]; bench: Player[] }> {
    const { data: lineup } = await supabase
      .from("liga_lineups").select("*")
      .eq("team_id", teamId).eq("gameweek", gw).maybeSingle();

    if (lineup) {
      setFormation(lineup.formation);
      setCaptainId(lineup.captain_id);
      setViceCaptainId(lineup.vice_captain_id);
      const xiMapped = (lineup.starting_xi as number[]).map(
        (id: number) => players.find(p => p.id === id) || null
      );
      // Pad to 11 slots — never wipe a partially-valid lineup
      const xi: (Player | null)[] = Array(11).fill(null);
      xiMapped.forEach((p, i) => { if (i < 11) xi[i] = p; });
      const benchArr = (lineup.bench as number[])
        .map((id: number) => players.find(p => p.id === id))
        .filter(Boolean) as Player[];
      setStartingXI(xi);
      setBench(benchArr);
      setOriginalXIIds(lineup.starting_xi as number[]);
      return { xi, bench: benchArr };
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
        return { xi: newXI, bench: benchArr };
      } else {
        setStartingXI(Array(11).fill(null));
        setBench([]);
        setCaptainId(null);
        setViceCaptainId(null);
        return { xi: Array(11).fill(null), bench: [] };
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
      if (targetSlot && normalizePos(targetSlot.position) !== normalizePos(player.position)) {
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

  function executeDirectSwap(
    fromType: "xi" | "bench", fromIndex: number,
    toType: "xi" | "bench", toIndex: number,
  ) {
    const newXI    = [...startingXI];
    const newBench = [...bench];
    if (fromType === "xi" && toType === "bench") {
      const a = newXI[fromIndex];
      const b = newBench[toIndex];
      newXI[fromIndex] = b ?? null;
      if (a) newBench[toIndex] = a; else newBench.splice(toIndex, 1);
    } else if (fromType === "bench" && toType === "xi") {
      const a = newBench[fromIndex];
      const b = newXI[toIndex];
      newXI[toIndex] = a;
      if (b) newBench[fromIndex] = b; else newBench.splice(fromIndex, 1);
    }
    setStartingXI(newXI);
    setBench(newBench);
    setSwapSelection(null);
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

  // ── Transfer listing helpers ─────────────────────────────────────────

  async function fetchMyListedIds() {
    if (!myTeam?.id) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
      const res  = await fetch(`/api/leagues/${leagueId}/transfer-listings`, { headers });
      const json = await res.json();
      if (!json.ok) return;
      setMyListedIds(new Set(
        (json.listings as { team_id: string; player_id: number }[])
          .filter(l => l.team_id === myTeam.id)
          .map(l => l.player_id),
      ));
    } catch {
      // silently fail — table might not exist yet
    }
  }

  async function handleListingToggle(playerId: number) {
    if (!myTeam?.id || listingActionLoading) return;
    setListingActionLoading(true);
    const isListed = myListedIds.has(playerId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      };
      await fetch(`/api/leagues/${leagueId}/transfer-listings`, {
        method: isListed ? "PATCH" : "POST",
        headers,
        body: JSON.stringify({ playerId }),
      });
      toast(isListed ? "Von Transferliste entfernt" : "Auf Transferliste gesetzt", "info");
      await fetchMyListedIds();
      setMarketRefreshKey(k => k + 1);
    } catch {
      toast("Fehler – bitte nochmal versuchen", "error");
    } finally {
      setListingActionLoading(false);
    }
  }

  // ── Market player click → open existing profile modal ───────────────
  // Must be defined BEFORE the early loading return (Rules of Hooks)
  const handleMarketPlayerClick = useCallback((
    mpi:            MarketPlayerInfo,
    status:         "available" | "mine" | "taken",
    ownerTeamName?: string,
    ownerTeamId?:   string,
  ) => {
    setModalData({
      player: {
        id:        mpi.id,
        name:      mpi.name,
        photo_url: mpi.photo_url,
        position:  mpi.position,   // raw DB: GK|DF|MF|FW — modal expects this format
        team_name: mpi.team_name ?? undefined,
        fpts:      mpi.fpts ?? undefined,
      } as Player,
      slotType:      "market",
      slotIndex:     -1,
      marketStatus:  status,
      ownerTeamName,
      ownerTeamId,
    });
  }, []);

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <Spinner text="Lade Aufstellung..." />
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

  // ── Tap-to-swap helpers ────────────────────────────────────────────
  function isPlayerSwappable(player: Player): boolean {
    if (isLocked) return false;
    if (canLiveSwap && (gwMinutes[player.id] ?? -1) > 0) return false;
    return true;
  }

  // Normalise DB position codes (TW/AB/ST) and config codes (GK/DF/FW) to a common set
  function normalizePos(pos: string): string {
    const p = (pos ?? "").toUpperCase();
    if (p === "GK" || p === "TW" || p === "G") return "GK";
    if (p === "DF" || p === "AB" || p === "D") return "DF";
    if (p === "FW" || p === "ST" || p === "F" || p === "LW" || p === "RW" || p === "CF" || p === "SS") return "FW";
    return "MF";
  }

  const validXITargets    = new Set<number>();
  const validBenchTargets = new Set<number>();
  if (swapSelection && config) {
    if (swapSelection.type === "bench") {
      config.layout.forEach((slot, i) => {
        // Include both occupied AND empty slots with matching position
        if (normalizePos(slot.position) === normalizePos(swapSelection.player.position)) {
          validXITargets.add(i);
        }
      });
    } else {
      const slotPos = config.layout[swapSelection.index]?.position;
      if (slotPos) {
        bench.forEach((p, i) => {
          if (normalizePos(p.position) === normalizePos(slotPos)) validBenchTargets.add(i);
        });
      }
    }
  }

  // When an empty XI slot is selected, highlight eligible bench players
  const emptySlotBenchTargets = new Set<number>();
  const isEmptySlotSelected = selectedSlot?.type === "xi" && !startingXI[selectedSlot.index];
  if (isEmptySlotSelected && config) {
    const neededPos = config.layout[selectedSlot!.index]?.position;
    if (neededPos) {
      bench.forEach((p, i) => {
        if (normalizePos(p.position) === normalizePos(neededPos)) emptySlotBenchTargets.add(i);
      });
    }
  }

  const swapIsActive          = swapSelection !== null;
  const swapSelectedXISlot    = swapSelection?.type === "xi"    ? swapSelection.index : null;
  const swapSelectedBenchSlot = swapSelection?.type === "bench" ? swapSelection.index : null;

  // For BenchSection: activate highlighting either in swap mode or empty-slot mode
  const benchHighlightActive  = swapIsActive || isEmptySlotSelected;
  const benchValidTargets     = swapIsActive ? validBenchTargets : emptySlotBenchTargets;
  const benchSwapSelectedSlot = swapIsActive ? swapSelectedBenchSlot : null;

  const captainMultiplier = (ligaSettings?.scoring_rules as any)?.captain_multiplier ?? 2;
  const xiPoints = startingXI.filter(Boolean).reduce((s, p) => {
    const base = p!.fpts || 0;
    return s + (p!.id === captainId ? base * captainMultiplier : base);
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
        isInjured={props.player ? injuredPlayerIds.has(props.player.id) : false}
      />
    );
  }

  return (
    <main
      className="flex min-h-screen flex-col items-center px-3 pb-28"
      style={{ background: "var(--bg-page)", paddingTop: 16 }}
      onClick={() => { if (swapIsActive) setSwapSelection(null); }}
    >

      {/* ── App Header ── */}
      <div className="w-full max-w-md pt-3 pb-1">
        {/* Row 1: GW context + Save */}
        <div className="flex items-center justify-between mb-1">
          <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            {gameweeks.length > 0 ? `Spieltag ${activeGW}` : (league?.name ?? "My Team")}
          </p>
          {activeTab === "lineup" && (
            <button
              onClick={saveLineup}
              disabled={saving || isLocked}
              className="rounded-full px-4 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40"
              style={{
                background: isLocked ? "var(--bg-elevated)" : saved ? "color-mix(in srgb, var(--color-success) 18%, var(--bg-elevated))" : "var(--color-primary)",
                color: isLocked ? "var(--color-muted)" : saved ? "var(--color-success)" : "var(--bg-page)",
                border: isLocked ? "1px solid var(--color-border)" : saved ? "1px solid var(--color-success)" : "none",
              }}
            >
              {isLocked ? "🔒" : saving ? "…" : saved ? "✓" : "Speichern"}
            </button>
          )}
        </div>

        {/* Row 2: Team name */}
        <h1 className="text-[26px] font-black uppercase leading-none tracking-tight truncate mb-2.5"
          style={{ color: "var(--color-text)" }}>
          {myTeam?.name || "Mein Team"}
        </h1>

        {/* Row 3: Formation pill + Points (lineup tab only) */}
        {activeTab === "lineup" && (
          <div className="flex items-center justify-between">
            {/* Formation pill */}
            <button
              onClick={() => { if (!isLocked) setShowFormationPicker(v => !v); }}
              disabled={isLocked}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40"
              style={{
                background: "var(--bg-elevated)",
                border: `1px solid ${showFormationPicker ? "var(--color-primary)" : "var(--color-border)"}`,
                color: showFormationPicker ? "var(--color-primary)" : "var(--color-text)",
              }}
            >
              {formation}
              <span style={{ fontSize: 8 }}>▾</span>
            </button>

            {/* Points summary */}
            <div className="flex items-baseline gap-3">
              <div className="text-right">
                <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Punkte</p>
                <p className="text-lg font-black leading-none" style={{ color: "var(--color-primary)" }}>
                  {xiPoints.toFixed(1)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>XI</p>
                <p className="text-base font-black leading-none" style={{ color: "var(--color-muted)" }}>
                  {startingXI.filter(Boolean).length}/11
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Formation picker — dropdown */}
        {showFormationPicker && !isLocked && activeTab === "lineup" && (
          <div className="mt-2 grid grid-cols-5 gap-1.5">
            {(ligaSettings?.allowed_formations || Object.keys(FORMATIONS).filter(f => !FORMATIONS[f].rare)).map((f: string) =>
              FORMATIONS[f] && (
                <button key={f}
                  onClick={() => { changeFormation(f); setShowFormationPicker(false); }}
                  className="py-1.5 rounded-lg text-[9px] font-black transition-all text-center"
                  style={{
                    background: formation === f ? "var(--color-primary)" : "var(--bg-elevated)",
                    color: formation === f ? "var(--bg-page)" : "var(--color-muted)",
                    border: `1px solid ${formation === f ? "var(--color-primary)" : "var(--color-border)"}`,
                  }}>
                  {f}
                </button>
              )
            )}
          </div>
        )}
      </div>

      {/* ── Tab bar — underline ── */}
      <div className="flex w-full max-w-md mb-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
        {([
          { id: "lineup", label: "Aufstellung" },
          { id: "squad",  label: "Kader" },
          { id: "market", label: "Markt" },
        ] as const).map(tab => (
          <button key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSelectedSlot(null); setSwapSelection(null); setSelectingIR(false); setSelectingTaxi(false); setShowFormationPicker(false); }}
            className="flex-1 pb-2 pt-1 text-[9px] font-black uppercase tracking-widest transition-all"
            style={{
              color: activeTab === tab.id ? "var(--color-primary)" : "var(--color-muted)",
              borderBottom: `2px solid ${activeTab === tab.id ? "var(--color-primary)" : "transparent"}`,
              marginBottom: "-1px",
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Squad warnings — compact strip ── */}
      {squadWarnings.length > 0 && (
        <div className="w-full max-w-md mb-2 rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap"
          style={{ background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))", border: "1px solid color-mix(in srgb, var(--color-error) 30%, transparent)" }}>
          <span className="text-[9px] font-black uppercase tracking-wider flex-shrink-0" style={{ color: "var(--color-error)" }}>⚠ Kader</span>
          {squadWarnings.map((w, i) => (
            <span key={i} className="text-[9px]" style={{ color: "var(--color-muted)" }}>{w.message}</span>
          ))}
        </div>
      )}

      {/* ── GW selector (compact scroll) ── */}
      {gameweeks.length > 0 && (
        <div className="flex gap-1.5 w-full max-w-md mb-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "none" }}>
          {gameweeks.map((gw: any) => (
            <button key={gw.gameweek} onClick={() => setActiveGW(gw.gameweek)}
              className="px-2.5 py-1 rounded-full text-[8px] font-black whitespace-nowrap flex-shrink-0 transition-all"
              style={{
                background: activeGW === gw.gameweek ? "var(--color-primary)" : "transparent",
                color: activeGW === gw.gameweek ? "var(--bg-page)" : "var(--color-muted)",
                border: `1px solid ${activeGW === gw.gameweek ? "var(--color-primary)" : "var(--color-border)"}`,
              }}>
              GW{gw.gameweek}
            </button>
          ))}
        </div>
      )}
      {gameweeks.length === 0 && activeTab === "lineup" && (
        <p className="w-full max-w-md text-[8px] font-black uppercase tracking-widest mb-2 px-1"
          style={{ color: "var(--color-border)" }}>
          Noch keine Spieltage angelegt
        </p>
      )}

      {/* ════════════════════════════════
          TAB: AUFSTELLUNG
      ════════════════════════════════ */}
      {activeTab === "lineup" && (
        <>
          {/* ── Status strip (thin, inline) ── */}
          {(() => {
            let icon = "", label = "", color = "var(--color-primary)";
            if (canLiveSwap)                                      { icon = "⚡"; label = "Live-Tausch aktiv";        color = "var(--color-primary)"; }
            else if (lockMode === "pre_sub" && activeGWStatus === "upcoming") { icon = "🔄"; label = "Auto-Sub Modus"; color = "var(--color-info)"; }
            else if (isLocked && activeGWStatus === "finished")   { icon = "✅"; label = "Spieltag abgeschlossen";   color = "var(--color-success)"; }
            else if (isLocked)                                    { icon = "🔒"; label = lockMode === "pre_sub" ? "Auto-Sub läuft" : "Aufstellung gesperrt"; color = "var(--color-primary)"; }
            else return null;
            return (
              <div className="w-full max-w-md mb-2 rounded-lg px-3 py-1.5 flex items-center gap-2"
                style={{ background: `color-mix(in srgb, ${color} 8%, var(--bg-page))`, border: `1px solid color-mix(in srgb, ${color} 25%, transparent)` }}>
                <span className="text-[11px]">{icon}</span>
                <p className="text-[8px] font-black uppercase tracking-widest" style={{ color }}>{label}</p>
              </div>
            );
          })()}

          {/* Swap hint strip */}
          {swapIsActive && (
            <div
              className="w-full max-w-md mb-2 rounded-lg px-3 py-1.5 flex items-center justify-between"
              style={{
                background: "color-mix(in srgb, rgba(244,196,48,1) 8%, var(--bg-page))",
                border: "1px solid rgba(244,196,48,0.28)",
                position: "relative", zIndex: 20,
              }}
            >
              <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "rgba(244,196,48,0.9)" }}>
                ⇄ {swapSelection!.player.name.split(" ").pop()} — gültiges Ziel wählen
              </p>
              <button
                onClick={() => setSwapSelection(null)}
                className="text-[8px] font-black px-2 py-0.5 rounded"
                style={{ background: "rgba(244,196,48,0.12)", color: "rgba(244,196,48,0.7)" }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Spielfeld + Bank — stopPropagation verhindert tap-outside-cancel beim Tippen auf Karten */}
          <div onClick={(e) => e.stopPropagation()}>

          {/* Spielfeld */}
          <LineupPitch
            rows={rows}
            startingXI={startingXI}
            captainId={captainId}
            viceCaptainId={viceCaptainId}
            isLocked={isLocked}
            canLiveSwap={canLiveSwap}
            gwPoints={gwPoints}
            gwMinutes={gwMinutes}
            injuredPlayerIds={injuredPlayerIds}
            swapSelectedSlot={swapSelectedXISlot}
            validTargetSlots={validXITargets}
            isSwapActive={swapIsActive}
            selectedSlotIndex={selectedSlot?.type === "xi" ? selectedSlot.index : null}
            onSlotClick={(slotIndex, player) => {
              if (swapSelection) {
                // Same XI slot tapped → deselect
                if (swapSelection.type === "xi" && swapSelection.index === slotIndex) {
                  setSwapSelection(null);
                  return;
                }
                // Bench player selected, tapped valid XI target
                if (swapSelection.type === "bench" && validXITargets.has(slotIndex)) {
                  if (player) {
                    // Normal swap: bench ↔ occupied XI slot
                    executeDirectSwap("bench", swapSelection.index, "xi", slotIndex);
                  } else {
                    // Empty XI slot: move bench player directly into it
                    const newXI    = [...startingXI];
                    const newBench = [...bench];
                    const fromBench = newBench.findIndex(p => p.id === swapSelection.player.id);
                    if (fromBench !== -1) newBench.splice(fromBench, 1);
                    newXI[slotIndex] = swapSelection.player;
                    setStartingXI(newXI);
                    setBench(newBench);
                  }
                  setSwapSelection(null);
                  return;
                }
                // Tapped another swappable XI player → change selection
                if (player && isPlayerSwappable(player)) {
                  setSwapSelection({ type: "xi", index: slotIndex, player });
                  return;
                }
                setSwapSelection(null);
                return;
              }

              if (player) {
                setCaptainSheet({ player, slotType: "xi", slotIndex });
              } else {
                if (isLocked) return;
                const isSelected = selectedSlot?.type === "xi" && selectedSlot.index === slotIndex;
                setSelectedSlot(isSelected ? null : { type: "xi", index: slotIndex });
              }
            }}
          />

          {/* Bank */}
          <BenchSection
            bench={bench}
            benchSize={benchSize}
            isLocked={isLocked}
            selectedSlot={selectedSlot}
            gwPoints={gwPoints}
            injuredPlayerIds={injuredPlayerIds}
            captainId={captainId}
            viceCaptainId={viceCaptainId}
            swapSelectedBench={benchSwapSelectedSlot}
            validTargetBench={benchValidTargets}
            isSwapActive={benchHighlightActive}
            onSlotClick={(index, player) => {
              if (swapSelection) {
                // Same bench slot tapped → deselect
                if (swapSelection.type === "bench" && swapSelection.index === index) {
                  setSwapSelection(null);
                  return;
                }
                // XI player selected, tapped valid bench target → swap
                if (swapSelection.type === "xi" && validBenchTargets.has(index) && player) {
                  executeDirectSwap("xi", swapSelection.index, "bench", index);
                  return;
                }
                // Tapped another swappable bench player → change selection
                if (player && isPlayerSwappable(player)) {
                  setSwapSelection({ type: "bench", index, player });
                  return;
                }
                setSwapSelection(null);
                return;
              }

              if (player) {
                // If an XI slot is already selected (selector panel mode), assign directly
                if (selectedSlot?.type === "xi") {
                  assignPlayer(player);
                  return;
                }
                setCaptainSheet({ player, slotType: "bench", slotIndex: index });
              } else {
                if (isLocked) return;
                const isSelected = selectedSlot?.type === "bench" && selectedSlot.index === index;
                setSelectedSlot(isSelected ? null : { type: "bench", index });
              }
            }}
          />

          </div>{/* end stopPropagation wrapper */}

          {/* IR-Spots */}
          {(ligaSettings?.ir_spots || 0) > 0 && (
            <IRSection
              irSlots={irSlots}
              irSpotsTotal={ligaSettings.ir_spots}
              irMinGameweeks={ligaSettings.ir_min_gameweeks || 4}
              activeGW={activeGW}
              selectingIR={selectingIR}
              draftPicks={draftPicks}
              onToggleSelecting={() => { setSelectingIR(v => !v); setSelectedSlot(null); }}
              onPlaceOnIR={placeOnIR}
              onReturnFromIR={returnFromIR}
            />
          )}

          {/* Taxi Squad */}
          {(ligaSettings?.taxi_spots || 0) > 0 && (
            <TaxiSection
              taxiSquad={taxiSquad}
              taxiSpotsTotal={ligaSettings.taxi_spots}
              taxiAgeLimit={ligaSettings.taxi_age_limit ?? 21}
              selectingTaxi={selectingTaxi}
              draftPicks={draftPicks}
              irPlayerIds={irPlayerIds}
              playerBorn={playerBorn}
              calcAge={calcAge}
              onToggleSelecting={() => { setSelectingTaxi(v => !v); setSelectedSlot(null); setSelectingIR(false); }}
              onPromoteFromTaxi={promoteFromTaxi}
              onMoveToTaxi={moveToTaxi}
            />
          )}

          {/* Spieler-Auswahl Panel (wenn Slot selektiert) */}
          {selectedSlot && (
            <div className="w-full max-w-md">
              {(() => {
                const neededPos = selectedSlot.type === "xi"
                  ? config?.layout[selectedSlot.index]?.position
                  : null;
                const count = selectorCandidates.filter(p => !neededPos || normalizePos(p.position) === normalizePos(neededPos)).length;
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
                    !neededPos || normalizePos(p.position) === normalizePos(neededPos)
                  );
                  if (filtered.length === 0) return (
                    <EmptyState title={`Keine ${neededPos || ""}-Spieler verfügbar`} className="py-4" />
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
                  <EmptyState title="Kein Spieler im Kader" className="py-6" />
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ════════════════════════════════
          TAB: MARKT
      ════════════════════════════════ */}
      {activeTab === "market" && (
        <MarketTab
          leagueId={leagueId}
          myTeamId={myTeam?.id ?? null}
          refreshKey={marketRefreshKey}
          onPlayerClick={handleMarketPlayerClick}
        />
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
        const photoSrc  = tsdbPlayer?.cutout || tsdbPlayer?.render || p.photo_url || "/player-placeholder.png";
        const isCutout  = !!(tsdbPlayer?.cutout || tsdbPlayer?.render);
        const seasonPts = playerGameLog.reduce((s, g) => s + (g.points || 0), 0);
        const avgPts    = playerGameLog.length > 0 ? seasonPts / playerGameLog.length : 0;
        const formatD   = (d: string) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
        const GOLD      = "rgba(244,196,48,";

        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center"
            style={{ background: "rgba(0,0,0,0.88)" }}
            onClick={() => setModalData(null)}>
            <div className="w-full max-w-md rounded-t-3xl flex flex-col overflow-hidden"
              style={{ background: "#090c09", maxHeight: "92vh" }}
              onClick={e => e.stopPropagation()}>

              {/* ── HERO ─────────────────────────────────────────── */}
              <div className="relative flex-shrink-0" style={{ height: 260, overflow: "hidden" }}>

                {/* L1: near-black base */}
                <div className="absolute inset-0" style={{ background: "#0b0f0c" }} />

                {/* L2: fan texture — grayscale, stadium contrast, slightly off-center */}
                <div className="absolute inset-0 pointer-events-none" style={{
                  backgroundImage: "url('/brand/fan-bg.png')",
                  backgroundSize: "cover",
                  backgroundPosition: "57% 33%",
                  filter: "grayscale(1) contrast(1.3) brightness(0.85)",
                  opacity: 0.64,
                }} />

                {/* L3: color — wide soft wash, asymmetric, club hue tints crowd */}
                <div className="absolute inset-0 pointer-events-none" style={{
                  background: c1
                    ? `radial-gradient(ellipse 90% 74% at 68% 50%, ${c1} 0%, transparent 100%)`
                    : `radial-gradient(ellipse 90% 74% at 68% 50%, ${posColor} 0%, transparent 100%)`,
                  opacity: 0.38,
                  mixBlendMode: "color" as const,
                }} />

                {/* L4: primary spotlight — tight off-axis upper-right floodlight */}
                <div className="absolute inset-0 pointer-events-none" style={{
                  background: c1
                    ? `radial-gradient(ellipse 28% 46% at 76% -7%, ${c1} 0%, transparent 100%)`
                    : `radial-gradient(ellipse 28% 46% at 76% -7%, ${posColor} 0%, transparent 100%)`,
                  opacity: 0.34,
                  mixBlendMode: "screen" as const,
                }} />

                {/* L4b: secondary light spill — left-of-center, breaks single-source symmetry */}
                <div className="absolute inset-0 pointer-events-none" style={{
                  background: "radial-gradient(ellipse 48% 32% at 28% 12%, rgba(255,255,255,0.05) 0%, transparent 100%)",
                  mixBlendMode: "screen" as const,
                }} />

                {/* L5: haze — asymmetric smoke-light diffusion */}
                <div className="absolute inset-0 pointer-events-none" style={{
                  background: "radial-gradient(ellipse 66% 44% at 55% 24%, rgba(255,255,255,0.07) 0%, transparent 100%)",
                  mixBlendMode: "screen" as const,
                }} />

                {/* L6: dark scrim — bottom-heavy for text */}
                <div className="absolute inset-0 pointer-events-none" style={{
                  background: "linear-gradient(to bottom, rgba(0,0,0,0.16) 0%, rgba(0,0,0,0.10) 32%, rgba(0,0,0,0.76) 70%, rgba(0,0,0,0.97) 100%)"
                }} />

                {/* L7: grain */}
                <div className="absolute inset-0 pointer-events-none" style={{
                  backgroundImage: "url('/noise.svg')",
                  opacity: 0.07,
                  mixBlendMode: "overlay" as const,
                }} />

                {/* Player portrait — size and scrims depend on image type */}
                <div className="absolute bottom-0 right-4 z-10"
                  style={{ width: isCutout ? 168 : 148, height: isCutout ? 228 : 204 }}>
                  <img
                    src={photoSrc}
                    alt={p.name}
                    className="w-full h-full"
                    style={{
                      objectFit: isCutout ? "contain" : "cover",
                      objectPosition: isCutout ? "bottom center" : "center top",
                      filter: [
                        "saturate(0.72) contrast(1.10) brightness(0.88)",
                        // rim light: softer club-colored edge glow + depth anchor
                        c1
                          ? `drop-shadow(0 0 22px ${c1}38) drop-shadow(0 12px 24px rgba(0,0,0,0.80))`
                          : "drop-shadow(0 12px 24px rgba(0,0,0,0.80))",
                      ].join(" "),
                    }}
                  />
                  {/* Bottom scrim */}
                  <div className="pointer-events-none absolute inset-0" style={{
                    background: isCutout
                      ? "linear-gradient(to top, rgba(8,12,8,0.82) 0%, rgba(8,12,8,0.18) 22%, transparent 42%)"
                      : "linear-gradient(to top, rgba(8,12,8,0.94) 0%, rgba(8,12,8,0.60) 30%, rgba(8,12,8,0.20) 55%, transparent 70%)"
                  }} />
                  {/* Extra side scrims for regular photos — suppress white edges */}
                  {!isCutout && (
                    <div className="pointer-events-none absolute inset-0" style={{
                      background: `
                        linear-gradient(to right,  rgba(8,12,8,0.72) 0%, transparent 28%),
                        linear-gradient(to left,   rgba(8,12,8,0.52) 0%, transparent 22%),
                        linear-gradient(to bottom, rgba(8,12,8,0.58) 0%, transparent 26%)
                      `
                    }} />
                  )}
                  {/* Club color influence — very soft, integrates player into scene */}
                  {c1 && (
                    <div className="pointer-events-none absolute inset-0" style={{
                      background: `radial-gradient(ellipse 100% 60% at 70% 0%, ${c1} 0%, transparent 70%)`,
                      opacity: 0.11,
                      mixBlendMode: "soft-light" as const,
                    }} />
                  )}
                  {/* Grain on portrait */}
                  <div className="pointer-events-none absolute inset-0" style={{
                    backgroundImage: "url('/noise.svg')",
                    opacity: 0.055,
                    mixBlendMode: "overlay" as const,
                  }} />
                </div>

                {/* Drag handle */}
                <div className="absolute top-3 left-0 right-0 flex justify-center z-30 pointer-events-none">
                  <div className="w-8 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.16)" }} />
                </div>

                {/* Close */}
                <button onClick={() => setModalData(null)}
                  className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full z-30"
                  style={{ background: "rgba(0,0,0,0.52)", color: "rgba(255,255,255,0.45)", fontSize: 11 }}>✕</button>

                {/* Cap / VC */}
                {(isCap || isVC) && (
                  <div className="absolute top-4 left-4 z-30">
                    <span className="w-7 h-7 rounded-full text-[10px] font-black flex items-center justify-center"
                      style={isCap
                        ? { background: `${GOLD}0.92)`, color: "#050301" }
                        : { background: "rgba(0,0,0,0.65)", color: `${GOLD}1)`, border: `1px solid ${GOLD}0.55)` }
                      }>
                      {isCap ? "C" : "V"}
                    </span>
                  </div>
                )}

                {/* Text — left column, bottom-anchored, clear of portrait */}
                <div className="absolute bottom-0 left-0 z-20 px-5 pb-6" style={{ right: 176 }}>
                  <div className="flex items-center gap-1.5 mb-2">
                    {club?.badge && <img src={club.badge} alt="" className="w-4 h-4 object-contain flex-shrink-0 opacity-70" />}
                    <span className="text-[8px] font-black uppercase tracking-widest truncate"
                      style={{ color: c1 ? `${c1}bb` : "rgba(255,255,255,0.35)" }}>
                      {p.team_name}
                    </span>
                  </div>
                  <p className="font-black leading-tight mb-3"
                    style={{ fontSize: 26, color: "#fff", textShadow: "0 2px 18px rgba(0,0,0,0.96)", letterSpacing: "-0.02em" }}>
                    {p.name}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[8px] font-black px-2 py-0.5 rounded"
                      style={{ background: posColor, color: "#050301" }}>{p.position}</span>
                    {gwPts !== undefined && (
                      <span className="text-[8px] font-black px-2 py-0.5 rounded"
                        style={{ background: `${GOLD}0.10)`, color: `${GOLD}0.88)`, border: `1px solid ${GOLD}0.24)` }}>
                        GW{activeGW > 1 ? activeGW - 1 : activeGW}: {gwPts} Pts
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom transition fade */}
                <div className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none z-20" style={{
                  background: "linear-gradient(to top, #090c09 0%, transparent 100%)"
                }} />
              </div>

              {/* ── HERO STAT ────────────────────────────────────── */}
              <div className="flex items-end justify-between px-5 py-4 flex-shrink-0"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div>
                  <p className="text-[8px] font-black uppercase tracking-widest mb-1"
                    style={{ color: "rgba(255,255,255,0.25)" }}>Saison-Punkte</p>
                  <p className="font-black leading-none"
                    style={{ fontSize: 40, color: posColor, letterSpacing: "-0.02em" }}>{p.fpts?.toFixed(1)}</p>
                </div>
                <div className="flex gap-5 pb-1">
                  <div className="text-right">
                    <p className="text-[7px] font-black uppercase tracking-widest mb-0.5"
                      style={{ color: "rgba(255,255,255,0.22)" }}>Ø / GW</p>
                    <p className="text-xl font-black" style={{ color: "rgba(255,255,255,0.62)" }}>{avgPts.toFixed(1)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[7px] font-black uppercase tracking-widest mb-0.5"
                      style={{ color: "rgba(255,255,255,0.22)" }}>Spiele</p>
                    <p className="text-xl font-black" style={{ color: "rgba(255,255,255,0.62)" }}>{playerGameLog.length}</p>
                  </div>
                </div>
              </div>

              {/* ── ACTION BUTTONS ───────────────────────────────── */}
              <div className="flex flex-wrap gap-2 px-5 pb-3 pt-3 flex-shrink-0"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                {modalData.slotType === "xi" && (
                  <>
                    <button onClick={() => { toggleCaptain(p.id); setModalData(null); }}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all"
                      style={{
                        background: isCap ? `${GOLD}0.90)` : "rgba(255,255,255,0.06)",
                        color: isCap ? "#050301" : "rgba(255,255,255,0.40)",
                        border: `1px solid ${isCap ? `${GOLD}0.28)` : "rgba(255,255,255,0.09)"}`,
                      }}>
                      {isCap ? "★ Kein Kapitän" : "★ Kapitän"}
                    </button>
                    <button onClick={() => { toggleVC(p.id); setModalData(null); }}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all"
                      style={{
                        background: isVC ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)",
                        color: isVC ? `${GOLD}0.88)` : "rgba(255,255,255,0.30)",
                        border: `1px solid ${isVC ? `${GOLD}0.28)` : "rgba(255,255,255,0.08)"}`,
                      }}>
                      {isVC ? "V Kein Vize" : "V Vize-Kap."}
                    </button>
                  </>
                )}
                {modalData.slotType !== "none" && modalData.slotType !== "market" && (
                  <>
                    <button onClick={() => {
                      setModalData(null);
                      setSelectedSlot({ type: modalData.slotType as "xi" | "bench", index: modalData.slotIndex });
                    }}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all"
                      style={{ background: "rgba(255,255,255,0.06)", color: "var(--color-info)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      ⇄ Tauschen
                    </button>
                    <button onClick={() => {
                      removeFromSlot(modalData.slotType as "xi" | "bench", modalData.slotIndex);
                      setModalData(null);
                    }}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all"
                      style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      ← Herausnehmen
                    </button>
                  </>
                )}
                {modalData.slotType !== "market" && (ligaSettings?.taxi_spots || 0) > 0 && (
                  taxiPlayerIds.has(p.id) ? (
                    <button onClick={() => promoteFromTaxi(p)}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all"
                      style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      ↑ Aus Taxi befördern
                    </button>
                  ) : (
                    <button onClick={() => moveToTaxi(p)}
                      disabled={taxiSquad.length >= (ligaSettings?.taxi_spots || 0)}
                      className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all disabled:opacity-40"
                      style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      → Taxi Squad
                    </button>
                  )
                )}
                {modalData.slotType !== "market" && (
                  <button onClick={() => dropPlayer(p.id)} disabled={dropping === p.id}
                    className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all disabled:opacity-50"
                    style={{ background: "rgba(220,50,50,0.09)", color: "var(--color-error)", border: "1px solid rgba(220,50,50,0.18)" }}>
                    {dropping === p.id ? "..." : "✕ Aus Kader"}
                  </button>
                )}
                {/* Transfer listing — all own players (xi/bench/none) */}
                {modalData.slotType !== "market" && (
                  <button
                    onClick={() => handleListingToggle(p.id)}
                    disabled={listingActionLoading}
                    className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all disabled:opacity-50"
                    style={{
                      background: myListedIds.has(p.id) ? "rgba(220,50,50,0.09)"    : "rgba(48,196,164,0.08)",
                      color:      myListedIds.has(p.id) ? "var(--color-error)"       : "rgba(48,196,164,0.85)",
                      border:     `1px solid ${myListedIds.has(p.id) ? "rgba(220,50,50,0.18)" : "rgba(48,196,164,0.22)"}`,
                    }}>
                    {listingActionLoading ? "…" : myListedIds.has(p.id) ? "↓ Von Transferliste" : "↑ Transferliste"}
                  </button>
                )}
              </div>

              {/* ── MARKET ACTION ZONE ────────────────────────── */}
              {modalData.slotType === "market" && (
                <div className="px-5 pb-4 pt-3 flex flex-col gap-2 flex-shrink-0"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>

                  {/* Owner info for taken players */}
                  {modalData.marketStatus === "taken" && modalData.ownerTeamName && (
                    <p className="text-[8px] font-black uppercase tracking-widest text-center"
                      style={{ color: "rgba(255,255,255,0.30)" }}>
                      Besitzer: {modalData.ownerTeamName}
                    </p>
                  )}

                  {/* available → Hinzufügen + Waiver */}
                  {modalData.marketStatus === "available" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowSwapSheet(true)}
                        className="flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest"
                        style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
                        + Hinzufügen
                      </button>
                      <button disabled
                        className="py-2.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                        style={{ background: "var(--bg-elevated)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                        Waiver
                      </button>
                    </div>
                  )}

                  {/* mine → Transferliste + Aus Kader */}
                  {modalData.marketStatus === "mine" && (
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => handleListingToggle(p.id)}
                        disabled={listingActionLoading}
                        className="w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                        style={{
                          background: myListedIds.has(p.id) ? "rgba(220,50,50,0.08)"    : "rgba(48,196,164,0.10)",
                          color:      myListedIds.has(p.id) ? "var(--color-error)"       : "rgba(48,196,164,0.90)",
                          border:     `1px solid ${myListedIds.has(p.id) ? "rgba(220,50,50,0.20)" : "rgba(48,196,164,0.28)"}`,
                        }}>
                        {listingActionLoading ? "…" : myListedIds.has(p.id) ? "↓ Von Transferliste entfernen" : "↑ Auf Transferliste setzen"}
                      </button>
                      <button
                        onClick={() => dropPlayer(p.id)}
                        disabled={dropping === p.id}
                        className="w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                        style={{ background: "rgba(220,50,50,0.08)", color: "var(--color-error)", border: "1px solid rgba(220,50,50,0.20)" }}>
                        {dropping === p.id ? "..." : "✕ Aus Kader"}
                      </button>
                    </div>
                  )}

                  {/* taken → Trade anbieten */}
                  {modalData.marketStatus === "taken" && modalData.ownerTeamId && (
                    <button
                      onClick={() => {
                        window.location.href = `/leagues/${leagueId}/trades?receiverTeamId=${modalData.ownerTeamId}&requestPlayerId=${modalData.player.id}`;
                      }}
                      className="w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest"
                      style={{ background: "var(--color-primary)", color: "var(--bg-page)", border: "1px solid var(--color-primary)" }}>
                      ⇄ Trade anbieten
                    </button>
                  )}
                </div>
              )}

              {/* ── TABS ─────────────────────────────────────────── */}
              <div className="flex flex-shrink-0 px-5"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                {(["summary", "gamelog", "history", "news"] as const).map(t => (
                  <button key={t} onClick={() => setPlayerTab(t)}
                    className="flex-1 py-3 text-[8px] font-black uppercase tracking-widest transition-all"
                    style={{
                      color: playerTab === t ? `${GOLD}1)` : "rgba(255,255,255,0.22)",
                      borderBottom: playerTab === t ? `2px solid ${GOLD}0.78)` : "2px solid transparent",
                    }}>
                    {t === "summary" ? "Übersicht" : t === "gamelog" ? "Log" : t === "history" ? "Historie" : "News"}
                  </button>
                ))}
              </div>

              {/* ── TAB CONTENT ──────────────────────────────────── */}
              <div className="overflow-y-auto flex-1 pb-8">
                {playerDetailLoading ? (
                  <Spinner text="Lade..." />
                ) : (
                  <>
                    {playerTab === "summary" && (
                      <div className="px-5 pt-5 space-y-3">
                        {/* Key numbers */}
                        <div className="flex gap-3">
                          <div className="flex-1 rounded-2xl p-4"
                            style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${posColor}28` }}>
                            <p className="text-[7px] font-black uppercase tracking-widest mb-1.5"
                              style={{ color: "rgba(255,255,255,0.25)" }}>Tore</p>
                            <p className="text-3xl font-black leading-none"
                              style={{ color: posColor }}>{playerGameLog.reduce((s,g)=>s+(g.goals||0),0)}</p>
                          </div>
                          <div className="flex-1 rounded-2xl p-4"
                            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                            <p className="text-[7px] font-black uppercase tracking-widest mb-1.5"
                              style={{ color: "rgba(255,255,255,0.25)" }}>Assists</p>
                            <p className="text-3xl font-black leading-none"
                              style={{ color: "rgba(255,255,255,0.68)" }}>{playerGameLog.reduce((s,g)=>s+(g.assists||0),0)}</p>
                          </div>
                          <div className="flex-1 rounded-2xl p-4"
                            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                            <p className="text-[7px] font-black uppercase tracking-widest mb-1.5"
                              style={{ color: "rgba(255,255,255,0.25)" }}>Minuten</p>
                            <p className="text-2xl font-black leading-none"
                              style={{ color: "rgba(255,255,255,0.68)" }}>{playerGameLog.reduce((s,g)=>s+(g.minutes||0),0)}</p>
                          </div>
                        </div>

                        {/* Secondary stats list */}
                        <div className="rounded-2xl overflow-hidden"
                          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                          {[
                            ["Schüsse aufs Tor", playerGameLog.reduce((s,g)=>s+(g.shots_on||0),0)],
                            ["Key Passes", playerGameLog.reduce((s,g)=>s+(g.key_passes||0),0)],
                            ["Tackles", playerGameLog.reduce((s,g)=>s+(g.tackles||0),0)],
                            ["Abfangen", playerGameLog.reduce((s,g)=>s+(g.interceptions||0),0)],
                            ...(p.position === "GK" ? [["Paraden", playerGameLog.reduce((s,g)=>s+(g.saves||0),0)]] : []),
                            ["Clean Sheets", playerGameLog.filter(g=>g.clean_sheet).length],
                          ].map(([label, val], i, arr) => (
                            <div key={String(label)}
                              className="flex items-center justify-between px-4 py-2.5"
                              style={{ borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                              <span className="text-[9px] font-black uppercase tracking-wide"
                                style={{ color: "rgba(255,255,255,0.32)" }}>{label}</span>
                              <span className="text-sm font-black"
                                style={{ color: "rgba(255,255,255,0.72)" }}>{val}</span>
                            </div>
                          ))}
                        </div>

                        {/* Cards */}
                        {((p.yellow_cards || 0) > 0 || (p.red_cards || 0) > 0) && (
                          <div className="flex gap-2">
                            {(p.yellow_cards || 0) > 0 && (
                              <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl"
                                style={{ background: `${GOLD}0.08)`, border: `1px solid ${GOLD}0.18)` }}>
                                <div className="w-3 h-4 rounded-sm" style={{ background: `${GOLD}0.82)` }} />
                                <span className="text-[9px] font-black" style={{ color: `${GOLD}0.82)` }}>
                                  {p.yellow_cards}× Gelb
                                </span>
                              </div>
                            )}
                            {(p.red_cards || 0) > 0 && (
                              <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl"
                                style={{ background: "rgba(220,50,50,0.08)", border: "1px solid rgba(220,50,50,0.18)" }}>
                                <div className="w-3 h-4 rounded-sm" style={{ background: "rgba(220,50,50,0.82)" }} />
                                <span className="text-[9px] font-black" style={{ color: "var(--color-error)" }}>
                                  {p.red_cards}× Rot
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {playerTab === "gamelog" && (
                      <div className="px-5 pt-4 space-y-2">
                        {playerGameLog.length === 0 ? (
                          <EmptyState icon="📊" title="Noch keine Spieltag-Daten" />
                        ) : playerGameLog.map(g => (
                          <div key={g.id} className="rounded-2xl overflow-hidden"
                            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                            <div className="px-4 py-2 flex items-center justify-between"
                              style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                              <span className="text-[9px] font-black uppercase tracking-widest"
                                style={{ color: "rgba(255,255,255,0.32)" }}>GW{g.gameweek}</span>
                              <span className="text-base font-black"
                                style={{ color: posColor }}>{g.points?.toFixed(1) || "0.0"} Pts</span>
                            </div>
                            <div className="grid grid-cols-5 gap-1 px-4 py-2.5">
                              {[["TOR",g.goals||0],["ASS",g.assists||0],["MIN",g.minutes||0],["CS",g.clean_sheet?"✓":"—"],["KP",g.key_passes||0]].map(([l,v])=>(
                                <div key={String(l)} className="text-center">
                                  <p className="text-[7px] uppercase mb-0.5"
                                    style={{ color: "rgba(255,255,255,0.22)" }}>{l}</p>
                                  <p className="text-xs font-black"
                                    style={{ color: "rgba(255,255,255,0.68)" }}>{v}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {playerTab === "history" && (
                      <div className="px-5 pt-4">
                        {playerHistory.length === 0 ? (
                          <EmptyState icon="📋" title="Keine Historie vorhanden" />
                        ) : (
                          <div className="relative pl-5">
                            <div className="absolute left-2 top-2 bottom-2 w-px"
                              style={{ background: "rgba(255,255,255,0.06)" }} />
                            {playerHistory.map((h, i) => {
                              const hColor = { draft: "var(--color-primary)", transfer_in: "var(--color-success)", transfer_out: "var(--color-error)", trade: "var(--color-info)" }[h.type as string] || "var(--color-text)";
                              const hIcon = { draft: "🏈", transfer_in: "▲", transfer_out: "▼", trade: "⇄" }[h.type as string] || "·";
                              return (
                                <div key={i} className="relative mb-3">
                                  <div className="absolute -left-3 top-3 w-2.5 h-2.5 rounded-full"
                                    style={{ background: hColor }} />
                                  <div className="p-3 rounded-xl ml-2"
                                    style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${hColor}20` }}>
                                    <div className="flex items-center justify-between mb-0.5">
                                      <span className="text-[9px] font-black uppercase"
                                        style={{ color: hColor }}>{hIcon} {h.detail}</span>
                                      <span className="text-[7px]"
                                        style={{ color: "rgba(255,255,255,0.22)" }}>{formatD(h.date)}</span>
                                    </div>
                                    <p className="text-xs font-black"
                                      style={{ color: "rgba(255,255,255,0.58)" }}>{h.team}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {playerTab === "news" && (
                      <div className="px-5 pt-4 space-y-2">
                        {playerNewsLoading ? (
                          <Spinner text="Lade News..." />
                        ) : playerNews.length === 0 ? (
                          <EmptyState icon="📰" title="Keine News gefunden" />
                        ) : playerNews.slice(0, 5).map((n: any, i: number) => (
                          <a key={i} href={n.link || "#"} target="_blank" rel="noopener noreferrer"
                            className="block p-4 rounded-2xl transition-opacity hover:opacity-80"
                            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                            <p className="text-xs font-black leading-snug"
                              style={{ color: "rgba(255,255,255,0.75)" }}>{n.title}</p>
                            {n.pubDate && (
                              <p className="text-[7px] font-black uppercase mt-1.5"
                                style={{ color: "rgba(255,255,255,0.22)" }}>
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

      {/* ── Captain / VC Action Sheet ─────────────────────────── */}
      {captainSheet && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.62)" }}
          onClick={() => setCaptainSheet(null)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl px-5 pt-5 pb-10"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--color-border)",
              borderBottom: "none",
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header — player identity */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {captainSheet.player.photo_url ? (
                  <img
                    src={captainSheet.player.photo_url}
                    className="w-11 h-11 rounded-full object-cover flex-shrink-0"
                    style={{ border: "1px solid var(--color-border)" }}
                    alt=""
                  />
                ) : (
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)" }}
                  >
                    <span className="text-xs font-black" style={{ color: "var(--color-muted)" }}>
                      {captainSheet.player.position}
                    </span>
                  </div>
                )}
                <div>
                  <p className="font-black text-sm leading-tight" style={{ color: "var(--color-text)" }}>
                    {captainSheet.player.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                      {captainSheet.player.position}
                    </span>
                    {captainSheet.player.team_name && (
                      <span className="text-[9px]" style={{ color: "var(--color-muted)" }}>
                        · {captainSheet.player.team_name}
                      </span>
                    )}
                    {captainId === captainSheet.player.id && (
                      <span
                        className="text-[8px] font-black px-1.5 py-0.5 rounded-full"
                        style={{ background: "rgba(244,196,48,0.15)", color: "rgba(244,196,48,1)", border: "1px solid rgba(244,196,48,0.35)" }}
                      >
                        C
                      </span>
                    )}
                    {viceCaptainId === captainSheet.player.id && (
                      <span
                        className="text-[8px] font-black px-1.5 py-0.5 rounded-full"
                        style={{ background: "rgba(0,0,0,0.55)", color: "rgba(244,196,48,1)", border: "1px solid rgba(244,196,48,0.40)" }}
                      >
                        VC
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setCaptainSheet(null)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] flex-shrink-0"
                style={{ background: "var(--bg-page)", color: "var(--color-muted)" }}
              >
                ✕
              </button>
            </div>

            {/* C / VC buttons — hidden when lineup is locked */}
            {!isLocked && (
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  onClick={() => {
                    const wasCap = captainId === captainSheet.player.id;
                    toggleCaptain(captainSheet.player.id);
                    toast(wasCap ? "Captain entfernt" : "Captain gesetzt", "info");
                    setCaptainSheet(null);
                  }}
                  className="py-3 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all"
                  style={
                    captainId === captainSheet.player.id
                      ? { background: "rgba(244,196,48,0.18)", color: "rgba(244,196,48,1)", border: "1px solid rgba(244,196,48,0.45)" }
                      : { background: "var(--bg-page)", color: "rgba(255,255,255,0.40)", border: "1px solid var(--color-border)" }
                  }
                >
                  {captainId === captainSheet.player.id ? "✕ Captain" : "★ Captain"}
                </button>
                <button
                  onClick={() => {
                    const wasVC = viceCaptainId === captainSheet.player.id;
                    toggleVC(captainSheet.player.id);
                    toast(wasVC ? "Vice-Captain entfernt" : "Vice-Captain gesetzt", "info");
                    setCaptainSheet(null);
                  }}
                  className="py-3 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all"
                  style={
                    viceCaptainId === captainSheet.player.id
                      ? { background: "rgba(244,196,48,0.08)", color: "rgba(244,196,48,0.90)", border: "1px solid rgba(244,196,48,0.40)" }
                      : { background: "var(--bg-page)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }
                  }
                >
                  {viceCaptainId === captainSheet.player.id ? "✕ Vice" : "Vice-Captain"}
                </button>
              </div>
            )}

            {/* Swap — only when not locked and player is swappable */}
            {isPlayerSwappable(captainSheet.player) && (
              <button
                onClick={() => {
                  const { player, slotType, slotIndex } = captainSheet;
                  setSelectedSlot(null);
                  setSwapSelection({ type: slotType, index: slotIndex, player });
                  setCaptainSheet(null);
                }}
                className="w-full py-3 rounded-xl text-[11px] font-black uppercase tracking-wider mb-2"
                style={{ background: "var(--bg-page)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
              >
                ⇄ Tauschen
              </button>
            )}

            {/* Profile */}
            <button
              onClick={() => {
                setModalData({ player: captainSheet.player, slotType: captainSheet.slotType, slotIndex: captainSheet.slotIndex });
                setCaptainSheet(null);
              }}
              className="w-full py-3 rounded-xl text-[11px] font-black uppercase tracking-wider"
              style={{ background: "var(--bg-page)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
            >
              Spielerprofil
            </button>
          </div>
        </div>
      )}

      {/* ── Market Swap Sheet ──────────────────────────────────── */}
      {showSwapSheet && modalData?.slotType === "market" && modalData.marketStatus === "available" && myTeam && (
        <MarketSwapSheet
          player={modalData.player as MarketPlayerInfo}
          myTeam={{ id: myTeam.id, name: myTeam.name }}
          draftPicks={draftPicks}
          startingXI={startingXI}
          bench={bench}
          irSlots={irSlots}
          taxiSquad={taxiSquad}
          ligaSettings={ligaSettings}
          leagueId={leagueId}
          activeGW={activeGW}
          onSuccess={(wasStarter) => {
            setShowSwapSheet(false);
            setModalData(null);
            setMarketRefreshKey(k => k + 1);
            if (wasStarter) {
              toast("Aufstellung unvollständig – bitte freien Startplatz besetzen.", "info");
            }
            if (myTeam?.user_id) loadAll(myTeam.user_id);
          }}
          onClose={() => setShowSwapSheet(false)}
        />
      )}
    </main>
  );
}
