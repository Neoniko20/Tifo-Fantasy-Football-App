"use client";

import { useState } from "react";
import { TifoScreenBackground } from "@/app/components/TifoScreenBackground";
import { PlayerPitchCard } from "@/app/components/PlayerPitchCard";

const THEMES = ["amber", "flutlicht", "tournament", "ucl"] as const;

type MockPlayer = {
  id: number;
  name: string;
  position: "GK" | "DF" | "MF" | "FW";
  points: number;
  imageUrl?: string | null;
  isCaptain?: boolean;
  isViceCaptain?: boolean;
  injured?: boolean;
  live?: number;
};

// 4-3-3 mock XI (row, col indices used for grouping)
type Row = { row: number; players: (MockPlayer | null)[]; positions: string[] };

const MOCK_XI: Row[] = [
  {
    row: 1,
    positions: ["LW", "ST", "RW"],
    players: [
      { id: 1, name: "Vinicius Jr", position: "FW", points: 15.3 },
      { id: 2, name: "Dusan Vlahovic", position: "FW", points: 16.2, isCaptain: true, live: 82 },
      { id: 3, name: "Mohamed Salah", position: "FW", points: 14.8, live: 68 },
    ],
  },
  {
    row: 2,
    positions: ["CM", "CM", "CM"],
    players: [
      { id: 4, name: "Martin Ødegaard", position: "MF", points: 12.4 },
      { id: 5, name: "Jude Bellingham", position: "MF", points: 13.1, isViceCaptain: true, live: 45 },
      null,
    ],
  },
  {
    row: 3,
    positions: ["LB", "CB", "CB", "RB"],
    players: [
      { id: 6, name: "Theo Hernández", position: "DF", points: 12.4 },
      { id: 7, name: "Rúben Dias", position: "DF", points: 10.6 },
      { id: 8, name: "Antonio Rüdiger", position: "DF", points: 10.2, injured: true },
      { id: 9, name: "Benjamin Pavard", position: "DF", points: 9.1, live: 0 },
    ],
  },
  {
    row: 4,
    positions: ["GK"],
    players: [{ id: 10, name: "Alisson", position: "GK", points: 11.2 }],
  },
];

const MOCK_BENCH: (MockPlayer | null)[] = [
  { id: 11, name: "S. Lunin", position: "GK", points: 7.2 },
  { id: 12, name: "G. Magalhães", position: "DF", points: 7.1 },
  { id: 13, name: "K. Kvaratskhelia", position: "MF", points: 8.0 },
  null,
];

