"use client";

import type { LineupPlayer, LineupIRSlot } from "@/app/types/lineup";
import { normalizeLineupPlayer } from "@/lib/players/normalizePlayer";
import { PlayerCardLineup } from "@/app/components/players/PlayerCardLineup";

const POS_COLOR: Record<string, string> = {
  GK: "var(--color-primary)",
  DF: "var(--color-info)",
  MF: "var(--color-success)",
  FW: "var(--color-error)",
};

interface IRSectionProps {
  irSlots: LineupIRSlot[];
  irSpotsTotal: number;
  irMinGameweeks: number;
  activeGW: number;
  selectingIR: boolean;
  draftPicks: LineupPlayer[];
  onToggleSelecting: () => void;
  onPlaceOnIR: (player: LineupPlayer) => void;
  onReturnFromIR: (slot: LineupIRSlot) => void;
}

export function IRSection({
  irSlots, irSpotsTotal, irMinGameweeks, activeGW,
  selectingIR, draftPicks,
  onToggleSelecting, onPlaceOnIR, onReturnFromIR,
}: IRSectionProps) {
  return (
    <div className="w-full max-w-md mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span
            className="text-[8px] font-black px-2 py-0.5 rounded-full"
            style={{
              background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))",
              border: "1px solid var(--color-error)",
              color: "var(--color-error)",
            }}
          >
            IR
          </span>
          <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            Injured Reserve · min. {irMinGameweeks} GWs
          </p>
        </div>
        {irSlots.length < irSpotsTotal && (
          <button
            onClick={onToggleSelecting}
            className="text-[8px] font-black px-2 py-1 rounded-lg transition-all"
            style={{
              background: selectingIR ? "var(--color-error)" : "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))",
              color: selectingIR ? "var(--bg-page)" : "var(--color-error)",
              border: "1px solid var(--color-error)",
            }}
          >
            {selectingIR ? "Abbrechen" : "+ Spieler"}
          </button>
        )}
      </div>

      {/* Slot cards — horizontal layout for readability */}
      <div className="space-y-2">
        {irSlots.map((slot) => {
          const canReturn = activeGW >= slot.min_return_gw;
          const gwsLeft   = Math.max(0, slot.min_return_gw - activeGW);
          const lastName  = slot.player?.name.split(" ").pop() ?? "—";

          return (
            <div
              key={slot.id}
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{
                background: "color-mix(in srgb, var(--color-error) 8%, var(--bg-page))",
                border: `1px solid ${canReturn ? "color-mix(in srgb, var(--color-error) 45%, transparent)" : "color-mix(in srgb, var(--color-error) 18%, transparent)"}`,
              }}
            >
              <PlayerCardLineup
                variant="ir"
                player={slot.player ? normalizeLineupPlayer(slot.player, {
                  isInjured: true,
                  slot:      "ir",
                }) : null}
                canReturn={canReturn}
              />

              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-black truncate leading-tight" style={{ color: "var(--color-text)" }}>
                  {lastName}
                </p>
                <p className="text-[8px] font-black mt-0.5" style={{ color: canReturn ? "var(--color-error)" : "var(--color-muted)" }}>
                  {canReturn ? "✓ Bereit zur Rückkehr" : `noch ${gwsLeft} GW${gwsLeft !== 1 ? "s" : ""} gesperrt`}
                </p>
                {slot.player?.team_name && (
                  <p className="text-[7px] truncate mt-0.5" style={{ color: "var(--color-muted)" }}>
                    {slot.player.team_name}
                  </p>
                )}
              </div>

              <button
                onClick={() => onReturnFromIR(slot)}
                disabled={!canReturn}
                className="flex-shrink-0 text-[8px] font-black px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-30"
                style={{
                  background: canReturn ? "color-mix(in srgb, var(--color-error) 18%, var(--bg-page))" : "transparent",
                  color: "var(--color-error)",
                  border: `1px solid ${canReturn ? "var(--color-error)" : "color-mix(in srgb, var(--color-error) 20%, transparent)"}`,
                  cursor: canReturn ? "pointer" : "not-allowed",
                }}
              >
                Zurück
              </button>
            </div>
          );
        })}

        {/* Empty slots */}
        {Array.from({ length: Math.max(0, irSpotsTotal - irSlots.length) }).map((_, i) => (
          <div
            key={`empty-ir-${i}`}
            className="flex items-center gap-3 p-3 rounded-xl"
            style={{
              background: "color-mix(in srgb, var(--color-error) 5%, var(--bg-page))",
              border: "1px dashed color-mix(in srgb, var(--color-error) 18%, transparent)",
            }}
          >
            <PlayerCardLineup variant="ir" player={null} />
            <p className="text-[8px] font-black" style={{ color: "color-mix(in srgb, var(--color-error) 30%, transparent)" }}>
              Leer
            </p>
          </div>
        ))}
      </div>

      {/* Selector panel */}
      {selectingIR && (
        <div className="mt-3 space-y-1 max-h-48 overflow-y-auto">
          <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-error)" }}>
            Spieler auf IR setzen (mind. {irMinGameweeks} GWs gesperrt)
          </p>
          {draftPicks
            .filter(p => !irSlots.find(s => s.player_id === p.id))
            .map(p => (
              <div
                key={p.id}
                onClick={() => onPlaceOnIR(p)}
                className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all"
                style={{ background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))", border: "1px solid color-mix(in srgb, var(--color-error) 15%, var(--bg-page))" }}
                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.borderColor = "var(--color-error)")}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.borderColor = "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))")}
              >
                <img
                  src={p.photo_url}
                  className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                  style={{ border: `1px solid ${(POS_COLOR[p.position] ?? "var(--color-border)")}40` }}
                  alt=""
                />
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
  );
}
