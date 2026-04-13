"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { FORMATIONS } from "@/lib/wm-formations";
import { validateFormation } from "@/lib/wm-formations";
import type { Position } from "@/lib/wm-types";
import { useToast } from "@/app/components/ToastProvider";
import { PlayerCard } from "@/app/components/PlayerCard";

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
  position: Position;
  team_name: string;
  fpts: number;
  nation_id?: string;
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
  const { toast } = useToast();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
    });
  }, []);

  async function loadAll(userId: string) {
    // Team
    const { data: team } = await supabase
      .from("teams").select("*").eq("league_id", leagueId).eq("user_id", userId).single();
    setMyTeam(team);

    // Settings
    const { data: settingsData } = await supabase
      .from("wm_league_settings").select("*").eq("league_id", leagueId).maybeSingle();
    setSettings(settingsData);
    if (settingsData?.allowed_formations?.[0]) {
      setFormation(settingsData.allowed_formations[0]);
    }

    if (!team) return;

    // Draft-Picks (mein Kader)
    const { data: picks } = await supabase
      .from("squad_players")
      .select("player_id")
      .eq("team_id", team.id);

    let playersData: any[] = [];
    if (picks && picks.length > 0) {
      const playerIds = picks.map(p => p.player_id);
      const { data: fetched } = await supabase
        .from("players")
        .select("id, name, photo_url, position, team_name, fpts")
        .in("id", playerIds);
      playersData = fetched || [];
      setDraftPicks(playersData);
    }

    // Gespeicherte Aufstellung laden
    const { data: lineup } = await supabase
      .from("team_lineups")
      .select("*")
      .eq("team_id", team.id)
      .eq("gameweek", gameweek)
      .maybeSingle();

    if (lineup && playersData.length > 0) {
      setFormation(lineup.formation);
      setCaptainId(lineup.captain_id);
      setViceCaptainId(lineup.vice_captain_id);
      // Spieler-Objekte für gespeicherte XI/Bench wiederherstellen
      const allPlayers = playersData as Player[];
      const xi = (lineup.starting_xi as number[]).map(
        (id: number) => allPlayers.find(p => p.id === id) || null
      );
      const benchArr = (lineup.bench as number[]).map(
        (id: number) => allPlayers.find(p => p.id === id)
      ).filter(Boolean) as Player[];
      setStartingXI(xi);
      setBench(benchArr);
    }
  }

  // Spieler in Slot zuweisen
  function assignPlayer(player: Player) {
    if (!selectedSlot) return;
    const formationConfig = FORMATIONS[formation];
    if (!formationConfig) return;

    if (selectedSlot.type === "xi") {
      const slot = formationConfig.layout[selectedSlot.index];
      // Position-Check
      if (slot && slot.position !== player.position) {
        toast(`Dieser Slot benötigt ${slot.position}, Spieler ist ${player.position}`, "error");
        return;
      }
      const newXI = [...startingXI];
      // Alten Spieler raus (falls schon woanders zugewiesen)
      const existingIdx = newXI.findIndex(p => p?.id === player.id);
      if (existingIdx !== -1) newXI[existingIdx] = null;
      // Vom Bench entfernen falls nötig
      setBench(prev => prev.filter(p => p.id !== player.id));
      newXI[selectedSlot.index] = player;
      setStartingXI(newXI);
    } else {
      // Bank-Slot
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

  // Spieler aus Slot entfernen
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

  // Formation wechseln — XI leeren
  function changeFormation(newFormation: string) {
    setFormation(newFormation);
    setStartingXI(Array(11).fill(null));
    setSelectedSlot(null);
  }

  async function saveLineup() {
    if (!myTeam) return;
    const xi = startingXI.filter(Boolean) as Player[];
    if (xi.length < 11) { toast("Startelf nicht vollständig (11 Spieler benötigt)", "error"); return; }

    const validation = validateFormation(xi.map(p => p.position), formation);
    if (!validation.valid) { toast(`Formation nicht erfüllt: ${validation.errors.join(", ")}`, "error"); return; }

    setSaving(true);
    await supabase.from("team_lineups").upsert({
      team_id: myTeam.id,
      tournament_id: settings?.tournament_id,
      gameweek,
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
    setTimeout(() => setSaved(false), 2000);
  }

  const formationConfig = FORMATIONS[formation];
  const assignedIds = new Set([
    ...startingXI.filter(Boolean).map(p => p!.id),
    ...bench.map(p => p.id),
  ]);
  const unassignedPlayers = draftPicks.filter(p => !assignedIds.has(p.id));
  const maxBench = settings?.bench_size ?? 4;

  // Spielfeld-Reihen aus Formation-Layout ableiten
  const rows = formationConfig
    ? Array.from(new Set(formationConfig.layout.map(s => s.row)))
        .sort((a, b) => b - a) // FW oben, GK unten
        .map(row => ({
          row,
          slots: formationConfig.layout
            .map((s, i) => ({ ...s, slotIndex: i }))
            .filter(s => s.row === row)
            .sort((a, b) => a.col - b.col),
        }))
    : [];

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "var(--bg-page)" }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "var(--color-primary)" }} />

      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-center mb-4">
        <button onClick={() => window.location.href = `/wm/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          ← WM
        </button>
        <p className="text-sm font-black" style={{ color: "var(--color-primary)" }}>Aufstellung</p>
        <button onClick={saveLineup} disabled={saving}
          className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50 transition-all"
          style={{ background: saved ? "var(--color-success)" : "var(--color-primary)", color: "var(--bg-page)" }}>
          {saving ? "..." : saved ? "✓ Gespeichert" : "Speichern"}
        </button>
      </div>

      {/* Formation-Selector */}
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

      {/* Spielfeld */}
      <div className="w-full max-w-md rounded-2xl overflow-hidden mb-4"
        style={{ background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))", border: "1px solid color-mix(in srgb, var(--color-success) 15%, var(--bg-page))", minHeight: 360 }}>
        {/* Feld-Markierungen */}
        <div className="relative p-3" style={{ background: "linear-gradient(180deg, color-mix(in srgb, var(--color-success) 8%, var(--bg-page)) 0%, var(--bg-page) 100%)" }}>
          {/* Mittellinie */}
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
                    onClick={() => setSelectedSlot(isSelected ? null : { type: "xi", index: slotIndex })}
                    className="flex flex-col items-center cursor-pointer transition-all"
                    style={{ width: 64 }}>
                    {/* Avatar */}
                    <PlayerCard player={player} posColor={posColor} size={44} selected={isSelected} posLabel={position} isCap={isCap} isVC={isVC} />
                    {/* Name */}
                    <p className="text-[8px] font-black text-center leading-tight mt-1 truncate w-full"
                      style={{ color: player ? "var(--color-text)" : "var(--color-border)" }}>
                      {player ? player.name.split(" ").pop() : position}
                    </p>
                    {player && (
                      <div className="flex gap-1 mt-0.5">
                        <span className="text-[7px] font-black" style={{ color: "var(--color-primary)" }}>
                          {player.fpts?.toFixed(0)}
                        </span>
                        <button onClick={e => { e.stopPropagation(); removeFromSlot("xi", slotIndex); }}
                          className="text-[7px] font-black" style={{ color: "var(--color-muted)" }}>✕</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Bank */}
      <div className="w-full max-w-md mb-4">
        <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>
          Bank · {bench.filter(Boolean).length}/{maxBench}
        </p>
        <div className="flex gap-2">
          {Array.from({ length: maxBench }).map((_, i) => {
            const player = bench[i];
            const isSelected = selectedSlot?.type === "bench" && selectedSlot.index === i;
            return (
              <div key={i}
                onClick={() => setSelectedSlot(isSelected ? null : { type: "bench", index: i })}
                className="flex-1 flex flex-col items-center p-2 rounded-xl cursor-pointer transition-all"
                style={{
                  background: isSelected ? "var(--bg-elevated)" : "var(--bg-card)",
                  border: `1px solid ${isSelected ? "var(--color-primary)" : "var(--color-border)"}`,
                }}>
                <PlayerCard player={player ?? null} posColor={player ? (POS_COLOR[player.position] || "var(--color-text)") : "var(--color-border)"} size={36} selected={isSelected} posLabel={String(i + 1)} />
                <p className="text-[7px] font-black text-center truncate w-full mt-1"
                  style={{ color: player ? "var(--color-text)" : "var(--color-border)" }}>
                  {player ? player.name.split(" ").pop() : "—"}
                </p>
                {player && (
                  <button onClick={e => { e.stopPropagation(); removeFromSlot("bench", i); }}
                    className="text-[7px]" style={{ color: "var(--color-muted)" }}>✕</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Spieler-Pool (unassigned) */}
      {selectedSlot && (
        <div className="w-full max-w-md">
          <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-primary)" }}>
            Spieler auswählen für {selectedSlot.type === "xi"
              ? formationConfig?.layout[selectedSlot.index]?.position || "Slot"
              : `Bank ${selectedSlot.index + 1}`}
          </p>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {unassignedPlayers
              .filter(p => selectedSlot.type === "bench" ||
                !formationConfig?.layout[selectedSlot.index] ||
                p.position === formationConfig.layout[selectedSlot.index].position)
              .map(player => {
                const posColor = POS_COLOR[player.position] || "var(--color-text)";
                return (
                  <div key={player.id} onClick={() => assignPlayer(player)}
                    className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all"
                    style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--color-primary)")}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--color-border)")}>
                    <PlayerCard player={player} posColor={posColor} size={32} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black truncate" style={{ color: "var(--color-text)" }}>{player.name}</p>
                      <p className="text-[8px] truncate" style={{ color: "var(--color-muted)" }}>{player.team_name}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-black" style={{ color: "var(--color-primary)" }}>{player.fpts?.toFixed(0)}</p>
                      <span className="text-[7px] font-black px-1.5 py-0.5 rounded-sm"
                        style={{ background: posColor + "30", color: posColor }}>
                        {player.position}
                      </span>
                    </div>
                  </div>
                );
              })}
            {unassignedPlayers.filter(p =>
              selectedSlot.type === "bench" ||
              !formationConfig?.layout[selectedSlot.index] ||
              p.position === formationConfig.layout[selectedSlot.index].position
            ).length === 0 && (
              <p className="text-center py-4 text-xs" style={{ color: "var(--color-muted)" }}>
                Keine verfügbaren Spieler für diese Position
              </p>
            )}
          </div>
        </div>
      )}

      {/* Kapitän setzen (wenn kein Slot ausgewählt) */}
      {!selectedSlot && startingXI.filter(Boolean).length > 0 && (
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
    </main>
  );
}
