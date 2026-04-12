"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const THEMES = [
  {
    id: "amber",
    label: "Stadium",
    desc: "Amber Flutlicht",
    bg: "#0c0900",
    primary: "#f5a623",
    card: "#141008",
  },
  {
    id: "flutlicht",
    label: "Flutlicht",
    desc: "Schwarz & Gelb",
    bg: "#050505",
    primary: "#f0e060",
    card: "#0f0f0f",
  },
  {
    id: "tournament",
    label: "Turnier",
    desc: "Navy & Gold",
    bg: "#0a0f1e",
    primary: "#e8c84a",
    card: "#0f1628",
  },
  {
    id: "ucl",
    label: "Champions",
    desc: "Deep Space",
    bg: "#060810",
    primary: "#7b9fff",
    card: "#080c18",
  },
] as const;

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <div className="grid grid-cols-2 gap-2">
      {THEMES.map((t) => {
        const isActive = theme === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className="relative rounded-2xl p-3 text-left transition-all"
            style={{
              background: t.card,
              border: `2px solid ${isActive ? t.primary : "transparent"}`,
              outline: "none",
            }}
          >
            {/* Mini preview strip */}
            <div className="flex gap-1 mb-2">
              <div className="h-4 rounded flex-1" style={{ background: t.bg }} />
              <div className="h-4 w-4 rounded" style={{ background: t.primary }} />
            </div>

            <p className="text-[9px] font-black uppercase tracking-widest"
              style={{ color: isActive ? t.primary : "#888" }}>
              {t.label}
            </p>
            <p className="text-[8px] mt-0.5"
              style={{ color: isActive ? t.primary + "99" : "#555" }}>
              {t.desc}
            </p>

            {isActive && (
              <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
                style={{ background: t.primary }} />
            )}
          </button>
        );
      })}
    </div>
  );
}
