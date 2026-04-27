"use client";

/**
 * PlayerAvatar — single source of truth for circular player markers.
 *
 * Covers:
 *   · Lineup field slots (empty + filled, selected state, glow)
 *   · List rows (transfers, waiver, draft, players browser)
 *   · WM pages (nation flag instead of club logo)
 *   · Captain / Vice-captain badges
 *   · IR (Injured Reserve) badge
 *   · GW points badge
 *   · Live-swap minutes badge
 *
 * Re-exported as PlayerCard for backward compatibility.
 */

export type PlayerCardPlayer = {
  id: string | number;
  photo_url?: string | null;
  api_team_id?: number | string | null;
};

export type PlayerAvatarProps = {
  player: PlayerCardPlayer | null;
  posColor: string;
  size?: number;
  /** Highlights empty slot — shows "+" and primary glow */
  selected?: boolean;
  /** Label shown in empty slot: position abbreviation or bench number */
  posLabel?: string;
  /** Captain badge (C) — top-right */
  isCap?: boolean;
  /** Vice-captain badge (V) — top-right, hidden when isCap */
  isVC?: boolean;
  /** Injured Reserve badge (IR) — bottom-right, overrides club logo */
  isIR?: boolean;
  /** Injury/news warning badge (⚠) — top-left */
  isInjured?: boolean;
  /** Nation flag URL — replaces club logo in WM mode */
  nationFlagUrl?: string | null;
  /** map of playerId → GW points — shown as top-right badge */
  gwPoints?: Record<string | number, number>;
  /** When true, show live-swap minute badges */
  canLiveSwap?: boolean;
  /** map of playerId → minutes played this GW */
  gwMinutes?: Record<string | number, number>;
  /** TIFO Ultra: highlight filled slot with themed glow ring */
  active?: boolean;
  /** Visual emphasis — "bench-muted" de-emphasises for bench / secondary lists */
  tone?: "default" | "bench-muted";
  /** U21 taxi squad marker — small "U21" chip bottom-left */
  taxi?: boolean;
};

