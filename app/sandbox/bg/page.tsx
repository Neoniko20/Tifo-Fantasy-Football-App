"use client";

import { useState } from "react";
import { TifoScreenBackground } from "@/app/components/TifoScreenBackground";

const THEMES = ["amber", "flutlicht", "tournament", "ucl"] as const;

export default function SandboxBgPage() {
  const [theme, setTheme] = useState<(typeof THEMES)[number]>("flutlicht");

  return (
    <div data-theme={theme} className="min-h-screen">
      <TifoScreenBackground>
        <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col gap-6 px-5 py-10">
          <h1 className="text-3xl font-bold tracking-wide text-[var(--color-text)]">
            TIFO Screen Background
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Dunkler Base Layer + themed Flutlicht-Gradient + Grain Overlay.
          </p>

          <div className="flex flex-wrap gap-2">
            {THEMES.map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-wider transition ${
                  t === theme
                    ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                    : "border-[var(--color-border)] text-[var(--color-muted)]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div
            className="rounded-2xl border p-5"
            style={{
              backgroundColor: "var(--bg-card)",
              borderColor: "var(--color-border)",
              boxShadow: "0 0 32px var(--color-glow)",
            }}
          >
            <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
              Matchday 32
            </div>
            <div className="mt-1 text-2xl font-bold text-[var(--color-accent)]">
              CURVA NORD
            </div>
            <div className="mt-4 flex gap-6 text-sm">
              <div>
                <div className="text-[var(--color-muted)]">GW Points</div>
                <div className="text-xl text-[var(--color-primary)]">76</div>
              </div>
              <div>
                <div className="text-[var(--color-muted)]">Overall</div>
                <div className="text-xl text-[var(--color-text)]">1,842</div>
              </div>
            </div>
          </div>

          <div
            className="rounded-xl border p-4 text-xs"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--color-border-subtle)",
            }}
          >
            <div className="text-[var(--color-text-secondary)]">
              text-secondary auf bg-elevated
            </div>
            <div className="text-[var(--color-muted)]">color-muted</div>
          </div>
        </div>
      </TifoScreenBackground>
    </div>
  );
}
