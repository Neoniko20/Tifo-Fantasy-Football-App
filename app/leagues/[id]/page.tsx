"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { BottomNav } from "@/app/components/BottomNav";
import { Spinner } from "@/app/components/ui/Spinner";
import { TransactionsFeed } from "@/app/components/TransactionsFeed";

// ── Team initials avatar ──────────────────────────────────────────────────────

function TeamAvatar({ name, isMine, size = 7 }: { name: string; isMine?: boolean; size?: number }) {
  const parts = name.trim().split(/\s+/);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  const px = size * 4;
  return (
    <div
      className="rounded-full flex items-center justify-center font-black flex-shrink-0"
      style={{
        width: px,
        height: px,
        background: isMine
          ? "linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 35%, var(--bg-elevated)), var(--bg-elevated))"
          : "var(--bg-elevated)",
        border: `1.5px solid ${isMine ? "color-mix(in srgb, var(--color-primary) 55%, transparent)" : "var(--color-border)"}`,
        color: isMine ? "var(--color-primary)" : "var(--color-muted)",
        fontSize: "9px",
        letterSpacing: "0.05em",
      }}
    >
      {initials}
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <p className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: "var(--color-muted)" }}>
        {title}
      </p>
      {action && (
        <button
          onClick={onAction}
          className="text-[8px] font-black uppercase tracking-widest"
          style={{ color: "var(--color-primary)" }}
        >
          {action}
        </button>
      )}
    </div>
  );
}

// ── Rank color ────────────────────────────────────────────────────────────────

const rankColor = (i: number) =>
  i === 0 ? "var(--color-primary)"
  : i === 1 ? "var(--color-text)"
  : i === 2 ? "var(--color-bronze)"
  : "var(--color-border-subtle)";

// ── Main ──────────────────────────────────────────────────────────────────────

