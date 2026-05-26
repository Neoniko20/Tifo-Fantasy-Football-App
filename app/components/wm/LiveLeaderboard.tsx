"use client";
import React, { memo } from "react";

export interface LiveTeamRow {
  team_id: string;
  team_name: string;
  gw_points: number;
  total_points: number;
  rank_delta: number;
  players_playing: number;
  players_total: number;
  is_my_team: boolean;
  has_nation_eliminated: boolean;
}

interface Props {
  rows: LiveTeamRow[];
}

export const LiveLeaderboard = memo(function LiveLeaderboard({ rows }: Props) {
  const sorted = [...rows].sort((a, b) => b.gw_points - a.gw_points);
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Live Rangliste
        </p>
      </div>
      {sorted.map((row, i) => (
        <div key={row.team_id}
          className="flex items-center px-4 py-3 gap-2"
          style={{
            borderBottom: i < sorted.length - 1 ? "1px solid var(--color-border)" : undefined,
            background: row.is_my_team
              ? "color-mix(in srgb, var(--color-primary) 5%, var(--bg-card))" : undefined,
          }}>
          <span className="text-[10px] font-black w-4 text-right flex-shrink-0"
            style={{ color: "var(--color-muted)" }}>{i + 1}</span>
          <span className="text-[7px] font-black w-5 text-right flex-shrink-0"
            style={{ color: row.rank_delta > 0 ? "var(--color-success)" : row.rank_delta < 0 ? "var(--color-error)" : "transparent" }}>
            {row.rank_delta > 0 ? `▲${row.rank_delta}` : row.rank_delta < 0 ? `▼${Math.abs(row.rank_delta)}` : "–"}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black truncate"
              style={{ color: row.is_my_team ? "var(--color-primary)" : "var(--color-text)" }}>
              {row.team_name}
              {row.is_my_team && <span className="ml-1 text-[7px] font-normal" style={{ color: "var(--color-muted)" }}>· Du</span>}
            </p>
            <p className="text-[8px]" style={{ color: "var(--color-muted)" }}>
              {row.players_playing}/{row.players_total} aktiv
              {row.has_nation_eliminated && <span style={{ color: "var(--color-error)" }}> · ⚠ eliminiert</span>}
            </p>
          </div>
          <span className="text-sm font-black flex-shrink-0"
            style={{ color: row.is_my_team ? "var(--color-primary)" : "var(--color-text)" }}>
            {row.gw_points.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
});
