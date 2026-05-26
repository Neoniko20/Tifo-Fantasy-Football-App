"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/app/components/ui/Spinner";
import { EmptyState } from "@/app/components/ui/EmptyState";
import { BottomNav } from "@/app/components/BottomNav";
import { MatchCard } from "@/app/components/wm/MatchCard";
import { TournamentBracket } from "@/app/components/wm/TournamentBracket";
import type { WMFixture, WMGameweek, WMNation, WMStage } from "@/lib/wm-types";

const STAGE_LABEL: Record<WMStage, string> = {
  group:        "Gruppenphase",
  round_of_32:  "Sechzehntelfinale",
  round_of_16:  "Achtelfinale",
  quarter:      "Viertelfinale",
  semi:         "Halbfinale",
  final:        "Finale",
};

const STAGE_ORDER: WMStage[] = ["group", "round_of_32", "round_of_16", "quarter", "semi", "final"];

export default function MatchdayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [loading, setLoading]             = useState(true);
  const [currentGW, setCurrentGW]         = useState<WMGameweek | null>(null);
  const [fixtures, setFixtures]           = useState<WMFixture[]>([]);
  const [allGameweeks, setAllGameweeks]   = useState<WMGameweek[]>([]);
  const [selectedGW, setSelectedGW]       = useState<number>(1);
  const [tournamentId, setTournamentId]   = useState<string | null>(null);
  const [allKOFixtures, setAllKOFixtures] = useState<WMFixture[]>([]);
  const [nations, setNations]             = useState<WMNation[]>([]);
  const [activeTab, setActiveTab]         = useState<"fixtures" | "bracket">("fixtures");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      loadAll();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime score updates — patches both fixtures and allKOFixtures
  useEffect(() => {
    if (!tournamentId) return;
    const channel = supabase
      .channel("wm-matchday-fixtures")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "wm_fixtures", filter: `tournament_id=eq.${tournamentId}` },
        (payload) => {
          const updated = payload.new as WMFixture;
          setFixtures(prev => prev.map(f => f.id === updated.id ? { ...f, ...updated } : f));
          setAllKOFixtures(prev => prev.map(f => f.id === updated.id ? { ...f, ...updated } : f));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tournamentId]);

  async function loadAll() {
    const { data: settings } = await supabase
      .from("wm_league_settings")
      .select("tournament_id")
      .eq("league_id", leagueId)
      .maybeSingle();

    if (!settings?.tournament_id) { setLoading(false); return; }
    const tid = settings.tournament_id;
    setTournamentId(tid);

    const [gwRes, nationsRes, koRes] = await Promise.all([
      supabase.from("wm_gameweeks").select("*").eq("tournament_id", tid).order("gameweek"),
      supabase.from("wm_nations").select("*").eq("tournament_id", tid),
      supabase.from("wm_fixtures")
        .select("*, home_nation:wm_nations!home_nation_id(*), away_nation:wm_nations!away_nation_id(*)")
        .eq("tournament_id", tid)
        .in("stage", ["round_of_32", "round_of_16", "quarter", "semi", "final"])
        .order("kickoff"),
    ]);

    const gws = gwRes.data || [];
    setAllGameweeks(gws);
    setNations((nationsRes.data || []) as WMNation[]);
    setAllKOFixtures((koRes.data || []) as WMFixture[]);

    const active = gws.find(g => g.status !== "finished") || gws.at(-1);
    const activeGW = active?.gameweek ?? 1;
    setCurrentGW(active || null);
    setSelectedGW(activeGW);

    await loadFixtures(tid, activeGW);
    setLoading(false);
  }

  async function loadFixtures(tid: string, gw: number) {
    const { data } = await supabase
      .from("wm_fixtures")
      .select(`
        *,
        home_nation:wm_nations!home_nation_id(*),
        away_nation:wm_nations!away_nation_id(*)
      `)
      .eq("tournament_id", tid)
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

      {/* Tab switcher */}
      <div className="w-full max-w-md flex gap-1.5 mb-4">
        {(["fixtures", "bracket"] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className="px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
            style={{
              background: activeTab === t ? "var(--color-primary)" : "var(--bg-card)",
              color:      activeTab === t ? "var(--bg-page)" : "var(--color-muted)",
              border:     `1px solid ${activeTab === t ? "var(--color-primary)" : "var(--color-border)"}`,
            }}>
            {t === "fixtures" ? "Spielplan" : "Bracket"}
          </button>
        ))}
      </div>

      {/* ── FIXTURES TAB ────────────────────────────────────────────────── */}
      {activeTab === "fixtures" && (
        <>
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

          {/* Live Center Banner */}
          {currentGW?.status === "active" ? (
            <Link href={`/wm/${leagueId}/live`}
              className="w-full max-w-md flex items-center gap-3 px-4 py-3 rounded-2xl mb-4"
              style={{
                background: "color-mix(in srgb, var(--color-primary) 12%, var(--bg-card))",
                border: "1px solid color-mix(in srgb, var(--color-primary) 40%, var(--color-border))",
              }}>
              <span className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ background: "var(--color-primary)" }} />
              <span className="flex-1 text-xs font-black" style={{ color: "var(--color-primary)" }}>
                Fantasy Live Center öffnen →
              </span>
              <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: "color-mix(in srgb, var(--color-primary) 60%, transparent)" }}>
                GW{currentGW.gameweek}
              </span>
            </Link>
          ) : (
            <div className="w-full max-w-md flex justify-end mb-2">
              <Link href={`/wm/${leagueId}/live`}
                className="text-[9px] font-black uppercase tracking-widest"
                style={{ color: "var(--color-muted)" }}>
                Live Center →
              </Link>
            </div>
          )}

          {fixturesByStage.length === 0 && (
            <EmptyState icon="📅" title="Keine Spiele" description="Für diesen Spieltag wurden noch keine Fixtures importiert." />
          )}

          {fixturesByStage.map(({ stage, items }) => (
            <div key={stage} className="w-full max-w-md mb-5">
              <p className="text-[8px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>
                {STAGE_LABEL[stage]}
              </p>
              <div className="space-y-2">
                {items.map(f => (
                  <MatchCard
                    key={f.id}
                    fixture={f}
                    homeNationName={f.home_nation?.name}
                    awayNationName={f.away_nation?.name}
                    homeNationFlag={f.home_nation?.flag_url}
                    awayNationFlag={f.away_nation?.flag_url}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {/* ── BRACKET TAB ─────────────────────────────────────────────────── */}
      {activeTab === "bracket" && (
        <div className="w-full max-w-md">
          <TournamentBracket fixtures={allKOFixtures} nations={nations} />
        </div>
      )}

      <BottomNav />
    </main>
  );
}
