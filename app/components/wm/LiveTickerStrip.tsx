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

export function LiveTickerStrip({ events }: Props) {
  const [visible, setVisible] = useState(false);
  const top = [...events].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])[0];

  useEffect(() => {
    if (!top) return;
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, [top?.id]);

  if (!top) return null;

  const accent =
    top.priority === "high" ? "var(--color-error)"
    : top.priority === "medium" ? "var(--color-primary)"
    : "var(--color-muted)";

  return (
    <div className="w-full px-4 py-2 rounded-xl overflow-hidden transition-opacity duration-300"
      style={{
        background: `color-mix(in srgb, ${accent} 10%, var(--bg-card))`,
        border: `1px solid color-mix(in srgb, ${accent} 30%, var(--color-border))`,
        opacity: visible ? 1 : 0,
      }}>
      <p className="text-[9px] font-black truncate" style={{ color: accent }}>
        {top.text}
      </p>
    </div>
  );
}
