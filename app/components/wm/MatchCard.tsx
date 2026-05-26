"use client";

import React, { memo, useEffect, useState } from "react";
import type { WMFixture } from "@/lib/wm-types";

interface Props {
  fixture: WMFixture;
  homeNationName?: string;
  awayNationName?: string;
  homeNationFlag?: string | null;
  awayNationFlag?: string | null;
  /** Compact layout for FixtureStrip / Bracket nodes */
  compact?: boolean;
}

type DisplayStatus =
  | "scheduled" | "live" | "half_time" | "extra_time"
  | "penalties" | "finished" | "delayed" | "interrupted";

function getDisplayStatus(f: WMFixture): DisplayStatus {
  if (f.status === "finished") return "finished";
  if (f.status === "live") {
    if (f.extra_status === "half_time")   return "half_time";
    if (f.extra_status === "extra_time")  return "extra_time";
    if (f.extra_status === "penalties")   return "penalties";
    if (f.extra_status === "delayed")     return "delayed";
    if (f.extra_status === "interrupted") return "interrupted";
    return "live";
  }
  return "scheduled";
}

function getApproximateMinute(kickoff: string, extraStatus: string | null | undefined): string {
  const elapsed = (Date.now() - new Date(kickoff).getTime()) / 60000;
  if (extraStatus === "extra_time") return `${Math.min(120, Math.round(elapsed))}'`;
  return `${Math.min(90, Math.round(elapsed))}'`;
}

const STATUS_LABEL: Record<DisplayStatus, string> = {
  scheduled:   "Geplant",
  live:        "Live",
  half_time:   "Halbzeit",
  extra_time:  "n.V.",
  penalties:   "Elfm.",
  finished:    "Abpfiff",
  delayed:     "Verzögert",
  interrupted: "Unterbrochen",
};

const STATUS_COLOR: Record<DisplayStatus, string> = {
  scheduled:   "var(--color-muted)",
  live:        "var(--color-primary)",
  half_time:   "var(--color-warning, #f59e0b)",
  extra_time:  "var(--color-primary)",
  penalties:   "var(--color-primary)",
  finished:    "var(--color-success)",
  delayed:     "var(--color-warning, #f59e0b)",
  interrupted: "var(--color-error)",
};