export default function LeagueSpieltagPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [user, setUser]                 = useState<any>(null);
  const [league, setLeague]             = useState<any>(null);
  const [teams, setTeams]               = useState<any[]>([]);
  const [draftSession, setDraftSession] = useState<any>(null);
  const [gameweeks, setGameweeks]       = useState<any[]>([]);
  const [selectedGW, setSelectedGW]     = useState<number>(1);
  const [gwRanking, setGwRanking]       = useState<any[]>([]);
  const [matchups, setMatchups]         = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);
  const [tableExpanded, setTableExpanded] = useState(false);
  const [tab, setTab]                   = useState<"uebersicht" | "tabelle" | "aktivitaeten" | "regeln">("uebersicht");

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

    const { data: ds } = await supabase
      .from("draft_sessions").select("*").eq("league_id", leagueId).maybeSingle();
    setDraftSession(ds);

    if (leagueData?.status === "setup" || leagueData?.status === "drafting") {
      setLoading(false);
      return;
    }

    const { data: gwData } = await supabase
      .from("liga_gameweeks").select("*").eq("league_id", leagueId).order("gameweek");
    setGameweeks(gwData || []);

    const active =
      (gwData || []).find((g: any) => g.status === "active") ||
      (gwData || []).slice().reverse().find((g: any) => g.status === "finished") ||
      (gwData || [])[0];
    const gw = active?.gameweek || 1;
    setSelectedGW(gw);
    await loadGWData(gw, teamsData || []);
    setLoading(false);
  }

  async function loadGWData(gw: number, allTeams: any[]) {
    const { data: pts } = await supabase
      .from("liga_gameweek_points")
      .select("team_id, points")
      .eq("league_id", leagueId)
      .eq("gameweek", gw);

    const teamGWPts: Record<string, number> = {};
    for (const r of pts || []) {
      teamGWPts[r.team_id] = (teamGWPts[r.team_id] || 0) + r.points;
    }
    const ranked = [...allTeams]
      .map(t => ({ ...t, gw_points: teamGWPts[t.id] ?? null }))
      .sort((a, b) => (b.gw_points ?? -1) - (a.gw_points ?? -1));
    setGwRanking(ranked);

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

  const isH2H      = league?.scoring_type === "h2h";
  const myTeam     = teams.find(t => t.user_id === user?.id);
  const myRank     = myTeam ? teams.findIndex(t => t.id === myTeam.id) + 1 : null;
  const myMatchup  = matchups.find(m => m.home?.id === myTeam?.id || m.away?.id === myTeam?.id);
  const myGWPoints = gwRanking.find(t => t.id === myTeam?.id)?.gw_points ?? null;
  const activeGW   = gameweeks.find(g => g.status === "active");
  const isLive     = !!activeGW && activeGW.gameweek === selectedGW;

  // Table: show top 5 by default, all when expanded
  const visibleTeams = tableExpanded ? teams : teams.slice(0, 5);

  return (
    <main
      className="flex min-h-screen flex-col items-center pb-28"
      style={{ background: "var(--bg-page)", paddingTop: 16 }}
    >

      {/* Ambient glow */}
      <div
        className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-8 pointer-events-none"
        style={{ background: "var(--color-primary)", zIndex: 49 }}
      />

      <div className="w-full max-w-md px-4">

        {/* ── Pre-Draft: Setup ────────────────────────────────────────────── */}
        {league?.status === "setup" && (
          <div className="mt-4 space-y-3">
            <div
              className="rounded-2xl p-5 text-center"
              style={{ background: "var(--bg-card)", border: "1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)" }}
            >
              <p className="text-3xl mb-3">📋</p>
              <p className="text-base font-black mb-1" style={{ color: "var(--color-primary)" }}>
                Draft vorbereiten
              </p>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                Der Draft wurde noch nicht gestartet
              </p>
            </div>

            {(draftSession || teams.length > 0) && (
              <div className="rounded-2xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-border-subtle)" }}>
                  Draft-Einstellungen
                </p>
                <div className="grid grid-cols-2 gap-y-3">
                  <div>
                    <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>Modus</p>
                    <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>
                      {draftSession?.draft_type === "linear" ? "Dynasty (Linear)" : "Snake"}
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
                </div>
              </div>
            )}

            {teams.length > 0 && (
              <div className="rounded-2xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-border-subtle)" }}>
                  Teilnehmer · {teams.length}
                </p>
                <div className="space-y-1.5">
                  {teams.map((t: any, i: number) => (
                    <div key={t.id} className="flex items-center gap-2">
                      <span className="text-[8px] font-black w-4 text-right" style={{ color: "var(--color-border-subtle)" }}>{i + 1}</span>
                      <p className="text-xs font-black flex-1" style={{ color: t.user_id === user?.id ? "var(--color-primary)" : "var(--color-text)" }}>
                        {t.name}
                        {t.user_id === user?.id && <span className="ml-1 text-[7px]" style={{ color: "var(--color-primary)" }}>(Du)</span>}
                        {!t.user_id && <span className="ml-1 text-[7px]" style={{ color: "var(--color-border-subtle)" }}>(Bot)</span>}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <a
              href={`/leagues/${leagueId}/draft`}
              className="block w-full py-3.5 rounded-2xl text-center text-[10px] font-black uppercase tracking-widest"
              style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}
            >
              Draft-Raum öffnen →
            </a>
          </div>
        )}

        {/* ── Pre-Draft: Drafting ──────────────────────────────────────────── */}
        {league?.status === "drafting" && (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl p-5" style={{ background: "var(--bg-card)", border: "1px solid color-mix(in srgb, var(--color-success) 30%, transparent)" }}>
              <div className="flex items-center gap-3 mb-3">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 animate-pulse" style={{ background: "var(--color-success)" }} />
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
            <a
              href={`/leagues/${leagueId}/draft`}
              className="block w-full py-3.5 rounded-2xl text-center text-[10px] font-black uppercase tracking-widest"
              style={{ background: "var(--color-success)", color: "var(--bg-page)" }}
            >
              Zum Draft →
            </a>
          </div>
        )}

        {/* ── Kein Spieltag ────────────────────────────────────────────────── */}
        {league?.status !== "setup" && league?.status !== "drafting" && gameweeks.length === 0 && (
          <div className="rounded-2xl p-8 text-center mt-6" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <p className="text-2xl mb-3">📅</p>
            <p className="text-sm font-black mb-1" style={{ color: "var(--color-text)" }}>Noch keine Spieltage</p>
            <p className="text-[9px] mb-4" style={{ color: "var(--color-muted)" }}>Der Liga-Owner kann Spieltage im Admin anlegen</p>
            {league?.owner_id === user?.id && (
              <a
                href={`/leagues/${leagueId}/admin`}
                className="inline-block px-4 py-2 rounded-xl text-[10px] font-black uppercase"
                style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}
              >
                Admin öffnen →
              </a>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            LIGA-ZENTRALE — gestapelte Sektionen
        ══════════════════════════════════════════════════════════════════ */}
        {league?.status !== "setup" && league?.status !== "drafting" && gameweeks.length > 0 && (
          <div className="mt-4 space-y-5">

            {/* ── Tab Bar ──────────────────────────────────────────────── */}
            <div className="flex" style={{ borderBottom: "1px solid var(--color-border)" }}>
              {(
                [
                  ["uebersicht",   "Übersicht"],
                  ["tabelle",      "Tabelle"],
                  ["aktivitaeten", "Aktivitäten"],
                  ["regeln",       "Regeln"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className="flex-1 py-2.5 text-[9px] font-black uppercase tracking-widest transition-all relative"
                  style={{ color: tab === id ? "var(--color-primary)" : "var(--color-muted)" }}
                >
                  {label}
                  {tab === id && (
                    <span
                      className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                      style={{ background: "var(--color-primary)" }}
                    />
                  )}
                </button>
              ))}
            </div>

            {/* ── GW Selector (Übersicht only) ─────────────────────────── */}
            {(tab === "uebersicht" || tab === "tabelle") && <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
              {gameweeks.map((gw: any) => (
                <button
                  key={gw.gameweek}
                  onClick={() => setSelectedGW(gw.gameweek)}
                  className="px-3 py-1.5 rounded-lg text-[9px] font-black whitespace-nowrap flex-shrink-0 transition-all flex items-center gap-1.5"
                  style={{
                    background: selectedGW === gw.gameweek ? "var(--color-primary)" : "var(--bg-card)",
                    color: selectedGW === gw.gameweek ? "var(--bg-page)" : "var(--color-muted)",
                    border: `1px solid ${selectedGW === gw.gameweek ? "var(--color-primary)" : "var(--color-border)"}`,
                  }}
                >
                  MD {gw.gameweek}
                  {gw.status === "active" && (
                    <span
                      className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
                      style={{ background: selectedGW === gw.gameweek ? "var(--bg-page)" : "var(--color-success)" }}
                    />
                  )}
                </button>
              ))}
            </div>}

            {/* ══ ÜBERSICHT ════════════════════════════════════════════════ */}
            {tab === "uebersicht" && <>

            {/* ── Mein Stand (my team stat strip) ──────────────────────── */}
            {myTeam && (
              <div
                className="rounded-2xl overflow-hidden"
                style={{
                  background: "var(--bg-card)",
                  border: `1px solid ${isLive ? "color-mix(in srgb, var(--color-primary) 40%, transparent)" : "var(--color-border-subtle)"}`,
                  boxShadow: isLive ? "0 0 20px color-mix(in srgb, var(--color-primary) 7%, transparent)" : undefined,
                }}
              >
                <div className="flex">
                  {/* Rank */}
                  <div className="flex-1 text-center py-3 px-2">
                    <p className="text-[7px] font-black uppercase tracking-widest mb-0.5" style={{ color: "var(--color-muted)" }}>Rang</p>
                    <p className="text-xl font-black leading-none" style={{ color: "var(--color-primary)" }}>
                      {myRank}
                      <span className="text-[9px] ml-0.5" style={{ color: "var(--color-muted)" }}>/{teams.length}</span>
                    </p>
                  </div>
                  <div style={{ width: 1, alignSelf: "stretch", background: "var(--color-border)" }} />
                  {/* GW points */}
                  <div className="flex-1 text-center py-3 px-2">
                    <p className="text-[7px] font-black uppercase tracking-widest mb-0.5" style={{ color: "var(--color-muted)" }}>
                      MD {selectedGW}
                    </p>
                    <p className="text-xl font-black leading-none"
                      style={{ color: isLive ? "var(--color-success)" : "var(--color-text)" }}>
                      {myGWPoints !== null ? myGWPoints.toFixed(1) : "—"}
                    </p>
                  </div>
                  <div style={{ width: 1, alignSelf: "stretch", background: "var(--color-border)" }} />
                  {/* Total */}
                  <div className="flex-1 text-center py-3 px-2">
                    <p className="text-[7px] font-black uppercase tracking-widest mb-0.5" style={{ color: "var(--color-muted)" }}>Gesamt</p>
                    <p className="text-xl font-black leading-none" style={{ color: "var(--color-text)" }}>
                      {(myTeam.total_points ?? 0).toFixed(1)}
                    </p>
                  </div>
                </div>
                {/* Live strip */}
                {isLive && (
                  <div className="px-4 py-1.5 flex items-center gap-2"
                    style={{ background: "color-mix(in srgb, var(--color-primary) 8%, transparent)" }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--color-success)" }} />
                    <span className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-success)" }}>
                      Spieltag läuft · {myTeam.name}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ── H2H: Mein Duell ──────────────────────────────────────── */}
            {isH2H && myMatchup && (
              <div>
                <SectionHeader title="Mein Duell" />
                <div
                  className="rounded-2xl overflow-hidden"
                  style={{
                    background: "var(--bg-card)",
                    border: `1px solid ${isLive ? "color-mix(in srgb, var(--color-primary) 45%, transparent)" : "var(--color-border-subtle)"}`,
                  }}
                >
                  <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2">
                    {/* Home */}
                    <div className="flex-1 text-center min-w-0">
                      <TeamAvatar name={myMatchup.home?.name || ""} isMine={myMatchup.home?.id === myTeam?.id} size={8} />
                      <p className="font-black text-xs truncate mt-1.5"
                        style={{ color: myMatchup.home?.id === myTeam?.id ? "var(--color-primary)" : "var(--color-text)" }}>
                        {myMatchup.home?.name}
                      </p>
                    </div>
                    {/* Score */}
                    <div className="text-center flex-shrink-0 px-2">
                      <p className="text-[24px] font-black leading-none tracking-tight" style={{ color: "var(--color-primary)" }}>
                        {myMatchup.home_points?.toFixed(1) ?? "—"}
                      </p>
                      <p className="text-[9px] font-black my-0.5" style={{ color: "var(--color-border-subtle)" }}>vs</p>
                      <p className="text-[24px] font-black leading-none tracking-tight" style={{ color: "var(--color-text)" }}>
                        {myMatchup.away_points?.toFixed(1) ?? "—"}
                      </p>
                    </div>
                    {/* Away */}
                    <div className="flex-1 text-center min-w-0">
                      <TeamAvatar name={myMatchup.away?.name || ""} isMine={myMatchup.away?.id === myTeam?.id} size={8} />
                      <p className="font-black text-xs truncate mt-1.5"
                        style={{ color: myMatchup.away?.id === myTeam?.id ? "var(--color-primary)" : "var(--color-text)" }}>
                        {myMatchup.away?.name}
                      </p>
                    </div>
                  </div>
                  {/* Status bar */}
                  <div className="px-4 py-2 flex items-center justify-between"
                    style={{ background: "color-mix(in srgb, var(--color-primary) 6%, transparent)" }}>
                    {isLive && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--color-success)" }} />
                        <span className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-success)" }}>Live</span>
                      </div>
                    )}
                    {myMatchup.winner_id && (
                      <p className="text-[7px] font-black uppercase tracking-widest"
                        style={{ color: myMatchup.winner_id === myTeam?.id ? "var(--color-success)" : "var(--color-muted)" }}>
                        {myMatchup.winner_id === myTeam?.id ? "✓ Gewonnen" : "✗ Verloren"}
                      </p>
                    )}
                    {!myMatchup.winner_id && !isLive && (
                      <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>Ausstehend</p>
                    )}
                    <a href={`/leagues/${leagueId}/lineup`}
                      className="text-[7px] font-black uppercase tracking-widest"
                      style={{ color: "var(--color-primary)" }}>
                      Aufstellung →
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* ── TABELLE ──────────────────────────────────────────────── */}
            <div>
              <SectionHeader
                title="Tabelle"
                action={tableExpanded ? "Weniger" : teams.length > 5 ? "Alle ansehen" : undefined}
                onAction={() => setTableExpanded(v => !v)}
              />
              <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                {/* Column headers */}
                <div className="flex items-center gap-2 px-3 py-2"
                  style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <span className="w-5 flex-shrink-0" />
                  <span className="w-7 flex-shrink-0" />
                  <span className="flex-1 text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>Manager</span>
                  <span className="text-[7px] font-black uppercase tracking-widest w-14 text-right flex-shrink-0" style={{ color: "var(--color-border-subtle)" }}>Gesamt</span>
                  <span className="text-[7px] font-black uppercase tracking-widest w-12 text-right flex-shrink-0" style={{ color: "var(--color-border-subtle)" }}>
                    MD {selectedGW}
                  </span>
                </div>
                {visibleTeams.map((team, i) => {
                  const isMine    = team.user_id === user?.id;
                  const gwEntry   = gwRanking.find(t => t.id === team.id);
                  const gwPts     = gwEntry?.gw_points ?? null;
                  return (
                    <div
                      key={team.id}
                      onClick={() => window.location.href = isMine ? `/leagues/${leagueId}/lineup` : `/leagues/${leagueId}/liga?team=${team.id}`}
                      className="flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-all"
                      style={{
                        background: isMine ? "color-mix(in srgb, var(--color-primary) 5%, var(--bg-card))" : undefined,
                        borderTop: i > 0 ? "1px solid var(--color-border)" : undefined,
                      }}
                    >
                      {/* Rank */}
                      <span className="w-5 text-center flex-shrink-0 font-black text-xs" style={{ color: rankColor(i) }}>
                        {i + 1}
                      </span>
                      {/* Avatar */}
                      <TeamAvatar name={team.name} isMine={isMine} size={7} />
                      {/* Name */}
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-xs truncate"
                          style={{ color: isMine ? "var(--color-primary)" : "var(--color-text)" }}>
                          {team.name}
                          {isMine && <span className="ml-1 text-[7px]" style={{ color: "var(--color-primary)" }}>(Du)</span>}
                          {!team.user_id && <span className="ml-1 text-[7px]" style={{ color: "var(--color-border)" }}>Bot</span>}
                        </p>
                      </div>
                      {/* Total pts */}
                      <span className="w-14 text-right flex-shrink-0 font-black text-xs"
                        style={{ color: i === 0 ? "var(--color-primary)" : "var(--color-text)" }}>
                        {(team.total_points ?? 0).toFixed(1)}
                      </span>
                      {/* GW pts */}
                      <span className="w-12 text-right flex-shrink-0 font-black text-xs"
                        style={{ color: gwPts !== null ? (isLive && isMine ? "var(--color-success)" : "var(--color-muted)") : "var(--color-border)" }}>
                        {gwPts !== null ? gwPts.toFixed(1) : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── H2H MATCHUPS ─────────────────────────────────────────── */}
            {isH2H && (
              <div>
                <SectionHeader title={`H2H Paarungen · MD ${selectedGW}`} />
                {matchups.length === 0 ? (
                  <div className="rounded-2xl p-5 text-center" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                    <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                      Keine Paarungen für MD {selectedGW}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                    {[...matchups]
                      .sort((a, b) => {
                        const aM = a.home?.id === myTeam?.id || a.away?.id === myTeam?.id;
                        const bM = b.home?.id === myTeam?.id || b.away?.id === myTeam?.id;
                        return aM ? -1 : bM ? 1 : 0;
                      })
                      .map((m: any, i: number) => {
                        const homeIsMine = m.home?.id === myTeam?.id;
                        const awayIsMine = m.away?.id === myTeam?.id;
                        const isMine     = homeIsMine || awayIsMine;
                        return (
                          <div key={m.id}
                            className="flex items-center px-3 py-3 gap-2"
                            style={{
                              borderTop: i > 0 ? "1px solid var(--color-border)" : undefined,
                              background: isMine ? "color-mix(in srgb, var(--color-primary) 5%, var(--bg-card))" : undefined,
                            }}>
                            {/* Home */}
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              <TeamAvatar name={m.home?.name || ""} isMine={homeIsMine} size={6} />
                              <p className="text-xs font-black truncate"
                                style={{ color: homeIsMine ? "var(--color-primary)" : "var(--color-text)" }}>
                                {m.home?.name}
                              </p>
                            </div>
                            {/* Score */}
                            <div className="text-center flex-shrink-0 px-2">
                              <p className="text-sm font-black" style={{ color: isMine ? "var(--color-primary)" : "var(--color-text)" }}>
                                {m.home_points !== null ? m.home_points.toFixed(1) : "—"}
                                <span className="mx-1.5 text-xs" style={{ color: "var(--color-border-subtle)" }}>:</span>
                                {m.away_points !== null ? m.away_points.toFixed(1) : "—"}
                              </p>
                              {m.winner_id && (
                                <p className="text-[7px] font-black uppercase text-center" style={{ color: "var(--color-success)" }}>Final</p>
                              )}
                              {!m.winner_id && isLive && (
                                <div className="flex items-center justify-center gap-0.5">
                                  <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: "var(--color-success)" }} />
                                  <span className="text-[6px] font-black uppercase" style={{ color: "var(--color-success)" }}>Live</span>
                                </div>
                              )}
                            </div>
                            {/* Away */}
                            <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
                              <p className="text-xs font-black truncate text-right"
                                style={{ color: awayIsMine ? "var(--color-primary)" : "var(--color-text)" }}>
                                {m.away?.name}
                              </p>
                              <TeamAvatar name={m.away?.name || ""} isMine={awayIsMine} size={6} />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}

            {/* ── GW-RANGLISTE (non-H2H) ───────────────────────────────── */}
            {!isH2H && (
              <div>
                <SectionHeader title={`GW-Rangliste · MD ${selectedGW}`} />
                <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                  {gwRanking.map((team, i) => {
                    const isMine = team.user_id === user?.id;
                    return (
                      <div key={team.id}
                        className="flex items-center gap-2 px-3 py-2.5"
                        style={{
                          borderTop: i > 0 ? "1px solid var(--color-border)" : undefined,
                          background: isMine ? "color-mix(in srgb, var(--color-primary) 5%, var(--bg-card))" : undefined,
                        }}>
                        <span className="w-5 text-center font-black text-xs flex-shrink-0" style={{ color: rankColor(i) }}>{i + 1}</span>
                        <TeamAvatar name={team.name} isMine={isMine} size={7} />
                        <p className="flex-1 font-black text-xs truncate"
                          style={{ color: isMine ? "var(--color-primary)" : "var(--color-text)" }}>
                          {team.name}
                        </p>
                        <span className="font-black text-xs"
                          style={{ color: team.gw_points !== null ? "var(--color-text)" : "var(--color-border)" }}>
                          {team.gw_points !== null ? team.gw_points.toFixed(1) : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── AKTIVITÄTEN (preview in Übersicht) ───────────────────── */}
            <div>
              <SectionHeader title="Aktivitäten" />
              <TransactionsFeed leagueId={leagueId} />
            </div>

            </> /* end tab === "uebersicht" */}

            {/* ══ TABELLE (vollständig) ════════════════════════════════════ */}
            {tab === "tabelle" && (
              <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                {/* Column headers */}
                <div className="flex items-center gap-2 px-3 py-2.5"
                  style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <span className="w-5 flex-shrink-0" />
                  <span className="w-7 flex-shrink-0" />
                  <span className="flex-1 text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>Manager</span>
                  <span className="text-[7px] font-black uppercase tracking-widest w-14 text-right flex-shrink-0" style={{ color: "var(--color-border-subtle)" }}>Gesamt</span>
                  <span className="text-[7px] font-black uppercase tracking-widest w-12 text-right flex-shrink-0" style={{ color: "var(--color-border-subtle)" }}>
                    MD {selectedGW}
                  </span>
                </div>
                {teams.map((team, i) => {
                  const isMine  = team.user_id === user?.id;
                  const gwEntry = gwRanking.find(t => t.id === team.id);
                  const gwPts   = gwEntry?.gw_points ?? null;
                  return (
                    <div
                      key={team.id}
                      onClick={() => window.location.href = isMine ? `/leagues/${leagueId}/lineup` : `/leagues/${leagueId}/liga?team=${team.id}`}
                      className="flex items-center gap-2 px-3 py-3 cursor-pointer"
                      style={{
                        background: isMine ? "color-mix(in srgb, var(--color-primary) 5%, var(--bg-card))" : undefined,
                        borderTop: i > 0 ? "1px solid var(--color-border)" : undefined,
                      }}
                    >
                      <span className="w-5 text-center font-black text-xs flex-shrink-0" style={{ color: rankColor(i) }}>{i + 1}</span>
                      <TeamAvatar name={team.name} isMine={isMine} size={7} />
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-sm truncate" style={{ color: isMine ? "var(--color-primary)" : "var(--color-text)" }}>
                          {team.name}
                          {isMine && <span className="ml-1 text-[7px]" style={{ color: "var(--color-primary)" }}>(Du)</span>}
                          {!team.user_id && <span className="ml-1 text-[7px]" style={{ color: "var(--color-border)" }}>Bot</span>}
                        </p>
                      </div>
                      <span className="w-14 text-right font-black text-sm flex-shrink-0"
                        style={{ color: i === 0 ? "var(--color-primary)" : "var(--color-text)" }}>
                        {(team.total_points ?? 0).toFixed(1)}
                      </span>
                      <span className="w-12 text-right font-black text-xs flex-shrink-0"
                        style={{ color: gwPts !== null ? (isLive && isMine ? "var(--color-success)" : "var(--color-muted)") : "var(--color-border)" }}>
                        {gwPts !== null ? gwPts.toFixed(1) : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ══ AKTIVITÄTEN (vollständig) ════════════════════════════════ */}
            {tab === "aktivitaeten" && (
              <TransactionsFeed leagueId={leagueId} />
            )}

            {/* ══ REGELN ═══════════════════════════════════════════════════ */}
            {tab === "regeln" && (
              <div className="space-y-3">
                {/* Scoring */}
                <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                  <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Wertungssystem</p>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between">
                    <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>Modus</p>
                    <span className="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest"
                      style={{ background: "var(--bg-elevated)", color: "var(--color-primary)", border: "1px solid var(--color-border-subtle)" }}>
                      {league?.scoring_type === "h2h" ? "Head-to-Head" : "Gesamtpunkte"}
                    </span>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--color-border)" }}>
                    <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>Teams</p>
                    <span className="text-xs font-black" style={{ color: "var(--color-muted)" }}>{teams.length}</span>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--color-border)" }}>
                    <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>Spieltage</p>
                    <span className="text-xs font-black" style={{ color: "var(--color-muted)" }}>{gameweeks.length}</span>
                  </div>
                </div>

                {/* Liga Info */}
                <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                  <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Liga Info</p>
                  </div>
                  {league?.invite_code && (
                    <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>Einladungscode</p>
                      <span className="font-black text-xs tracking-widest px-2 py-1 rounded-lg"
                        style={{ background: "var(--bg-elevated)", color: "var(--color-primary)", letterSpacing: "0.15em" }}>
                        {league.invite_code}
                      </span>
                    </div>
                  )}
                  <div className="px-4 py-3 flex items-center justify-between">
                    <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>Status</p>
                    <span className="text-xs font-black capitalize" style={{ color: "var(--color-muted)" }}>{league?.status}</span>
                  </div>
                </div>

                {/* Admin link */}
                {league?.owner_id === user?.id && (
                  <a href={`/leagues/${leagueId}/admin`}
                    className="flex items-center justify-between px-4 py-3.5 rounded-2xl"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border-subtle)" }}>
                    <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>Admin-Einstellungen</p>
                    <span className="text-[10px]" style={{ color: "var(--color-primary)" }}>→</span>
                  </a>
                )}
              </div>
            )}

          </div>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
