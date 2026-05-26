"use client";
import React from "react";

interface Props {
  gwNumber: number;
  fixturesTotal: number;
  fixturesFinished: number;
  realtimeStatus: "connected" | "disconnected";
  onRefresh?: () => void;
}

export function LiveStatusBanner({ gwNumber, fixturesTotal, fixturesFinished, realtimeStatus, onRefresh }: Props) {
  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-center justify-between px-4 py-3 rounded-xl"
        style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--color-primary)" }} />
          <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>
            GW{gwNumber} läuft
          </p>
          <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            {fixturesFinished}/{fixturesTotal} Spiele beendet
          </span>
        </div>
        {realtimeStatus === "disconnected" && (
          <button onClick={onRefresh}
            className="text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg"
            style={{ background: "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))", color: "var(--color-error)", border: "1px solid color-mix(in srgb, var(--color-error) 30%, transparent)" }}>
            Verbindung unterbrochen — Neu laden
          </button>
        )}
      </div>
    </div>
  );
}
