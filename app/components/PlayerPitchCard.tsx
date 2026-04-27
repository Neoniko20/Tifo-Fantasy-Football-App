"use client";

/**
 * PlayerPitchCard — Banner / fabric-style card for the lineup pitch.
 *
 * Opt-in. Not used on list rows — use <PlayerAvatar> there.
 *
 * Visual language:
 *   · rounded rectangle with subtle fabric gradient
 *   · rating (top-left) + position (below rating)
 *   · captain/vice badge (top-right)
 *   · centered photo (silhouette fallback)
 *   · bottom band: uppercase last-name + points pill
 */

import type { ReactNode } from "react";

export type PitchStatus = "default" | "active" | "locked" | "injured" | "taxi";
export type PitchVariant = "starter" | "bench" | "compact";

/** Collapse all fine-grained positions onto 4 roles: TW, AB, MF, ST. */
export type SimpleRole = "TW" | "AB" | "MF" | "ST";
export function simplifyPosition(pos: string | undefined | null): SimpleRole {
  if (!pos) return "MF";
  const p = pos.toUpperCase().trim();
  if (p === "GK" || p === "TW" || p === "G") return "TW";
  if (p === "DF" || p === "AB" || p === "D" || /^(L|R|C)?B$/.test(p) || /^(LCB|RCB|LWB|RWB|SW)$/.test(p)) return "AB";
  if (p === "FW" || p === "ST" || p === "F" || /^(LW|RW|CF|SS|LF|RF)$/.test(p)) return "ST";
  // Everything else (CM, CDM, CAM, LM, RM, AM, DM, MF, M) → MF
  return "MF";
}

/** Role → theme-aware colour token expression. Returns a css color-mix string. */
function roleColor(role: SimpleRole): string {
  switch (role) {
    case "TW": return "var(--color-accent)";                                             // keeper – accent (gold-ish)
    case "AB": return "color-mix(in srgb, #3b82f6 70%, var(--color-primary))";           // defender – cool blue
    case "MF": return "color-mix(in srgb, var(--color-primary) 80%, #10b981)";           // midfield – primary / green
    case "ST": return "color-mix(in srgb, #ef4444 70%, var(--color-primary))";           // striker – warm red
  }
}

export type PlayerPitchCardProps = {
  name?: string;
  position: string;
  rating?: number;
  points?: number;
  imageUrl?: string | null;
  isCaptain?: boolean;
  isViceCaptain?: boolean;
  status?: PitchStatus;
  variant?: PitchVariant;
  onClick?: () => void;
  /** Optional slot below the card (e.g. projected points) */
  footer?: ReactNode;
  /** Empty slot placeholder — dashed border + position label, no photo/name/points */
  isEmpty?: boolean;
  /** Live-swap minutes played this GW — tiny chip at top-right corner */
  liveMinutes?: number;
};

const SIZES: Record<PitchVariant, { w: number; h: number; name: string; pts: string; rating: string }> = {
  starter: { w: 96,  h: 128, name: "text-[11px]", pts: "text-[11px]", rating: "text-lg" },
  bench:   { w: 76,  h: 100, name: "text-[10px]", pts: "text-[10px]", rating: "text-base" },
  compact: { w: 64,  h: 84,  name: "text-[9px]",  pts: "text-[9px]",  rating: "text-sm" },
};

