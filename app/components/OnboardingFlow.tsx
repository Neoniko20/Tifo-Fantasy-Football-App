"use client";

import { useState } from "react";
import { TifoIcon } from "@/app/components/TifoLogo";

type Step = "welcome" | "create" | "join";

type Props = {
  onCreateLeague: (name: string, mode: "liga" | "wm", scoringType: "h2h" | "standard") => Promise<void>;
  onJoinLeague: (code: string) => Promise<void>;
  saving: boolean;
};

export function OnboardingFlow({ onCreateLeague, onJoinLeague, saving }: Props) {
  const [step, setStep] = useState<Step>("welcome");
  const [leagueName, setLeagueName] = useState("");
  const [mode, setMode] = useState<"liga" | "wm">("liga");
  const [scoringType, setScoringType] = useState<"h2h" | "standard">("h2h");
  const [joinCode, setJoinCode] = useState("");

  async function handleCreate() {
    if (!leagueName.trim()) return;
    await onCreateLeague(leagueName.trim(), mode, scoringType);
  }

  async function handleJoin() {
    if (!joinCode.trim()) return;
    await onJoinLeague(joinCode.trim());
  }

  if (step === "welcome") {
    return (
      <div className="flex flex-col items-center gap-6 py-8 w-full max-w-md mx-auto text-center">
        <div className="flex flex-col items-center gap-3">
          <TifoIcon size={56} />
          <div>
            <p className="text-2xl font-black" style={{ color: "var(--color-primary)" }}>Willkommen bei Tifo</p>
            <p className="text-[10px] font-black uppercase tracking-widest mt-1" style={{ color: "var(--color-muted)" }}>
              Fantasy Football für Freunde & Hardcore-Manager
            </p>
          </div>
        </div>

        {/* Value props */}
        <div className="w-full space-y-2">
          {[
            { icon: "🏆", label: "Bundesliga, Premier League, La Liga und mehr" },
            { icon: "🔄", label: "Snake Draft, Trades, Waiver Wire" },
            { icon: "⚽", label: "Liga-Modus & WM-Turnier-Modus" },
          ].map((v) => (
            <div key={v.label} className="flex items-center gap-3 p-3 rounded-xl text-left"
              style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
              <span className="text-base">{v.icon}</span>
              <span className="text-[10px] font-black" style={{ color: "var(--color-text)" }}>{v.label}</span>
            </div>
          ))}
        </div>

        {/* CTAs */}
        <div className="w-full space-y-2">
          <button
            onClick={() => setStep("create")}
            className="w-full py-4 rounded-2xl text-sm font-black uppercase tracking-widest transition-all"
            style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
            Liga erstellen
          </button>
          <button
            onClick={() => setStep("join")}
            className="w-full py-4 rounded-2xl text-sm font-black uppercase tracking-widest transition-all"
            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}>
            Liga beitreten
          </button>
        </div>
      </div>
    );
  }

  if (step === "create") {
    return (
      <div className="flex flex-col gap-5 w-full max-w-md mx-auto">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep("welcome")}
            className="w-8 h-8 flex items-center justify-center rounded-xl flex-shrink-0"
            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <p className="text-sm font-black uppercase tracking-widest" style={{ color: "var(--color-text)" }}>
            Liga erstellen
          </p>
        </div>

        {/* Liga-Name */}
        <div>
          <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>Liga-Name</p>
          <input
            value={leagueName}
            onChange={(e) => setLeagueName(e.target.value)}
            placeholder="z.B. Die Bundesliga-Könige"
            className="w-full p-3 rounded-xl text-sm focus:outline-none transition-colors"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text)",
            }}
          />
        </div>

        {/* Modus */}
        <div>
          <p className="text-[8px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>Modus</p>
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: "liga", label: "Liga-Modus", desc: "Bundesliga, PL, La Liga …", icon: "⚽" },
              { id: "wm", label: "WM-Modus", desc: "WM 2026 Turnier", icon: "🏆" },
            ] as const).map((m) => (
              <button key={m.id} onClick={() => setMode(m.id)}
                className="flex flex-col items-start p-4 rounded-2xl text-left transition-all"
                style={{
                  background: mode === m.id ? "color-mix(in srgb, var(--color-primary) 10%, var(--bg-card))" : "var(--bg-card)",
                  border: `1px solid ${mode === m.id ? "var(--color-primary)" : "var(--color-border)"}`,
                }}>
                <span className="text-xl mb-1">{m.icon}</span>
                <p className="text-xs font-black" style={{ color: mode === m.id ? "var(--color-primary)" : "var(--color-text)" }}>{m.label}</p>
                <p className="text-[8px] mt-0.5" style={{ color: "var(--color-muted)" }}>{m.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Wertungsmodus */}
        <div>
          <p className="text-[8px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>Wertung</p>
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: "h2h", label: "Head-to-Head", desc: "Jede Woche 1 vs 1" },
              { id: "standard", label: "Gesamtpunkte", desc: "Rangliste nach Punkten" },
            ] as const).map((s) => (
              <button key={s.id} onClick={() => setScoringType(s.id)}
                className="flex flex-col items-start p-4 rounded-2xl text-left transition-all"
                style={{
                  background: scoringType === s.id ? "color-mix(in srgb, var(--color-primary) 10%, var(--bg-card))" : "var(--bg-card)",
                  border: `1px solid ${scoringType === s.id ? "var(--color-primary)" : "var(--color-border)"}`,
                }}>
                <p className="text-xs font-black" style={{ color: scoringType === s.id ? "var(--color-primary)" : "var(--color-text)" }}>{s.label}</p>
                <p className="text-[8px] mt-0.5" style={{ color: "var(--color-muted)" }}>{s.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <p className="text-[8px] text-center" style={{ color: "var(--color-muted)" }}>
          Weitere Einstellungen (Spielerzahl, Waiver, Formations) kannst du danach im Admin-Bereich anpassen.
        </p>

        <button
          onClick={handleCreate}
          disabled={!leagueName.trim() || saving}
          className="w-full py-4 rounded-2xl text-sm font-black uppercase tracking-widest transition-all disabled:opacity-40"
          style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
          {saving ? "Erstelle…" : "Liga erstellen"}
        </button>
      </div>
    );
  }

  // step === "join"
  return (
    <div className="flex flex-col gap-5 w-full max-w-md mx-auto">
      <div className="flex items-center gap-3">
        <button onClick={() => setStep("welcome")}
          className="w-8 h-8 flex items-center justify-center rounded-xl flex-shrink-0"
          style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <p className="text-sm font-black uppercase tracking-widest" style={{ color: "var(--color-text)" }}>
          Liga beitreten
        </p>
      </div>

      <div className="p-6 rounded-2xl flex flex-col gap-4"
        style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
        <p className="text-[9px]" style={{ color: "var(--color-muted)" }}>
          Gib den Einladungscode ein, den dir der Liga-Owner geschickt hat.
        </p>
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          placeholder="ABCD1234"
          maxLength={12}
          className="w-full p-3 rounded-xl text-sm font-black text-center tracking-widest uppercase focus:outline-none transition-colors"
          style={{
            background: "var(--bg-page)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text)",
            letterSpacing: "0.2em",
          }}
        />
      </div>

      <button
        onClick={handleJoin}
        disabled={!joinCode.trim() || saving}
        className="w-full py-4 rounded-2xl text-sm font-black uppercase tracking-widest transition-all disabled:opacity-40"
        style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
        {saving ? "Beitreten…" : "Beitreten"}
      </button>
    </div>
  );
}
