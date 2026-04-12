"use client";

import { liveStateOf, liveStateLabel, liveStateColor, type LiveState } from "@/lib/fixture-status";

const POS_COLOR: Record<string, string> = {
  GK: "var(--color-primary)", DF: "var(--color-info)", MF: "var(--color-success)", FW: "var(--color-error)",
};

interface Props {
  name: string;
  position: string;
  photoUrl?: string | null;
  points: number;
  minutes?: number;
  fixtureShort?: string | null;
  isCaptain?: boolean;
  dim?: boolean; // grey-out when not yet played
}

export function LivePlayerRow({ name, position, photoUrl, points, minutes, fixtureShort, isCaptain, dim }: Props) {
  const state: LiveState = liveStateOf(fixtureShort);
  const color = liveStateColor(state);
  const label = liveStateLabel(fixtureShort);
  const posColor = POS_COLOR[position] || "var(--color-text)";

  return (
    <div className="flex items-center gap-2 py-1.5" style={{ opacity: dim ? 0.45 : 1 }}>
      <img
        src={photoUrl || "/player-placeholder.png"}
        alt={name}
        className="w-7 h-7 rounded-full object-cover flex-shrink-0"
        style={{ border: `1px solid ${posColor}` }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-black truncate" style={{ color: "var(--color-text)" }}>
          {name}
          {isCaptain && <span className="ml-1" style={{ color: "var(--color-primary)" }}>(C)</span>}
        </p>
        <p className="text-[7px] font-black uppercase tracking-wider" style={{ color: "var(--color-muted)" }}>
          {position}
          {state === "live" && typeof minutes === "number" && <span className="ml-1" style={{ color }}>· {minutes}&apos;</span>}
        </p>
      </div>
      <span className="text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0"
        style={{ background: color + "20", color, border: `1px solid ${color}40` }}>
        {label}
      </span>
      <p className="text-[11px] font-black w-10 text-right" style={{ color: "var(--color-text)" }}>
        {points.toFixed(1)}
      </p>
    </div>
  );
}
