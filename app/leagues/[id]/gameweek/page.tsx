"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { BottomNav } from "@/app/components/BottomNav";
import { LEAGUE_META } from "@/lib/league-meta";
import { LiveMatchupCard } from "@/app/components/LiveMatchupCard";

export default function GameweekPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [user, setUser] = useState<any>(null);
  const [league, setLeague] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [gameweeks, setGameweeks] = useState<any[]>([]);
  const [selectedGW, setSelectedGW] = useState<number>(1);
  const [gwPoints, setGwPoints] = useState<any[]>([]);
  const [matchups, setMatchups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"ranking" | "matchups">("ranking");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
    });
  }, []);

  useEffect(() => {
    if (teams.length > 0) loadGWData(selectedGW);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGW]);

  async function loadAll(userId: string) {
    const { data: leagueData } = await supabase
      .from("leagues").select("*").eq("id", leagueId).single();
    setLeague(leagueData);

    const { data: teamsData } = await supabase
      .from("teams")
      .select("id, name, user_id, total_points, profiles(username)")
      .eq("league_id", leagueId)
      .order("total_points", { ascending: false });
    setTeams(teamsData || []);

    const { data: gwData } = await supabase
      .from("liga_gameweeks")
      .select("*").eq("league_id", leagueId).order("gameweek");
    setGameweeks(gwData || []);

    const active = (gwData || []).find((g: any) => g.status === "active")
      || (gwData || []).find((g: any) => g.status === "finished")
      || (gwData || [])[0];
    const gw = active?.gameweek || 1;
    setSelectedGW(gw);

    await loadGWDataWithTeams(gw, teamsData || []);
    setLoading(false);
  }

  async function loadGWData(gw: number) {
    await loadGWDataWithTeams(gw, teams);
  }

  async function loadGWDataWithTeams(gw: number, allTeams: any[]) {
    const teamIds = allTeams.map(t => t.id);
    if (teamIds.length === 0) return;

    // GW-Punkte aggregiert pro Team
    const { data: pts } = await supabase
      .from("liga_gameweek_points")
      .select("team_id, points")
      .eq("league_id", leagueId)
      .eq("gameweek", gw);

    const teamGWPts: Record<string, number> = {};
    for (const r of (pts || [])) {
      teamGWPts[r.team_id] = (teamGWPts[r.team_id] || 0) + r.points;
    }

    const ranked = allTeams
      .map(t => ({ ...t, gw_points: teamGWPts[t.id] || 0 }))
      .sort((a, b) => b.gw_points - a.gw_points);
    setGwPoints(ranked);

    // H2H Matchups
    const { data: mu } = await supabase
      .from("liga_matchups")
      .select("*, home:home_team_id(name, user_id), away:away_team_id(name, user_id)")
      .eq("league_id", leagueId)
      .eq("gameweek", gw);
    setMatchups(mu || []);
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center text-[9px] font-black uppercase tracking-widest animate-pulse"
      style={{ background: "var(--bg-page)", color: "var(--color-border)" }}>Lade Spieltag...</main>
  );

  const isH2H = league?.scoring_type === "h2h";
  const myTeam = teams.find(t => t.user_id === user?.id);

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "var(--bg-page)" }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "var(--color-primary)" }} />

      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-center mb-4">
        <button onClick={() => window.location.href = `/leagues/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          ← Liga
        </button>
        <div className="text-center">
          <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            {league?.name}
          </p>
          <p className="text-sm font-black" style={{ color: "var(--color-primary)" }}>Spieltage</p>
        </div>
        <div style={{ width: 40 }} />
      </div>

      {/* GW-Auswahl */}
      {gameweeks.length === 0 ? (
        <div className="w-full max-w-md rounded-xl p-6 text-center mb-4"
          style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
          <p className="text-sm font-black mb-1" style={{ color: "var(--color-muted)" }}>Noch keine Spieltage</p>
          {league?.owner_id === user?.id && (
            <button onClick={() => window.location.href = `/leagues/${leagueId}/admin`}
              className="mt-3 px-4 py-2 rounded-xl text-[10px] font-black uppercase"
              style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
              Im Admin anlegen →
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="flex gap-1.5 w-full max-w-md mb-4 overflow-x-auto pb-1">
            {gameweeks.map((gw: any) => {
              const isBreak = (gw.active_leagues || []).length === 0;
              const hasDouble = (gw.double_gw_leagues || []).length > 0;
              return (
                <button key={gw.gameweek} onClick={() => setSelectedGW(gw.gameweek)}
                  className="relative px-3 py-1.5 rounded-lg text-[9px] font-black whitespace-nowrap flex-shrink-0 transition-all"
                  style={{
                    background: selectedGW === gw.gameweek ? "var(--color-primary)" : isBreak ? "var(--bg-page)" : "var(--bg-card)",
                    color: selectedGW === gw.gameweek ? "var(--bg-page)" : isBreak ? "var(--color-border)" : "var(--color-muted)",
                    border: `1px solid ${selectedGW === gw.gameweek ? "var(--color-primary)"
                      : gw.status === "active" ? "var(--color-border-subtle)" : isBreak ? "var(--bg-elevated)" : "var(--color-border)"}`,
                    opacity: isBreak && selectedGW !== gw.gameweek ? 0.5 : 1,
                  }}>
                  GW{gw.gameweek}
                  {gw.status === "active" && <span className="ml-1" style={{ color: selectedGW === gw.gameweek ? "var(--bg-page)" : "var(--color-primary)" }}>●</span>}
                  {hasDouble && selectedGW !== gw.gameweek && <span className="ml-0.5 text-[7px]" style={{ color: "var(--color-primary)" }}>×2</span>}
                </button>
              );
            })}
          </div>

          {/* GW-Info + Liga-Status */}
          {(() => {
            const gw = gameweeks.find(g => g.gameweek === selectedGW);
            if (!gw) return null;
            const activeLgs: string[] = gw.active_leagues || [];
            const doubleLgs: string[] = gw.double_gw_leagues || [];
            const isBreak = activeLgs.length === 0;

            return (
              <div className="w-full max-w-md rounded-xl p-4 mb-4 space-y-3"
                style={{ background: "var(--bg-card)", border: `1px solid ${isBreak ? "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))" : "var(--color-border)"}` }}>
                {/* Datum + Status */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-black text-sm" style={{ color: "var(--color-text)" }}>{gw.label}</p>
                    {gw.start_date && (
                      <p className="text-[8px] font-black mt-0.5" style={{ color: "var(--color-muted)" }}>
                        {new Date(gw.start_date).toLocaleDateString("de-DE", { day: "2-digit", month: "short" })} – {gw.end_date ? new Date(gw.end_date).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }) : "?"}
                      </p>
                    )}
                  </div>
                  <span className="text-[9px] font-black px-2 py-1 rounded-full"
                    style={{
                      background: gw.status === "active" ? "var(--bg-elevated)" : gw.status === "finished" ? "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))" : "var(--bg-card)",
                      color: gw.status === "active" ? "var(--color-primary)" : gw.status === "finished" ? "var(--color-success)" : "var(--color-border)",
                      border: `1px solid ${gw.status === "active" ? "var(--color-primary)" : gw.status === "finished" ? "var(--color-success)" : "var(--color-border)"}`,
                    }}>
                    {gw.status === "active" ? "Aktiv" : gw.status === "finished" ? "Abgeschlossen" : "Bald"}
                  </span>
                </div>

                {/* Ligen-Status */}
                {isBreak ? (
                  <div className="flex items-center gap-2 py-1">
                    <span className="text-base">⚠️</span>
                    <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-error)" }}>
                      {gw.notes || "Länderspielpause — keine Liga-Spiele"}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-[7px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--color-border)" }}>
                      Spielende Ligen
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {activeLgs.map((key: string) => {
                        const meta = LEAGUE_META[key];
                        if (!meta) return null;
                        const isDouble = doubleLgs.includes(key);
                        return (
                          <div key={key} className="flex items-center gap-1 px-2 py-1 rounded-lg"
                            style={{
                              background: isDouble ? "color-mix(in srgb, var(--color-primary) 10%, var(--bg-page))" : "var(--bg-page)",
                              border: `1px solid ${isDouble ? "var(--color-primary)" : "var(--color-border)"}`,
                            }}>
                            <span className="text-sm">{meta.flag}</span>
                            <span className="text-[9px] font-black" style={{ color: isDouble ? "var(--color-primary)" : "var(--color-text)" }}>
                              {meta.short}
                            </span>
                            {isDouble && (
                              <span className="text-[8px] font-black" style={{ color: "var(--color-primary)" }}>×2</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {doubleLgs.length > 0 && (
                      <p className="text-[8px] font-black mt-1.5" style={{ color: "var(--color-primary)" }}>
                        🔥 Doppelspieltag — Spieler dieser Ligen können 2× punkten
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Tabs (nur bei H2H) */}
          {isH2H && matchups.length > 0 && (
            <div className="flex gap-1 w-full max-w-md mb-4 p-1 rounded-xl"
              style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
              {([
                { id: "ranking",  label: "Rangliste" },
                { id: "matchups", label: "Paarungen" },
              ] as const).map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className="flex-1 py-2 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all"
                  style={{
                    background: tab === t.id ? "var(--color-primary)" : "transparent",
                    color: tab === t.id ? "var(--bg-page)" : "var(--color-muted)",
                  }}>
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* RANGLISTE */}
          {tab === "ranking" && (
            <div className="w-full max-w-md space-y-2">
              {gwPoints.length === 0 ? (
                <p className="text-center text-sm font-black py-8" style={{ color: "var(--color-border)" }}>
                  Noch keine Punkte für GW{selectedGW}
                </p>
              ) : gwPoints.map((team, i) => (
                <div key={team.id} className="flex items-center justify-between p-4 rounded-2xl"
                  style={{
                    background: "var(--bg-card)",
                    border: `1px solid ${team.user_id === user?.id ? "var(--color-border-subtle)" : "var(--color-border)"}`,
                  }}>
                  <div className="flex items-center gap-3">
                    <span className="font-black text-sm w-5 text-center"
                      style={{ color: i === 0 ? "var(--color-primary)" : i === 1 ? "var(--color-text)" : i === 2 ? "var(--color-bronze)" : "var(--color-border)" }}>
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-black text-sm"
                        style={{ color: team.user_id === user?.id ? "var(--color-primary)" : "var(--color-text)" }}>
                        {team.name}
                      </p>
                      <p className="text-[9px] font-black uppercase tracking-widest mt-0.5" style={{ color: "var(--color-muted)" }}>
                        {team.profiles?.username || "—"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-lg"
                      style={{ color: i === 0 ? "var(--color-primary)" : "var(--color-text)" }}>
                      {team.gw_points.toFixed(1)}
                    </p>
                    <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-border)" }}>
                      GW · {team.total_points?.toFixed(1)} Ges.
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* H2H MATCHUPS */}
          {tab === "matchups" && (
            <div className="w-full max-w-md space-y-3">
              {matchups.length === 0 ? (
                <p className="text-center text-sm font-black py-8" style={{ color: "var(--color-border)" }}>
                  Noch keine Paarungen
                </p>
              ) : matchups.map((m: any) => {
                const gwRow = gameweeks.find((g: any) => g.gameweek === selectedGW);
                const gwIsActive = gwRow?.status === "active";
                return (
                  <LiveMatchupCard
                    key={m.id}
                    matchup={m}
                    currentUserId={user?.id}
                    gwIsActive={gwIsActive}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      <BottomNav />
    </main>
  );
}
