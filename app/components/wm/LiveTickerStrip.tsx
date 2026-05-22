"use client";
import React, { useEffect, useState } from "react";

interface TickerEvent {
  text: string;
  priority: "high" | "medium" | "low";
  id: string;
}

interface Props {
  events: TickerEvent[];
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const ROTATION_MS = 4000; // rotate every 4 seconds

export function LiveTickerStrip({ events }: Props) {
  const sorted = [...events].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  );

  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(false);

  // Reset + fade-in when the top event changes (new high-priority message arrived)
  const topId = sorted[0]?.id;
  useEffect(() => {
    setIdx(0);
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, [topId]);

  // Auto-rotate through all events when there are multiple
  useEffect(() => {
    if (sorted.length <= 1) return;
    const interval = setInterval(() => {
      setVisible(false);
      const next = setTimeout(() => {
        setIdx(prev => (prev + 1) % sorted.length);
        setVisible(true);
      }, 250);
      return () => clearTimeout(next);
    }, ROTATION_MS);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted.length, topId]);

  const top = sorted[idx];
  if (!top) return null;

  const accent =
    top.priority === "high"   ? "var(--color-error)"
    : top.priority === "medium" ? "var(--color-primary)"
    : "var(--color-muted)";

  return (
    <div
      className="w-full px-4 py-2 rounded-xl overflow-hidden"
      style={{
        background: `color-mix(in srgb, ${accent} 10%, var(--bg-card))`,
        border:     `1px solid color-mix(in srgb, ${accent} 30%, var(--color-border))`,
        transition: "opacity 0.25s ease",
        opacity:    visible ? 1 : 0,
      }}
    >
      <div className="flex items-center gap-2">
        {/* Live pulse dot */}
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse"
          style={{ background: accent }}
        />
        <p className="text-[9px] font-black truncate flex-1" style={{ color: accent }}>
          {top.text}
        </p>
        {/* Counter badge — shown when multiple events are rotating */}
        {sorted.length > 1 && (
          <span
            className="text-[7px] font-black flex-shrink-0 px-1.5 py-0.5 rounded-full"
            style={{
              background: `color-mix(in srgb, ${accent} 15%, var(--bg-elevated))`,
              color:  accent,
              border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)`,
            }}
          >
            {idx + 1}/{sorted.length}
          </span>
        )}
      </div>
    </div>
  );
}
