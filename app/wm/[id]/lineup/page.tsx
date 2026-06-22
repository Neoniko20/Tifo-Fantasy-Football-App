"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { FORMATIONS } from "@/lib/wm-formations";
import type { Position } from "@/lib/wm-types";
import { useToast } from "@/app/components/ToastProvider";
import { PlayerCardLineup } from "@/app/components/players/PlayerCardLineup";
import { BottomNav } from "@/app/components/BottomNav";
import { Spinner } from "@/app/components/ui/Spinner";
import type { PlayerCardViewModel, PositionLabel } from "@/app/types/player";

type Player = {
  id: number;
  name: string;
  photo_url: string | null;
  position: Position;
  team_name: string;
};

export default function LineupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [user, setUser] = useState<any>(null);
  const [myTeam, setMyTeam] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [draftPicks, setDraftPicks] = useState<Player[]>([]);
  const [formation, setFormation] = useState("4-3-3");
  const [startingXI, setStartingXI] = useState<(Player | null)[]>(Array(11).fill(null));
  const [bench, setBench] = useState<Player[]>([]);
  const [captainId, setCaptainId] = useState<number | null>(null);
  const [viceCaptainId, setViceCaptainId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ type: "xi" | "bench"; index: number } | null>(null);
  const [gameweek, setGameweek] = useState(1);
  const [gameweekId, setGameweekId] = useState<string | null>(null);
  const [playerNationElimMap, setPlayerNationElimMap] = useState<Record<number, { eliminated_after_gameweek?: number | null } | null>>({});
  const [nationFlagMap, setNationFlagMap] = useState<Record<number, string | null>>({});
  const [gwPointsMap, setGwPointsMap] = useState<Record<number, number>>({});
  const [isLineupLocked, setIsLineupLocked] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageTab, setPageTab] = useState<"aufstellung" | "kader">("aufstellung");
  const { toast } = useToast();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id).finally(() => setIsLoading(false));
    });
  }, []);

  async function loadAll(userId: string) {
    const { data: team } = await supabase
      .from("teams").select("*").eq("league_id", leagueId).eq("user_id", userId).single();
    setMyTeam(team);

    const { data: settingsData } = await supabase
      .from("wm_league_settings").select("*").eq("league_id", leagueId).maybeSingle();
    setSettings(settingsData);
    if (settingsData?.allowed_formations?.[0]) {
      setFormation(settingsData.allowed_formations[0]);
    }

    let activeGW: number = 1;
    let activeGWId: string | null = null;
    if (settingsData?.tournament_id) {
      const { data: gw } = await supabase
        .from("wm_gameweeks")
        .select("id, gameweek")
        .eq("tournament_id", settingsData.tournament_id)
        .neq("status", "finished")
        .order("gameweek")
        .limit(1)
        .maybeSingle();
      if (gw) {
        activeGW = gw.gameweek;
        activeGWId = gw.id;
        setGameweek(gw.gameweek);
        setGameweekId(gw.id);
      }
    }

    if (!team) return;

    const { data: picks } = await supabase
      .from("wm_squad_players")
      .select("player_id")
      .eq("team_id", team.id);

    let playersData: Player[] = [];
    if (picks && picks.length > 0) {
      const playerIds = picks.map((p: any) => p.player_id);

      const { data: fetched } = await supabase
        .from("players")
        .select("id, name, photo_url, position, team_name")
        .in("id", playerIds);
      playersData = (fetched || []) as Player[];
      setDraftPicks(playersData);

      // Nation flags + elimination info in one query
      if (settingsData?.tournament_id) {
        const { data: pnData } = await supabase
          .from("wm_player_nations")
          .select("player_id, wm_nations(flag_url, eliminated_after_gameweek)")
          .eq("tournament_id", settingsData.tournament_id)
          .in("player_id", playerIds);

        if (pnData && pnData.length > 0) {
          const flagMap: Record<number, string | null> = {};
          const elimMap: Record<number, { eliminated_after_gameweek?: number | null } | null> = {};
          for (const pn of pnData as any[]) {
            flagMap[pn.player_id] = pn.wm_nations?.flag_url ?? null;
            elimMap[pn.player_id] = pn.wm_nations ?? null;
          }
          setNationFlagMap(flagMap);
          setPlayerNationElimMap(elimMap);
        }
      }

      // GW points for current gameweek
      if (activeGW) {
        const { data: gwPoints } = await supabase
          .from("wm_gameweek_points")
          .select("player_id, points")
          .eq("team_id", team.id)
          .eq("gameweek", activeGW);
        if (gwPoints && gwPoints.length > 0) {
          const ptMap: Record<number, number> = {};
          for (const row of gwPoints as any[]) {
            ptMap[row.player_id] = row.points ?? 0;
          }
          setGwPointsMap(ptMap);
        }
      }
    }

    const { data: lineup } = await supabase
      .from("team_lineups")
      .select("*")
      .eq("team_id", team.id)
      .eq("gameweek", activeGW)
      .maybeSingle();

    if (lineup) {
      setIsLineupLocked(!!lineup.locked);

      if (playersData.length > 0) {
        setFormation(lineup.formation);
        setCaptainId(lineup.captain_id);
        setViceCaptainId(lineup.vice_captain_id);
        const xi = (lineup.starting_xi as number[]).map(
          (id: number) => playersData.find(p => p.id === id) || null
        );
        const benchArr = (lineup.bench as number[]).map(
          (id: number) => playersData.find(p => p.id === id)
        ).filter(Boolean) as Player[];
        setStartingXI(xi);
        setBench(benchArr);
      }
    }
  }

  function isEliminated(player: Player): boolean {
    const mapped = playerNationElimMap[player.id];
    if (!mapped?.eliminated_after_gameweek) return false;
    return gameweek > mapped.eliminated_after_gameweek;
  }

  function toVM(player: Player, capId: number | null, vcId: number | null): PlayerCardViewModel {
    const elim = isEliminated(player);
    const gwPts = gwPointsMap[player.id];
    return {
      id: player.id,
      name: player.name,
      positionLabel: player.position as PositionLabel,
      imageUrl: player.photo_url ?? null,
      nationFlagUrl: nationFlagMap[player.id] ?? null,
      gameweekPoints: gwPts !== undefined ? gwPts : undefined,
      isCaptain: player.id === capId,
      isViceCaptain: player.id === vcId,
    };
  }

  function assignPlayer(player: Player) {
    if (!selectedSlot) return;
    const formationConfig = FORMATIONS[formation];
    if (!formationConfig) return;

    if (selectedSlot.type === "xi") {
      const slot = formationConfig.layout[selectedSlot.index];
      if (slot && slot.position !== player.position) {
        toast(`Dieser Slot benötigt ${slot.position}, Spieler ist ${player.position}`, "error");
        return;
      }
      const newXI = [...startingXI];
      const existingIdx = newXI.findIndex(p => p?.id === player.id);
      if (existingIdx !== -1) newXI[existingIdx] = null;
      setBench(prev => prev.filter(p => p.id !== player.id));
      newXI[selectedSlot.index] = player;
      setStartingXI(newXI);
    } else {
      const newBench = [...bench];
      const existingXIIdx = startingXI.findIndex(p => p?.id === player.id);
      if (existingXIIdx !== -1) {
        const newXI = [...startingXI];
        newXI[existingXIIdx] = null;
        setStartingXI(newXI);
      }
      const existingBenchIdx = newBench.findIndex(p => p.id === player.id);
      if (existingBenchIdx !== -1) newBench.splice(existingBenchIdx, 1);
      newBench[selectedSlot.index] = player;
      setBench(newBench);
    }
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

  function changeFormation(newFormation: string) {
    setFormation(newFormation);
    setStartingXI(Array(11).fill(null));
    setSelectedSlot(null);
  }

  async function saveLineup() {
    if (!myTeam) return;
    const xi = startingXI.filter(Boolean) as Player[];
    if (xi.length < 11) { toast("Startelf nicht vollständig (11 Spieler benötigt)", "error"); return; }
    if (!gameweekId) { toast("Kein aktiver Spieltag gefunden", "error"); return; }

    const eliminatedStarters = xi.filter(p => isEliminated(p));
    if (eliminatedStarters.length > 0) {
      const names = eliminatedStarters.length === 1
        ? eliminatedStarters[0].name
        : `${eliminatedStarters.length} Spieler`;
      toast(`⚠ ${names} aus ausgeschiedener Nation — gibt 0 Punkte in GW ${gameweek}!`, "error");
    }

    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/wm/${leagueId}/lineup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          team_id: myTeam.id,
          gameweek_id: gameweekId,
          formation,
          starters: startingXI.filter(Boolean).map(p => p!.id),
          bench: bench.map(p => p.id),
          captain_id: captainId,
          vice_captain_id: viceCaptainId,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        toast(json.error || "Fehler beim Speichern", "error");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      toast("Netzwerkfehler beim Speichern", "error");
    } finally {
      setSaving(false);
    }
  }

  const formationConfig = FORMATIONS[formation];
  const assignedIds = new Set([
    ...startingXI.filter(Boolean).map(p => p!.id),
    ...bench.map(p => p.id),
  ]);
  const unassignedPlayers = draftPicks.filter(p => !assignedIds.has(p.id));
  const maxBench = settings?.bench_size ?? 4;

  const rows = formationConfig
    ? Array.from(new Set(formationConfig.layout.map((s: any) => s.row)))
        .sort((a, b) => (b as number) - (a as number))
        .map(row => ({
          row,
          slots: formationConfig.layout
            .map((s: any, i: number) => ({ ...s, slotIndex: i }))
            .filter((s: any) => s.row === row)
            .sort((a: any, b: any) => a.col - b.col),
        }))
    : [];

  if (isLoading) return (
    <main className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <Spinner text="Lade Aufstellung…" />
    </main>
  );

  if (!isLoading && draftPicks.length === 0) return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6" style={{ background: "var(--bg-page)" }}>
      <p className="text-4xl">📋</p>
      <p className="text-base font-black text-center" style={{ color: "var(--color-primary)" }}>
        Noch kein Kader
      </p>
      <p className="text-xs text-center max-w-xs" style={{ color: "var(--color-muted)" }}>
        Dein WM-Kader wird nach dem Draft hier angezeigt. Erst draften, dann aufstellen.
      </p>
      <button
        onClick={() => window.location.href = `/wm/${leagueId}/draft`}
        className="mt-2 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest"
        style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}
      >
        Zum Draft →
      </button>
      <BottomNav />
    </main>
  );

  const POS_COLOR: Record<string, string> = {
    GK: "var(--color-accent)",
    DF: "var(--color-info)",
    MF: "var(--color-success)",
    FW: "var(--color-error)",
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "var(--bg-page)" }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "var(--color-primary)" }} />

      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-center mb-4">
        <div className="flex flex-col gap-0.5">
          <button onClick={() => window.location.href = `/wm/${leagueId}`}
            className="text-[9px] font-black uppercase tracking-widest text-left" style={{ color: "var(--color-muted)" }}>
            ← WM
          </button>
          <button onClick={() => window.location.href = `/wm/${leagueId}/matchday`}
            className="text-[9px] font-black uppercase tracking-widest text-left" style={{ color: "var(--color-muted)" }}>
            Spielplan →
          </button>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <p className="text-sm font-black" style={{ color: "var(--color-primary)" }}>
            {pageTab === "kader" ? "Kader" : "Aufstellung"}
          </p>
          {isLineupLocked && pageTab === "aufstellung" && (
            <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
              style={{ background: "color-mix(in srgb, var(--color-muted) 15%, transparent)", color: "var(--color-muted)" }}>
              🔒 GW{gameweek} gesperrt
            </span>
          )}
        </div>
        {pageTab === "aufstellung" && !isLineupLocked ? (
          <button onClick={saveLineup} disabled={saving}
            className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50 transition-all"
            style={{ background: saved ? "var(--color-success)" : "var(--color-primary)", color: "var(--bg-page)" }}>
            {saving ? "..." : saved ? "✓ Gespeichert" : "Speichern"}
          </button>
        ) : (
          <div className="w-16" />
        )}
      </div>

      {/* Tab-Switcher */}
      <div className="w-full max-w-md flex mb-4 rounded-xl overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
        {(["aufstellung", "kader"] as const).map(t => (
          <button key={t} onClick={() => setPageTab(t)}
            className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest transition-all"
            style={{
              background: pageTab === t ? "var(--color-primary)" : "transparent",
              color: pageTab === t ? "var(--bg-page)" : "var(--color-muted)",
            }}>
            {t === "aufstellung" ? "Aufstellung" : "Kader"}
          </button>
        ))}
      </div>

      {/* ── KADER-Ansicht ──────────────────────────────────────────────── */}
      {pageTab === "kader" && (
        <div className="w-full max-w-md space-y-1.5">
          {(["GK", "DF", "MF", "FW"] as const).map(pos => {
            const posPlayers = draftPicks.filter(p => p.position === pos);
            if (posPlayers.length === 0) return null;
            return (
              <div key={pos}>
                <p className="text-[8px] font-black uppercase tracking-widest mb-1 mt-2"
                  style={{ color: POS_COLOR[pos] ?? "var(--color-muted)" }}>
                  {pos === "GK" ? "Torhüter" : pos === "DF" ? "Abwehr" : pos === "MF" ? "Mittelfeld" : "Sturm"} · {posPlayers.length}
                </p>
                {posPlayers.map(player => {
                  const elim = isEliminated(player);
                  const gwPts = gwPointsMap[player.id];
                  const inXI = startingXI.some(p => p?.id === player.id);
                  const onBench = bench.some(p => p.id === player.id);
                  const posColor = POS_COLOR[player.position] || "var(--color-text)";
                  return (
                    <div key={player.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                      style={{
                        background: "var(--bg-card)",
                        border: `1px solid ${elim ? "color-mix(in srgb, var(--color-error) 25%, transparent)" : "var(--color-border)"}`,
                        opacity: elim ? 0.7 : 1,
                      }}>
                      {nationFlagMap[player.id] && (
                        <img src={nationFlagMap[player.id]!} className="w-6 h-4 rounded-sm object-cover flex-shrink-0"
                          style={{ border: "1px solid rgba(0,0,0,0.3)" }} alt="" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black truncate" style={{ color: elim ? "var(--color-error)" : "var(--color-text)" }}>
                          {player.name}
                          {player.id === captainId && <span className="ml-1 text-[7px]" style={{ color: "rgba(244,196,48,1)" }}>C</span>}
                          {player.id === viceCaptainId && <span className="ml-1 text-[7px]" style={{ color: "rgba(244,196,48,0.8)" }}>V</span>}
                        </p>
                        <p className="text-[8px] truncate" style={{ color: "var(--color-muted)" }}>{player.team_name}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {inXI && (
                          <span className="text-[7px] font-black px-1.5 py-0.5 rounded-sm"
                            style={{ background: "color-mix(in srgb, var(--color-success) 15%, transparent)", color: "var(--color-success)" }}>XI</span>
                        )}
                        {onBench && (
                          <span className="text-[7px] font-black px-1.5 py-0.5 rounded-sm"
                            style={{ background: "color-mix(in srgb, var(--color-muted) 15%, transparent)", color: "var(--color-muted)" }}>Bank</span>
                        )}
                        <span className="text-[7px] font-black px-1.5 py-0.5 rounded-sm"
                          style={{ background: posColor + "25", color: posColor }}>
                          {player.position}
                        </span>
                        <p className="text-xs font-black w-8 text-right" style={{ color: elim ? "var(--color-error)" : "var(--color-primary)" }}>
                          {elim ? "0" : gwPts !== undefined ? gwPts.toFixed(1) : "—"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {draftPicks.length === 0 && (
            <p className="text-center py-8 text-xs" style={{ color: "var(--color-muted)" }}>Kein Kader vorhanden</p>
          )}
          <p className="text-center text-[8px] pt-2 pb-1" style={{ color: "var(--color-border)" }}>
            {draftPicks.length} Spieler · GW{gameweek} Punkte
          </p>
        </div>
      )}

      {/* ── AUFSTELLUNG ─────────────────────────────────────────────────── */}
      {pageTab === "aufstellung" && <>

      {/* Formation-Selector — nur wenn nicht gesperrt */}
      {!isLineupLocked && (
        <div className="w-full max-w-md mb-4">
          <div className="flex gap-1.5 flex-wrap">
            {(settings?.allowed_formations || Object.keys(FORMATIONS)).map((f: string) => (
              <button key={f} onClick={() => changeFormation(f)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black transition-all"
                style={{
                  background: formation === f ? "var(--color-primary)" : "var(--bg-card)",
                  color: formation === f ? "var(--bg-page)" : "var(--color-muted)",
                  border: `1px solid ${formation === f ? "var(--color-primary)" : "var(--color-border)"}`,
                }}>
                {f}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Spielfeld */}
      <div className="w-full max-w-md rounded-2xl overflow-hidden mb-4"
        style={{
          background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))",
          border: "1px solid color-mix(in srgb, var(--color-success) 15%, var(--bg-page))",
          minHeight: 360,
        }}>
        <div className="relative p-3"
          style={{ background: "linear-gradient(180deg, color-mix(in srgb, var(--color-success) 8%, var(--bg-page)) 0%, var(--bg-page) 100%)" }}>
          <div className="absolute left-3 right-3 top-1/2 h-px opacity-20" style={{ background: "var(--color-success)" }} />
          <div className="absolute left-1/2 top-1/2 w-16 h-16 rounded-full border opacity-10 -translate-x-1/2 -translate-y-1/2"
            style={{ borderColor: "var(--color-success)" }} />

          {rows.map(({ row, slots }: any) => (
            <div key={row} className="flex justify-center gap-2 mb-3">
              {slots.map(({ position, slotIndex }: any) => {
                const player = startingXI[slotIndex];
                const isSelected = !isLineupLocked && selectedSlot?.type === "xi" && selectedSlot.index === slotIndex;
                const elim = player ? isEliminated(player) : false;
                const vm = player ? toVM(player, captainId, viceCaptainId) : null;

                return (
                  <div key={slotIndex}
                    onClick={() => {
                      if (isLineupLocked) {
                        if (player) setSelectedPlayer(player);
                      } else {
                        setSelectedSlot(isSelected ? null : { type: "xi", index: slotIndex });
                      }
                    }}
                    className="flex flex-col items-center cursor-pointer transition-all"
                    style={{ opacity: elim ? 0.7 : 1 }}>

                    <PlayerCardLineup
                      player={vm}
                      variant="pitch"
                      isSwapSelected={isSelected}
                    />

                    {/* Slot-Label wenn leer */}
                    {!player && (
                      <p className="text-[8px] font-black text-center mt-1"
                        style={{ color: "var(--color-border)" }}>
                        {position}
                      </p>
                    )}

                    {/* Remove-Button nur im Edit-Modus */}
                    {player && !isLineupLocked && (
                      <button onClick={e => { e.stopPropagation(); removeFromSlot("xi", slotIndex); }}
                        className="text-[7px] font-black mt-0.5" style={{ color: "var(--color-muted)" }}>✕</button>
                    )}

                    {/* Eliminiert-Badge */}
                    {player && elim && (
                      <span className="text-[6px] font-black px-1 rounded-sm mt-0.5"
                        style={{ background: "color-mix(in srgb, var(--color-error) 20%, transparent)", color: "var(--color-error)" }}>
                        0 Pts
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Locked-Hinweis */}
      {isLineupLocked && (
        <div className="w-full max-w-md mb-3 px-3 py-2 rounded-xl flex items-center gap-2"
          style={{ background: "color-mix(in srgb, var(--color-muted) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--color-muted) 20%, transparent)" }}>
          <span style={{ fontSize: 12 }}>🔒</span>
          <p className="text-[9px] font-black" style={{ color: "var(--color-muted)" }}>
            Aufstellung gesperrt — Änderungen sind für diese Gameweek nicht mehr möglich.
          </p>
        </div>
      )}

      {/* Bank */}
      <div className="w-full max-w-md mb-4">
        <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>
          Bank · {bench.filter(Boolean).length}/{maxBench}
        </p>
        {/* grid-cols-4 wraps 8-slot bench into 2 rows on mobile */}
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: maxBench }).map((_, i) => {
            const player = bench[i];
            const isSelected = !isLineupLocked && selectedSlot?.type === "bench" && selectedSlot.index === i;
            const elim = player ? isEliminated(player) : false;
            const vm = player ? toVM(player, captainId, viceCaptainId) : null;

            return (
              <div key={i}
                onClick={() => {
                  if (isLineupLocked) {
                    if (player) setSelectedPlayer(player);
                  } else {
                    setSelectedSlot(isSelected ? null : { type: "bench", index: i });
                  }
                }}
                className="flex flex-col items-center cursor-pointer transition-all"
                style={{ opacity: elim ? 0.7 : 1 }}>
                <PlayerCardLineup
                  player={vm}
                  variant="bench"
                  benchNumber={i + 1}
                  isSwapSelected={isSelected}
                />
                {player && !isLineupLocked && (
                  <button onClick={e => { e.stopPropagation(); removeFromSlot("bench", i); }}
                    className="text-[7px] mt-0.5" style={{ color: "var(--color-muted)" }}>✕</button>
                )}
                {player && elim && (
                  <span className="text-[6px] font-black px-1 rounded-sm mt-0.5"
                    style={{ background: "color-mix(in srgb, var(--color-error) 20%, transparent)", color: "var(--color-error)" }}>
                    Aus
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Spieler-Auswahl Bottom Sheet */}
      {!isLineupLocked && selectedSlot && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setSelectedSlot(null)}>
          <div className="w-full max-w-md mx-auto rounded-t-3xl pb-8"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)", borderBottom: "none", maxHeight: "70vh", display: "flex", flexDirection: "column" }}
            onClick={e => e.stopPropagation()}>

            {/* Handle + Header */}
            <div className="flex-shrink-0 px-5 pt-4 pb-3">
              <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: "var(--color-border)" }} />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--color-primary)" }}>
                    {selectedSlot.type === "xi"
                      ? `${formationConfig?.layout[selectedSlot.index]?.position || "Slot"} auswählen`
                      : `Bank ${selectedSlot.index + 1} auswählen`}
                  </p>
                  <p className="text-[8px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                    {unassignedPlayers.filter(p =>
                      selectedSlot.type === "bench" ||
                      !formationConfig?.layout[selectedSlot.index] ||
                      p.position === formationConfig.layout[selectedSlot.index].position
                    ).length} verfügbar
                  </p>
                </div>
                <button onClick={() => setSelectedSlot(null)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs"
                  style={{ background: "var(--bg-card)", color: "var(--color-muted)" }}>✕</button>
              </div>
            </div>

            {/* Scrollbare Spielerliste */}
            <div className="flex-1 overflow-y-auto px-4 space-y-1.5 pb-4">
              {unassignedPlayers
                .filter(p => selectedSlot.type === "bench" ||
                  !formationConfig?.layout[selectedSlot.index] ||
                  p.position === formationConfig.layout[selectedSlot.index].position)
                .map(player => {
                  const posColor = POS_COLOR[player.position] || "var(--color-text)";
                  const elim = isEliminated(player);
                  const gwPts = gwPointsMap[player.id];
                  return (
                    <div key={player.id} onClick={() => assignPlayer(player)}
                      className="flex items-center gap-3 p-3 rounded-xl cursor-pointer active:opacity-70 transition-opacity"
                      style={{
                        background: "var(--bg-card)",
                        border: `1px solid ${elim ? "color-mix(in srgb, var(--color-error) 30%, transparent)" : "var(--color-border)"}`,
                        opacity: elim ? 0.75 : 1,
                      }}>
                      {/* Foto */}
                      <div className="w-10 h-12 rounded-lg overflow-hidden flex-shrink-0"
                        style={{ background: "var(--bg-page)" }}>
                        {player.photo_url ? (
                          <img src={player.photo_url} className="w-full h-full object-cover" alt="" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-lg">👤</div>
                        )}
                      </div>
                      {nationFlagMap[player.id] && (
                        <img src={nationFlagMap[player.id]!} className="w-6 h-4 rounded-sm object-cover flex-shrink-0"
                          style={{ border: "1px solid rgba(0,0,0,0.3)" }} alt="" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black truncate" style={{ color: elim ? "var(--color-error)" : "var(--color-text)" }}>{player.name}</p>
                        <p className="text-[8px] truncate" style={{ color: "var(--color-muted)" }}>{player.team_name}</p>
                      </div>
                      <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                        <span className="text-[7px] font-black px-1.5 py-0.5 rounded-sm"
                          style={{ background: posColor + "30", color: posColor }}>
                          {player.position}
                        </span>
                        {elim ? (
                          <span className="text-[7px] font-black px-1.5 py-0.5 rounded-sm"
                            style={{ background: "color-mix(in srgb, var(--color-error) 15%, transparent)", color: "var(--color-error)" }}>
                            Ausgeschieden
                          </span>
                        ) : (
                          <p className="text-xs font-black" style={{ color: "var(--color-primary)" }}>
                            {gwPts !== undefined ? `${gwPts.toFixed(1)} Pts` : "—"}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              {unassignedPlayers.filter(p =>
                selectedSlot.type === "bench" ||
                !formationConfig?.layout[selectedSlot.index] ||
                p.position === formationConfig.layout[selectedSlot.index].position
              ).length === 0 && (
                <p className="text-center py-8 text-xs" style={{ color: "var(--color-muted)" }}>
                  Keine verfügbaren Spieler für diese Position
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Kapitän setzen (nur Edit-Modus) */}
      {!isLineupLocked && !selectedSlot && startingXI.filter(Boolean).length > 0 && (
        <div className="w-full max-w-md mt-2">
          <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>
            Kapitän & Vize-Kapitän
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {startingXI.filter(Boolean).map(player => {
              const isCap = player!.id === captainId;
              const isVC = player!.id === viceCaptainId;
              return (
                <button key={player!.id}
                  onClick={() => {
                    if (!isCap && !isVC) {
                      if (!captainId) setCaptainId(player!.id);
                      else if (!viceCaptainId) setViceCaptainId(player!.id);
                    } else if (isCap) { setCaptainId(null); }
                    else { setViceCaptainId(null); }
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-[9px] font-black transition-all"
                  style={{
                    background: isCap ? "var(--color-primary)" : isVC ? "var(--color-muted)" : "var(--bg-card)",
                    color: isCap ? "var(--bg-page)" : isVC ? "var(--color-primary)" : "var(--color-muted)",
                    border: `1px solid ${isCap ? "var(--color-primary)" : isVC ? "var(--color-muted)" : "var(--color-border)"}`,
                  }}>
                  {isCap ? "© " : isVC ? "V " : ""}{player!.name.split(" ").pop()}
                </button>
              );
            })}
          </div>
          <p className="text-[8px] mt-1" style={{ color: "var(--color-border)" }}>
            Tippe zweimal für Vize-Kapitän · Kapitän × 2 Punkte · Vize × 1.5
          </p>
        </div>
      )}

      {/* GW-Punkte-Übersicht (locked mode) */}
      {isLineupLocked && Object.keys(gwPointsMap).length > 0 && (
        <div className="w-full max-w-md mt-2 p-3 rounded-xl"
          style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
          <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
            GW{gameweek} Gesamt
          </p>
          <p className="text-xl font-black" style={{ color: "var(--color-primary)" }}>
            {(() => {
              const starters = startingXI.filter(Boolean) as Player[];
              let total = 0;
              for (const p of starters) {
                const pts = gwPointsMap[p.id] ?? 0;
                total += p.id === captainId ? pts * 2 : p.id === viceCaptainId ? pts * 1.5 : pts;
              }
              return total.toFixed(1);
            })()} Pts
          </p>
        </div>
      )}

      {/* Player Detail Sheet (Bottom Sheet) */}
      {selectedPlayer && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setSelectedPlayer(null)}
        >
          <div
            className="w-full max-w-md mx-auto rounded-t-3xl p-6 pb-8"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)", borderBottom: "none" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "var(--color-border)" }} />

            <div className="flex items-start gap-4">
              {/* Foto */}
              <div className="relative flex-shrink-0" style={{ width: 72, height: 90 }}>
                {selectedPlayer.photo_url ? (
                  <img src={selectedPlayer.photo_url} className="w-full h-full object-cover rounded-xl" alt="" />
                ) : (
                  <div className="w-full h-full rounded-xl flex items-center justify-center text-2xl"
                    style={{ background: "var(--bg-card)" }}>👤</div>
                )}
                {nationFlagMap[selectedPlayer.id] && (
                  <img src={nationFlagMap[selectedPlayer.id]!}
                    className="absolute -bottom-1 -right-1 rounded-sm object-cover"
                    style={{ width: 22, height: 14, border: "1px solid rgba(0,0,0,0.5)" }} alt="" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-base font-black leading-tight" style={{ color: "var(--color-text)" }}>
                  {selectedPlayer.name}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                  {selectedPlayer.team_name}
                </p>
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  <span className="text-[8px] font-black px-2 py-1 rounded-lg"
                    style={{
                      background: (POS_COLOR[selectedPlayer.position] ?? "var(--color-text)") + "25",
                      color: POS_COLOR[selectedPlayer.position] ?? "var(--color-text)",
                    }}>
                    {selectedPlayer.position}
                  </span>
                  {selectedPlayer.id === captainId && (
                    <span className="text-[8px] font-black px-2 py-1 rounded-lg"
                      style={{ background: "rgba(244,196,48,0.22)", color: "rgba(244,196,48,1)" }}>
                      Kapitän ×2
                    </span>
                  )}
                  {selectedPlayer.id === viceCaptainId && (
                    <span className="text-[8px] font-black px-2 py-1 rounded-lg"
                      style={{ background: "rgba(244,196,48,0.12)", color: "rgba(244,196,48,0.8)" }}>
                      Vize ×1.5
                    </span>
                  )}
                  {isEliminated(selectedPlayer) && (
                    <span className="text-[8px] font-black px-2 py-1 rounded-lg"
                      style={{ background: "color-mix(in srgb, var(--color-error) 20%, transparent)", color: "var(--color-error)" }}>
                      Nation ausgeschieden
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Punkte */}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl text-center" style={{ background: "var(--bg-card)" }}>
                <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
                  GW{gameweek} Punkte
                </p>
                <p className="text-xl font-black" style={{ color: "var(--color-primary)" }}>
                  {gwPointsMap[selectedPlayer.id] !== undefined
                    ? (() => {
                        const base = gwPointsMap[selectedPlayer.id];
                        const mult = selectedPlayer.id === captainId ? 2 : selectedPlayer.id === viceCaptainId ? 1.5 : 1;
                        return (base * mult).toFixed(1);
                      })()
                    : "—"}
                </p>
                {(selectedPlayer.id === captainId || selectedPlayer.id === viceCaptainId) && gwPointsMap[selectedPlayer.id] !== undefined && (
                  <p className="text-[7px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                    Basis: {gwPointsMap[selectedPlayer.id].toFixed(1)}
                  </p>
                )}
              </div>
              <div className="p-3 rounded-xl text-center" style={{ background: "var(--bg-card)" }}>
                <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
                  WM Gesamt
                </p>
                <p className="text-xl font-black" style={{ color: "var(--color-text)" }}>
                  {(() => {
                    // Sum all GW points across all gameweeks for this player
                    // gwPointsMap only has current GW — for now show same value
                    return gwPointsMap[selectedPlayer.id] !== undefined
                      ? gwPointsMap[selectedPlayer.id].toFixed(1)
                      : "—";
                  })()}
                </p>
                <p className="text-[7px] mt-0.5" style={{ color: "var(--color-muted)" }}>nur aktueller GW</p>
              </div>
            </div>

            {gwPointsMap[selectedPlayer.id] === undefined && (
              <p className="text-center text-[9px] mt-3" style={{ color: "var(--color-muted)" }}>
                Noch keine Punkte für GW{gameweek} vorhanden
              </p>
            )}

            <button
              onClick={() => setSelectedPlayer(null)}
              className="w-full mt-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest"
              style={{ background: "var(--bg-card)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
              Schließen
            </button>
          </div>
        </div>
      )}

      </> /* end pageTab === "aufstellung" */}

      <BottomNav />
    </main>
  );
}
