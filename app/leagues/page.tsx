"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { UserBadge } from "@/app/components/UserBadge";
import { BottomNav } from "@/app/components/BottomNav";
import { DEFAULT_WM_SETTINGS } from "@/lib/wm-types";
import { FORMATION_KEYS } from "@/lib/wm-formations";
import { useToast } from "@/app/components/ToastProvider";

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

const inputCls = "w-full mt-1 p-3 rounded-xl text-sm focus:outline-none focus:border-[#f5a623] transition-colors";

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

  async function createLeague() {
    if (!newLeagueName.trim()) return;
    setSaving(true);

    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const { data: league, error } = await supabase
      .from("leagues")
      .insert({
        name: newLeagueName.trim(),
        owner_id: user.id,
        max_teams: maxTeams,
        scoring_type: scoringType,
        status: "setup",
        mode: leagueMode,
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
    if (leagueMode === "wm") {
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
    setSaving(true);

    const { data: league } = await supabase
      .from("leagues")
      .select("*")
      .eq("invite_code", joinCode.trim().toLowerCase())
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
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "#0c0900" }}>
      {/* Glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "#f5a623" }} />

      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-center mb-6">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: "#5a4020" }}>Fantasy Football</p>
          <h1 className="text-xl font-black" style={{ color: "#f5a623" }}>LIGA</h1>
        </div>
        <UserBadge />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 w-full max-w-md mb-5 p-1 rounded-xl" style={{ background: "#141008", border: "1px solid #2a2010" }}>
        {[{ id: "overview", label: "Übersicht" }, { id: "create", label: "Erstellen" }, { id: "join", label: "Beitreten" }].map((t) => (
          <button key={t.id} onClick={() => { setView(t.id as any); }}
            className="flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all"
            style={{
              background: view === t.id ? "#f5a623" : "transparent",
              color: view === t.id ? "#0c0900" : "#5a4020",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {view === "overview" && (
        <div className="w-full max-w-md space-y-3">
          {loading ? (
            <div className="text-center py-20 text-[9px] font-black uppercase tracking-widest animate-pulse"
              style={{ color: "#2a2010" }}>Lade Ligen...</div>
          ) : leagues.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-4xl mb-3">🏆</p>
              <p className="text-sm font-black mb-1" style={{ color: "#5a4020" }}>Noch keine Ligen.</p>
              <p className="text-xs mb-5" style={{ color: "#2a2010" }}>Erstelle deine erste Liga oder tritt einer bei.</p>
              <button onClick={() => setView("create")}
                className="px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest"
                style={{ background: "#f5a623", color: "#0c0900" }}>
                Erste Liga erstellen
              </button>
            </div>
          ) : (
            leagues.map((league) => (
              <div key={league.id} className="rounded-2xl p-4"
                style={{ background: "#141008", border: "1px solid #2a2010" }}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-black text-base" style={{ color: "#c8b080" }}>{league.name}</h3>
                    <div className="flex gap-2 mt-1">
                      <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                        style={{
                          background: league.status === "active" ? "#1a1a08" : "#141008",
                          color: league.status === "active" ? "#f5a623" : "#5a4020",
                          border: `1px solid ${league.status === "active" ? "#f5a623" : "#2a2010"}`,
                        }}>
                        {statusLabel(league.status)}
                      </span>
                      <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                        style={{ background: "#141008", border: "1px solid #2a2010", color: "#5a4020" }}>
                        {league.scoring_type === "h2h" ? "H2H" : "Gesamtpkt."}
                      </span>
                    </div>
                  </div>
                  <span className="text-[9px] font-black" style={{ color: "#5a4020" }}>{league.max_teams} Teams</span>
                </div>

                {league.owner_id === user?.id && (
                  <div className="flex items-center gap-3 rounded-xl p-3 mb-3"
                    style={{ background: "#0c0900", border: "1px solid #2a2010" }}>
                    <div className="flex-1">
                      <p className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: "#5a4020" }}>Invite-Code</p>
                      <p className="font-black tracking-widest text-sm" style={{ color: "#f5a623" }}>{league.invite_code}</p>
                    </div>
                    <button onClick={() => copyCode(league.invite_code)}
                      className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-colors"
                      style={{ background: "#2a2010", color: copiedCode === league.invite_code ? "#f5a623" : "#c8b080" }}>
                      {copiedCode === league.invite_code ? "✓ Kopiert" : "Kopieren"}
                    </button>
                  </div>
                )}

                <button onClick={() => window.location.href = `/leagues/${league.id}`}
                  className="w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
                  style={{ background: "#2a2010", color: "#c8b080" }}>
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
          <div className="rounded-2xl p-5" style={{ background: "#141008", border: "1px solid #2a2010" }}>
            <h2 className="font-black text-base mb-5" style={{ color: "#c8b080" }}>Neue Liga erstellen</h2>

            {/* Liga-Name */}
            <div className="mb-4">
              <label className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>Liga-Name</label>
              <input type="text" value={newLeagueName} onChange={(e) => setNewLeagueName(e.target.value)}
                className={inputCls} placeholder="z.B. WM 2026 Friends Liga"
                style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }} />
            </div>

            {/* Liga-Typ: Liga vs WM */}
            <div className="mb-4">
              <label className="text-[9px] font-black uppercase tracking-widest mb-2 block" style={{ color: "#5a4020" }}>Liga-Typ</label>
              <div className="flex gap-2">
                {[
                  { id: "liga", label: "⚽ Saison-Liga", desc: "Bundesliga, PL, La Liga…" },
                  { id: "wm",   label: "🏆 WM 2026",    desc: "Turnier-Modus · 11. Juni" },
                ].map((m) => (
                  <button key={m.id} onClick={() => setLeagueMode(m.id as any)}
                    className="flex-1 p-3 rounded-xl text-left transition-all"
                    style={{
                      border: `1px solid ${leagueMode === m.id ? "#f5a623" : "#2a2010"}`,
                      background: leagueMode === m.id ? "#1a1208" : "#0c0900",
                    }}>
                    <p className="text-xs font-black" style={{ color: leagueMode === m.id ? "#f5a623" : "#c8b080" }}>{m.label}</p>
                    <p className="text-[9px] mt-0.5" style={{ color: "#5a4020" }}>{m.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Scoring-Modus (nur Liga) */}
            {leagueMode === "liga" && (
              <div className="mb-4">
                <label className="text-[9px] font-black uppercase tracking-widest mb-2 block" style={{ color: "#5a4020" }}>Scoring</label>
                <div className="flex gap-2">
                  {[{ id: "h2h", label: "Head-to-Head", desc: "Wie Sleeper" }, { id: "standard", label: "Gesamtpunkte", desc: "Wie Comunio" }].map((m) => (
                    <button key={m.id} onClick={() => setScoringType(m.id as any)}
                      className="flex-1 p-3 rounded-xl text-left transition-all"
                      style={{
                        border: `1px solid ${scoringType === m.id ? "#f5a623" : "#2a2010"}`,
                        background: scoringType === m.id ? "#1a1208" : "#0c0900",
                      }}>
                      <p className="text-xs font-black" style={{ color: scoringType === m.id ? "#f5a623" : "#c8b080" }}>{m.label}</p>
                      <p className="text-[9px] mt-0.5" style={{ color: "#5a4020" }}>{m.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Teams-Anzahl */}
            <div className="mb-5">
              <label className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
                Teams: <span style={{ color: "#f5a623" }}>{maxTeams}</span>
              </label>
              <input type="range" min="4" max={leagueMode === "wm" ? 10 : 12} step="2"
                value={maxTeams} onChange={(e) => setMaxTeams(Number(e.target.value))}
                className="w-full mt-2 accent-[#f5a623]" />
              <div className="flex justify-between text-[9px] mt-1" style={{ color: "#2a2010" }}>
                <span>4</span>
                {leagueMode === "wm" ? <><span>6</span><span>8</span><span>10</span></> : <><span>6</span><span>8</span><span>10</span><span>12</span></>}
              </div>
            </div>

            <button onClick={createLeague} disabled={saving || !newLeagueName.trim()}
              className="w-full py-3 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50 transition-opacity"
              style={{ background: "#f5a623", color: "#0c0900" }}>
              {saving ? "Erstelle..." : `${leagueMode === "wm" ? "WM-Liga" : "Liga"} erstellen`}
            </button>
          </div>

          {/* WM SETTINGS (nur wenn WM-Modus) */}
          {leagueMode === "wm" && (
            <div className="rounded-2xl p-5" style={{ background: "#141008", border: "1px solid #2a2010" }}>
              <p className="text-[9px] font-black uppercase tracking-widest mb-4" style={{ color: "#f5a623" }}>
                🏆 WM-Modus Einstellungen
              </p>

              {/* Kader-Größe */}
              <div className="mb-4">
                <label className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
                  Startelf: <span style={{ color: "#f5a623" }}>{wmSquadSize}</span> · Bank: <span style={{ color: "#f5a623" }}>{wmBenchSize}</span>
                  <span style={{ color: "#2a2010" }}> · {wmSquadSize + wmBenchSize} Draftrunden</span>
                </label>
                <div className="flex gap-3 mt-2">
                  <div className="flex-1">
                    <p className="text-[8px] mb-1" style={{ color: "#5a4020" }}>Startelf</p>
                    <input type="range" min="9" max="11" value={wmSquadSize}
                      onChange={(e) => setWmSquadSize(Number(e.target.value))}
                      className="w-full accent-[#f5a623]" />
                    <div className="flex justify-between text-[8px]" style={{ color: "#2a2010" }}>
                      <span>9</span><span>10</span><span>11</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="text-[8px] mb-1" style={{ color: "#5a4020" }}>Bank</p>
                    <input type="range" min="0" max="8" value={wmBenchSize}
                      onChange={(e) => setWmBenchSize(Number(e.target.value))}
                      className="w-full accent-[#f5a623]" />
                    <div className="flex justify-between text-[8px]" style={{ color: "#2a2010" }}>
                      <span>0</span><span>4</span><span>8</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Formationen */}
              <div className="mb-4">
                <label className="text-[9px] font-black uppercase tracking-widest mb-2 block" style={{ color: "#5a4020" }}>
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
                        background: wmFormations.includes(f) ? "#f5a623" : "#0c0900",
                        color: wmFormations.includes(f) ? "#0c0900" : "#5a4020",
                        border: `1px solid ${wmFormations.includes(f) ? "#f5a623" : "#2a2010"}`,
                      }}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Transfers */}
              <div className="mb-4 p-3 rounded-xl" style={{ background: "#0c0900", border: "1px solid #2a2010" }}>
                <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "#5a4020" }}>Transfers (Gruppenphase)</p>
                <label className="flex items-center gap-2 mb-2 cursor-pointer">
                  <input type="checkbox" checked={wmTransfersUnlimited}
                    onChange={e => setWmTransfersUnlimited(e.target.checked)}
                    className="accent-[#f5a623]" />
                  <span className="text-xs font-black" style={{ color: "#c8b080" }}>Unlimited Transfers</span>
                </label>
                {!wmTransfersUnlimited && (
                  <div>
                    <label className="text-[9px]" style={{ color: "#5a4020" }}>
                      Max. <span style={{ color: "#f5a623" }}>{wmTransfers}</span> pro Spieltag
                    </label>
                    <input type="range" min="1" max="5" value={wmTransfers}
                      onChange={e => setWmTransfers(Number(e.target.value))}
                      className="w-full mt-1 accent-[#f5a623]" />
                  </div>
                )}
              </div>

              {/* Waiver System */}
              <div className="mb-4 p-3 rounded-xl" style={{ background: "#0c0900", border: "1px solid #2a2010" }}>
                <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "#5a4020" }}>Waiver-System (K.O.-Phase ab GW4)</p>

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
                          border: `1px solid ${active ? "#f5a623" : "#2a2010"}`,
                          background: active ? "#1a1208" : "transparent",
                        }}>
                        <p className="text-[10px] font-black" style={{ color: active ? "#f5a623" : "#c8b080" }}>{w.label}</p>
                        <p className="text-[8px]" style={{ color: "#5a4020" }}>{w.desc}</p>
                      </button>
                    );
                  })}
                </div>

                {wmWaiverBudget && (
                  <div className="mb-3">
                    <label className="text-[9px]" style={{ color: "#5a4020" }}>
                      Start-Budget: <span style={{ color: "#f5a623" }}>{wmWaiverBudgetAmount}</span> Bucks
                    </label>
                    <input type="range" min="50" max="500" step="50" value={wmWaiverBudgetAmount}
                      onChange={e => setWmWaiverBudgetAmount(Number(e.target.value))}
                      className="w-full mt-1 accent-[#f5a623]" />
                  </div>
                )}

                <label className="flex items-center gap-2 mb-2 cursor-pointer">
                  <input type="checkbox" checked={wmClaimsLimit}
                    onChange={e => setWmClaimsLimit(e.target.checked)}
                    className="accent-[#f5a623]" />
                  <span className="text-xs font-black" style={{ color: "#c8b080" }}>Claims-Limit pro GW</span>
                </label>
                {wmClaimsLimit && (
                  <div>
                    <label className="text-[9px]" style={{ color: "#5a4020" }}>
                      Max. <span style={{ color: "#f5a623" }}>{wmMaxClaims}</span> Claims pro Spieltag
                    </label>
                    <input type="range" min="1" max="5" value={wmMaxClaims}
                      onChange={e => setWmMaxClaims(Number(e.target.value))}
                      className="w-full mt-1 accent-[#f5a623]" />
                  </div>
                )}
              </div>

              {/* Auto-Subs */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={wmAutoSubs}
                  onChange={e => setWmAutoSubs(e.target.checked)}
                  className="accent-[#f5a623]" />
                <div>
                  <p className="text-xs font-black" style={{ color: "#c8b080" }}>Automatische Substitutionen</p>
                  <p className="text-[9px]" style={{ color: "#5a4020" }}>
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
          style={{ background: "#141008", border: "1px solid #2a2010" }}>
          <h2 className="font-black text-base mb-1" style={{ color: "#c8b080" }}>Liga beitreten</h2>
          <p className="text-xs mb-5" style={{ color: "#5a4020" }}>Gib den Invite-Code deines Liga-Erstellers ein.</p>

          <div className="mb-6">
            <label className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>Invite-Code</label>
            <input type="text" value={joinCode} onChange={(e) => setJoinCode(e.target.value)}
              className={`${inputCls} font-mono tracking-widest uppercase`}
              placeholder="z.B. a3f9b2c1"
              style={{ background: "#0c0900", border: "1px solid #2a2010", color: "#c8b080" }} />
          </div>

          <button onClick={joinLeague} disabled={saving || !joinCode.trim()}
            className="w-full py-3 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50 transition-opacity"
            style={{ background: "#f5a623", color: "#0c0900" }}>
            {saving ? "Suche Liga..." : "Beitreten"}
          </button>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
