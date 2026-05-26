"use client";

import type { LineupPlayer } from "@/app/types/lineup";
import { normalizeLineupPlayer } from "@/lib/players/normalizePlayer";
import { PlayerCardLineup } from "@/app/components/players/PlayerCardLineup";

interface BenchSectionProps {
  bench: LineupPlayer[];
  benchSize: number;
  isLocked: boolean;
  selectedSlot: { type: "xi" | "bench"; index: number } | null;
  gwPoints: Record<number, number>;
  injuredPlayerIds: Set<number | string>;
  captainId?: number | null;
  viceCaptainId?: number | null;
  onSlotClick: (index: number, player: LineupPlayer | null) => void;
  /** tap-to-swap: index of the selected bench slot (null = XI is selected) */
  swapSelectedBench?: number | null;
  /** tap-to-swap: bench indices that are valid swap targets */
  validTargetBench?: Set<number>;
  /** tap-to-swap: any swap selection is active */
  isSwapActive?: boolean;
}

export function BenchSection({
  bench, benchSize, isLocked, selectedSlot, gwPoints, injuredPlayerIds,
  captainId, viceCaptainId,
  onSlotClick, swapSelectedBench, validTargetBench, isSwapActive,
}: BenchSectionProps) {
  const displayCount = Math.max(bench.length, benchSize);

  return (
    <div className="w-full max-w-md mb-6">
      <div className="flex items-center gap-2 mb-2.5">
        <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Bank · {bench.filter(Boolean).length}/{benchSize}
        </p>
        {bench.length > benchSize && (
          <span
            className="text-[8px] font-black px-1.5 py-0.5 rounded-full"
            style={{
              background: "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))",
              color: "var(--color-error)",
              border: "1px solid color-mix(in srgb, var(--color-error) 40%, transparent)",
            }}
          >
            +{bench.length - benchSize} überschuss
          </span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: displayCount }).map((_, i) => {
          const player       = bench[i] ?? null;
          const isSelected   = selectedSlot?.type === "bench" && selectedSlot.index === i;
          const isOverflow   = i >= benchSize;
          const isSwapSelected = isSwapActive === true && swapSelectedBench === i;
          const isSwapTarget   = isSwapActive === true && swapSelectedBench !== i && (validTargetBench?.has(i) ?? false);
          const isSlotDimmed   = isSwapActive === true && !isSwapSelected && !isSwapTarget;

          return (
            <div
              key={i}
              onClick={() => onSlotClick(i, player)}
              style={{ cursor: isLocked ? "default" : "pointer", position: "relative", zIndex: 20 }}
            >
              <PlayerCardLineup
                variant="bench"
                player={player ? normalizeLineupPlayer(player, {
                  gwPoints:      gwPoints[player.id],
                  isCaptain:     player.id === captainId,
                  isViceCaptain: player.id === viceCaptainId,
                  isInjured:     injuredPlayerIds.has(player.id),
                  isLocked,
                  slot:          "bench",
                }) : null}
                benchNumber={i + 1}
                isOverflow={isOverflow}
                isSelected={isSelected}
                isSwapSelected={isSwapSelected}
                isSwapTarget={isSwapTarget}
                isDimmed={isSlotDimmed}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
