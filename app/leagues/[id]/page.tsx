"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { LeagueTopNav } from "@/app/components/LeagueTopNav";
import { BottomNav } from "@/app/components/BottomNav";
import { Spinner } from "@/app/components/ui/Spinner";
import { TransactionsFeed } from "@/app/components/TransactionsFeed";

export default function LeagueSpieltagPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [user, setUser]           = useState<any>(null);
  const [league, setLeague]       = useState<any>(null);
  const [teams, setTeams]         = useState<any[]>([]);
  const [draftSession, setDraftSession] = useState<any>(null);
  const [gameweeks, setGameweeks] = useState<any[]>([]);
  const [selectedGW, setSelectedGW] = useState<number>(1);
  const [gwRanking, setGwRanking]   = useState<any[]>([]);
  const [matchups, setMatchups]     = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [view, setView]         = useState<"tabelle" | "paarungen">("tabelle");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
    });
  }, []);

  useEffect(() => {
    if (teams.length > 0) loadGWData(selectedGW, teams);
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
      .order("total_points", { ascending: false, nullsFirst: false });
    setTeams(teamsData || []);

    // Load draft session for pre-draft info
    const { data: ds } = await supabase
      .from("draft_sessions").select("*").eq("league_id", leagueId).maybeSingle();
    setDraftSession(ds);

    // If still in setup/drafting, skip gameweek loading
    if (leagueData?.status === "setup" || leagueData?.status === "drafting") {
      setLoading(false);
      return;
    }

    const { data: gwData } = await supabase
      .from("liga_gameweeks").select("*").eq("league_id", leagueId).order("gameweek");
    setGameweeks(gwData || []);

    const active = (gwData || []).find((g: any) => g.status === "active")
      || (gwData || []).slice().reverse().find((g: any) => g.status === "finished")
      || (gwData || [])[0];
    const gw = active?.gameweek || 1;
    setSelectedGW(gw);
    await loadGWData(gw, teamsData || []);
    setLoading(false);
  }

  async function loadGWData(gw: number, allTeams: any[]) {
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
    const ranked = [...allTeams]
      .map(t => ({ ...t, gw_points: teamGWPts[t.id] ?? null }))
      .sort((a, b) => (b.gw_points ?? -1) - (a.gw_points ?? -1));
    setGwRanking(ranked);

    // H2H Matchups
    const { data: mu } = await supabase
      .from("liga_matchups")
      .select("*, home:home_team_id(id, name, user_id), away:away_team_id(id, name, user_id)")
      .eq("league_id", leagueId)
      .eq("gameweek", gw);
    setMatchups(mu || []);
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <Spinner />
    </main>
  );

  const isH2H  = league?.scoring_type === "h2h";
  const myTeam = teams.find(t => t.user_id === user?.id);
  const myMatchup = matchups.find(m =>
    m.home?.id === myTeam?.id || m.away?.id === myTeam?.id
  );

  const rankColor = (i: number) =>
    i === 0 ? "var(--color-primary)" : i === 1 ? "var(--color-text)" : i === 2 ? "var(--color-bronze)" : "var(--color-border-subtle)";

  return (
    <main className="flex min-h-screen flex-col items-center pb-28"
      style={{ background: "var(--bg-page)", paddingTop: 80 }}>
      <LeagueTopNav
        leagueId={leagueId}
        leagueName={league?.name}
        leagueStatus={league?.status}
        isOwner={league?.owner_id === user?.id}
      />

      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-8 pointer-events-none"
        style={{ background: "var(--color-primary)", zIndex: 49 }} />

      <div className="w-full max-w-md px-4">

        {/* ── Pre-Draft: Setup ── */}
        {league?.status === "setup" && (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl p-5 text-center"
              style={{ background: "var(--bg-card)", border: "1px solid var(--color-primary)30" }}>
              <p className="text-3xl mb-3">📋</p>
              <p className="text-base font-black mb-1" style={{ color: "var(--color-primary)" }}>Draft vorbereiten</p>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                Der Draft wurde noch nicht gestartet
              </p>
            </div>

            {/* Draft Details */}
            {(draftSession || teams.length > 0) && (
              <div className="rounded-2xl p-4"
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-border-subtle)" }}>
                  Draft-Einstellungen
                </p>
                <div className="grid grid-cols-2 gap-y-3">
                  <div>
                    <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>Modus</p>
                    <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>
                      {draftSession?.draft_type === "linear" ? "Dynasty (Linear)" : draftSession?.draft_type === "snake" ? "Snake" : "Snake"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>Teams</p>
                    <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>{teams.length}</p>
                  </div>
                  {draftSession?.rounds && (
                    <div>
                      <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>Runden</p>
                      <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>{draftSession.rounds}</p>
                    </div>
                  )}
                  {draftSession?.picks_per_round && (
                    <div>
                      <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>Picks/Runde</p>
                      <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>{draftSession.picks_per_round}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Teams */}
            {teams.length > 0 && (
              <div className="rounded-2xl p-4"
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-border-subtle)" }}>
                  Teilnehmer · {teams.length}
                </p>
                <div className="space-y-1.5">
                  {teams.map((t: any, i: number) => (
                    <div key={t.id} className="flex items-center gap-2">
                      <span className="text-[8px] font-black w-4 text-right" style={{ color: "var(--color-border-subtle)" }}>{i + 1}</span>
                      <p className="text-xs font-black flex-1"
                        style={{ color: t.user_id === user?.id ? "var(--color-primary)" : "var(--color-text)" }}>
                        {t.name}
                        {t.user_id === user?.id && <span className="ml-1 text-[7px]" style={{ color: "var(--color-primary)" }}>(Du)</span>}
                        {!t.user_id && <span className="ml-1 text-[7px]" style={{ color: "var(--color-border-subtle)" }}>(Bot)</span>}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Go to draft room */}
            <a href={`/leagues/${leagueId}/draft`}
              className="block w-full py-3.5 rounded-2xl text-center text-[10px] font-black uppercase tracking-widest transition-all"
              style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
              Draft-Raum öffnen →
            </a>
          </div>
        )}

        {/* ── Pre-Draft: Drafting in progress ── */}
        {league?.status === "drafting" && (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl p-5"
              style={{ background: "var(--bg-card)", border: "1px solid var(--color-success)40" }}>
              <div className="flex items-center gap-3 mb-3">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 animate-pulse"
                  style={{ background: "var(--color-success)" }} />
                <p className="text-sm font-black" style={{ color: "var(--color-success)" }}>Draft läuft!</p>
              </div>
              <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
                {draftSession?.draft_type === "linear" ? "Dynasty · Linear" : "Snake Draft"}
                {draftSession?.rounds && ` · ${draftSession.rounds} Runden`}
                {` · ${teams.length} Teams`}
              </p>
              {draftSession?.current_pick !== undefined && (
                <p className="text-[8px] font-black" style={{ color: "var(--color-border-subtle)" }}>
                  Pick {(draftSession.current_pick ?? 0) + 1} von {(draftSession.rounds || 15) * teams.length}
                </p>
              )}
            </div>
            <a href={`/leagues/${leagueId}/draft`}
              className="block w-full py-3.5 rounded-2xl text-center text-[10px] font-black uppercase tracking-widest"
              style={{ background: "var(--color-success)", color: "var(--bg-page)" }}>
              Zum Draft →
            </a>
          </div>
        )}

        {/* ── Kein Spieltag ── */}
        {league?.status !== "setup" && league?.status !== "drafting" && gameweeks.length === 0 && (
          <div className="rounded-2xl p-8 text-center mt-6"
            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <p className="text-2xl mb-3">📅</p>
            <p className="text-sm font-black mb-1" style={{ color: "var(--color-text)" }}>Noch keine Spieltage</p>
            <p className="text-[9px] mb-4" style={{ color: "var(--color-muted)" }}>Der Liga-Owner kann Spieltage im Admin anlegen</p>
            {league?.owner_id === user?.id && (
              <a href={`/leagues/${leagueId}/admin`}
                className="inline-block px-4 py-2 rounded-xl text-[10px] font-black uppercase"
                style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
                Admin öffnen →
              </a>
            )}
          </div>
        )}

        {league?.status !== "setup" && league?.status !== "drafting" && gameweeks.length > 0 && (
          <>
            {/* ── GW-Selector ── */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 mt-4 mb-4">
              {gameweeks.map((gw: any) => (
                <button key={gw.gameweek} onClick={() => setSelectedGW(gw.gameweek)}
                  className="px-3 py-1.5 rounded-lg text-[9px] font-black whitespace-nowrap flex-shrink-0 transition-all"
                  style={{
                    background: selectedGW === gw.gameweek ? "var(--color-primary)" : "var(--bg-card)",
                    color: selectedGW === gw.gameweek ? "var(--bg-page)" : "var(--color-muted)",
                    border: `1px solid ${selectedGW === gw.gameweek ? "var(--color-primary)" : gw.status === "active" ? "var(--color-border-subtle)" : "var(--color-border)"}`,
                  }}>
                  GW{gw.gameweek}
                  {gw.status === "active" && (
                    <span className="ml-1 w-1.5 h-1.5 rounded-full inline-block"
                      style={{ background: "var(--color-success)", verticalAlign: "middle" }} />
                  )}
                </button>
              ))}
            </div>

            {/* ── Mein Duell (H2H) ── */}
            {isH2H && myMatchup && (
              <div className="rounded-2xl p-4 mb-4"
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-border-subtle)" }}>
                <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
                  Mein Duell · GW{selectedGW}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex-1 text-center">
                    <p className="font-black text-sm truncate"
                      style={{ color: myMatchup.home?.id === myTeam?.id ? "var(--color-primary)" : "var(--color-text)" }}>
                      {myMatchup.home?.name}
                    </p>
                    <p className="text-[7px] font-black uppercase mt-0.5" style={{ color: "var(--color-muted)" }}>
                      {myMatchup.home?.user_id ? "" : "Bot"}
                    </p>
                  </div>
                  <div className="px-4 text-center">
                    <p className="text-xl font-black" style={{ color: "var(--color-primary)" }}>
                      {myMatchup.home_points?.toFixed(1) ?? "—"}
                      <span className="mx-2 text-sm" style={{ color: "var(--color-border-subtle)" }}>:</span>
                      {myMatchup.away_points?.toFixed(1) ?? "—"}
                    </p>
                    {myMatchup.winner_id && (
                      <p className="text-[7px] font-black uppercase mt-0.5" style={{ color: "var(--color-success)" }}>
                        {myMatchup.winner_id === myTeam?.id ? "✓ Gewonnen" : "✗ Verloren"}
                      </p>
                    )}
                    {!myMatchup.winner_id && myMatchup.home_points !== null && (
                      <p className="text-[7px] font-black uppercase mt-0.5" style={{ color: "var(--color-muted)" }}>
                        Laufend
                      </p>
                    )}
                  </div>
                  <div className="flex-1 text-center">
                    <p className="font-black text-sm truncate"
                      style={{ color: myMatchup.away?.id === myTeam?.id ? "var(--color-primary)" : "var(--color-text)" }}>
                      {myMatchup.away?.name}
                    </p>
                    <p className="text-[7px] font-black uppercase mt-0.5" style={{ color: "var(--color-muted)" }}>
                      {myMatchup.away?.user_id ? "" : "Bot"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── View-Toggle ── */}
            <div className="flex gap-1.5 mb-4">
              {([
                ["tabelle",   "Tabelle"],
                ["paarungen", isH2H ? "Paarungen" : "GW-Rangliste"],
              ] as const).map(([id, label]) => (
                <button key={id} onClick={() => setView(id)}
                  className="px-3 py-1.5 rounded-lg text-[9px] font-black transition-all"
                  style={{
                    background: view === id ? "var(--color-primary)" : "var(--bg-card)",
                    color: view === id ? "var(--bg-page)" : "var(--color-muted)",
                    border: `1px solid ${view === id ? "var(--color-primary)" : "var(--color-border)"}`,
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── TABELLE (Gesamtpunkte) ── */}
            {view === "tabelle" && (
              <div className="space-y-1.5">
                {teams.map((team, i) => {
                  const isMine = team.user_id === user?.id;
                  return (
                    <div key={team.id}
                      onClick={() => window.location.href = isMine
                        ? `/leagues/${leagueId}/lineup`
                        : `/leagues/${leagueId}/liga?team=${team.id}`}
                      className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all"
                      style={{
                        background: isMine ? "var(--bg-elevated)" : "var(--bg-card)",
                        border: `1px solid ${isMine ? "var(--color-border-subtle)" : "var(--color-border)"}`,
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--color-primary)"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = isMine ? "var(--color-border-subtle)" : "var(--color-border)"}>
                      <span className="font-black text-sm w-5 text-center flex-shrink-0"
                        style={{ color: rankColor(i) }}>
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-sm truncate"
                          style={{ color: isMine ? "var(--color-primary)" : "var(--color-text)" }}>
                          {team.name}
                          {!team.user_id && <span className="ml-1 text-[8px]" style={{ color: "var(--color-border)" }}>(Bot)</span>}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-black text-base" style={{ color: i === 0 ? "var(--color-primary)" : "var(--color-text)" }}>
                          {(team.total_points ?? 0).toFixed(1)}
                        </p>
                        <p className="text-[7px] font-black uppercase" style={{ color: "var(--color-border-subtle)" }}>Pts</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── PAARUNGEN / GW-RANGLISTE ── */}
            {view === "paarungen" && (
              <div className="space-y-2">
                {isH2H ? (
                  matchups.length === 0 ? (
                    <div className="rounded-xl p-6 text-center"
                      style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                      <p className="text-[9px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                        Keine Paarungen für GW{selectedGW}
                      </p>
                      {league?.owner_id === user?.id && (
                        <p className="text-[8px] mt-2" style={{ color: "var(--color-border-subtle)" }}>
                          Paarungen im Admin anlegen
                        </p>
                      )}
                    </div>
                  ) : (
                    matchups.map((m: any) => {
                      const homeIsMine = m.home?.id === myTeam?.id;
                      const awayIsMine = m.away?.id === myTeam?.id;
                      const isMine = homeIsMine || awayIsMine;
                      return (
                        <div key={m.id}
                          className="rounded-xl p-3 transition-all"
                          style={{
                            background: isMine ? "var(--bg-elevated)" : "var(--bg-card)",
                            border: `1px solid ${isMine ? "var(--color-border-subtle)" : "var(--color-border)"}`,
                          }}>
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0 text-center">
                              <p className="font-black text-xs truncate"
                                style={{ color: homeIsMine ? "var(--color-primary)" : "var(--color-text)" }}>
                                {m.home?.name}
                              </p>
                            </div>
                            <div className="px-3 text-center flex-shrink-0">
                              <p className="text-sm font-black" style={{ color: "var(--color-primary)" }}>
                                {m.home_points !== null ? m.home_points?.toFixed(1) : "—"}
                                <span className="mx-1.5 text-xs" style={{ color: "var(--color-border-subtle)" }}>:</span>
                                {m.away_points !== null ? m.away_points?.toFixed(1) : "—"}
                              </p>
                              {m.winner_id && (
                                <p className="text-[7px] font-black uppercase" style={{ color: "var(--color-success)" }}>Final</p>
                              )}
                            </div>
                            <div className="flex-1 min-w-0 text-center">
                              <p className="font-black text-xs truncate"
                                style={{ color: awayIsMine ? "var(--color-primary)" : "var(--color-text)" }}>
                                {m.away?.name}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )
                ) : (
                  // Gesamtpunkte: GW-Rangliste
                  gwRanking.map((team, i) => {
                    const isMine = team.user_id === user?.id;
                    return (
                      <div key={team.id}
                        className="flex items-center gap-3 p-3 rounded-xl"
                        style={{
                          background: isMine ? "var(--bg-elevated)" : "var(--bg-card)",
                          border: `1px solid ${isMine ? "var(--color-border-subtle)" : "var(--color-border)"}`,
                        }}>
                        <span className="font-black text-sm w-5 text-center flex-shrink-0"
                          style={{ color: rankColor(i) }}>
                          {i + 1}
                        </span>
                        <p className="flex-1 font-black text-sm truncate"
                          style={{ color: isMine ? "var(--color-primary)" : "var(--color-text)" }}>
                          {team.name}
                        </p>
                        <div className="text-right flex-shrink-0">
                          <p className="font-black text-base"
                            style={{ color: team.gw_points !== null ? "var(--color-text)" : "var(--color-border)" }}>
                            {team.gw_points !== null ? team.gw_points.toFixed(1) : "—"}
                          </p>
                          <p className="text-[7px] font-black uppercase" style={{ color: "var(--color-border-subtle)" }}>GW-Pts</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          {/* ── Letzte Transaktionen ── */}
          <div className="mt-6">
            <p className="text-[8px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-border-subtle)" }}>
              Letzte Aktivitäten
            </p>
            <TransactionsFeed leagueId={leagueId} maxHeight="40vh" />
          </div>
          </>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
