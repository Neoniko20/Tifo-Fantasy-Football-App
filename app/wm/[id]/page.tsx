"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { UserBadge } from "@/app/components/UserBadge";
import { BottomNav } from "@/app/components/BottomNav";
import type { WMNation, WMGameweek, WMLeagueSettings } from "@/lib/wm-types";

const PHASE_LABEL: Record<string, string> = {
  group:        "Gruppenphase",
  round_of_32:  "Sechzehntelfinale",
  round_of_16:  "Achtelfinale",
  quarter:      "Viertelfinale",
  semi:         "Halbfinale",
  final:        "Finale",
};

export default function WMLeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [league, setLeague] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [myTeam, setMyTeam] = useState<any>(null);
  const [settings, setSettings] = useState<WMLeagueSettings | null>(null);
  const [nations, setNations] = useState<WMNation[]>([]);
  const [gameweeks, setGameweeks] = useState<WMGameweek[]>([]);
  const [currentGW, setCurrentGW] = useState<WMGameweek | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"standings" | "nations" | "settings">("standings");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
    });
  }, []);

  async function loadAll(userId: string) {
    // Liga
    const { data: leagueData } = await supabase
      .from("leagues").select("*").eq("id", leagueId).single();
    setLeague(leagueData);

    // Teams
    const { data: teamsData } = await supabase
      .from("teams")
      .select("id, name, user_id, total_points, profiles(username)")
      .eq("league_id", leagueId)
      .order("total_points", { ascending: false });
    setTeams(teamsData || []);

    const myT = (teamsData || []).find((t: any) => t.user_id === userId);
    setMyTeam(myT);

    // WM Settings
    const { data: settingsData } = await supabase
      .from("wm_league_settings")
      .select("*, wm_tournaments(id, name, season, status)")
      .eq("league_id", leagueId)
      .maybeSingle();
    setSettings(settingsData);

    if (settingsData?.tournament_id) {
      // Nations
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

      const active = (gwData || []).find(gw => gw.status === "active")
        || (gwData || [])[0];
      setCurrentGW(active || null);
    }

    setLoading(false);
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center text-[9px] font-black uppercase tracking-widest animate-pulse"
      style={{ background: "var(--bg-page)", color: "var(--color-border)" }}>
      Lade WM-Liga...
    </main>
  );

  const hasDraft = false; // TODO: check if draft_session exists

  // Gruppen aufteilen
  const groups = nations.reduce((acc, n) => {
    const g = n.group_letter || "?";
    if (!acc[g]) acc[g] = [];
    acc[g].push(n);
    return acc;
  }, {} as Record<string, WMNation[]>);

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "var(--bg-page)" }}>
      {/* Glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "var(--color-primary)" }} />

      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-center mb-5">
        <button onClick={() => window.location.href = `/leagues/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          ← Liga
        </button>
        <div className="text-center">
          <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>WM 2026</p>
          <p className="text-sm font-black" style={{ color: "var(--color-primary)" }}>{league?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          {league?.owner_id === user?.id && (
            <button onClick={() => window.location.href = `/wm/${leagueId}/admin`}
              className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg"
              style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}>
              Admin
            </button>
          )}
          <UserBadge />
        </div>
      </div>

      {/* Status-Card */}
      <div className="w-full max-w-md rounded-2xl p-4 mb-4 flex items-center justify-between"
        style={{ background: "var(--bg-card)", border: "1px solid var(--color-primary)" }}>
        <div>
          <p className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: "var(--color-muted)" }}>
            {currentGW ? PHASE_LABEL[currentGW.phase] || currentGW.label : "Noch nicht gestartet"}
          </p>
          <p className="text-2xl font-black" style={{ color: "var(--color-primary)" }}>
            {currentGW ? `GW ${currentGW.gameweek}` : "Draft Phase"}
          </p>
          <p className="text-[9px] font-black mt-1" style={{ color: "var(--color-muted)" }}>
            {teams.filter(t => t.user_id).length}/{league?.max_teams} Teams
            · {settings ? `${settings.squad_size}+${settings.bench_size}` : "11"} Spieler
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <button onClick={() => window.location.href = `/wm/${leagueId}/draft`}
            className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest"
            style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
            Draft →
          </button>
          <button onClick={() => window.location.href = `/wm/${leagueId}/waiver`}
            className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest"
            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border-subtle)", color: "var(--color-text)" }}>
            Waiver →
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 w-full max-w-md mb-4 p-1 rounded-xl" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
        {([
          { id: "standings", label: "Tabelle" },
          { id: "nations",   label: "Nationen" },
          { id: "settings",  label: "Einstellungen" },
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

      {/* STANDINGS */}
      {tab === "standings" && (
        <div className="w-full max-w-md space-y-2">
          {teams.length === 0 ? (
            <div className="text-center py-12" style={{ color: "var(--color-muted)" }}>
              <p className="text-4xl mb-2">👥</p>
              <p className="text-sm font-black">Noch keine Teams</p>
            </div>
          ) : teams.map((team, i) => (
            <div key={team.id} className="flex items-center justify-between p-4 rounded-2xl"
              style={{
                background: "var(--bg-card)",
                border: `1px solid ${team.user_id === user?.id ? "var(--color-border-subtle)" : "var(--color-border)"}`,
              }}>
              <div className="flex items-center gap-3">
                <span className="font-black text-sm w-5 text-center"
                  style={{ color: i === 0 ? "var(--color-primary)" : i === 1 ? "var(--color-text)" : i === 2 ? "#a07040" : "var(--color-border)" }}>
                  {i + 1}
                </span>
                <div>
                  <p className="font-black text-sm"
                    style={{ color: team.user_id === user?.id ? "var(--color-primary)" : "var(--color-text)" }}>
                    {team.name}
                    {!team.user_id && <span className="ml-1 text-[8px]" style={{ color: "var(--color-border)" }}>(Bot)</span>}
                  </p>
                  <p className="text-[9px] font-black uppercase tracking-widest mt-0.5" style={{ color: "var(--color-muted)" }}>
                    {team.profiles?.username || (team.user_id ? "—" : "KI")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="font-black text-lg" style={{ color: i === 0 ? "var(--color-primary)" : "var(--color-text)" }}>
                    {team.total_points?.toFixed(1) || "0.0"}
                  </p>
                  <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-border)" }}>FPTS</p>
                </div>
                {team.user_id === user?.id && (
                  <button onClick={() => window.location.href = `/wm/${leagueId}/lineup`}
                    className="px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase"
                    style={{ background: "var(--color-border)", color: "var(--color-text)" }}>
                    Aufst. →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* NATIONS */}
      {tab === "nations" && (
        <div className="w-full max-w-md space-y-4">
          {Object.keys(groups).length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-2">🌍</p>
              <p className="text-sm font-black" style={{ color: "var(--color-muted)" }}>Noch keine Nationen geladen</p>
              <p className="text-xs mt-1" style={{ color: "var(--color-border)" }}>
                Werden nach Bekanntgabe der Gruppen geladen
              </p>
            </div>
          ) : Object.entries(groups).sort().map(([letter, groupNations]) => (
            <div key={letter}>
              <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-border)" }}>
                Gruppe {letter}
              </p>
              <div className="space-y-1.5">
                {groupNations.map(nation => (
                  <div key={nation.id} className="flex items-center justify-between p-3 rounded-xl"
                    style={{
                      background: "var(--bg-card)",
                      border: `1px solid ${nation.eliminated_after_gameweek ? "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))" : "var(--color-border)"}`,
                      opacity: nation.eliminated_after_gameweek ? 0.5 : 1,
                    }}>
                    <div className="flex items-center gap-2">
                      {nation.flag_url && (
                        <img src={nation.flag_url} className="w-6 h-4 rounded-sm object-cover" alt="" />
                      )}
                      <p className="font-black text-sm" style={{ color: "var(--color-text)" }}>{nation.name}</p>
                    </div>
                    {nation.eliminated_after_gameweek ? (
                      <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))", color: "var(--color-error)" }}>
                        Raus GW{nation.eliminated_after_gameweek}
                      </span>
                    ) : (
                      <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))", color: "var(--color-success)", border: "1px solid var(--color-success)40" }}>
                        Aktiv
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SETTINGS */}
      {tab === "settings" && settings && (
        <div className="w-full max-w-md space-y-3">
          {[
            { label: "Startelf", value: `${settings.squad_size} Spieler` },
            { label: "Bank", value: `${settings.bench_size} Spieler` },
            { label: "Draftrunden", value: settings.squad_size + settings.bench_size },
            { label: "Transfers/GW", value: settings.transfers_unlimited ? "Unlimited" : settings.transfers_per_gameweek },
            { label: "Waiver-System", value: settings.waiver_budget_enabled ? "FAAB Budget" : "Priority" },
            { label: "Waiver startet", value: `GW ${settings.waiver_mode_starts_gameweek}` },
            { label: "Claims/GW", value: settings.waiver_claims_limit_enabled ? settings.waiver_max_claims_per_gameweek : "Unlimited" },
            { label: "Auto-Subs", value: settings.auto_subs_enabled ? "An" : "Aus" },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between p-3 rounded-xl"
              style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>{label}</p>
              <p className="text-sm font-black" style={{ color: "var(--color-text)" }}>{value}</p>
            </div>
          ))}
          <div className="p-3 rounded-xl" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>
              Formationen
            </p>
            <div className="flex flex-wrap gap-2">
              {(settings.allowed_formations || []).map(f => (
                <span key={f} className="px-3 py-1 rounded-lg text-[10px] font-black"
                  style={{ background: "var(--color-border)", color: "var(--color-primary)" }}>
                  {f}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
