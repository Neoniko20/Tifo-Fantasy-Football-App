"use client";
import React, { memo } from "react";
import type { WMFixture } from "@/lib/wm-types";

interface Props {
  fixtures: WMFixture[];
  nationNames: Record<string, string>;
  nationFlags: Record<string, string | undefined>;
}

export const FixtureStrip = memo(function FixtureStrip({ fixtures, nationNames, nationFlags }: Props) {
  if (!fixtures.length) return null;
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Aktive Fixtures
        </p>
      </div>
      <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
        {fixtures.map(f => {
          const isLive = f.status === "live";
          const isFinished = f.status === "finished";
          return (
            <div key={f.id} className="px-4 py-3 flex items-center gap-3">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isLive ? "animate-pulse" : ""}`}
                style={{ background: isLive ? "var(--color-primary)" : isFinished ? "var(--color-success)" : "var(--color-border)" }} />
              <div className="flex-1 flex items-center gap-1.5 justify-end">
                {nationFlags[f.home_nation_id] && (
                  <img src={nationFlags[f.home_nation_id]} alt="" className="w-4 h-3 object-cover rounded-sm" />
                )}
                <span className="text-xs font-black truncate" style={{ color: "var(--color-text)" }}>
                  {nationNames[f.home_nation_id] ?? "?"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-sm font-black w-5 text-center" style={{ color: isLive ? "var(--color-primary)" : "var(--color-text)" }}>
                  {f.home_score ?? "–"}
                </span>
                <span className="text-[8px]" style={{ color: "var(--color-muted)" }}>:</span>
                <span className="text-sm font-black w-5 text-center" style={{ color: isLive ? "var(--color-primary)" : "var(--color-text)" }}>
                  {f.away_score ?? "–"}
                </span>
              </div>
              <div className="flex-1 flex items-center gap-1.5">
                <span className="text-xs font-black truncate" style={{ color: "var(--color-text)" }}>
                  {nationNames[f.away_nation_id] ?? "?"}
                </span>
                {nationFlags[f.away_nation_id] && (
                  <img src={nationFlags[f.away_nation_id]} alt="" className="w-4 h-3 object-cover rounded-sm" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
