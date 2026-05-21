"use client";
import React from "react";

interface Props {
  teamName: string;
  gwPoints: number;
  totalPoints: number;
  captainName?: string;
  captainPoints?: number;
  vcName?: string;
  autoSubsCount?: number;
  hasEliminatedPlayer?: boolean;
}

export function MyGWCard({
  teamName, gwPoints, totalPoints, captainName, captainPoints,
  vcName, autoSubsCount, hasEliminatedPlayer,
}: Props) {
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid color-mix(in srgb, var(--color-primary) 40%, var(--color-border))" }}>
      <div className="px-4 pt-4 pb-3">
        <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
          {teamName}
        </p>
        <div className="flex items-end gap-3">
          <span className="text-3xl font-black" style={{ color: "var(--color-text)" }}>
            {gwPoints.toFixed(1)}
          </span>
          <span className="text-[9px] font-black mb-1" style={{ color: "var(--color-muted)" }}>
            pts dieser GW
          </span>
          <span className="text-[9px] font-black mb-1 ml-auto" style={{ color: "var(--color-muted)" }}>
            Gesamt: {totalPoints.toFixed(1)}
          </span>
        </div>
      </div>
      <div className="px-4 pb-3 flex flex-wrap gap-2">
        {captainName && (
          <span className="text-[8px] font-black px-2 py-1 rounded-full"
            style={{ background: "color-mix(in srgb, var(--color-primary) 15%, var(--bg-page))", color: "var(--color-primary)" }}>
            C: {captainName} {captainPoints !== undefined ? `(${captainPoints.toFixed(1)}pt)` : ""}
          </span>
        )}
        {vcName && (
          <span className="text-[8px] font-black px-2 py-1 rounded-full"
            style={{ background: "var(--bg-page)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
            VC: {vcName}
          </span>
        )}
        {(autoSubsCount ?? 0) > 0 && (
          <span className="text-[8px] font-black px-2 py-1 rounded-full"
            style={{ background: "color-mix(in srgb, var(--color-info) 15%, var(--bg-page))", color: "var(--color-info)" }}>
            🔄 {autoSubsCount} Auto-Sub{autoSubsCount! > 1 ? "s" : ""}
          </span>
        )}
        {hasEliminatedPlayer && (
          <span className="text-[8px] font-black px-2 py-1 rounded-full"
            style={{ background: "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))", color: "var(--color-error)" }}>
            ⚠ Eliminierter Spieler
          </span>
        )}
      </div>
    </div>
  );
}
