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
        <p className="text-center text-xs text-gray-400">WM Hub Skeleton — Tasks werden ergänzt</p>
      </div>

      <BottomNav />
    </main>
  );
}
