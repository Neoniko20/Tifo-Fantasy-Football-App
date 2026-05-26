"use client";

import { useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import type { MarketPlayerInfo } from "./MarketTab";
import type { LineupPlayer, LineupIRSlot } from "@/app/types/lineup";
import tsdbClubs from "@/lib/tsdb-clubs.json";

// ── Constants ─────────────────────────────────────────────────

const GOLD    = "rgba(244,196,48,";
const CARD_BG = "#090c09";

const POS_LABEL: Record<string, string> = { GK: "TW", DF: "AB", MF: "MF", FW: "ST" };
const POS_COLOR: Record<string, string> = {
  GK: "var(--color-accent)",
  DF: "var(--color-info)",
  MF: "var(--color-success)",
  FW: "var(--color-error)",
};
const POS_SORT: Record<string, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };
const SLOT_SORT: Record<string, number> = { XI: 0, Bank: 1, IR: 2, Taxi: 3 };

const clubColor = (name?: string | null): string | undefined =>
  name ? ((tsdbClubs as Record<string, any>)[name]?.colour1 ?? undefined) : undefined;

// ── Exported types ────────────────────────────────────────────

export interface MarketSwapSheetProps {
  player:       MarketPlayerInfo;
  myTeam:       { id: string; name: string };
  draftPicks:   LineupPlayer[];
  startingXI:   (LineupPlayer | null)[];
  bench:        LineupPlayer[];
  irSlots:      LineupIRSlot[];
  taxiSquad:    LineupPlayer[];
  ligaSettings: any;
  leagueId:     string;
  activeGW:     number;
  onSuccess:    (wasStarter: boolean) => void;
  onClose:      () => void;
}

// ── Internal helpers ──────────────────────────────────────────

