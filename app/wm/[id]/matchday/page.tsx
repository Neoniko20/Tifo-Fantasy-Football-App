"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/app/components/ui/Spinner";
import { EmptyState } from "@/app/components/ui/EmptyState";
import { BottomNav } from "@/app/components/BottomNav";
import type { WMFixture, WMGameweek, WMStage } from "@/lib/wm-types";

const STAGE_LABEL: Record<WMStage, string> = {
  group:        "Gruppenphase",
  round_of_32:  "Sechzehntelfinale",
  round_of_16:  "Achtelfinale",
  quarter:      "Viertelfinale",
  semi:         "Halbfinale",
  final:        "Finale",
};

const STAGE_ORDER: WMStage[] = ["group", "round_of_32", "round_of_16", "quarter", "semi", "final"];

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("de-DE", {
    weekday: "short", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function StatusDot({ status }: { status: WMFixture["status"] }) {
  if (status === "live") return (
    <span className="flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--color-primary)" }} />
      <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-primary)" }}>Live</span>
    </span>
  );
  if (status === "finished") return (
    <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-success)" }}>Beendet</span>
  );
  return (
    <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Geplant</span>
  );
}

export default function MatchdayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [loading, setLoading]           = useState(true);
  const [currentGW, setCurrentGW]       = useState<WMGameweek | null>(null);
  const [fixtures, setFixtures]         = useState<WMFixture[]>([]);
  const [allGameweeks, setAllGameweeks] = useState<WMGameweek[]>([]);
  const [selectedGW, setSelectedGW]     = useState<number>(1);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      loadAll();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    const { data: settings } = await supabase
      .from("wm_league_settings")
      .select("tournament_id")
      .eq("league_id", leagueId)
      .maybeSingle();

    if (!settings?.tournament_id) { setLoading(false); return; }
    const tournamentId = settings.tournament_id;

    const { data: gws } = await supabase
      .from("wm_gameweeks")
      .select("*")
      .eq("tournament_id", tournamentId)
      .order("gameweek");
    setAllGameweeks(gws || []);

    const active = (gws || []).find(g => g.status !== "finished") || (gws || []).at(-1);
    const activeGW = active?.gameweek ?? 1;
    setCurrentGW(active || null);
    setSelectedGW(activeGW);

    await loadFixtures(tournamentId, activeGW);
    setLoading(false);
  }

  async function loadFixtures(tournamentId: string, gw: number) {
    const { data } = await supabase
      .from("wm_fixtures")
      .select(`
        *,
        home_nation:wm_nations!home_nation_id(*),
        away_nation:wm_nations!away_nation_id(*)
      `)
      .eq("tournament_id", tournamentId)
      .eq("gameweek", gw)
      .order("kickoff");
    setFixtures((data as WMFixture[]) || []);
  }

  async function switchGW(gw: number) {
    setSelectedGW(gw);
    const { data: settings } = await supabase
      .from("wm_league_settings")
      .select("tournament_id")
      .eq("league_id", leagueId)
      .maybeSingle();
    if (settings?.tournament_id) await loadFixtures(settings.tournament_id, gw);
  }

  const fixturesByStage = STAGE_ORDER
    .map(stage => ({
      stage,
      items: fixtures.filter(f => f.stage === stage),
    }))
    .filter(g => g.items.length > 0);

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <Spinner text="Lade Spieltag..." />
    </main>
  );

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "var(--bg-page)" }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "var(--color-primary)" }} />

      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-center mb-5">
        <button onClick={() => window.location.href = `/wm/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          ← Liga
        </button>
        <p className="text-sm font-black" style={{ color: "var(--color-primary)" }}>Spieltag</p>
        <div className="w-12" />
      </div>

      {/* GW Selector */}
      {allGameweeks.length > 0 && (
        <div className="w-full max-w-md mb-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          <div className="flex gap-2 min-w-max pb-1">
            {allGameweeks.map(gw => (
              <button key={gw.gameweek} onClick={() => switchGW(gw.gameweek)}
                className="px-3 py-2 rounded-xl text-[10px] font-black transition-all"
                style={{
                  background: selectedGW === gw.gameweek ? "var(--color-primary)" : "var(--bg-card)",
                  color:      selectedGW === gw.gameweek ? "var(--bg-page)" : "var(--color-muted)",
                  border:     `1px solid ${selectedGW === gw.gameweek ? "var(--color-primary)" : gw.status === "active" ? "var(--color-border-subtle)" : "var(--color-border)"}`,
                }}>
                GW{gw.gameweek}
                <span className="ml-1 text-[7px]"
                  style={{ color: selectedGW === gw.gameweek ? "var(--bg-page)" : gw.status === "active" ? "var(--color-primary)" : "var(--color-border)" }}>
                  {gw.status === "active" ? "●" : gw.status === "finished" ? "✓" : "○"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* No fixtures */}
      {fixturesByStage.length === 0 && (
        <EmptyState icon="📅" title="Keine Spiele" description="Für diesen Spieltag wurden noch keine Fixtures importiert." />
      )}

      {/* Fixtures grouped by stage */}
      {fixturesByStage.map(({ stage, items }) => (
        <div key={stage} className="w-full max-w-md mb-5">
          <p className="text-[8px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>
            {STAGE_LABEL[stage]}
          </p>
          <div className="space-y-2">
            {items.map(fixture => {
              const isFinished = fixture.status === "finished";
              const isLive     = fixture.status === "live";
              return (
                <div key={fixture.id}
                  className="rounded-2xl p-3"
                  style={{
                    background: "var(--bg-card)",
                    border: `1px solid ${isLive ? "var(--color-primary)" : isFinished ? "var(--color-border-subtle)" : "var(--color-border)"}`,
                  }}>
                  {/* Status + time */}
                  <div className="flex items-center justify-between mb-2">
                    <StatusDot status={fixture.status} />
                    <p className="text-[8px]" style={{ color: "var(--color-muted)" }}>
                      {formatKickoff(fixture.kickoff)}
                    </p>
                  </div>

                  {/* Match row */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 flex items-center gap-2 min-w-0">
                      {fixture.home_nation?.flag_url && (
                        <img src={fixture.home_nation.flag_url} alt="" className="w-6 h-4 object-cover rounded-sm flex-shrink-0" />
                      )}
                      <p className="text-xs font-black truncate" style={{ color: "var(--color-text)" }}>
                        {fixture.home_nation?.name ?? "—"}
                      </p>
                    </div>

                    <div className="flex flex-col items-center flex-shrink-0">
                      <div className="flex items-center gap-1.5">
                        {isFinished || isLive ? (
                          <>
                            <span className="text-base font-black w-5 text-center" style={{ color: "var(--color-primary)" }}>
                              {fixture.home_score ?? 0}
                            </span>
                            <span className="text-[9px] font-black" style={{ color: "var(--color-border)" }}>:</span>
                            <span className="text-base font-black w-5 text-center" style={{ color: "var(--color-primary)" }}>
                              {fixture.away_score ?? 0}
                            </span>
                          </>
                        ) : (
                          <span className="text-[9px] font-black px-2" style={{ color: "var(--color-muted)" }}>vs</span>
                        )}
                      </div>
                      {(isFinished || isLive) && fixture.penalties_home != null && (
                        <p className="text-[7px] font-black text-center mt-0.5" style={{ color: "var(--color-muted)" }}>
                          n.E. {fixture.penalties_home}:{fixture.penalties_away ?? "?"}
                        </p>
                      )}
                    </div>

                    <div className="flex-1 flex items-center gap-2 justify-end min-w-0">
                      <p className="text-xs font-black truncate text-right" style={{ color: "var(--color-text)" }}>
                        {fixture.away_nation?.name ?? "—"}
                      </p>
                      {fixture.away_nation?.flag_url && (
                        <img src={fixture.away_nation.flag_url} alt="" className="w-6 h-4 object-cover rounded-sm flex-shrink-0" />
                      )}
                    </div>
                  </div>

                  {fixture.city && (
                    <p className="text-[7px] text-center mt-1.5" style={{ color: "var(--color-border)" }}>
                      {fixture.stadium ? `${fixture.stadium}, ` : ""}{fixture.city}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <BottomNav />
    </main>
  );
}
