"use client";

import React, { useState, useEffect, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { BottomNav } from "@/app/components/BottomNav";
import { Spinner } from "@/app/components/ui/Spinner";
import { EmptyState } from "@/app/components/ui/EmptyState";
import { UserBadge } from "@/app/components/UserBadge";
import { TransactionsFeed } from "@/app/components/TransactionsFeed";
import { TeamDetailSheet } from "@/app/components/TeamDetailSheet";
import { mergeRules, RULE_GROUPS } from "@/lib/scoring";
import type { WMNation, WMGameweek, WMLeagueSettings } from "@/lib/wm-types";

// ── Phase labels ──────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<string, string> = {
  group:       "Gruppenphase",
  round_of_32: "Sechzehntelfinale",
  round_of_16: "Achtelfinale",
  quarter:     "Viertelfinale",
  semi:        "Halbfinale",
  final:       "Finale",
};

// ── Helper: Team initials avatar ──────────────────────────────────────────────

function TeamAvatar({ name, isMine, size = 7 }: { name: string; isMine?: boolean; size?: number }) {
  const px = size * 4;
  if (!name || !name.trim()) return (
    <div className="rounded-full flex-shrink-0" style={{ width: px, height: px, background: "var(--bg-elevated)", border: "1.5px solid var(--color-border)" }} />
  );
  const parts    = name.trim().split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
  return (
    <div
      className="rounded-full flex items-center justify-center font-black flex-shrink-0"
      style={{
        width: px, height: px,
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

// ── Helper: Section header ────────────────────────────────────────────────────

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <p className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: "var(--color-muted)" }}>
        {title}
      </p>
      {action && (
        <button onClick={onAction} className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-primary)" }}>
          {action}
        </button>
      )}
    </div>
  );
}

// ── Helper: Rank color ────────────────────────────────────────────────────────

const rankColor = (i: number) =>
  i === 0 ? "var(--color-primary)"
  : i === 1 ? "var(--color-text)"
  : i === 2 ? "var(--color-bronze)"
  : "var(--color-border-subtle)";

// ── Main ──────────────────────────────────────────────────────────────────────

