"use client";

import type { PlayerCardViewModel } from "@/app/types/player";
import { getVisualTier } from "@/lib/players/visualTier";
import { PlayerImage } from "./PlayerImage";
import tsdbClubs from "@/lib/tsdb-clubs.json";

const clubColor = (slug?: string): string | undefined =>
  slug ? ((tsdbClubs as Record<string, any>)[slug]?.colour1 ?? undefined) : undefined;

const POS_COLOR: Record<string, string> = {
  TW: "var(--color-accent)",
  AB: "var(--color-info)",
  MF: "var(--color-success)",
  ST: "var(--color-error)",
  // WM position codes
  GK: "var(--color-accent)",
  DF: "var(--color-info)",
  FW: "var(--color-error)",
};

const CARD_BG = "#090c09";
const GOLD    = "rgba(244,196,48,";

export type LineupCardVariant = "pitch" | "bench" | "ir" | "taxi";

export interface PlayerCardLineupProps {
  player:       PlayerCardViewModel | null;
  variant:      LineupCardVariant;
  /** bench: 1-based slot index shown as badge */
  benchNumber?: number;
  /** bench: slot exceeds roster limit */
  isOverflow?:  boolean;
  /** bench: card is the active selection (legacy slot selector) */
  isSelected?:  boolean;
  /** ir: player is eligible to return */
  canReturn?:   boolean;
  /** pitch: live minutes played this GW */
  liveMinutes?: number;
  /** tap-to-swap: this card is the selected source */
  isSwapSelected?: boolean;
  /** tap-to-swap: this card is a valid swap target */
  isSwapTarget?:   boolean;
  /** tap-to-swap: swap is active but this card is not a valid target */
  isDimmed?:       boolean;
}

// ═══════════════════════════════════════════════════════════════
//  PITCH  (72 × 100)
// ═══════════════════════════════════════════════════════════════

