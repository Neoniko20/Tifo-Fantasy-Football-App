"use client";
import React, { memo } from "react";

export type PlayerLiveStatus = "playing" | "finished" | "upcoming" | "eliminated";

export interface PlayerLiveRow {
  player_id: number;
  player_name: string;
  position: string;
  nation_flag?: string;
  gw_points: number;
  status: PlayerLiveStatus;
  is_captain: boolean;
  is_vc: boolean;
  is_auto_subbed: boolean;
}

interface Props {
  players: PlayerLiveRow[];
}

const STATUS_CONFIG: Record<PlayerLiveStatus, { label: string; color: string }> = {
  playing:    { label: "Spielt",      color: "var(--color-success)" },
  finished:   { label: "Fertig",      color: "var(--color-muted)" },
  upcoming:   { label: "Ausstehend",  color: "var(--color-info)" },
  eliminated: { label: "Eliminiert",  color: "var(--color-error)" },
};

const POS_COLOR: Record<string, string> = {
  GK: "var(--color-primary)", DF: "var(--color-info)",
  MF: "var(--color-success)", FW: "var(--color-error)",
};

export const PlayerStatusGrid = memo(function PlayerStatusGrid({ players }: Props) {
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Meine Spieler
        </p>
      </div>
      <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
        {players.map(p => {
          const sc = STATUS_CONFIG[p.status];
          const isElim = p.status === "eliminated";
          return (
            <div key={p.player_id}
              className="flex items-center px-4 py-2.5 gap-2"
              style={{ opacity: isElim ? 0.5 : 1 }}>
              <span className="text-[7px] font-black w-6 text-center flex-shrink-0"
                style={{ color: POS_COLOR[p.position] ?? "var(--color-muted)" }}>
                {p.position}
              </span>
              {p.nation_flag && (
                <img src={p.nation_flag} alt="" className="w-4 h-3 object-cover rounded-sm flex-shrink-0" />
              )}
              <p className="flex-1 text-xs font-black truncate" style={{ color: "var(--color-text)" }}>
                {p.player_name}
                {p.is_captain && <span className="ml-1 text-[7px] px-1 rounded" style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>C</span>}
                {p.is_vc && <span className="ml-1 text-[7px] px-1 rounded" style={{ background: "var(--bg-elevated)", color: "var(--color-muted)" }}>VC</span>}
                {p.is_auto_subbed && <span className="ml-1 text-[7px]" style={{ color: "var(--color-info)" }}>🔄</span>}
              </p>
              <span className="text-[7px] font-black uppercase tracking-widest flex-shrink-0"
                style={{ color: sc.color }}>{sc.label}</span>
              <span className="text-xs font-black flex-shrink-0 w-10 text-right"
                style={{ color: p.gw_points > 0 ? "var(--color-text)" : "var(--color-muted)" }}>
                {p.status === "playing" ? "~" : ""}{p.gw_points.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