export default function WMLeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  // ── Auth + Liga
  const [user, setUser]       = useState<any>(null);
  const [league, setLeague]   = useState<any>(null);
  const [teams, setTeams]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // ── WM-spezifisch
  const [settings, setSettings]     = useState<WMLeagueSettings & { wm_tournaments?: any } | null>(null);
  const [gameweeks, setGameweeks]   = useState<WMGameweek[]>([]);
  const [currentGW, setCurrentGW]   = useState<WMGameweek | null>(null);
  const [selectedGW, setSelectedGW] = useState<number>(1);
  const [gwPointsMap, setGwPointsMap] = useState<Record<string, number>>({});
  const [nations, setNations]       = useState<WMNation[]>([]);
  const [hasDraft, setHasDraft]     = useState(false);
  const [draftSession, setDraftSession] = useState<any>(null);

  // ── DETAILS-Tabelle: alle GW-Punkte (gameweek → teamId → points)
  const [allGwPoints, setAllGwPoints] = useState<Record<number, Record<string, number>>>({});
  const [allGwPointsLoaded, setAllGwPointsLoaded] = useState(false);

  // ── UI-State
  const [tab, setTab]                   = useState<"uebersicht" | "tabelle" | "nationen">("uebersicht");
  const [standingsView, setStandingsView] = useState<"table" | "details">("table");
  const [showSettings, setShowSettings] = useState(false);
  const [showActivities, setShowActivities] = useState(false);
  const [actFilter, setActFilter]       = useState<"alle" | "transfer" | "waiver">("alle");
  const [sheetTeam, setSheetTeam]       = useState<any>(null);

  // ── Teamname-Edit (im Settings Modal)
  const [editTeamName, setEditTeamName] = useState("");
  const [savingName, setSavingName]     = useState(false);
  const [nameSaved, setNameSaved]       = useState(false);

  // ── Invite-Code Copy
  const [copiedCode, setCopiedCode]     = useState(false);

  // ── Load ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
    });
  }, []);

  async function loadAll(userId: string) {
    try {
      // Liga
      const { data: leagueData } = await supabase
        .from("leagues").select("*").eq("id", leagueId).single();
      setLeague(leagueData);

      // Teams (absteigend nach total_points)
      const { data: teamsData } = await supabase
        .from("teams")
        .select("id, name, user_id, total_points, profiles(username)")
        .eq("league_id", leagueId)
        .order("total_points", { ascending: false, nullsFirst: false });
      setTeams(teamsData || []);

      // Draft Session
      const { data: draftData } = await supabase
        .from("draft_sessions").select("*").eq("league_id", leagueId).maybeSingle();
      setDraftSession(draftData);
      setHasDraft(!!draftData);

      // WM-Settings (join wm_tournaments für Turniername)
      const { data: settingsData } = await supabase
        .from("wm_league_settings")
        .select("*, wm_tournaments(id, name, season, status)")
        .eq("league_id", leagueId)
        .maybeSingle();
      setSettings(settingsData);

      if (settingsData?.tournament_id) {
        // Nationen
        const { data: nationsData } = await supabase
          .from("wm_nations")
          .select("*")
          .eq("tournament_id", settingsData.tournament_id)
          .order("group_letter");
        setNations(nationsData || []);

        // Gameweeks
        const { data: gwData } = await supabase
          .from("wm_gameweeks")
          .select("*")
          .eq("tournament_id", settingsData.tournament_id)
          .order("gameweek");
        setGameweeks(gwData || []);

        const active = (gwData || []).find((g: WMGameweek) => g.status === "active")
          || (gwData || []).slice().reverse().find((g: WMGameweek) => g.status === "finished")
          || (gwData || [])[0];
        setCurrentGW(active || null);

        if (active) {
          setSelectedGW(active.gameweek);
          await loadGWData(active.gameweek, teamsData || []);
        }
      }

      // Teamname vorbefüllen
      const myT = (teamsData || []).find((t: any) => t.user_id === userId);
      if (myT) setEditTeamName(myT.name || "");
    } catch {
      // errors are swallowed; loading spinner is released via finally
    } finally {
      setLoading(false);
    }
  }

  async function loadGWData(gw: number, allTeams: any[]) {
    if (!allTeams.length) return;
    const teamIds = allTeams.map((t: any) => t.id);
    const { data: gwPts } = await supabase
      .from("wm_gameweek_points")
      .select("team_id, points")
      .eq("gameweek", gw)
      .in("team_id", teamIds);
    const map: Record<string, number> = {};
    for (const r of (gwPts || [])) {
      map[r.team_id] = (map[r.team_id] || 0) + r.points;
    }
    setGwPointsMap(map);
  }

  // Wird beim Wechsel zu Details-Ansicht in Tabelle einmalig geladen
  async function loadAllGwPoints() {
    if (allGwPointsLoaded || !teams.length || !gameweeks.length) return;
    const teamIds = teams.map((t: any) => t.id);
    const { data } = await supabase
      .from("wm_gameweek_points")
      .select("team_id, gameweek, points")
      .in("team_id", teamIds);
    const result: Record<number, Record<string, number>> = {};
    for (const r of (data || [])) {
      if (!result[r.gameweek]) result[r.gameweek] = {};
      result[r.gameweek][r.team_id] = (result[r.gameweek][r.team_id] || 0) + r.points;
    }
    setAllGwPoints(result);
    setAllGwPointsLoaded(true);
  }

  async function saveTeamName() {
    const myTeam = teams.find((t: any) => t.user_id === user?.id);
    if (!myTeam) return;
    const trimmed = editTeamName.trim();
    if (trimmed.length < 2 || trimmed.length > 24 || trimmed === myTeam.name) return;
    setSavingName(true);
    await supabase.from("teams").update({ name: trimmed }).eq("id", myTeam.id);
    setTeams(prev => prev.map((t: any) => t.id === myTeam.id ? { ...t, name: trimmed } : t));
    setSavingName(false);
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  }

  async function copyInviteCode() {
    if (!league?.invite_code) return;
    try {
      await navigator.clipboard.writeText(league.invite_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      setCopiedCode(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const myTeam   = teams.find((t: any) => t.user_id === user?.id);
  const myRank   = myTeam ? teams.findIndex((t: any) => t.id === myTeam.id) + 1 : null;
  const myGWPts  = myTeam ? (gwPointsMap[myTeam.id] ?? null) : null;
  const isLive   = currentGW?.status === "active" && selectedGW === currentGW.gameweek;

  const draftLabel =
    league?.status === "setup"     ? "Draft-Raum öffnen" :
    league?.status === "drafting"  ? "Zum Draft"         :
    "Draft-Board";

  const groups = nations.reduce((acc, n) => {
    const g = n.group_letter || "?";
    if (!acc[g]) acc[g] = [];
    acc[g].push(n);
    return acc;
  }, {} as Record<string, WMNation[]>);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <Spinner text="Lade WM-Liga..." />
    </main>
  );

  return (
    <main className="flex min-h-screen flex-col items-center pb-28" style={{ background: "var(--bg-page)", paddingTop: 16 }}>

      {/* Ambient glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-8 pointer-events-none"
        style={{ background: "var(--color-primary)", zIndex: 49 }} />

      <div className="w-full max-w-md px-4">
        {/* ── League Header ─────────────────────────────────────────── */}
        <div className="mb-4">
          <button
            onClick={() => window.location.href = "/wm"}
            className="text-[8px] font-black uppercase tracking-widest"
            style={{ color: "var(--color-muted)" }}
          >
            ← WM
          </button>
          <div className="flex items-center justify-between mt-0.5">
            <p className="text-lg font-black leading-tight flex-1 mr-2 truncate" style={{ color: "var(--color-text)" }}>
              {league?.name}
            </p>
            {/* ⚙ Gear — immer sichtbar (auch setup/drafting) */}
            <button
              onClick={() => setShowSettings(true)}
              className="w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0 transition-all active:scale-90"
              style={{ fontSize: "18px", color: "var(--color-muted)" }}
            >
              ⚙
            </button>
            <UserBadge />
          </div>
        </div>

        {/* ── Status: setup ──────────────────────────────────────────── */}
        {league?.status === "setup" && (
          <div className="mt-2 space-y-3">
            <div className="rounded-2xl p-5 text-center"
              style={{ background: "var(--bg-card)", border: "1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)" }}>
              <p className="text-3xl mb-3">📋</p>
              <p className="text-base font-black mb-1" style={{ color: "var(--color-primary)" }}>Draft vorbereiten</p>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                Der Draft wurde noch nicht gestartet
              </p>
            </div>

            {/* Draft-Einstellungen */}
            {draftSession && (
              <div className="rounded-2xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-border-subtle)" }}>
                  Draft-Einstellungen
                </p>
                <div className="grid grid-cols-2 gap-y-3">
                  <div>
                    <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>Modus</p>
                    <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>
                      {draftSession.draft_type === "linear" ? "Dynasty (Linear)" : "Snake"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>Teams</p>
                    <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>{teams.length}</p>
                  </div>
                  {draftSession.rounds && (
                    <div>
                      <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>Runden</p>
                      <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>{draftSession.rounds}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Teilnehmer */}
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
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Invite-Code (Owner) */}
            {league?.owner_id === user?.id && league?.invite_code && (
              <div className="rounded-2xl p-4 flex items-center justify-between"
                style={{ background: "var(--bg-card)", border: "1px solid color-mix(in srgb, var(--color-primary) 25%, transparent)" }}>
                <div>
                  <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>Liga einladen</p>
                  <p className="text-base font-black tracking-widest" style={{ color: "var(--color-primary)" }}>{league.invite_code}</p>
                </div>
                <button onClick={copyInviteCode}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest"
                  style={{ background: "color-mix(in srgb, var(--color-primary) 15%, var(--bg-page))", border: "1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)", color: "var(--color-primary)" }}>
                  {copiedCode ? "✓ Kopiert" : "Kopieren"}
                </button>
              </div>
            )}

            <button onClick={() => window.location.href = `/wm/${leagueId}/draft`}
              className="block w-full py-3.5 rounded-2xl text-center text-[10px] font-black uppercase tracking-widest"
              style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
              Draft-Raum öffnen →
            </button>
          </div>
        )}

        {/* ── Status: drafting ───────────────────────────────────────── */}
        {league?.status === "drafting" && (
          <div className="mt-2 space-y-3">
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
            <button onClick={() => window.location.href = `/wm/${leagueId}/draft`}
              className="block w-full py-3.5 rounded-2xl text-center text-[10px] font-black uppercase tracking-widest"
              style={{ background: "var(--color-success)", color: "var(--bg-page)" }}>
              Zum Draft →
            </button>
          </div>
        )}

        {/* ── Active: Tab-Bar + Inhalt ─────────────────────────────── */}
        {league?.status !== "setup" && league?.status !== "drafting" && (
          <div className="mt-4 space-y-5">

            {/* ── Tab Bar ──────────────────────────────────────────────── */}
            <div className="flex items-stretch" style={{ borderBottom: "1px solid var(--color-border)" }}>
              {(
                [
                  ["uebersicht", "Übersicht"],
                  ["tabelle",    "Tabelle"],
                  ["nationen",   "Nationen"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className="flex-1 py-2.5 text-[9px] font-black uppercase tracking-widest transition-all active:scale-[0.97] relative"
                  style={{ color: tab === id ? "var(--color-primary)" : "var(--color-muted)" }}
                >
                  {label}
                  {tab === id && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                      style={{ background: "var(--color-primary)" }} />
                  )}
                </button>
              ))}
            </div>

            {/* ── GW-Selector (Übersicht + Tabelle) ────────────────────── */}
            {(tab === "uebersicht" || tab === "tabelle") && gameweeks.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
                {gameweeks.map((gw: WMGameweek) => (
                  <button
                    key={gw.gameweek}
                    onClick={() => {
                      setSelectedGW(gw.gameweek);
                      loadGWData(gw.gameweek, teams);
                    }}
                    className="px-3 py-1.5 rounded-lg text-[9px] font-black whitespace-nowrap flex-shrink-0 transition-all active:scale-[0.97] flex flex-col items-center gap-0"
                    style={{
                      background: selectedGW === gw.gameweek ? "var(--color-primary)" : "var(--bg-card)",
                      color:      selectedGW === gw.gameweek ? "var(--bg-page)"       : "var(--color-muted)",
                      border:     `1px solid ${selectedGW === gw.gameweek ? "var(--color-primary)" : "var(--color-border)"}`,
                    }}
                  >
                    <span className="flex items-center gap-1">
                      GW {gw.gameweek}
                      {gw.status === "active" && (
                        <span className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
                          style={{ background: selectedGW === gw.gameweek ? "var(--bg-page)" : "var(--color-success)" }} />
                      )}
                    </span>
                    {gw.phase && (
                      <span className="text-[7px] opacity-70">{PHASE_LABEL[gw.phase]?.slice(0, 3) ?? gw.phase}</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* ── Tab-Inhalte folgen in Task 4–7 ───────────────────────── */}

            {/* ══ ÜBERSICHT ════════════════════════════════════════════════ */}
            {tab === "uebersicht" && (
              <div className="tifo-fade-up space-y-5">

                {/* ── Mein Stand (Stat-Strip) ───────────────────────────── */}
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
                      <div className="flex-1 text-center py-3 px-2">
                        <p className="text-[7px] font-black uppercase tracking-widest mb-0.5" style={{ color: "var(--color-muted)" }}>Rang</p>
                        <p className="text-xl font-black leading-none" style={{ color: "var(--color-primary)" }}>
                          {myRank}
                          <span className="text-[9px] ml-0.5" style={{ color: "var(--color-muted)" }}>/{teams.length}</span>
                        </p>
                      </div>
                      <div style={{ width: 1, alignSelf: "stretch", background: "var(--color-border)" }} />
                      <div className="flex-1 text-center py-3 px-2">
                        <p className="text-[7px] font-black uppercase tracking-widest mb-0.5" style={{ color: "var(--color-muted)" }}>
                          GW {selectedGW}
                        </p>
                        <p className="text-xl font-black leading-none"
                          style={{ color: isLive ? "var(--color-success)" : "var(--color-text)" }}>
                          {myGWPts !== null ? myGWPts.toFixed(1) : "—"}
                        </p>
                      </div>
                      <div style={{ width: 1, alignSelf: "stretch", background: "var(--color-border)" }} />
                      <div className="flex-1 text-center py-3 px-2">
                        <p className="text-[7px] font-black uppercase tracking-widest mb-0.5" style={{ color: "var(--color-muted)" }}>Gesamt</p>
                        <p className="text-xl font-black leading-none" style={{ color: "var(--color-text)" }}>
                          {(myTeam.total_points ?? 0).toFixed(1)}
                        </p>
                      </div>
                    </div>
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

                {/* ── Quick-Actions Row (2×2) ───────────────────────────── */}
                <div className="grid grid-cols-2 gap-2">
                  {myTeam && (
                    <button onClick={() => window.location.href = `/wm/${leagueId}/lineup`}
                      className="py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-center"
                      style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}>
                      Aufstellung →
                    </button>
                  )}
                  <button onClick={() => window.location.href = `/wm/${leagueId}/draft`}
                    className="py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-center"
                    style={{
                      background: league?.status === "drafting" ? "var(--color-success)" : "var(--bg-card)",
                      border: `1px solid ${league?.status === "drafting" ? "var(--color-success)" : "var(--color-border)"}`,
                      color: league?.status === "drafting" ? "var(--bg-page)" : "var(--color-text)",
                    }}>
                    {draftLabel} →
                  </button>
                  <button onClick={() => window.location.href = `/wm/${leagueId}/waiver`}
                    className="py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-center"
                    style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}>
                    Waiver →
                  </button>
                  <button onClick={() => window.location.href = `/wm/${leagueId}/matchday`}
                    className="py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-center"
                    style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}>
                    Spielplan →
                  </button>
                </div>

                {/* ── Standings Preview (Top 5) ─────────────────────────── */}
                {teams.length > 0 && (
                  <div>
                    <SectionHeader
                      title="Tabelle"
                      action={teams.length > 5 ? "Alle anzeigen →" : undefined}
                      onAction={() => setTab("tabelle")}
                    />
                    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                      {teams.slice(0, 5).map((team: any, i: number) => {
                        const isMine  = team.user_id === user?.id;
                        const gwPts   = gwPointsMap[team.id] ?? null;
                        return (
                          <div
                            key={team.id}
                            onClick={() => isMine ? (window.location.href = `/wm/${leagueId}/lineup`) : setSheetTeam(team)}
                            className="flex items-center gap-2 px-3 py-3 cursor-pointer transition-transform duration-100 active:scale-[0.97]"
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
                              </p>
                            </div>
                            <span className="font-black text-sm flex-shrink-0" style={{ color: i === 0 ? "var(--color-primary)" : "var(--color-text)" }}>
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
                    {teams.length > 5 && (
                      <button onClick={() => setTab("tabelle")}
                        className="w-full mt-1.5 py-2 text-[8px] font-black uppercase tracking-widest text-center"
                        style={{ color: "var(--color-primary)" }}>
                        Alle {teams.length} Teams anzeigen →
                      </button>
                    )}
                  </div>
                )}

                {/* ── Aktivitäten Preview ───────────────────────────────── */}
                <div>
                  <SectionHeader title="Aktivitäten" action="Alle anzeigen →" onAction={() => setShowActivities(true)} />
                  <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", maxHeight: 160, overflow: "hidden" }}>
                    <React.Suspense fallback={<div className="p-4 text-center text-xs" style={{ color: "var(--color-muted)" }}>Lade…</div>}>
                      <TransactionsFeed
                        leagueId={leagueId}
                        kindFilter={["transfer", "waiver"]}
                        maxHeight="160px"
                        compact
                      />
                    </React.Suspense>
                  </div>
                </div>

              </div>
            )}
            {/* ══ TABELLE ══════════════════════════════════════════════════ */}
            {tab === "tabelle" && (
              <div className="tifo-fade-up space-y-3">

                {/* TABLE / DETAILS Toggle */}
                <div className="flex gap-1">
                  {(["table", "details"] as const).map(v => (
                    <button key={v}
                      onClick={() => {
                        setStandingsView(v);
                        if (v === "details") loadAllGwPoints();
                      }}
                      className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all"
                      style={{
                        background: standingsView === v ? "var(--color-primary)" : "var(--bg-card)",
                        color:      standingsView === v ? "var(--bg-page)"       : "var(--color-muted)",
                        border:     `1px solid ${standingsView === v ? "var(--color-primary)" : "var(--color-border)"}`,
                      }}>
                      {v === "table" ? "Tabelle" : "Details"}
                    </button>
                  ))}
                </div>

                {/* ── TABLE-Ansicht ─────────────────────────────────────── */}
                {standingsView === "table" && (
                  <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                    {teams.length === 0 ? (
                      <EmptyState icon="👥" title="Noch keine Teams" />
                    ) : teams.map((team: any, i: number) => {
                      const isMine = team.user_id === user?.id;
                      const gwPts  = gwPointsMap[team.id] ?? null;
                      return (
                        <div
                          key={team.id}
                          onClick={() => isMine ? (window.location.href = `/wm/${leagueId}/lineup`) : setSheetTeam(team)}
                          className="flex items-center gap-2 px-3 py-3 cursor-pointer transition-transform duration-100 active:scale-[0.97]"
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
                            </p>
                          </div>
                          <span className="w-14 text-right font-black text-sm flex-shrink-0" style={{ color: i === 0 ? "var(--color-primary)" : "var(--color-text)" }}>
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

                {/* ── DETAILS-Ansicht (horizontal scroll) ──────────────── */}
                {standingsView === "details" && (
                  <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                    {!allGwPointsLoaded ? (
                      <div className="flex justify-center py-8"><Spinner /></div>
                    ) : (
                      <div className="overflow-x-auto overscroll-x-contain" style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
                        <table style={{ minWidth: Math.max(360, 200 + gameweeks.length * 52), borderCollapse: "collapse", width: "100%" }}>
                          <thead>
                            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                              <th className="sticky left-0 z-10 text-left px-2 py-2.5 text-[7px] font-black uppercase tracking-widest w-7"
                                style={{ background: "var(--bg-card)", color: "var(--color-border-subtle)" }}>#</th>
                              <th className="sticky left-7 z-10 text-left px-2 py-2.5 text-[7px] font-black uppercase tracking-widest"
                                style={{ background: "var(--bg-card)", color: "var(--color-border-subtle)", minWidth: 110 }}>Team</th>
                              <th className="text-right px-3 py-2.5 text-[7px] font-black uppercase tracking-widest whitespace-nowrap"
                                style={{ color: "var(--color-primary)" }}>PF</th>
                              <th className="text-right px-3 py-2.5 text-[7px] font-black uppercase tracking-widest whitespace-nowrap"
                                style={{ color: "var(--color-border-subtle)" }}>Max PF</th>
                              {gameweeks.map((gw: WMGameweek) => (
                                <th key={gw.gameweek} className="text-right px-3 py-2.5 text-[7px] font-black uppercase tracking-widest whitespace-nowrap"
                                  style={{ color: selectedGW === gw.gameweek ? "var(--color-primary)" : "var(--color-border-subtle)" }}>
                                  GW{gw.gameweek}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {teams.map((team: any, i: number) => {
                              const isMine = team.user_id === user?.id;
                              const gwPtsPerGW = gameweeks.map((gw: WMGameweek) => allGwPoints[gw.gameweek]?.[team.id] ?? null);
                              const maxPF      = gwPtsPerGW.reduce((max, v) => (v !== null && v > (max ?? -Infinity) ? v : max), null as number | null);
                              return (
                                <tr key={team.id}
                                  onClick={() => isMine ? (window.location.href = `/wm/${leagueId}/lineup`) : setSheetTeam(team)}
                                  className="cursor-pointer"
                                  style={{
                                    background: isMine ? "color-mix(in srgb, var(--color-primary) 5%, var(--bg-card))" : undefined,
                                    borderTop: i > 0 ? "1px solid var(--color-border)" : undefined,
                                  }}>
                                  <td className="sticky left-0 z-10 px-2 py-3 text-center"
                                    style={{ background: isMine ? "color-mix(in srgb, var(--color-primary) 5%, var(--bg-card))" : "var(--bg-card)" }}>
                                    <span className="font-black text-xs" style={{ color: rankColor(i) }}>{i + 1}</span>
                                  </td>
                                  <td className="sticky left-7 z-10 px-2 py-3"
                                    style={{ background: isMine ? "color-mix(in srgb, var(--color-primary) 5%, var(--bg-card))" : "var(--bg-card)" }}>
                                    <div className="flex items-center gap-2">
                                      <TeamAvatar name={team.name} isMine={isMine} size={6} />
                                      <p className="font-black text-xs truncate" style={{ color: isMine ? "var(--color-primary)" : "var(--color-text)", maxWidth: 80 }}>
                                        {team.name}
                                      </p>
                                    </div>
                                  </td>
                                  <td className="text-right px-3 py-3">
                                    <span className="font-black text-xs" style={{ color: i === 0 ? "var(--color-primary)" : "var(--color-text)" }}>
                                      {(team.total_points ?? 0).toFixed(1)}
                                    </span>
                                  </td>
                                  <td className="text-right px-3 py-3">
                                    <span className="font-black text-xs" style={{ color: "var(--color-muted)" }}>
                                      {maxPF !== null ? maxPF.toFixed(1) : "—"}
                                    </span>
                                  </td>
                                  {gwPtsPerGW.map((pts, idx) => (
                                    <td key={idx} className="text-right px-3 py-3">
                                      <span className="font-black text-xs" style={{ color: pts !== null ? "var(--color-muted)" : "var(--color-border)" }}>
                                        {pts !== null ? pts.toFixed(1) : "—"}
                                      </span>
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

              </div>
            )}
            {tab === "nationen"   && <p className="text-center text-xs" style={{ color: "var(--color-muted)" }}>Nationen folgt</p>}

          </div>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
