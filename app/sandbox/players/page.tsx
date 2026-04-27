"use client";

import { useState } from "react";
import { TifoScreenBackground } from "@/app/components/TifoScreenBackground";
import { PlayerAvatar } from "@/app/components/PlayerAvatar";
import { PlayerPitchCard } from "@/app/components/PlayerPitchCard";

const THEMES = ["amber", "flutlicht", "tournament", "ucl"] as const;

const POS = {
  GK: "var(--pos-gk)",
  DF: "var(--pos-df)",
  MF: "var(--pos-mf)",
  FW: "var(--pos-fw)",
};

const demoPlayer = { id: 1, photo_url: null, api_team_id: 40 };

export default function SandboxPlayersPage() {
  const [theme, setTheme] = useState<(typeof THEMES)[number]>("flutlicht");
  const gwPoints = { 1: 13 };
  const gwMinutes = { 1: 72 };

  return (
    <div data-theme={theme} className="min-h-screen">
      <TifoScreenBackground>
        <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col gap-6 px-5 py-10">
          <h1 className="text-2xl font-black text-[var(--color-text)]">Player components</h1>

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
          </div>

          {/* ── PlayerAvatar states ── */}
          <section className="flex flex-col gap-3">
            <h2 className="text-xs uppercase tracking-widest text-[var(--color-muted)]">PlayerAvatar (circle)</h2>
            <div className="flex flex-wrap items-center gap-4 rounded-xl border p-4"
                 style={{ borderColor: "var(--color-border)", background: "var(--bg-card)" }}>
              <Labeled label="empty">
                <PlayerAvatar player={null} posColor={POS.MF} posLabel="MF" />
              </Labeled>
              <Labeled label="selected">
                <PlayerAvatar player={null} posColor={POS.MF} posLabel="MF" selected />
              </Labeled>
              <Labeled label="default">
                <PlayerAvatar player={demoPlayer} posColor={POS.MF} />
              </Labeled>
              <Labeled label="active">
                <PlayerAvatar player={demoPlayer} posColor={POS.MF} active />
              </Labeled>
              <Labeled label="captain">
                <PlayerAvatar player={demoPlayer} posColor={POS.FW} isCap gwPoints={gwPoints} />
              </Labeled>
              <Labeled label="vice">
                <PlayerAvatar player={demoPlayer} posColor={POS.FW} isVC />
              </Labeled>
              <Labeled label="injured">
                <PlayerAvatar player={demoPlayer} posColor={POS.DF} isInjured />
              </Labeled>
              <Labeled label="IR">
                <PlayerAvatar player={demoPlayer} posColor={POS.DF} isIR />
              </Labeled>
              <Labeled label="live-swap">
                <PlayerAvatar player={demoPlayer} posColor={POS.MF} canLiveSwap gwMinutes={gwMinutes} />
              </Labeled>
              <Labeled label="bench-muted">
                <PlayerAvatar player={demoPlayer} posColor={POS.MF} tone="bench-muted" />
              </Labeled>
              <Labeled label="taxi">
                <PlayerAvatar player={demoPlayer} posColor={POS.FW} taxi />
              </Labeled>
            </div>
          </section>

          {/* ── PlayerPitchCard ── */}
          <section className="flex flex-col gap-3">
            <h2 className="text-xs uppercase tracking-widest text-[var(--color-muted)]">PlayerPitchCard (banner)</h2>
            <div className="grid grid-cols-3 gap-3 rounded-xl border p-4"
                 style={{ borderColor: "var(--color-border)", background: "var(--bg-card)" }}>
              <PlayerPitchCard name="Dusan Vlahovic" position="ST" rating={91} points={16.2} isCaptain status="active" />
              <PlayerPitchCard name="Vinicius Jr" position="LW" rating={90} points={15.3} />
              <PlayerPitchCard name="Mohamed Salah" position="RW" rating={89} points={14.8} />
              <PlayerPitchCard name="Jude Bellingham" position="CM" rating={87} points={13.1} isViceCaptain />
              <PlayerPitchCard name="Martin Ødegaard" position="CM" rating={88} points={12.4} />
              <PlayerPitchCard name="Pedri" position="CM" rating={86} points={11.6} status="injured" />
            </div>

            <h3 className="mt-2 text-[10px] uppercase tracking-widest text-[var(--color-muted)]">bench variant</h3>
            <div className="grid grid-cols-4 gap-2 rounded-xl border p-3"
                 style={{ borderColor: "var(--color-border)", background: "var(--bg-card)" }}>
              <PlayerPitchCard variant="bench" name="S. Lunin" position="GK" rating={82} points={7.2} />
              <PlayerPitchCard variant="bench" name="G. Magalhães" position="DF" rating={81} points={7.1} />
              <PlayerPitchCard variant="bench" name="K. Kvaratskhelia" position="MID" rating={83} points={8.0} />
              <PlayerPitchCard variant="bench" name="K. Mainoo" position="MID" rating={80} points={6.2} status="locked" />
            </div>

            <h3 className="mt-2 text-[10px] uppercase tracking-widest text-[var(--color-muted)]">compact / taxi</h3>
            <div className="grid grid-cols-4 gap-2 rounded-xl border p-3"
                 style={{ borderColor: "var(--color-border)", background: "var(--bg-card)" }}>
              <PlayerPitchCard variant="compact" name="A. Güler" position="FW" rating={76} points={5.4} status="taxi" />
              <PlayerPitchCard variant="compact" name="L. Yoro" position="DF" rating={75} points={5.1} status="taxi" />
            </div>
          </section>
        </div>
      </TifoScreenBackground>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {children}
      <span className="text-[9px] uppercase tracking-wider text-[var(--color-muted)]">{label}</span>
    </div>
  );
}
