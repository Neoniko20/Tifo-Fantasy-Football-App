"use client";

import type { LineupPlayer } from "@/app/types/lineup";
import { normalizeLineupPlayer } from "@/lib/players/normalizePlayer";
import { PlayerCardLineup } from "@/app/components/players/PlayerCardLineup";

type LayoutSlot = { position: string; slotIndex: number; col: number; row: number };
type PitchRow = { row: number; slots: LayoutSlot[] };

interface LineupPitchProps {
  rows: PitchRow[];
  startingXI: (LineupPlayer | null)[];
  captainId: number | null;
  viceCaptainId: number | null;
  isLocked: boolean;
  canLiveSwap: boolean;
  gwPoints: Record<number, number>;
  gwMinutes: Record<number, number>;
  injuredPlayerIds: Set<number | string>;
  onSlotClick: (slotIndex: number, player: LineupPlayer | null) => void;
  /** tap-to-swap: index of the selected XI slot (null = bench is selected) */
  swapSelectedSlot?: number | null;
  /** tap-to-swap: XI slot indices that are valid swap targets */
  validTargetSlots?: Set<number>;
  /** tap-to-swap: any swap selection is active */
  isSwapActive?: boolean;
  /** selector mode: the XI slot index that is currently selected (for empty slot highlight) */
  selectedSlotIndex?: number | null;
}

function PitchLines() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute left-0 right-0 top-1/2 h-px"
        style={{ background: "color-mix(in srgb, var(--color-primary) 22%, transparent)" }} />
      <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border"
        style={{ borderColor: "color-mix(in srgb, var(--color-primary) 22%, transparent)" }} />
      <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "color-mix(in srgb, var(--color-primary) 40%, transparent)" }} />
      <div className="absolute left-[18%] right-[18%] top-0 h-[90px] border border-t-0"
        style={{ borderColor: "color-mix(in srgb, var(--color-primary) 22%, transparent)" }} />
      <div className="absolute left-[34%] right-[34%] top-0 h-[34px] border border-t-0"
        style={{ borderColor: "color-mix(in srgb, var(--color-primary) 22%, transparent)" }} />
      <div className="absolute left-1/2 top-[60px] h-1 w-1 -translate-x-1/2 rounded-full"
        style={{ background: "color-mix(in srgb, var(--color-primary) 40%, transparent)" }} />
      <div className="absolute left-[18%] right-[18%] bottom-0 h-[90px] border border-b-0"
        style={{ borderColor: "color-mix(in srgb, var(--color-primary) 22%, transparent)" }} />
      <div className="absolute left-[34%] right-[34%] bottom-0 h-[34px] border border-b-0"
        style={{ borderColor: "color-mix(in srgb, var(--color-primary) 22%, transparent)" }} />
      <div className="absolute left-1/2 bottom-[60px] h-1 w-1 -translate-x-1/2 rounded-full"
        style={{ background: "color-mix(in srgb, var(--color-primary) 40%, transparent)" }} />
    </div>
  );
}

export function LineupPitch({
  rows, startingXI, captainId, viceCaptainId,
  isLocked, canLiveSwap,
  gwPoints, gwMinutes, injuredPlayerIds,
  onSlotClick,
  swapSelectedSlot, validTargetSlots, isSwapActive,
  selectedSlotIndex,
}: LineupPitchProps) {
  return (
    <div
      className="w-full max-w-md mb-6"
      style={{ perspective: "700px" }}
    >
    <div
      className="rounded-2xl overflow-hidden relative"
      style={{
        background: "linear-gradient(180deg, color-mix(in srgb, var(--color-primary) 8%, var(--bg-page)) 0%, color-mix(in srgb, #1a2e1a 60%, var(--bg-page)) 100%)",
        border: "1px solid color-mix(in srgb, var(--color-primary) 22%, transparent)",
        minHeight: 640,
        transform: "rotateX(4deg) scale(1.04)",
        transformOrigin: "50% 0%",
        transformStyle: "preserve-3d",
      }}
    >
      <PitchLines />

      {/* Spotlight tight core — top-left */}
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 28% 22% at 14% 2%, rgba(255,228,100,0.14) 0%, transparent 100%)" }} />
      {/* Spotlight soft halo — top-left */}
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 52% 38% at 14% 0%, rgba(255,200,60,0.05) 0%, transparent 100%)" }} />
      {/* Spotlight tight core — top-right */}
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 28% 22% at 86% 2%, rgba(255,228,100,0.22) 0%, transparent 100%)" }} />
      {/* Spotlight soft halo — top-right */}
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 52% 38% at 86% 0%, rgba(255,200,60,0.08) 0%, transparent 100%)" }} />
      {/* Upper bright / lower dark — vertical contrast */}
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: "linear-gradient(to bottom, rgba(255,255,255,0.05) 0%, transparent 38%, rgba(0,0,0,0.38) 100%)" }} />
      {/* Vignette — darkens outer edges */}
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 86% 80% at 50% 50%, transparent 48%, rgba(0,0,0,0.68) 100%)" }} />

      <div className="relative z-10 flex flex-col justify-between p-4" style={{ minHeight: 640 }}>
        {rows.map(({ row, slots }) => (
          <div key={row} className="flex justify-center gap-2">
            {slots.map(({ position: _pos, slotIndex }) => {
              const player = startingXI[slotIndex] ?? null;
              const isCap = player?.id === captainId;
              const isVC  = player?.id === viceCaptainId;
              const playerInjured  = player ? injuredPlayerIds.has(player.id) : false;
              const lockedForSwap  = !!player && canLiveSwap && (gwMinutes[player.id] ?? -1) > 0;
              const liveMin        = player && canLiveSwap && gwMinutes[player.id] !== undefined
                ? gwMinutes[player.id]
                : undefined;

              const isSwapSelected = isSwapActive === true && swapSelectedSlot === slotIndex;
              const isSwapTarget   = isSwapActive === true && swapSelectedSlot !== slotIndex && (validTargetSlots?.has(slotIndex) ?? false);
              const isSlotDimmed   = isSwapActive === true && !isSwapSelected && !isSwapTarget;
              const isSlotSelected = !player && selectedSlotIndex === slotIndex;

              return (
                <div
                  key={slotIndex}
                  onClick={() => onSlotClick(slotIndex, player)}
                  style={{ cursor: (isLocked && !!player) ? "default" : "pointer", position: "relative", zIndex: 20 }}
                >
                  <PlayerCardLineup
                    variant="pitch"
                    player={player ? normalizeLineupPlayer(player, {
                      gwPoints:      gwPoints[player.id] !== undefined ? gwPoints[player.id] : player.fpts,
                      isCaptain:     isCap,
                      isViceCaptain: isVC,
                      isInjured:     playerInjured,
                      isLocked:      isLocked || lockedForSwap,
                      isLive:        canLiveSwap && gwMinutes[player.id] !== undefined,
                      slot:          "starter",
                    }) : null}
                    liveMinutes={liveMin}
                    isSwapSelected={isSwapSelected}
                    isSwapTarget={isSwapTarget}
                    isDimmed={isSlotDimmed}
                    isSelected={isSlotSelected}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
    </div>
  );
}
