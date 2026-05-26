"use client";

import React, { memo, useMemo, useState } from "react";
import type { WMFixture, WMNation, WMStage } from "@/lib/wm-types";
import { MatchCard } from "@/app/components/wm/MatchCard";

interface BracketMatch {
  fixture?: WMFixture;
  home_nation?: WMNation;
  away_nation?: WMNation;
  winner?: WMNation | null;
  is_live: boolean;
}

interface BracketRound {
  stage: WMStage;
  label: string;
  matches: BracketMatch[];
}

const KO_STAGES: WMStage[] = ["round_of_32", "round_of_16", "quarter", "semi", "final"];

const STAGE_LABEL: Record<WMStage, string> = {
  group:        "Gruppenphase",
  round_of_32:  "Sechzehntelfinale",
  round_of_16:  "Achtelfinale",
  quarter:      "Viertelfinale",
  semi:         "Halbfinale",
  final:        "Finale",
};

// Expected match counts per WM stage (32-team tournament)
const STAGE_MATCH_COUNT: Partial<Record<WMStage, number>> = {
  round_of_32: 16,
  round_of_16: 8,
  quarter:     4,
  semi:        2,
  final:       1,
};

// Penalty override takes precedence over drawn scores.
// Returns null for live/scheduled fixtures or genuine draws without penalties.
function getWinner(fixture: WMFixture, nationMap: Record<string, WMNation>): WMNation | null {
  if (fixture.status !== "finished") return null;

  const home = nationMap[fixture.home_nation_id];
  const away = nationMap[fixture.away_nation_id];

  if (fixture.penalties_home != null && fixture.penalties_away != null) {
    if (fixture.penalties_home > fixture.penalties_away) return home ?? null;
    if (fixture.penalties_away > fixture.penalties_home) return away ?? null;
    return null;
  }

  const hs = fixture.home_score ?? 0;
  const as_ = fixture.away_score ?? 0;
  if (hs > as_) return home ?? null;
  if (as_ > hs) return away ?? null;
  return null;
}

function buildBracketFromFixtures(fixtures: WMFixture[], nations: WMNation[]): BracketRound[] {
  const nationMap: Record<string, WMNation> = {};
  for (const n of nations) nationMap[n.id] = n;

  const rounds: BracketRound[] = [];

  for (const stage of KO_STAGES) {
    const stageFixtures = fixtures
      .filter(f => f.stage === stage)
      .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());

    const expectedCount = STAGE_MATCH_COUNT[stage] ?? 0;

    const matches: BracketMatch[] = stageFixtures.map(f => ({
      fixture:      f,
      home_nation:  f.home_nation ?? nationMap[f.home_nation_id],
      away_nation:  f.away_nation ?? nationMap[f.away_nation_id],
      winner:       getWinner(f, nationMap),
      is_live:      f.status === "live",
    }));

    // Pad with placeholder slots up to expectedCount
    const needed = Math.max(0, expectedCount - matches.length);
    for (let i = 0; i < needed; i++) {
      matches.push({ is_live: false });
    }

    if (matches.length > 0) {
      rounds.push({ stage, label: STAGE_LABEL[stage], matches });
    }
  }

  return rounds;
}

interface Props {
  fixtures: WMFixture[];
  nations: WMNation[];
}

export const TournamentBracket = memo(function TournamentBracket({ fixtures, nations }: Props) {
  // Default: all stages expanded
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});

  const rounds = useMemo(
    () => buildBracketFromFixtures(fixtures, nations),
    [fixtures, nations],
  );

  function toggleStage(stage: string) {
    setExpandedStages(prev => ({ ...prev, [stage]: !isExpanded(stage, prev) }));
  }

  function isExpanded(stage: string, state: Record<string, boolean>) {
    return state[stage] !== false; // default open
  }

  if (rounds.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Noch keine KO-Fixtures vorhanden
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rounds.map(round => {
        const expanded = isExpanded(round.stage, expandedStages);
        const hasLive  = round.matches.some(m => m.is_live);

        return (
          <div key={round.stage} className="rounded-xl overflow-hidden"
            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>

            {/* Stage header */}
            <button
              className="w-full flex items-center justify-between px-4 py-3"
              style={{ borderBottom: expanded ? "1px solid var(--color-border)" : "none" }}
              onClick={() => toggleStage(round.stage)}>
              <div className="flex items-center gap-2">
                {hasLive && (
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ background: "var(--color-primary)" }} />
                )}
                <p className="text-[9px] font-black uppercase tracking-widest"
                  style={{ color: "var(--color-muted)" }}>
                  {round.label}
                </p>
                <span className="text-[7px] px-1.5 py-0.5 rounded-full"
                  style={{ background: "var(--color-border)", color: "var(--color-muted)" }}>
                  {round.matches.filter(m => m.fixture).length}/{round.matches.length}
                </span>
              </div>
              <span className="text-[8px]" style={{ color: "var(--color-muted)" }}>
                {expanded ? "▲" : "▼"}
              </span>
            </button>

            {/* Match list */}
            {expanded && (
              <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {round.matches.map((match, i) => {

                  // Placeholder — fixture not yet scheduled
                  if (!match.fixture) {
                    return (
                      <div key={`placeholder-${i}`}
                        className="flex items-center gap-3 px-4 py-3">
                        <div className="flex-1 flex items-center gap-1.5 justify-end">
                          <span className="text-[9px]" style={{ color: "var(--color-border)" }}>
                            Noch nicht bekannt
                          </span>
                        </div>
                        <span className="text-[8px] px-2 flex-shrink-0"
                          style={{ color: "var(--color-border)" }}>vs</span>
                        <div className="flex-1 flex items-center gap-1.5">
                          <span className="text-[9px]" style={{ color: "var(--color-border)" }}>
                            Noch nicht bekannt
                          </span>
                        </div>
                      </div>
                    );
                  }

                  // Real fixture — MatchCard compact
                  return (
                    <div key={match.fixture.id} className="px-3 py-2">
                      <MatchCard
                        fixture={match.fixture}
                        homeNationName={match.home_nation?.name}
                        awayNationName={match.away_nation?.name}
                        homeNationFlag={match.home_nation?.flag_url}
                        awayNationFlag={match.away_nation?.flag_url}
                        compact
                      />
                      {match.winner && (
                        <p className="text-[7px] font-black uppercase tracking-widest text-center mt-1"
                          style={{ color: "var(--color-success)" }}>
                          Weiter: {match.winner.name}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
