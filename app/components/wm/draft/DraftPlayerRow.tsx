"use client";

import { PlayerCard } from "@/app/components/PlayerCard";

type DraftPlayer = {
  id: number;
  name: string;
  photo_url: string;
  position: string;
  team_name: string;
  goals: number;
  assists: number;
  fpts: number;
};

type Nation = {
  name: string;
  code?: string;
  flag_url?: string;
  group_letter?: string;
};

type Props = {
  player: DraftPlayer;
  nation: Nation | undefined;
  posColor: string | undefined;
  isMyTurn: boolean;
  isConnected: boolean;
  onPick: (playerId: number) => void;
};

export function DraftPlayerRow({
  player,
  nation,
  posColor,
  isMyTurn,
  isConnected,
  onPick,
}: Props) {
  const canPick = isMyTurn && isConnected;

  return (
    <div
      onClick={() => canPick && onPick(player.id)}
      className="flex items-center gap-2 p-2 transition-all"
      style={{
        borderBottom: "1px solid var(--color-border)",
        opacity: canPick ? 1 : 0.4,
        cursor: canPick ? "pointer" : "not-allowed",
        background: "transparent",
        minHeight: 48,
      }}
      onMouseEnter={(e) => {
        if (canPick)
          (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <PlayerCard
        player={player}
        posColor={posColor ?? "#888888"}
        size={32}
        nationFlagUrl={nation?.flag_url}
      />
      <div className="flex-1 min-w-0">
        <p
          className="text-xs font-black truncate"
          style={{ color: "var(--color-text)" }}
        >
          {player.name}
        </p>
        <p className="text-[8px] truncate" style={{ color: "var(--color-muted)" }}>
          {nation?.code || player.team_name}
          {nation?.group_letter && (
            <span style={{ color: "var(--color-border)" }}>
              {" · "}Gr.{nation.group_letter}
            </span>
          )}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p
          className="text-xs font-black"
          style={{ color: "var(--color-primary)" }}
        >
          {player.fpts?.toFixed(0)}
        </p>
        <span
          className="text-[7px] font-black px-1 rounded-sm"
          style={{
            background: posColor ? posColor + "20" : "var(--color-border)",
            color: posColor || "var(--color-muted)",
          }}
        >
          {player.position}
        </span>
      </div>
    </div>
  );
}
