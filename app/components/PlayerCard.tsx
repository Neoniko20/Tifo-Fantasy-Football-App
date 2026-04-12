"use client";

/**
 * PlayerCard — circular player avatar badge
 * Replaces the inline PlayerCircle defined inside lineup/page.tsx
 *
 * Usage:
 *   <PlayerCard player={p} posColor={posColor} size={44} isCap gwPoints={gwPoints} />
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
  selected?: boolean;
  posLabel?: string;
  isCap?: boolean;
  isVC?: boolean;
  /** map of playerId → GW points — shown as top-right badge */
  gwPoints?: Record<string | number, number>;
  /** when true, show gwMinutes badge */
  canLiveSwap?: boolean;
  /** map of playerId → minutes played this GW */
  gwMinutes?: Record<string | number, number>;
};

export function PlayerCard({
  player, posColor, size = 44, selected, posLabel, isCap, isVC,
  gwPoints, canLiveSwap, gwMinutes,
}: PlayerCardProps) {
  const logoSize = size > 36 ? 16 : 14;

  return (
    <div
      className="rounded-full flex items-center justify-center relative flex-shrink-0"
      style={{
        width: size,
        height: size,
        border: `2px solid ${selected ? "var(--color-primary)" : player ? posColor : "var(--color-border)"}`,
        background: player ? "var(--bg-card)" : "var(--bg-page)",
        boxShadow: selected ? `0 0 10px ${posColor}50` : undefined,
      }}
    >
      {/* Photo or placeholder */}
      {player?.photo_url ? (
        <img src={player.photo_url} className="w-full h-full rounded-full object-cover" alt="" />
      ) : (
        <span style={{ fontSize: size > 36 ? 16 : 11, color: selected ? "var(--color-primary)" : "var(--color-border)" }}>
          {selected ? "+" : (posLabel || "?")}
        </span>
      )}

      {/* Captain badge */}
      {isCap && (
        <span
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[8px] font-black flex items-center justify-center"
          style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}
        >C</span>
      )}

      {/* Vice-captain badge */}
      {isVC && !isCap && (
        <span
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[8px] font-black flex items-center justify-center"
          style={{ background: "var(--color-muted)", color: "var(--color-primary)" }}
        >V</span>
      )}

      {/* Club logo */}
      {player?.api_team_id && (
        <img
          src={`https://media.api-sports.io/football/teams/${player.api_team_id}.png`}
          className="absolute rounded-full object-contain"
          style={{
            width: logoSize, height: logoSize,
            bottom: -2, left: -2,
            background: "var(--bg-card)", border: "1px solid var(--color-border)",
          }}
          alt=""
        />
      )}

      {/* GW points badge */}
      {player && gwPoints && gwPoints[player.id] !== undefined && (
        <span
          className="absolute text-[6px] font-black px-0.5 rounded leading-tight"
          style={{
            top: -2,
            right: isCap || isVC ? 14 : -2,
            background: "color-mix(in srgb, var(--color-success) 15%, var(--bg-page))",
            color: "var(--color-success)",
            border: "1px solid color-mix(in srgb, var(--color-success) 25%, transparent)",
          }}
        >
          {gwPoints[player.id]}
        </span>
      )}

      {/* Live-swap minute badge */}
      {player && canLiveSwap && gwMinutes && gwMinutes[player.id] !== undefined && (
        <span
          className="absolute text-[6px] font-black px-0.5 rounded leading-tight"
          style={{
            bottom: size > 36 ? 10 : 8,
            left: -2,
            background: gwMinutes[player.id] > 0
              ? "color-mix(in srgb, var(--color-success) 15%, var(--bg-page))"
              : "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))",
            color: gwMinutes[player.id] > 0 ? "var(--color-success)" : "var(--color-error)",
            border: `1px solid color-mix(in srgb, ${gwMinutes[player.id] > 0 ? "var(--color-success)" : "var(--color-error)"} 25%, transparent)`,
          }}
        >
          {gwMinutes[player.id]}′
        </span>
      )}
    </div>
  );
}