async function postSystemMessage(leagueId: string, content: string, metadata: Record<string, unknown> = {}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? "";
    if (!token) {
      console.warn("[system-message] no session token, skipping");
      return;
    }
    const res = await fetch(`/api/leagues/${leagueId}/system-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ content, metadata }),
    });
    if (!res.ok) {
      console.warn("[system-message] failed:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.warn("[system-message] error:", err);
  }
}

type SlotLabel = "XI" | "Bank" | "IR" | "Taxi";

function getSlot(
  id:       number,
  xiIds:    Set<number>,
  benchIds: Set<number>,
  irIds:    Set<number>,
  taxiIds:  Set<number>,
): SlotLabel {
  if (xiIds.has(id))    return "XI";
  if (benchIds.has(id)) return "Bank";
  if (irIds.has(id))    return "IR";
  if (taxiIds.has(id))  return "Taxi";
  return "Bank";
}

function validateAdd(
  player:   MarketPlayerInfo,
  squad:    LineupPlayer[],
  dropId:   number | null,
  settings: any,
): string[] {
  const errors: string[] = [];
  const afterDrop = dropId ? squad.filter(p => p.id !== dropId) : squad;

  // Squad size check (only relevant for direct add)
  if (!dropId) {
    const maxSquad = settings?.squad_size || 15;
    if (squad.length >= maxSquad) {
      errors.push(`Kader voll (max. ${maxSquad} Spieler)`);
    }
  }

  // Position limit check
  const posLimits = settings?.position_limits;
  if (posLimits?.[player.position]) {
    const count    = afterDrop.filter(p => p.position === player.position).length;
    const maxInPos = posLimits[player.position].max;
    if (count >= maxInPos) {
      errors.push(
        `${POS_LABEL[player.position] || player.position}-Limit erreicht (max. ${maxInPos})`,
      );
    }
  }

  return errors;
}

// ── Slot badge component ──────────────────────────────────────

function SlotBadge({ slot }: { slot: SlotLabel }) {
  const styles: Record<SlotLabel, { bg: string; color: string }> = {
    XI:   { bg: "rgba(60,180,60,0.15)",   color: "var(--color-success)" },
    Bank: { bg: "rgba(80,100,200,0.15)",  color: "var(--color-info)"    },
    IR:   { bg: "rgba(220,50,50,0.15)",   color: "var(--color-error)"   },
    Taxi: { bg: `${GOLD}0.10)`,           color: `${GOLD}0.80)`         },
  };
  const s = styles[slot];
  return (
    <span className="text-[6px] font-black px-1.5 py-0.5 rounded flex-shrink-0"
      style={{ background: s.bg, color: s.color }}>
      {slot}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────

export function MarketSwapSheet({
  player, myTeam, draftPicks, startingXI, bench, irSlots, taxiSquad,
  ligaSettings, leagueId, activeGW, onSuccess, onClose,
}: MarketSwapSheetProps) {
  const [selectedDrop, setSelectedDrop] = useState<LineupPlayer | null>(null);
  const [saving,       setSaving]       = useState(false);
  const [mutError,     setMutError]     = useState<string | null>(null);

  // Slot ID sets
  const xiIds    = useMemo(() => new Set(startingXI.filter(Boolean).map(p => p!.id)), [startingXI]);
  const benchIds = useMemo(() => new Set(bench.map(p => p.id)), [bench]);
  const irIds    = useMemo(() => new Set(irSlots.map(s => s.player_id)), [irSlots]);
  const taxiIds  = useMemo(() => new Set(taxiSquad.map(p => p.id)), [taxiSquad]);

  // Squad sorted by slot then position
  const sortedSquad = useMemo(() =>
    [...draftPicks].sort((a, b) => {
      const sd = SLOT_SORT[getSlot(a.id, xiIds, benchIds, irIds, taxiIds)]
               - SLOT_SORT[getSlot(b.id, xiIds, benchIds, irIds, taxiIds)];
      if (sd !== 0) return sd;
      const pd = (POS_SORT[a.position] ?? 9) - (POS_SORT[b.position] ?? 9);
      if (pd !== 0) return pd;
      return a.name.localeCompare(b.name);
    }),
  [draftPicks, xiIds, benchIds, irIds, taxiIds]);

  // Validation
  const directErrors = useMemo(
    () => validateAdd(player, draftPicks, null, ligaSettings),
    [player, draftPicks, ligaSettings],
  );
  const swapErrors = useMemo(
    () => selectedDrop ? validateAdd(player, draftPicks, selectedDrop.id, ligaSettings) : [],
    [player, draftPicks, selectedDrop, ligaSettings],
  );

  const canDirectAdd = directErrors.length === 0;
  const canSwap      = selectedDrop !== null && swapErrors.length === 0;

  // ── Mutation ────────────────────────────────────────────────
  async function doAdd(playerOut?: LineupPlayer) {
    setSaving(true);
    setMutError(null);
    try {
      const currentXIIds    = startingXI.filter(Boolean).map(p => p!.id);
      const currentBenchIds = bench.map(p => p.id);
      const wasIR           = playerOut ? irSlots.some(s => s.player_id === playerOut.id) : false;
      const wasInXI         = playerOut ? currentXIIds.includes(playerOut.id) : false;
      const wasTaxi         = playerOut ? taxiSquad.some(p => p.id === playerOut.id) : false;
      const droppedSlot     = wasIR ? "IR" : wasInXI ? "XI" : wasTaxi ? "Taxi" : "Bank";

      console.log("[MarketSwap] start", {
        addedPlayer:   { id: player.id, name: player.name },
        droppedPlayer: playerOut ? { id: playerOut.id, name: playerOut.name, slot: droppedSlot } : null,
        starterCount:  currentXIIds.length,
        benchCount:    currentBenchIds.length,
        irCount:       irSlots.length,
        taxiCount:     taxiSquad.length,
      });

      let wasStarter  = wasInXI && !wasIR;
      let newBenchIds = [...currentBenchIds];

      if (playerOut) {
        newBenchIds = newBenchIds.filter(id => id !== playerOut.id);

        await supabase
          .from("squad_players")
          .update({ player_id: player.id })
          .eq("team_id", myTeam.id)
          .eq("player_id", playerOut.id);

        await supabase.from("liga_transfers").insert({
          team_id:       myTeam.id,
          league_id:     leagueId,
          player_out_id: playerOut.id,
          player_in_id:  player.id,
        });

        postSystemMessage(leagueId, `🔄 Transfer: ${myTeam?.name ?? "Team"} holt ${player.name}, gibt ${playerOut.name} ab`, {
          event: "transfer_completed",
          player_in: player.name,
          player_out: playerOut.name,
        });

        // Clear IR slot if dropped player was on IR
        if (wasIR) {
          await supabase
            .from("liga_ir_slots")
            .update({ returned_at_gw: activeGW })
            .eq("team_id", myTeam.id)
            .eq("player_id", playerOut.id)
            .is("returned_at_gw", null);
        }
      } else {
        await supabase.from("squad_players").insert({
          team_id:   myTeam.id,
          player_id: player.id,
        });
      }

      // New player always lands on bench.
      // Only update bench — never touch starting_xi here.
      // loadLineupWithPlayers will naturally null-out the dropped player's XI slot
      // because the player is gone from squad_players.
      newBenchIds = [...newBenchIds, player.id];

      await supabase.from("liga_lineups").upsert({
        team_id:    myTeam.id,
        league_id:  leagueId,
        gameweek:   activeGW,
        bench:      newBenchIds,
        updated_at: new Date().toISOString(),
      }, { onConflict: "team_id,gameweek" });

      console.log("[MarketSwap] done", {
        wasStarter,
        newBenchIds,
      });

      onSuccess(wasStarter);
    } catch (err) {
      console.error("[MarketSwap] error", err);
      setMutError("Fehler beim Speichern. Bitte versuche es erneut.");
      setSaving(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────
  const c1       = clubColor(player.team_name);
  const posColor = POS_COLOR[player.position] || "var(--color-text)";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.88)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-md rounded-t-3xl flex flex-col"
        style={{ background: CARD_BG, maxHeight: "88vh" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-8 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.14)" }} />
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-7 h-7 flex items-center justify-center rounded-full"
          style={{ background: "rgba(0,0,0,0.52)", color: "rgba(255,255,255,0.45)", fontSize: 11 }}
        >
          ✕
        </button>

        {/* ── Header: incoming player ─────────────────────────── */}
        <div
          className="flex items-center gap-3 px-5 py-3 flex-shrink-0"
          style={{
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            background: c1
              ? `radial-gradient(ellipse 100% 120% at 110% 50%, ${c1}18 0%, transparent 100%)`
              : undefined,
          }}
        >
          <img
            src={player.photo_url || "/player-placeholder.png"}
            alt={player.name}
            className="w-12 h-12 rounded-xl object-cover object-top flex-shrink-0"
            style={{
              filter: "saturate(0.80) contrast(1.05)",
              border: `1px solid ${c1 ? `${c1}40` : "rgba(255,255,255,0.08)"}`,
            }}
            onError={e => { (e.target as HTMLImageElement).src = "/player-placeholder.png"; }}
          />
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm leading-tight text-white truncate">{player.name}</p>
            <p className="text-[8px] font-black uppercase tracking-widest truncate mt-0.5"
              style={{ color: c1 ? `${c1}cc` : "rgba(255,255,255,0.35)" }}>
              {player.team_name ?? "–"}
            </p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-[7px] font-black px-1.5 py-0.5 rounded"
                style={{ background: posColor, color: "#050301" }}>
                {POS_LABEL[player.position] || player.position}
              </span>
              {player.fpts !== null && player.fpts !== undefined && (
                <span className="text-[8px] font-black"
                  style={{ color: "rgba(255,255,255,0.55)" }}>
                  {player.fpts.toFixed(1)} Pts
                </span>
              )}
              <span className="text-[7px] font-black px-1.5 py-0.5 rounded"
                style={{
                  background: "rgba(60,180,60,0.15)",
                  color: "var(--color-success)",
                  border: "1px solid rgba(60,180,60,0.25)",
                }}>
                Freier Spieler
              </span>
            </div>
          </div>
        </div>

        {/* ── Scrollable body ──────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 px-5 py-4">

          {/* Direct add section */}
          <p className="text-[8px] font-black uppercase tracking-widest mb-2"
            style={{ color: "rgba(255,255,255,0.35)" }}>
            {canDirectAdd ? "Direkt hinzufügen" : "Direkt hinzufügen nicht möglich"}
          </p>

          {canDirectAdd ? (
            <button
              onClick={() => doAdd()}
              disabled={saving}
              className="w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40 mb-5"
              style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}
            >
              {saving ? "Wird hinzugefügt…" : `+ ${player.name} hinzufügen`}
            </button>
          ) : (
            <div className="space-y-1 mb-5">
              {directErrors.map((err, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{
                    background: "rgba(220,50,50,0.08)",
                    border: "1px solid rgba(220,50,50,0.18)",
                  }}>
                  <span className="text-[10px] font-black" style={{ color: "var(--color-error)" }}>!</span>
                  <p className="text-[8px] font-black" style={{ color: "var(--color-error)" }}>{err}</p>
                </div>
              ))}
            </div>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
            <p className="text-[7px] font-black uppercase tracking-widest"
              style={{ color: "rgba(255,255,255,0.25)" }}>
              oder Spieler ersetzen
            </p>
            <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
          </div>

          {/* Squad list */}
          <p className="text-[8px] font-black uppercase tracking-widest mb-2"
            style={{ color: "rgba(255,255,255,0.35)" }}>
            Wähle einen Spieler zum Ersetzen
          </p>
          <div className="space-y-1.5 pb-6">
            {sortedSquad.map(sq => {
              const isSelected = selectedDrop?.id === sq.id;
              const slot       = getSlot(sq.id, xiIds, benchIds, irIds, taxiIds);
              const pColor     = POS_COLOR[sq.position] || "var(--color-muted)";
              const sc1        = clubColor(sq.team_name);

              return (
                <button
                  key={sq.id}
                  onClick={() => setSelectedDrop(prev => prev?.id === sq.id ? null : sq)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all"
                  style={{
                    background: isSelected
                      ? `${GOLD}0.06)`
                      : "rgba(255,255,255,0.03)",
                    border: `1.5px solid ${isSelected
                      ? `${GOLD}0.65)`
                      : "rgba(255,255,255,0.07)"}`,
                  }}
                >
                  {/* Position badge */}
                  <span
                    className="text-[7px] font-black px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ background: pColor, color: "#050301", minWidth: 22, textAlign: "center" }}
                  >
                    {POS_LABEL[sq.position] || sq.position}
                  </span>

                  {/* Name + club */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black leading-tight truncate"
                      style={{ color: isSelected ? `${GOLD}1)` : "rgba(255,255,255,0.90)" }}>
                      {sq.name}
                    </p>
                    <p className="text-[7px] font-black uppercase truncate mt-0.5"
                      style={{ color: sc1 ? `${sc1}aa` : "rgba(255,255,255,0.28)" }}>
                      {sq.team_name}
                    </p>
                  </div>

                  {/* Season pts */}
                  <span className="text-[9px] font-black flex-shrink-0"
                    style={{ color: "rgba(255,255,255,0.45)" }}>
                    {sq.fpts != null ? sq.fpts.toFixed(1) : "–"}
                  </span>

                  {/* Slot badge */}
                  <SlotBadge slot={slot} />

                  {/* Selected X icon */}
                  {isSelected && (
                    <span className="text-[10px] flex-shrink-0"
                      style={{ color: `${GOLD}0.90)` }}>
                      ✕
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Sticky footer: swap confirm ──────────────────────── */}
        {selectedDrop && (
          <div
            className="flex-shrink-0 px-5 pt-3 pb-6"
            style={{ borderTop: "1px solid rgba(255,255,255,0.07)", background: CARD_BG }}
          >
            {/* Swap preview */}
            <div className="flex items-stretch gap-2 mb-3">
              <div className="flex-1 min-w-0 px-3 py-2 rounded-lg"
                style={{
                  background: "rgba(220,50,50,0.08)",
                  border: "1px solid rgba(220,50,50,0.20)",
                }}>
                <p className="text-[6px] font-black uppercase tracking-widest mb-0.5"
                  style={{ color: "var(--color-error)" }}>
                  Raus
                </p>
                <p className="text-[9px] font-black truncate"
                  style={{ color: "rgba(255,255,255,0.80)" }}>
                  {selectedDrop.name}
                </p>
              </div>

              <div className="flex items-center flex-shrink-0 px-1"
                style={{ color: "rgba(255,255,255,0.25)" }}>
                →
              </div>

              <div className="flex-1 min-w-0 px-3 py-2 rounded-lg"
                style={{
                  background: "rgba(60,180,60,0.08)",
                  border: "1px solid rgba(60,180,60,0.20)",
                }}>
                <p className="text-[6px] font-black uppercase tracking-widest mb-0.5"
                  style={{ color: "var(--color-success)" }}>
                  Rein
                </p>
                <p className="text-[9px] font-black truncate"
                  style={{ color: "rgba(255,255,255,0.80)" }}>
                  {player.name}
                </p>
              </div>
            </div>

            {/* Swap validation errors */}
            {swapErrors.length > 0 && (
              <div className="mb-3 space-y-1">
                {swapErrors.map((err, i) => (
                  <div key={i} className="px-3 py-2 rounded-lg"
                    style={{
                      background: "rgba(220,50,50,0.08)",
                      border: "1px solid rgba(220,50,50,0.18)",
                    }}>
                    <p className="text-[8px] font-black" style={{ color: "var(--color-error)" }}>
                      {err}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Mutation error */}
            {mutError && (
              <p className="text-[8px] font-black text-center mb-2"
                style={{ color: "var(--color-error)" }}>
                {mutError}
              </p>
            )}

            {/* Confirm button */}
            <button
              onClick={() => doAdd(selectedDrop)}
              disabled={saving || !canSwap}
              className="w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-40 transition-all"
              style={{
                background: canSwap ? "var(--color-primary)" : "var(--bg-elevated)",
                color:      canSwap ? "var(--bg-page)"       : "var(--color-muted)",
                border:     canSwap ? "none" : "1px solid var(--color-border)",
              }}
            >
              {saving
                ? "Wird gespeichert…"
                : `${selectedDrop.name} ersetzen`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
