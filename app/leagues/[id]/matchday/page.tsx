"use client";

import { useState } from "react";
import { use } from "react";
import { BottomNav } from "@/app/components/BottomNav";
import { GameweekView } from "@/app/components/lineup/GameweekView";
import { ScoresView } from "@/app/components/lineup/ScoresView";
import { H2HSection } from "@/app/components/matchday/H2HSection";

type Tab = "fantasy" | "spiele";

const TABS: { id: Tab; label: string }[] = [
  { id: "fantasy", label: "Fantasy" },
  { id: "spiele",  label: "Spiele" },
];

export default function MatchdayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [activeTab, setActiveTab] = useState<Tab>("fantasy");

  return (
    <main className="flex min-h-screen flex-col pb-24" style={{ background: "var(--bg-page)" }}>

      {/* Sticky header */}
      <div className="sticky top-0 z-40" style={{ background: "var(--bg-page)", borderBottom: "1px solid var(--bg-elevated)" }}>
        <div className="max-w-[480px] mx-auto">
          <div className="px-4 pt-3 pb-2">
            <h1 className="text-sm font-black uppercase tracking-widest" style={{ color: "var(--color-text)" }}>
              Spieltag
            </h1>
          </div>
          <div className="flex gap-1 px-4 pb-0">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative px-4 py-2 text-[9px] font-black uppercase tracking-widest transition-colors"
                style={{ color: activeTab === tab.id ? "var(--color-primary)" : "var(--color-muted)" }}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <span
                    className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full"
                    style={{ background: "var(--color-primary)" }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Fantasy tab: H2H section + Gameweek content ────────────────── */}
      {activeTab === "fantasy" && (
        <>
          {/* H2H section with real data */}
          <div className="max-w-[480px] mx-auto w-full">
            <p className="px-4 pt-4 pb-1 text-[7px] font-black uppercase tracking-widest"
              style={{ color: "var(--color-muted)" }}>
              Dein Duell
            </p>
            <H2HSection leagueId={id} />
          </div>

          {/* Separator */}
          <div className="max-w-[480px] mx-auto w-full px-4 pt-2 pb-1">
            <div style={{ borderTop: "1px solid var(--color-border)" }} />
          </div>

          {/* Existing gameweek ranking + pairings */}
          <GameweekView leagueId={id} />
        </>
      )}

      {/* ── Spiele tab ─────────────────────────────────────────────────── */}
      {activeTab === "spiele" && <ScoresView />}

      <BottomNav />
    </main>
  );
}