function PitchCard({ vm, liveMinutes, isSwapSelected, isSwapTarget, isDimmed }: {
  vm: PlayerCardViewModel; liveMinutes?: number;
  isSwapSelected?: boolean; isSwapTarget?: boolean; isDimmed?: boolean;
}) {
  const tier      = getVisualTier(vm);
  const posColor  = POS_COLOR[vm.positionLabel] ?? "var(--color-text)";
  const lastName  = vm.name.split(" ").pop() ?? vm.name;
  const hasPoints = vm.gameweekPoints !== undefined;
  const isLocked  = vm.status === "locked";
  const isHero    = tier === "hero" || !!vm.isCaptain;
  const c1        = clubColor(vm.clubSlug);

  const showCapVC  = vm.isCaptain || vm.isViceCaptain;
  const showLive   = !showCapVC && liveMinutes !== undefined;
  const showInjury = !showCapVC && !showLive && !!vm.isInjured;

  // Captain gets strongest ring; VC gets subtle gold tint; hero gets standard gold
  const border = isSwapSelected
    ? `2px solid ${GOLD}0.95)`
    : isSwapTarget
    ? `2px dashed ${GOLD}0.70)`
    : vm.isCaptain
    ? `2px solid ${GOLD}0.96)`
    : vm.isViceCaptain
    ? `1.5px solid ${GOLD}0.38)`
    : isHero
    ? `2px solid ${GOLD}0.72)`
    : "1.5px solid rgba(255,255,255,0.07)";

  const boxShadow = isSwapSelected
    ? `0 0 14px ${GOLD}0.35), 0 0 28px ${GOLD}0.12)`
    : vm.isCaptain
    ? `0 0 18px ${GOLD}0.45), 0 0 36px ${GOLD}0.14)`
    : isHero
    ? `0 0 12px ${GOLD}0.20)`
    : undefined;

  return (
    <div
      className="relative overflow-hidden rounded-lg"
      style={{
        width: 86, height: 120,
        background: CARD_BG,
        border,
        boxShadow,
        opacity: isDimmed ? 0.38 : isLocked ? 0.46 : 1,
        flexShrink: 0,
        transition: "opacity 0.15s, border-color 0.15s, box-shadow 0.15s",
      }}
    >
      {/* Fan texture — subtle stadium background over full card */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: "url('/brand/fan-bg.png')",
        backgroundSize: "cover",
        backgroundPosition: "55% 30%",
        filter: "grayscale(1) contrast(1.2) brightness(0.6)",
        opacity: 0.16,
      }} />

      {/* Locked overlay — faint dark wash + lock icon */}
      {isLocked && (
        <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.22)" }}>
          <span style={{ fontSize: 13, opacity: 0.55 }}>🔒</span>
        </div>
      )}

      {/* ── Image zone: fills top 90px ── */}
      <div className="absolute overflow-hidden" style={{ top: 0, left: 0, right: 0, height: 90 }}>
        <PlayerImage src={vm.imageUrl} tier={tier} fill rounded="none" rimColor={c1} />
        {/* Edge vignette */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse 76% 70% at 50% 36%, transparent 0%, rgba(9,12,9,0.82) 100%)" }}
        />
        {/* Club color glow / generic floodlight */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: c1
              ? `radial-gradient(ellipse 80% 50% at 65% -8%, ${c1} 0%, transparent 100%)`
              : "radial-gradient(ellipse 110% 50% at 50% -10%, rgba(255,210,50,0.11) 0%, transparent 68%)",
            mixBlendMode: "screen" as const,
            opacity: c1 ? 0.22 : 1,
          }}
        />
        {/* Bottom fade — image melts into info zone */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(to top, rgba(9,12,9,1) 0%, rgba(9,12,9,0.55) 22%, transparent 52%)" }}
        />
        {/* Injury red tint */}
        {vm.isInjured && (
          <div className="pointer-events-none absolute inset-0" style={{ background: "rgba(180,0,0,0.18)" }} />
        )}
      </div>

      {/* ── Info zone: solid dark strip, bottom 30px ── */}
      <div
        className="absolute bottom-0 left-0 right-0 flex flex-col items-center justify-center gap-0.5 px-1"
        style={{ height: 30, background: CARD_BG, borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        <p
          className="w-full text-center text-[8px] font-black uppercase leading-none truncate"
          style={{ color: "#fff", letterSpacing: "0.025em" }}
        >
          {lastName}
        </p>
        {hasPoints && (
          <span
            className="whitespace-nowrap rounded-full px-1.5 py-0.5 text-[7px] font-black leading-none"
            style={{
              background: vm.isCaptain ? GOLD + "0.90)" : "rgba(0,0,0,0.82)",
              color: vm.isCaptain ? "#050301" : GOLD + "1)",
              border: `1px solid ${vm.isCaptain ? GOLD + "0.28)" : GOLD + "0.18)"}`,
            }}
          >
            {vm.gameweekPoints}
          </span>
        )}
      </div>

      {/* Nation flag — WM mode (bottom-right, above info strip) */}
      {vm.nationFlagUrl && (
        <img
          src={vm.nationFlagUrl}
          className="absolute z-10 rounded-sm object-cover"
          style={{ width: 18, height: 12, bottom: 33, right: 4, border: "1px solid rgba(0,0,0,0.45)" }}
          alt=""
        />
      )}

      {/* Position badge */}
      <span
        className="absolute top-1 left-1 rounded px-1 py-0.5 text-[7px] font-black leading-none z-10"
        style={{
          background: "rgba(0,0,0,0.88)",
          color: posColor,
          border: `1px solid ${posColor}70`,
          boxShadow: "0 1px 4px rgba(0,0,0,0.9)",
        }}
      >
        {vm.positionLabel}
      </span>

      {/* Top-right: live minutes */}
      {showLive && (
        <span
          className="absolute top-1 right-1 rounded px-1 py-0.5 text-[6px] font-black leading-none z-10"
          style={{ background: "var(--color-success)", color: "#050301" }}
        >
          {liveMinutes}&apos;
        </span>
      )}

      {/* Top-right: captain / vice */}
      {showCapVC && (
        vm.isCaptain ? (
          <span
            className="absolute top-1 right-1 flex h-[20px] w-[20px] items-center justify-center rounded-full text-[9px] font-black leading-none z-10"
            style={{
              background: GOLD + "0.96)",
              color: "#050301",
              boxShadow: `0 0 8px ${GOLD + "0.50)"}`,
            }}
          >
            C
          </span>
        ) : (
          <span
            className="absolute top-1 right-1 flex h-[16px] w-[16px] items-center justify-center rounded-full text-[7px] font-black leading-none z-10"
            style={{
              background: "rgba(0,0,0,0.70)",
              color: GOLD + "0.80)",
              border: `1px solid ${GOLD + "0.38)"}`,
            }}
          >
            V
          </span>
        )
      )}

      {/* Top-right: injury */}
      {showInjury && (
        <span
          className="absolute top-1 right-1 flex h-[18px] items-center justify-center rounded-sm px-1 text-[7px] font-black leading-none z-10 uppercase tracking-wide"
          style={{
            background: "rgba(180,0,0,0.92)",
            color: "#fff",
            border: "1px solid rgba(255,80,80,0.50)",
            boxShadow: "0 0 6px rgba(220,50,50,0.45)",
          }}
        >
          OUT
        </span>
      )}
    </div>
  );
}

function EmptyPitchCard({ isDimmed, isSwapTarget, isSelected }: {
  isDimmed?: boolean; isSwapTarget?: boolean; isSelected?: boolean;
}) {
  const border = isSwapTarget
    ? `2px dashed ${GOLD}0.70)`
    : isSelected
    ? `2px solid ${GOLD}0.70)`
    : "1px dashed rgba(255,255,255,0.07)";
  const boxShadow = isSwapTarget
    ? `0 0 10px ${GOLD}0.18)`
    : isSelected
    ? `0 0 12px ${GOLD}0.22)`
    : undefined;
  return (
    <div
      className="relative overflow-hidden rounded-lg flex items-center justify-center"
      style={{
        width: 86, height: 120,
        background: CARD_BG,
        border,
        boxShadow,
        flexShrink: 0,
        opacity: isDimmed ? 0.38 : 1,
        transition: "opacity 0.15s, border-color 0.15s, box-shadow 0.15s",
      }}
    >
      <div className="w-5 h-5 rounded-full"
        style={{ border: isSwapTarget || isSelected
          ? `2px solid ${GOLD}0.55)`
          : "1px dashed rgba(255,255,255,0.09)" }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  BENCH  — portrait crop (top) + solid dark info strip (bottom)
//  Same dark card logic as pitch. No full-image fill.
// ═══════════════════════════════════════════════════════════════

function BenchCard({
  vm, benchNumber, isOverflow, isSelected, isSwapSelected, isSwapTarget, isDimmed,
}: {
  vm: PlayerCardViewModel; benchNumber?: number; isOverflow?: boolean; isSelected?: boolean;
  isSwapSelected?: boolean; isSwapTarget?: boolean; isDimmed?: boolean;
}) {
  const tier     = getVisualTier(vm);
  const posColor = POS_COLOR[vm.positionLabel] ?? "var(--color-text)";
  const lastName = vm.name.split(" ").pop() ?? vm.name;
  const c1       = clubColor(vm.clubSlug);

  const border = isSwapSelected
    ? `2px solid ${GOLD}0.90)`
    : isSwapTarget
    ? `1.5px dashed ${GOLD}0.65)`
    : isOverflow
    ? "1px solid rgba(220,50,50,0.60)"
    : isSelected
    ? `1px solid ${GOLD}0.68)`
    : "1px solid rgba(255,255,255,0.08)";

  const boxShadow = isSwapSelected
    ? `0 0 10px ${GOLD}0.28)`
    : isSelected
    ? `0 0 6px ${GOLD}0.12)`
    : undefined;

  return (
    <div
      className="relative overflow-hidden rounded-lg"
      style={{
        width: 60, height: 84,
        flexShrink: 0,
        background: CARD_BG,
        opacity: isDimmed ? 0.30 : 0.72,
        border,
        boxShadow,
        transition: "opacity 0.15s, border-color 0.15s, box-shadow 0.15s",
      }}
    >
      {/* ── Image zone: fills top 58px ── */}
      <div className="absolute overflow-hidden" style={{ top: 0, left: 0, right: 0, height: 58 }}>
        <PlayerImage src={vm.imageUrl} tier={tier} fill rounded="none" rimColor={c1} />
        {/* Club color glow — restrained, bench context */}
        {c1 && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(ellipse 70% 45% at 60% -5%, ${c1} 0%, transparent 100%)`,
              mixBlendMode: "screen" as const,
              opacity: 0.14,
            }}
          />
        )}
        {/* Edge vignette */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse 80% 75% at 50% 38%, transparent 0%, rgba(9,12,9,0.82) 100%)" }}
        />
        {/* Bottom fade — melts into info zone */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(to top, rgba(9,12,9,1.0) 0%, rgba(9,12,9,0.50) 22%, transparent 52%)" }}
        />
      </div>

      {/* ── Info zone: solid dark strip, bottom 26px ── */}
      <div
        className="absolute bottom-0 left-0 right-0 flex flex-col items-center justify-center gap-0.5 px-1"
        style={{ height: 26, background: CARD_BG, borderTop: "1px solid rgba(255,255,255,0.04)" }}
      >
        <p
          className="w-full text-center text-[7px] font-black uppercase leading-none truncate"
          style={{
            color: isOverflow ? "var(--color-error)" : "rgba(255,255,255,0.60)",
            letterSpacing: "0.02em",
          }}
        >
          {lastName}
        </p>
        {vm.gameweekPoints !== undefined ? (
          <span
            className="text-[7px] font-black leading-none"
            style={{ color: GOLD + "0.70)" }}
          >
            {vm.gameweekPoints}
          </span>
        ) : isOverflow ? (
          <span className="text-[8px] font-black leading-none" style={{ color: "var(--color-error)" }}>!</span>
        ) : null}
      </div>

      {/* Position badge — top-left, over image */}
      <span
        className="absolute top-1 left-1 rounded px-1 py-0.5 text-[6px] font-black leading-none z-10"
        style={{
          background: "rgba(0,0,0,0.88)",
          color: posColor,
          border: `1px solid ${posColor}70`,
          boxShadow: "0 1px 3px rgba(0,0,0,0.9)",
        }}
      >
        {vm.positionLabel}
      </span>

      {/* Top-right: C/VC badge or bench number */}
      {(vm.isCaptain || vm.isViceCaptain) ? (
        <span
          className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full text-[6px] font-black leading-none z-10"
          style={
            vm.isCaptain
              ? { background: GOLD + "0.92)", color: "#050301", boxShadow: `0 0 4px ${GOLD + "0.20)"}` }
              : { background: "rgba(0,0,0,0.65)", color: GOLD + "1)", border: `1px solid ${GOLD + "0.55)"}` }
          }
        >
          {vm.isCaptain ? "C" : "V"}
        </span>
      ) : benchNumber !== undefined ? (
        <span
          className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full text-[6px] font-black leading-none z-10"
          style={{
            background: "rgba(0,0,0,0.72)",
            color: "rgba(255,255,255,0.48)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          {benchNumber}
        </span>
      ) : null}

      {/* Injury dot */}
      {vm.isInjured && (
        <span
          className="absolute top-1 h-[7px] w-[7px] rounded-full z-10"
          style={{
            right: (vm.isCaptain || vm.isViceCaptain || benchNumber !== undefined) ? 24 : 4,
            background: "var(--color-error)",
            boxShadow: "0 0 5px rgba(220,50,50,0.55)",
          }}
        />
      )}
    </div>
  );
}

function EmptyBenchCard({ benchNumber, isDimmed }: { benchNumber?: number; isDimmed?: boolean }) {
  return (
    <div
      className="relative overflow-hidden rounded-lg"
      style={{
        width: 60, height: 84,
        flexShrink: 0,
        background: CARD_BG,
        opacity: isDimmed ? 0.20 : 0.55,
        border: "1px dashed rgba(255,255,255,0.06)",
        transition: "opacity 0.15s",
      }}
    >
      <div
        className="absolute flex items-center justify-center"
        style={{ top: 0, left: 0, right: 0, height: 58 }}
      >
        <div className="w-5 h-5 rounded-full" style={{ border: "1px dashed rgba(255,255,255,0.09)" }} />
      </div>
      <div
        className="absolute bottom-0 left-0 right-0 flex items-center justify-center"
        style={{ height: 26, borderTop: "1px solid rgba(255,255,255,0.04)" }}
      >
        {benchNumber !== undefined && (
          <span className="text-[7px] font-black" style={{ color: "rgba(255,255,255,0.14)" }}>
            {benchNumber}
          </span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  IR  (48px circle — injury state)
// ═══════════════════════════════════════════════════════════════

function IrCard({ vm, canReturn }: { vm: PlayerCardViewModel; canReturn?: boolean }) {
  const tier = getVisualTier(vm);
  return (
    <div className="relative flex-shrink-0" style={{ width: 48, height: 48 }}>
      <PlayerImage
        src={vm.imageUrl}
        tier={tier}
        size={48}
        rounded="full"
        style={{
          border: `2px solid ${canReturn ? "rgba(220,50,50,0.78)" : "rgba(220,50,50,0.22)"}`,
          boxShadow: canReturn ? "0 0 8px rgba(220,50,50,0.35)" : undefined,
          opacity: canReturn ? 1 : 0.58,
        }}
      />
      {/* Red tint when not yet eligible */}
      {!canReturn && (
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{ background: "rgba(160,0,0,0.22)" }}
        />
      )}
      {/* IR badge */}
      <span
        className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[6px] font-black leading-none"
        style={{
          background: canReturn ? "var(--color-error)" : "rgba(130,0,0,0.85)",
          color: "#fff",
          border: canReturn ? "none" : "1px solid rgba(220,50,50,0.30)",
        }}
      >
        IR
      </span>
    </div>
  );
}

function EmptyIrCard() {
  return (
    <div
      className="flex-shrink-0 flex items-center justify-center rounded-full"
      style={{
        width: 48, height: 48,
        background: "rgba(140,0,0,0.06)",
        border: "1.5px dashed rgba(220,50,50,0.22)",
      }}
    >
      <span className="text-[9px] font-black" style={{ color: "rgba(220,50,50,0.32)" }}>IR</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  TAXI  (48px circle — U21/talent aesthetic)
// ═══════════════════════════════════════════════════════════════

function TaxiCard({ vm }: { vm: PlayerCardViewModel }) {
  const tier = getVisualTier(vm);
  return (
    <div className="relative flex-shrink-0" style={{ width: 48, height: 48 }}>
      <PlayerImage
        src={vm.imageUrl}
        tier={tier}
        size={48}
        rounded="full"
        style={{
          border: `2px solid ${GOLD + "0.40)"}`,
          boxShadow: `0 0 7px ${GOLD + "0.14)"}`,
        }}
      />
      {/* U21 badge — gold tinted */}
      <span
        className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[6px] font-black leading-none"
        style={{
          background: "rgba(10,8,2,0.92)",
          color: GOLD + "1)",
          border: `1px solid ${GOLD + "0.42)"}`,
        }}
      >
        U21
      </span>
    </div>
  );
}

function EmptyTaxiCard() {
  return (
    <div
      className="flex-shrink-0 flex items-center justify-center rounded-full"
      style={{
        width: 48, height: 48,
        background: "rgba(244,196,48,0.04)",
        border: `1.5px dashed ${GOLD + "0.20)"}`,
      }}
    >
      <span className="text-[7px] font-black" style={{ color: GOLD + "0.32)" }}>U21</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════════════

export function PlayerCardLineup({
  player, variant, benchNumber, isOverflow, isSelected, canReturn, liveMinutes,
  isSwapSelected, isSwapTarget, isDimmed,
}: PlayerCardLineupProps) {
  if (variant === "pitch") {
    return player
      ? <PitchCard vm={player} liveMinutes={liveMinutes} isSwapSelected={isSwapSelected} isSwapTarget={isSwapTarget} isDimmed={isDimmed} />
      : <EmptyPitchCard isDimmed={isDimmed} isSwapTarget={isSwapTarget} isSelected={isSelected} />;
  }
  if (variant === "bench") {
    return player
      ? <BenchCard vm={player} benchNumber={benchNumber} isOverflow={isOverflow} isSelected={isSelected} isSwapSelected={isSwapSelected} isSwapTarget={isSwapTarget} isDimmed={isDimmed} />
      : <EmptyBenchCard benchNumber={benchNumber} isDimmed={isDimmed} />;
  }
  if (variant === "ir") {
    return player ? <IrCard vm={player} canReturn={canReturn} /> : <EmptyIrCard />;
  }
  return player ? <TaxiCard vm={player} /> : <EmptyTaxiCard />;
}