export function PlayerPitchCard({
  name, position, rating, points, imageUrl,
  isCaptain, isViceCaptain, status = "default", variant = "starter",
  onClick, footer, isEmpty, liveMinutes,
}: PlayerPitchCardProps) {
  const s = SIZES[variant];
  const lastName = name ? (name.split(" ").slice(-1)[0] ?? name) : "";

  // ── Empty-slot placeholder ─────────────────────────────
  if (isEmpty) {
    return (
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={onClick}
          className="flex items-center justify-center rounded-xl transition"
          style={{
            width: s.w,
            height: s.h,
            background: "color-mix(in srgb, var(--color-primary-soft) 60%, transparent)",
            border: "1px dashed color-mix(in srgb, var(--color-primary) 35%, transparent)",
          }}
        >
          <span
            className="text-[10px] font-black uppercase tracking-widest"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {position}
          </span>
        </button>
        {footer}
      </div>
    );
  }

  const isActive   = status === "active";
  const isLocked   = status === "locked";
  const isInjured  = status === "injured";
  const isTaxi     = status === "taxi";

  const borderColor = isActive
    ? "var(--color-primary)"
    : isInjured
      ? "var(--color-error)"
      : "var(--color-border)";

  const glow = isActive ? "0 0 18px var(--color-glow)" : undefined;

  const rootOpacity = isLocked ? 0.55 : variant === "bench" ? 0.92 : 1;

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={isLocked}
        className="relative flex flex-col overflow-hidden rounded-xl text-left transition"
        style={{
          width: s.w,
          height: s.h,
          opacity: rootOpacity,
          border: `1px solid ${borderColor}`,
          background:
            "linear-gradient(160deg, var(--bg-elevated) 0%, var(--bg-card) 60%, color-mix(in srgb, var(--color-primary) 10%, var(--bg-card)) 100%)",
          boxShadow: glow,
        }}
      >
        {/* Fabric grain — very subtle */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 mix-blend-overlay"
          style={{
            backgroundImage:
              "radial-gradient(circle at 30% 20%, var(--color-primary-soft) 0%, transparent 45%)",
            opacity: 0.8,
          }}
        />

        {/* Top-left: role badge (TW / AB / MF / ST) */}
        {(() => {
          const role = simplifyPosition(position);
          const rc = roleColor(role);
          return (
            <div className="relative z-10 flex items-start justify-between px-1.5 pt-1.5">
              <span
                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase leading-none tracking-wider"
                style={{
                  background: `color-mix(in srgb, ${rc} 18%, transparent)`,
                  color: rc,
                  border: `1px solid color-mix(in srgb, ${rc} 45%, transparent)`,
                }}
                aria-label={`Position: ${role}`}
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: rc }}
                />
                {role}
              </span>

          {/* Top-right badges */}
          {(isCaptain || isViceCaptain || isInjured) && (
            <div className="flex flex-col items-end gap-0.5">
              {isCaptain && (
                <span
                  className="rounded-sm px-1 text-[9px] font-black leading-tight"
                  style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}
                >C</span>
              )}
              {isViceCaptain && !isCaptain && (
                <span
                  className="rounded-sm px-1 text-[9px] font-black leading-tight"
                  style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}
                >V</span>
              )}
              {isInjured && (
                <span
                  className="rounded-sm px-1 text-[9px] font-black leading-tight"
                  style={{ background: "var(--color-error)", color: "#fff" }}
                >!</span>
              )}
            </div>
          )}
            </div>
          );
        })()}

        {/* Photo area */}
        <div className="relative z-0 flex flex-1 items-end justify-center">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              className="h-full w-full object-cover"
              style={{ opacity: isLocked ? 0.5 : 1 }}
            />
          ) : (
            <span
              className="pb-3 text-4xl"
              style={{ color: "var(--color-border)" }}
              aria-hidden
            >
              ●
            </span>
          )}
        </div>

        {/* Bottom band: name + points */}
        <div
          className="relative z-10 flex flex-col items-center gap-0.5 px-1.5 pb-1.5 pt-1"
          style={{
            background:
              "linear-gradient(to top, var(--bg-page) 0%, color-mix(in srgb, var(--bg-page) 80%, transparent) 70%, transparent 100%)",
          }}
        >
          <span
            className={`${s.name} font-black uppercase tracking-wider truncate max-w-full`}
            style={{ color: "var(--color-text)" }}
          >
            {lastName}
          </span>
          {points !== undefined && (
            <span
              className={`${s.pts} rounded px-1.5 py-0.5 font-black leading-none`}
              style={{
                background: "var(--color-primary-soft)",
                color: "var(--color-primary)",
                border: "1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)",
              }}
            >
              {points.toFixed(1)}
            </span>
          )}
        </div>

        {/* Live-swap minutes — tiny chip bottom-right above name band */}
        {liveMinutes !== undefined && (
          <span
            className="absolute right-1 rounded px-1 text-[7px] font-black leading-tight z-10"
            style={{
              bottom: variant === "starter" ? 30 : variant === "bench" ? 26 : 22,
              background: liveMinutes > 0
                ? "color-mix(in srgb, var(--color-success) 18%, var(--bg-page))"
                : "color-mix(in srgb, var(--color-muted) 18%, var(--bg-page))",
              color: liveMinutes > 0 ? "var(--color-success)" : "var(--color-muted)",
              border: `1px solid color-mix(in srgb, ${
                liveMinutes > 0 ? "var(--color-success)" : "var(--color-muted)"
              } 30%, transparent)`,
            }}
          >
            {liveMinutes}′
          </span>
        )}

        {/* Taxi marker — bottom-right chip */}
        {isTaxi && (
          <span
            className="absolute bottom-1 right-1 rounded px-1 text-[8px] font-black"
            style={{
              background: "var(--color-primary-soft)",
              color: "var(--color-primary)",
              border: "1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)",
            }}
          >U21</span>
        )}
      </button>
      {footer}
    </div>
  );
}

export default PlayerPitchCard;
