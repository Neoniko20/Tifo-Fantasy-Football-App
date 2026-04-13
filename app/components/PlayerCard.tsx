"use client";

/**
 * PlayerCard — THE single source of truth for all player avatar states.
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
 * Usage:
 *   // Lineup field slot
 *   <PlayerCard player={p} posColor={POS_COLOR.MF} size={44} isCap
 *     gwPoints={gwPoints} canLiveSwap gwMinutes={gwMinutes} />
 *
 *   // Simple list row
 *   <PlayerCard player={p} posColor={POS_COLOR[p.position]} size={32} isIR />
 *
 *   // WM draft list
 *   <PlayerCard player={p} posColor={teamColor} size={32}
 *     nationFlagUrl={nation.flag_url} />
 */

export type PlayerCardPlayer = {
  id: string | number;
  photo_url?: string | null;
  api_team_id?: number | string | null;
};

type PlayerCardProps = {
  player: PlayerCardPlayer | null;
  posColor: string;
  size?: number;
  /** Highlights slot — shows "+" and primary glow */
  selected?: boolean;
  /** Label shown in empty slot: position abbreviation or bench number */
  posLabel?: string;
  /** Captain badge (C) — top-right */
  isCap?: boolean;
  /** Vice-captain badge (V) — top-right, hidden when isCap */
  isVC?: boolean;
  /** Injured Reserve badge (IR) — bottom-right, overrides club logo */
  isIR?: boolean;
  /**
   * Nation flag URL — replaces club logo in WM mode.
   * Pass `nation.flag_url` from wm pages.
   */
  nationFlagUrl?: string | null;
  /** map of playerId → GW points — shown as top-right badge */
  gwPoints?: Record<string | number, number>;
  /** When true, show live-swap minute badges */
  canLiveSwap?: boolean;
  /** map of playerId → minutes played this GW */
  gwMinutes?: Record<string | number, number>;
};

export function PlayerCard({
  player, posColor, size = 44, selected, posLabel, isCap, isVC, isIR,
  nationFlagUrl, gwPoints, canLiveSwap, gwMinutes,
}: PlayerCardProps) {
  const logoSize = size > 36 ? 16 : 14;
  const hasBadgeTopRight = isCap || isVC;

  // overlay = club logo OR nation flag OR IR badge (priority: IR > nation > club)
  const showIR   = !!player && isIR;
  const showFlag = !!player && !isIR && !!nationFlagUrl;
  const showLogo = !!player?.api_team_id && !isIR && !nationFlagUrl;

  return (
    <div
      className="rounded-full flex items-center justify-center relative flex-shrink-0"
      style={{
        width: size,
        height: size,
        border: `2px solid ${
          selected
            ? "var(--color-primary)"
            : player
            ? isIR
              ? "var(--color-error)"
              : posColor
            : "var(--color-border)"
        }`,
        background: player
          ? isIR
            ? "color-mix(in srgb, var(--color-error) 8%, var(--bg-card))"
            : "var(--bg-card)"
          : "var(--bg-page)",
        boxShadow: selected ? `0 0 10px ${posColor}50` : undefined,
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
      {player && canLiveSwap && gwMinutes && gwMinutes[player.id] !== undefined && (
        <span
          className="absolute text-[6px] font-black px-0.5 rounded leading-tight z-10"
          style={{
            bottom: size > 36 ? 10 : 8,
            left: -2,
            background: gwMinutes[player.id] > 0
              ? "color-mix(in srgb, var(--color-success) 15%, var(--bg-page))"
              : "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))",
            color: gwMinutes[player.id] > 0 ? "var(--color-success)" : "var(--color-error)",
            border: `1px solid color-mix(in srgb, ${
              gwMinutes[player.id] > 0 ? "var(--color-success)" : "var(--color-error)"
            } 25%, transparent)`,
          }}
        >
          {gwMinutes[player.id]}′
        </span>
      )}
    </div>
  );
}