export const MatchCard = memo(function MatchCard({
  fixture, homeNationName, awayNationName, homeNationFlag, awayNationFlag, compact,
}: Props) {
  const ds = getDisplayStatus(fixture);
  const isLive = ds === "live" || ds === "extra_time" || ds === "penalties";
  const statusColor = STATUS_COLOR[ds];

  const [minute, setMinute] = useState(() =>
    isLive ? getApproximateMinute(fixture.kickoff, fixture.extra_status) : ""
  );
  useEffect(() => {
    if (!isLive) { setMinute(""); return; }
    setMinute(getApproximateMinute(fixture.kickoff, fixture.extra_status));
    const interval = setInterval(() => {
      setMinute(getApproximateMinute(fixture.kickoff, fixture.extra_status));
    }, 60_000);
    return () => clearInterval(interval);
  }, [isLive, fixture.kickoff, fixture.extra_status]);

  const penaltiesDisplay =
    fixture.penalties_home != null && fixture.penalties_away != null
      ? `(${fixture.penalties_home}–${fixture.penalties_away} n.E.)`
      : null;

  const kickoffDate = new Date(fixture.kickoff).toLocaleDateString("de-DE", {
    weekday: "short", day: "2-digit", month: "2-digit",
  });
  const kickoffTime = new Date(fixture.kickoff).toLocaleTimeString("de-DE", {
    hour: "2-digit", minute: "2-digit",
  });

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2"
        style={{ background: "var(--bg-card)", borderRadius: 8 }}>
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isLive ? "animate-pulse" : ""}`}
          style={{ background: statusColor }} />
        <div className="flex items-center gap-1 flex-1 justify-end">
          {homeNationFlag && <img src={homeNationFlag} alt="" className="w-4 h-3 object-cover rounded-sm" />}
          <span className="text-[10px] font-black truncate" style={{ color: "var(--color-text)" }}>
            {homeNationName ?? "?"}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-xs font-black w-4 text-center transition-all duration-300"
            style={{ color: isLive ? "var(--color-primary)" : "var(--color-text)" }}>
            {fixture.home_score ?? "–"}
          </span>
          <span className="text-[8px]" style={{ color: "var(--color-muted)" }}>:</span>
          <span className="text-xs font-black w-4 text-center transition-all duration-300"
            style={{ color: isLive ? "var(--color-primary)" : "var(--color-text)" }}>
            {fixture.away_score ?? "–"}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-1">
          <span className="text-[10px] font-black truncate" style={{ color: "var(--color-text)" }}>
            {awayNationName ?? "?"}
          </span>
          {awayNationFlag && <img src={awayNationFlag} alt="" className="w-4 h-3 object-cover rounded-sm" />}
        </div>
        <span className="text-[7px] font-black uppercase tracking-widest flex-shrink-0 w-10 text-right"
          style={{ color: statusColor }}>
          {isLive ? minute : STATUS_LABEL[ds]}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden"
      style={{
        background: "var(--bg-card)",
        border: `1px solid ${isLive ? "color-mix(in srgb, var(--color-primary) 30%, var(--color-border))" : ds === "finished" ? "var(--color-border-subtle)" : "var(--color-border)"}`,
      }}>
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? "animate-pulse" : ""}`}
            style={{ background: statusColor }} />
          <span className="text-[8px] font-black uppercase tracking-widest"
            style={{ color: statusColor }}>
            {STATUS_LABEL[ds]}{isLive && minute ? ` · ${minute}` : ""}
          </span>
        </div>
        <span className="text-[7px]" style={{ color: "var(--color-muted)" }}>
          {ds === "scheduled" ? `${kickoffDate} · ${kickoffTime}` : ""}
        </span>
      </div>
      {/* Teams + Score */}
      <div className="flex items-center px-4 py-4 gap-3">
        <div className="flex-1 flex items-center gap-2 justify-end">
          {homeNationFlag && <img src={homeNationFlag} alt={homeNationName} className="w-6 h-4 object-cover rounded-sm" />}
          <span className="text-sm font-black truncate" style={{ color: "var(--color-text)" }}>
            {homeNationName ?? "?"}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-2xl font-black transition-all duration-300"
            style={{ color: isLive ? "var(--color-primary)" : "var(--color-text)", minWidth: 24, textAlign: "center" }}>
            {(ds === "live" || ds === "half_time" || ds === "extra_time" || ds === "penalties" || ds === "finished")
              ? (fixture.home_score ?? 0) : "–"}
          </span>
          <span className="text-sm" style={{ color: "var(--color-muted)" }}>:</span>
          <span className="text-2xl font-black transition-all duration-300"
            style={{ color: isLive ? "var(--color-primary)" : "var(--color-text)", minWidth: 24, textAlign: "center" }}>
            {(ds === "live" || ds === "half_time" || ds === "extra_time" || ds === "penalties" || ds === "finished")
              ? (fixture.away_score ?? 0) : "–"}
          </span>
        </div>
        <div className="flex-1 flex items-center gap-2">
          <span className="text-sm font-black truncate" style={{ color: "var(--color-text)" }}>
            {awayNationName ?? "?"}
          </span>
          {awayNationFlag && <img src={awayNationFlag} alt={awayNationName} className="w-6 h-4 object-cover rounded-sm" />}
        </div>
      </div>
      {penaltiesDisplay && (
        <div className="px-4 pb-3 text-center">
          <span className="text-[9px] font-black" style={{ color: "var(--color-muted)" }}>
            {penaltiesDisplay}
          </span>
        </div>
      )}
      {fixture.city && (
        <div className="px-4 pb-2 text-center">
          <span className="text-[7px]" style={{ color: "var(--color-border)" }}>
            {fixture.stadium ? `${fixture.stadium}, ` : ""}{fixture.city}
          </span>
        </div>
      )}
    </div>
  );
});