export function PlayerAvatar({
  player, posColor, size = 44, selected, posLabel, isCap, isVC, isIR, isInjured,
  nationFlagUrl, gwPoints, canLiveSwap, gwMinutes, active, tone, taxi,
}: PlayerAvatarProps) {
  const logoSize = size > 36 ? 16 : 14;
  const hasBadgeTopRight = isCap || isVC;

  const showIR   = !!player && isIR;
  const showFlag = !!player && !isIR && !!nationFlagUrl;
  const showLogo = !!player?.api_team_id && !isIR && !nationFlagUrl;

  const hasMinutesBadge =
    !!player && canLiveSwap && !!gwMinutes && gwMinutes[player.id] !== undefined;
  const showTaxi = !!player && taxi && !hasMinutesBadge;

  const boxShadow = selected
    ? `0 0 10px ${posColor}50`
    : active && player
      ? "0 0 14px var(--color-glow)"
      : undefined;

  const rootOpacity = tone === "bench-muted" ? 0.72 : 1;

  return (
    <div
      className="rounded-full flex items-center justify-center relative flex-shrink-0"
      style={{
        width: size,
        height: size,
        opacity: rootOpacity,
        border: `2px solid ${
          selected
            ? "var(--color-primary)"
            : player
              ? isIR
                ? "var(--color-error)"
                : active
                  ? "var(--color-primary)"
                  : posColor
              : "var(--color-border)"
        }`,
        background: player
          ? isIR
            ? "color-mix(in srgb, var(--color-error) 8%, var(--bg-card))"
            : "var(--bg-card)"
          : "var(--bg-page)",
        boxShadow,
      }}
    >
      {/* ── Photo or empty-slot placeholder ── */}
      {player?.photo_url ? (
        <img
          src={player.photo_url}
          className="w-full h-full rounded-full object-cover"
          style={{ opacity: isIR ? 0.5 : 1 }}
          alt=""
        />
      ) : (
        <span
          style={{
            fontSize: size > 36 ? 16 : 11,
            color: selected ? "var(--color-primary)" : "var(--color-border)",
          }}
        >
          {selected ? "+" : (posLabel || "?")}
        </span>
      )}

      {/* ── Injury warning badge (⚠) — top-left ── */}
      {player && isInjured && !isIR && (
        <span
          className="absolute -top-1 -left-1 w-4 h-4 rounded-full text-[7px] font-black flex items-center justify-center z-10"
          style={{ background: "var(--color-warning, #f59e0b)", color: "#fff" }}
        >!</span>
      )}

      {/* ── Captain badge (C) ── */}
      {isCap && (
        <span
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[8px] font-black flex items-center justify-center z-10"
          style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}
        >C</span>
      )}

      {/* ── Vice-captain badge (V) ── */}
      {isVC && !isCap && (
        <span
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[8px] font-black flex items-center justify-center z-10"
          style={{ background: "var(--color-muted)", color: "var(--color-primary)" }}
        >V</span>
      )}

      {/* ── IR badge — replaces bottom-right overlay ── */}
      {showIR && (
        <span
          className="absolute -bottom-1 -right-1 rounded-full text-[7px] font-black flex items-center justify-center z-10 px-1"
          style={{
            background: "var(--color-error)",
            color: "var(--bg-page)",
            minWidth: 14,
            height: 14,
          }}
        >IR</span>
      )}

      {/* ── Club logo (bottom-right) ── */}
      {showLogo && (
        <img
          src={`https://media.api-sports.io/football/teams/${player!.api_team_id}.png`}
          className="absolute rounded-full object-contain z-10"
          style={{
            width: logoSize, height: logoSize,
            bottom: -2, right: -2,
            background: "var(--bg-card)", border: "1px solid var(--color-border)",
          }}
          alt=""
        />
      )}

      {/* ── Nation flag (bottom-right, WM mode) ── */}
      {showFlag && (
        <img
          src={nationFlagUrl!}
          className="absolute -bottom-0.5 -right-0.5 rounded-sm object-cover z-10"
          style={{
            width: logoSize, height: Math.round(logoSize * 0.7),
            border: "1px solid var(--bg-page)",
          }}
          alt=""
        />
      )}

      {/* ── GW points badge (top-right, shifted left when cap/vc) ── */}
      {player && gwPoints && gwPoints[player.id] !== undefined && (
        <span
          className="absolute text-[6px] font-black px-0.5 rounded leading-tight z-10"
          style={{
            top: -2,
            right: hasBadgeTopRight ? 14 : -2,
            background: "color-mix(in srgb, var(--color-success) 15%, var(--bg-page))",
            color: "var(--color-success)",
            border: "1px solid color-mix(in srgb, var(--color-success) 25%, transparent)",
          }}
        >
          {gwPoints[player.id]}
        </span>
      )}

      {/* ── Live-swap minute badge (bottom-left) ── */}
      {hasMinutesBadge && (
        <span
          className="absolute text-[6px] font-black px-0.5 rounded leading-tight z-10"
          style={{
            bottom: size > 36 ? 10 : 8,
            left: -2,
            background: gwMinutes![player!.id] > 0
              ? "color-mix(in srgb, var(--color-success) 15%, var(--bg-page))"
              : "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))",
            color: gwMinutes![player!.id] > 0 ? "var(--color-success)" : "var(--color-error)",
            border: `1px solid color-mix(in srgb, ${
              gwMinutes![player!.id] > 0 ? "var(--color-success)" : "var(--color-error)"
            } 25%, transparent)`,
          }}
        >
          {gwMinutes![player!.id]}′
        </span>
      )}

      {/* ── Taxi / U21 badge (bottom-left) — only when no live-swap minutes ── */}
      {showTaxi && (
        <span
          className="absolute text-[6px] font-black px-0.5 rounded leading-tight z-10"
          style={{
            bottom: size > 36 ? 10 : 8,
            left: -2,
            background: "color-mix(in srgb, var(--color-primary) 18%, var(--bg-page))",
            color: "var(--color-primary)",
            border: "1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)",
          }}
        >U21</span>
      )}
    </div>
  );
}

export default PlayerAvatar;
