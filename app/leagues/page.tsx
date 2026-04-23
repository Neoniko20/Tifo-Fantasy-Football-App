"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { UserBadge } from "@/app/components/UserBadge";
import { BottomNav } from "@/app/components/BottomNav";
import { DEFAULT_WM_SETTINGS } from "@/lib/wm-types";
import { FORMATION_KEYS } from "@/lib/wm-formations";
import { useToast } from "@/app/components/ToastProvider";
import { Spinner } from "@/app/components/ui/Spinner";
import { EmptyState } from "@/app/components/ui/EmptyState";
import { OnboardingFlow } from "@/app/components/OnboardingFlow";

type League = {
  id: string;
  name: string;
  invite_code: string;
  status: string;
  max_teams: number;
  owner_id: string;
  scoring_type: string;
  mode?: string; // "liga" | "wm"
};

const inputCls = "w-full mt-1 p-3 rounded-xl text-sm focus:outline-none focus:border-[var(--color-primary)] transition-colors";

export default function LeaguesPage() {
  const [user, setUser] = useState<any>(null);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"overview" | "create" | "join">("overview");
  const [newLeagueName, setNewLeagueName] = useState("");
  const [maxTeams, setMaxTeams] = useState(8);
  const [scoringType, setScoringType] = useState<"standard" | "h2h">("h2h");
  const [leagueMode, setLeagueMode] = useState<"liga" | "wm">("liga");
  const [joinCode, setJoinCode] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // WM-spezifische Settings
  const [wmSquadSize, setWmSquadSize] = useState(DEFAULT_WM_SETTINGS.squad_size);
  const [wmBenchSize, setWmBenchSize] = useState(DEFAULT_WM_SETTINGS.bench_size);
  const [wmTransfers, setWmTransfers] = useState(DEFAULT_WM_SETTINGS.transfers_per_gameweek);
  const [wmTransfersUnlimited, setWmTransfersUnlimited] = useState(false);
  const [wmWaiverPriority, setWmWaiverPriority] = useState(true);
  const [wmWaiverBudget, setWmWaiverBudget] = useState(false);
  const [wmWaiverBudgetAmount, setWmWaiverBudgetAmount] = useState(100);
  const [wmClaimsLimit, setWmClaimsLimit] = useState(true);
  const [wmMaxClaims, setWmMaxClaims] = useState(3);
  const [wmAutoSubs, setWmAutoSubs] = useState(true);
  const [wmFormations, setWmFormations] = useState<string[]>(["4-3-3", "4-2-3-1", "3-5-2", "5-3-2"]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadLeagues(data.user.id);
    });
  }, []);

  async function loadLeagues(userId: string) {
    setLoading(true);
    const { data } = await supabase
      .from("teams")
      .select("league_id")
      .eq("user_id", userId)
      .not("league_id", "is", null);

    const leagueIds = (data || []).map((t) => t.league_id);
    if (leagueIds.length === 0) { setLoading(false); return; }

    const { data: leagueData } = await supabase
      .from("leagues")
      .select("*")
      .in("id", leagueIds);

    setLeagues(leagueData || []);
    setLoading(false);
  }

  async function createLeagueFromOnboarding(name: string, mode: "liga" | "wm", scoring: "h2h" | "standard") {
    setNewLeagueName(name);
    setLeagueMode(mode);
    setScoringType(scoring);
    await createLeagueWithParams(name, mode, scoring);
  }

  async function joinLeagueFromOnboarding(code: string) {
    setJoinCode(code);
    await joinLeagueWithCode(code);
  }

  async function createLeague() {
    if (!newLeagueName.trim()) return;
    setSaving(true);
    await createLeagueWithParams(newLeagueName, leagueMode, scoringType);
  }

  async function createLeagueWithParams(name: string, mode: "liga" | "wm", scoring: "h2h" | "standard") {
    if (!name.trim()) return;
    setSaving(true);

    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const { data: league, error } = await supabase
      .from("leagues")
      .insert({
        name: name.trim(),
        owner_id: user.id,
        max_teams: maxTeams,
        scoring_type: scoring,
        status: "setup",
        mode,
        invite_code: inviteCode,
      })
      .select()
      .single();

    if (error || !league) {
      console.error("Create league error:", error?.message, error?.details, error?.hint, error?.code);
      toast(`Fehler: ${error?.message || "Unbekannt"}`, "error");
      setSaving(false);
      return;
    }

    // Eigenes Team anlegen
    await supabase.from("teams").insert({
      user_id: user.id,
      league_id: league.id,
      name: "Mein Team",
    });

    // WM: Turnier-Settings anlegen
    if (mode === "wm") {
      const { data: tournament } = await supabase
        .from("wm_tournaments")
        .select("id")
        .eq("season", 2026)
        .single();

      if (tournament) {
        await supabase.from("wm_league_settings").insert({
          league_id: league.id,
          tournament_id: tournament.id,
          squad_size: wmSquadSize,
          bench_size: wmBenchSize,
          position_limits: {
            GK: { min: 1, max: 2 },
            DF: { min: 2, max: 5 },
            MF: { min: 2, max: 5 },
            FW: { min: 1, max: 3 },
          },
          allowed_formations: wmFormations,
          transfers_per_gameweek: wmTransfers,
          transfers_unlimited: wmTransfersUnlimited,
          waiver_mode_starts_gameweek: 4,
          waiver_priority_enabled: wmWaiverPriority,
          waiver_budget_enabled: wmWaiverBudget,
          waiver_budget_starting: wmWaiverBudgetAmount,
          waiver_claims_limit_enabled: wmClaimsLimit,
          waiver_max_claims_per_gameweek: wmMaxClaims,
          auto_subs_enabled: wmAutoSubs,
        });
      }
    }

    toast(`Liga erstellt! Code: ${league.invite_code}`, "success");
    setNewLeagueName("");
    loadLeagues(user.id);
    setSaving(false);
    setView("overview");
  }

  async function joinLeague() {
    if (!joinCode.trim()) return;
    await joinLeagueWithCode(joinCode.trim());
  }

  async function joinLeagueWithCode(code: string) {
    setSaving(true);

    const { data: league } = await supabase
      .from("leagues")
      .select("*")
      .eq("invite_code", code.trim().toLowerCase())
      .single();

    if (!league) {
      toast("Liga nicht gefunden. Code prüfen!", "error");
      setSaving(false);
      return;
    }

    const { data: existingTeams } = await supabase
      .from("teams").select("id").eq("league_id", league.id);

    if ((existingTeams?.length || 0) >= league.max_teams) {
      toast("Liga ist bereits voll!", "error");
      setSaving(false);
      return;
    }

    const { data: alreadyIn } = await supabase
      .from("teams").select("id")
      .eq("league_id", league.id).eq("user_id", user.id).maybeSingle();

    if (alreadyIn) {
      toast("Du bist bereits in dieser Liga!", "error");
      setSaving(false);
      return;
    }

    await supabase.from("teams").insert({
      user_id: user.id,
      league_id: league.id,
      name: "Mein Team",
    });

    toast(`Beigetreten: ${league.name}!`, "success");
    setJoinCode("");
    loadLeagues(user.id);
    setSaving(false);
    setView("overview");
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  function statusLabel(s: string) {
    return s === "setup" ? "Aufbau" : s === "drafting" ? "Draft" : s === "active" ? "Aktiv" : "Beendet";
  }

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "var(--bg-page)" }}>
      {/* Glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "var(--color-primary)" }} />

      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-center mb-6">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: "var(--color-muted)" }}>Fantasy Football</p>
          <h1 className="text-xl font-black" style={{ color: "var(--color-primary)" }}>LIGA</h1>
        </div>
        <UserBadge />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 w-full max-w-md mb-5 p-1 rounded-xl" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
        {[{ id: "overview", label: "Übersicht" }, { id: "create", label: "Erstellen" }, { id: "join", label: "Beitreten" }].map((t) => (
          <button key={t.id} onClick={() => { setView(t.id as any); }}
            className="flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all"
            style={{
              background: view === t.id ? "var(--color-primary)" : "transparent",
              color: view === t.id ? "var(--bg-page)" : "var(--color-muted)",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {view === "overview" && (
        <div className="w-full max-w-md space-y-3">
          {loading ? (
            <Spinner text="Lade Ligen..." />
          ) : leagues.length === 0 ? (
            <OnboardingFlow
              onCreateLeague={createLeagueFromOnboarding}
              onJoinLeague={joinLeagueFromOnboarding}
              saving={saving}
            />
          ) : (
            leagues.map((league) => (
              <div key={league.id} className="rounded-2xl p-4"
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-black text-base" style={{ color: "var(--color-text)" }}>{league.name}</h3>
                    <div className="flex gap-2 mt-1">
                      <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                        style={{
                          background: league.status === "active" ? "var(--bg-elevated)" : "var(--bg-card)",
                          color: league.status === "active" ? "var(--color-primary)" : "var(--color-muted)",
                          border: `1px solid ${league.status === "active" ? "var(--color-primary)" : "var(--color-border)"}`,
                        }}>
                        {statusLabel(league.status)}
                      </span>
                      <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                        style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}>
                        {league.scoring_type === "h2h" ? "H2H" : "Gesamtpkt."}
                      </span>
                    </div>
                  </div>
                  <span className="text-[9px] font-black" style={{ color: "var(--color-muted)" }}>{league.max_teams} Teams</span>
                </div>

                {league.owner_id === user?.id && (
                  <div className="flex items-center gap-3 rounded-xl p-3 mb-3"
                    style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)" }}>
                    <div className="flex-1">
                      <p className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: "var(--color-muted)" }}>Invite-Code</p>
                      <p className="font-black tracking-widest text-sm" style={{ color: "var(--color-primary)" }}>{league.invite_code}</p>
                    </div>
                    <button onClick={() => copyCode(league.invite_code)}
                      className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-colors"
                      style={{ background: "var(--color-border)", color: copiedCode === league.invite_code ? "var(--color-primary)" : "var(--color-text)" }}>
                      {copiedCode === league.invite_code ? "✓ Kopiert" : "Kopieren"}
                    </button>
                  </div>
                )}

                <button onClick={() => window.location.href = `/leagues/${league.id}`}
                  className="w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
                  style={{ background: "var(--color-border)", color: "var(--color-text)" }}>
                  Liga öffnen →
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* CREATE */}
      {view === "create" && (
        <div className="w-full max-w-md space-y-3">
          <div className="rounded-2xl p-5" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <h2 className="font-black text-base mb-5" style={{ color: "var(--color-text)" }}>Neue Liga erstellen</h2>

            {/* Liga-Name */}
            <div className="mb-4">
              <label className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Liga-Name</label>
              <input type="text" value={newLeagueName} onChange={(e) => setNewLeagueName(e.target.value)}
                className={inputCls} placeholder="z.B. WM 2026 Friends Liga"
                style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
            </div>

            {/* Liga-Typ: Liga vs WM */}
            <div className="mb-4">
              <label className="text-[9px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--color-muted)" }}>Liga-Typ</label>
              <div className="flex gap-2">
                {[
                  { id: "liga", label: "⚽ Saison-Liga", desc: "Bundesliga, PL, La Liga…" },
                  { id: "wm",   label: "🏆 WM 2026",    desc: "Turnier-Modus · 11. Juni" },
                ].map((m) => (
                  <button key={m.id} onClick={() => setLeagueMode(m.id as any)}
                    className="flex-1 p-3 rounded-xl text-left transition-all"
                    style={{
                      border: `1px solid ${leagueMode === m.id ? "var(--color-primary)" : "var(--color-border)"}`,
                      background: leagueMode === m.id ? "var(--bg-elevated)" : "var(--bg-page)",
                    }}>
                    <p className="text-xs font-black" style={{ color: leagueMode === m.id ? "var(--color-primary)" : "var(--color-text)" }}>{m.label}</p>
                    <p className="text-[9px] mt-0.5" style={{ color: "var(--color-muted)" }}>{m.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Scoring-Modus (nur Liga) */}
            {leagueMode === "liga" && (
              <div className="mb-4">
                <label className="text-[9px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--color-muted)" }}>Scoring</label>
                <div className="flex gap-2">
                  {[{ id: "h2h", label: "Head-to-Head", desc: "Wie Sleeper" }, { id: "standard", label: "Gesamtpunkte", desc: "Wie Comunio" }].map((m) => (
                    <button key={m.id} onClick={() => setScoringType(m.id as any)}
                      className="flex-1 p-3 rounded-xl text-left transition-all"
                      style={{
                        border: `1px solid ${scoringType === m.id ? "var(--color-primary)" : "var(--color-border)"}`,
                        background: scoringType === m.id ? "var(--bg-elevated)" : "var(--bg-page)",
                      }}>
                      <p className="text-xs font-black" style={{ color: scoringType === m.id ? "var(--color-primary)" : "var(--color-text)" }}>{m.label}</p>
                      <p className="text-[9px] mt-0.5" style={{ color: "var(--color-muted)" }}>{m.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Teams-Anzahl */}
            <div className="mb-5">
              <label className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                Teams: <span style={{ color: "var(--color-primary)" }}>{maxTeams}</span>
              </label>
              <input type="range" min="4" max={leagueMode === "wm" ? 10 : 12} step="2"
                value={maxTeams} onChange={(e) => setMaxTeams(Number(e.target.value))}
                className="w-full mt-2 accent-[var(--color-primary)]" />
              <div className="flex justify-between text-[9px] mt-1" style={{ color: "var(--color-border)" }}>
                <span>4</span>
                {leagueMode === "wm" ? <><span>6</span><span>8</span><span>10</span></> : <><span>6</span><span>8</span><span>10</span><span>12</span></>}
              </div>
            </div>

            <button onClick={createLeague} disabled={saving || !newLeagueName.trim()}
              className="w-full py-3 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50 transition-opacity"
              style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
              {saving ? "Erstelle..." : `${leagueMode === "wm" ? "WM-Liga" : "Liga"} erstellen`}
            </button>
          </div>

          {/* WM SETTINGS (nur wenn WM-Modus) */}
          {leagueMode === "wm" && (
            <div className="rounded-2xl p-5" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
              <p className="text-[9px] font-black uppercase tracking-widest mb-4" style={{ color: "var(--color-primary)" }}>
                🏆 WM-Modus Einstellungen
              </p>

              {/* Kader-Größe */}
              <div className="mb-4">
                <label className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                  Startelf: <span style={{ color: "var(--color-primary)" }}>{wmSquadSize}</span> · Bank: <span style={{ color: "var(--color-primary)" }}>{wmBenchSize}</span>
                  <span style={{ color: "var(--color-border)" }}> · {wmSquadSize + wmBenchSize} Draftrunden</span>
                </label>
                <div className="flex gap-3 mt-2">
                  <div className="flex-1">
                    <p className="text-[8px] mb-1" style={{ color: "var(--color-muted)" }}>Startelf</p>
                    <input type="range" min="9" max="11" value={wmSquadSize}
                      onChange={(e) => setWmSquadSize(Number(e.target.value))}
                      className="w-full accent-[var(--color-primary)]" />
                    <div className="flex justify-between text-[8px]" style={{ color: "var(--color-border)" }}>
                      <span>9</span><span>10</span><span>11</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="text-[8px] mb-1" style={{ color: "var(--color-muted)" }}>Bank</p>
                    <input type="range" min="0" max="8" value={wmBenchSize}
                      onChange={(e) => setWmBenchSize(Number(e.target.value))}
                      className="w-full accent-[var(--color-primary)]" />
                    <div className="flex justify-between text-[8px]" style={{ color: "var(--color-border)" }}>
                      <span>0</span><span>4</span><span>8</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Formationen */}
              <div className="mb-4">
                <label className="text-[9px] font-black uppercase tracking-widest mb-2 block" style={{ color: "var(--color-muted)" }}>
                  Erlaubte Formationen
                </label>
                <div className="flex flex-wrap gap-2">
                  {FORMATION_KEYS.map(f => (
                    <button key={f}
                      onClick={() => setWmFormations(prev =>
                        prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]
                      )}
                      className="px-3 py-1.5 rounded-lg text-[10px] font-black transition-all"
                      style={{
                        background: wmFormations.includes(f) ? "var(--color-primary)" : "var(--bg-page)",
                        color: wmFormations.includes(f) ? "var(--bg-page)" : "var(--color-muted)",
                        border: `1px solid ${wmFormations.includes(f) ? "var(--color-primary)" : "var(--color-border)"}`,
                      }}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Transfers */}
              <div className="mb-4 p-3 rounded-xl" style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)" }}>
                <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>Transfers (Gruppenphase)</p>
                <label className="flex items-center gap-2 mb-2 cursor-pointer">
                  <input type="checkbox" checked={wmTransfersUnlimited}
                    onChange={e => setWmTransfersUnlimited(e.target.checked)}
                    className="accent-[var(--color-primary)]" />
                  <span className="text-xs font-black" style={{ color: "var(--color-text)" }}>Unlimited Transfers</span>
                </label>
                {!wmTransfersUnlimited && (
                  <div>
                    <label className="text-[9px]" style={{ color: "var(--color-muted)" }}>
                      Max. <span style={{ color: "var(--color-primary)" }}>{wmTransfers}</span> pro Spieltag
                    </label>
                    <input type="range" min="1" max="5" value={wmTransfers}
                      onChange={e => setWmTransfers(Number(e.target.value))}
                      className="w-full mt-1 accent-[var(--color-primary)]" />
                  </div>
                )}
              </div>

              {/* Waiver System */}
              <div className="mb-4 p-3 rounded-xl" style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)" }}>
                <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>Waiver-System (K.O.-Phase ab GW4)</p>

                <div className="flex gap-2 mb-3">
                  {[
                    { id: "priority", label: "Priority", desc: "Inverse Standings" },
                    { id: "budget",   label: "FAAB Budget", desc: "Höchstbietender" },
                  ].map(w => {
                    const active = w.id === "priority" ? wmWaiverPriority : wmWaiverBudget;
                    return (
                      <button key={w.id}
                        onClick={() => {
                          if (w.id === "priority") { setWmWaiverPriority(true); setWmWaiverBudget(false); }
                          else { setWmWaiverPriority(false); setWmWaiverBudget(true); }
                        }}
                        className="flex-1 p-2 rounded-xl text-left transition-all"
                        style={{
                          border: `1px solid ${active ? "var(--color-primary)" : "var(--color-border)"}`,
                          background: active ? "var(--bg-elevated)" : "transparent",
                        }}>
                        <p className="text-[10px] font-black" style={{ color: active ? "var(--color-primary)" : "var(--color-text)" }}>{w.label}</p>
                        <p className="text-[8px]" style={{ color: "var(--color-muted)" }}>{w.desc}</p>
                      </button>
                    );
                  })}
                </div>

                {wmWaiverBudget && (
                  <div className="mb-3">
                    <label className="text-[9px]" style={{ color: "var(--color-muted)" }}>
                      Start-Budget: <span style={{ color: "var(--color-primary)" }}>{wmWaiverBudgetAmount}</span> Bucks
                    </label>
                    <input type="range" min="50" max="500" step="50" value={wmWaiverBudgetAmount}
                      onChange={e => setWmWaiverBudgetAmount(Number(e.target.value))}
                      className="w-full mt-1 accent-[var(--color-primary)]" />
                  </div>
                )}

                <label className="flex items-center gap-2 mb-2 cursor-pointer">
                  <input type="checkbox" checked={wmClaimsLimit}
                    onChange={e => setWmClaimsLimit(e.target.checked)}
                    className="accent-[var(--color-primary)]" />
                  <span className="text-xs font-black" style={{ color: "var(--color-text)" }}>Claims-Limit pro GW</span>
                </label>
                {wmClaimsLimit && (
                  <div>
                    <label className="text-[9px]" style={{ color: "var(--color-muted)" }}>
                      Max. <span style={{ color: "var(--color-primary)" }}>{wmMaxClaims}</span> Claims pro Spieltag
                    </label>
                    <input type="range" min="1" max="5" value={wmMaxClaims}
                      onChange={e => setWmMaxClaims(Number(e.target.value))}
                      className="w-full mt-1 accent-[var(--color-primary)]" />
                  </div>
                )}
              </div>

              {/* Auto-Subs */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={wmAutoSubs}
                  onChange={e => setWmAutoSubs(e.target.checked)}
                  className="accent-[var(--color-primary)]" />
                <div>
                  <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>Automatische Substitutionen</p>
                  <p className="text-[9px]" style={{ color: "var(--color-muted)" }}>
                    Spieler ausgeschiedener Nationen werden automatisch durch Bankspieler ersetzt
                  </p>
                </div>
              </label>
            </div>
          )}
        </div>
      )}

      {/* JOIN */}
      {view === "join" && (
        <div className="w-full max-w-md rounded-2xl p-5"
          style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
          <h2 className="font-black text-base mb-1" style={{ color: "var(--color-text)" }}>Liga beitreten</h2>
          <p className="text-xs mb-5" style={{ color: "var(--color-muted)" }}>Gib den Invite-Code deines Liga-Erstellers ein.</p>

          <div className="mb-6">
            <label className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Invite-Code</label>
            <input type="text" value={joinCode} onChange={(e) => setJoinCode(e.target.value)}
              className={`${inputCls} font-mono tracking-widest uppercase`}
              placeholder="z.B. a3f9b2c1"
              style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
          </div>

          <button onClick={joinLeague} disabled={saving || !joinCode.trim()}
            className="w-full py-3 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50 transition-opacity"
            style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
            {saving ? "Suche Liga..." : "Beitreten"}
          </button>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