export default function SandboxLineupPage() {
  const [theme, setTheme] = useState<(typeof THEMES)[number]>("flutlicht");
  const [locked, setLocked] = useState(false);

  return (
    <div data-theme={theme} className="min-h-screen">
      <TifoScreenBackground>
        <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col gap-4 px-4 py-8">
          <h1 className="text-xl font-black uppercase tracking-wider text-[var(--color-text)]">
            Lineup sandbox
          </h1>

          <div className="flex flex-wrap gap-2">
            {THEMES.map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-wider ${
                  t === theme
                    ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                    : "border-[var(--color-border)] text-[var(--color-muted)]"
                }`}
              >
                {t}
              </button>
            ))}
            <button
              onClick={() => setLocked((v) => !v)}
              className="rounded-full border border-[var(--color-border)] px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--color-muted)]"
            >
              {locked ? "unlock" : "lock"}
            </button>
          </div>

          {/* ── Pitch ── */}
          <div
            className="relative w-full overflow-hidden rounded-2xl"
            style={{
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--color-primary) 6%, var(--bg-page)) 0%, var(--bg-page) 100%)",
              border: "1px solid color-mix(in srgb, var(--color-primary) 22%, transparent)",
              minHeight: 560,
            }}
          >
            {/* Pitch lines — subtle primary-soft outline of a football pitch */}
            <div aria-hidden className="pointer-events-none absolute inset-0">
              {/* Center line */}
              <div
                className="absolute left-0 right-0 top-1/2 h-px"
                style={{ background: "color-mix(in srgb, var(--color-primary) 22%, transparent)" }}
              />
              {/* Center circle */}
              <div
                className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                style={{ borderColor: "color-mix(in srgb, var(--color-primary) 22%, transparent)" }}
              />
              {/* Center spot */}
              <div
                className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ background: "color-mix(in srgb, var(--color-primary) 40%, transparent)" }}
              />

              {/* Top penalty box (no top border — flush with goal line) */}
              <div
                className="absolute left-[18%] right-[18%] top-0 h-[90px] border border-t-0"
                style={{ borderColor: "color-mix(in srgb, var(--color-primary) 22%, transparent)" }}
              />
              {/* Top goal area (6-yard) */}
              <div
                className="absolute left-[34%] right-[34%] top-0 h-[34px] border border-t-0"
                style={{ borderColor: "color-mix(in srgb, var(--color-primary) 22%, transparent)" }}
              />
              {/* Top penalty spot */}
              <div
                className="absolute left-1/2 top-[60px] h-1 w-1 -translate-x-1/2 rounded-full"
                style={{ background: "color-mix(in srgb, var(--color-primary) 40%, transparent)" }}
              />

              {/* Bottom penalty box */}
              <div
                className="absolute left-[18%] right-[18%] bottom-0 h-[90px] border border-b-0"
                style={{ borderColor: "color-mix(in srgb, var(--color-primary) 22%, transparent)" }}
              />
              {/* Bottom goal area */}
              <div
                className="absolute left-[34%] right-[34%] bottom-0 h-[34px] border border-b-0"
                style={{ borderColor: "color-mix(in srgb, var(--color-primary) 22%, transparent)" }}
              />
              {/* Bottom penalty spot */}
              <div
                className="absolute left-1/2 bottom-[60px] h-1 w-1 -translate-x-1/2 rounded-full"
                style={{ background: "color-mix(in srgb, var(--color-primary) 40%, transparent)" }}
              />
            </div>

            {/* Content wrapper above lines — absolute so rows span full pitch height.
                Uses justify-between with generous top padding so formation sits lower,
                placing the GK visually inside the bottom penalty box. */}
            <div className="absolute inset-0 z-10 flex flex-col justify-between px-3 pt-8 pb-1">

            {/* Rows */}
            {MOCK_XI.map(({ row, players, positions }) => (
              <div key={row} className="relative z-10 flex justify-center gap-2">
                {players.map((p, i) => {
                  const pos = positions[i];
                  if (!p) {
                    return (
                      <PlayerPitchCard
                        key={`${row}-${i}`}
                        variant="compact"
                        position={pos}
                        isEmpty
                      />
                    );
                  }
                  const status = locked
                    ? "locked"
                    : p.injured
                      ? "injured"
                      : p.isCaptain
                        ? "active"
                        : "default";
                  return (
                    <PlayerPitchCard
                      key={p.id}
                      variant="compact"
                      position={pos}
                      name={p.name}
                      points={p.points}
                      isCaptain={p.isCaptain}
                      isViceCaptain={p.isViceCaptain}
                      liveMinutes={p.live}
                      status={status}
                    />
                  );
                })}
              </div>
            ))}
            </div>
          </div>

          {/* ── Bench ── */}
          <div className="flex flex-col gap-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-[var(--color-muted)]">
              Bank · {MOCK_BENCH.filter(Boolean).length}/4
            </p>
            <div className="grid grid-cols-4 gap-2">
              {MOCK_BENCH.map((p, i) =>
                p ? (
                  <PlayerPitchCard
                    key={p.id}
                    variant="bench"
                    position={p.position}
                    name={p.name}
                    points={p.points}
                    status={locked ? "locked" : "default"}
                  />
                ) : (
                  <PlayerPitchCard
                    key={`empty-${i}`}
                    variant="bench"
                    position={String(i + 1)}
                    isEmpty
                  />
                ),
              )}
            </div>
          </div>
        </div>
      </TifoScreenBackground>
    </div>
  );
}
