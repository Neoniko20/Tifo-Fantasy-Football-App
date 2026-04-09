"use client";

import { liveStateOf, liveStateLabel, liveStateColor, type LiveState } from "@/lib/fixture-status";

const POS_COLOR: Record<string, string> = {
  GK: "#f5a623", DF: "#4a9eff", MF: "#00ce7d", FW: "#ff4d6d",
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
  const posColor = POS_COLOR[position] || "#c8b080";

  return (
    <div className="flex items-center gap-2 py-1.5" style={{ opacity: dim ? 0.45 : 1 }}>
      <img
        src={photoUrl || "/player-placeholder.png"}
        alt={name}
        className="w-7 h-7 rounded-full object-cover flex-shrink-0"
        style={{ border: `1px solid ${posColor}` }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-black truncate" style={{ color: "#c8b080" }}>
          {name}
          {isCaptain && <span className="ml-1" style={{ color: "#f5a623" }}>(C)</span>}
        </p>
        <p className="text-[7px] font-black uppercase tracking-wider" style={{ color: "#5a4020" }}>
          {position}
          {state === "live" && typeof minutes === "number" && <span className="ml-1" style={{ color }}>· {minutes}&apos;</span>}
        </p>
      </div>
      <span className="text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0"
        style={{ background: color + "20", color, border: `1px solid ${color}40` }}>
        {label}
      </span>
      <p className="text-[11px] font-black w-10 text-right" style={{ color: "#c8b080" }}>
        {points.toFixed(1)}
      </p>
    </div>
  );
}
