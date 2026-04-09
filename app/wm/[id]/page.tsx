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
      style={{ background: "#0c0900", color: "#2a2010" }}>
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
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "#0c0900" }}>
      {/* Glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "#f5a623" }} />

      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-center mb-5">
        <button onClick={() => window.location.href = `/leagues/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
          ← Liga
        </button>
        <div className="text-center">
          <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>WM 2026</p>
          <p className="text-sm font-black" style={{ color: "#f5a623" }}>{league?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          {league?.owner_id === user?.id && (
            <button onClick={() => window.location.href = `/wm/${leagueId}/admin`}
              className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg"
              style={{ background: "#141008", border: "1px solid #2a2010", color: "#5a4020" }}>
              Admin
            </button>
          )}
          <UserBadge />
        </div>
      </div>

      {/* Status-Card */}
      <div className="w-full max-w-md rounded-2xl p-4 mb-4 flex items-center justify-between"
        style={{ background: "#141008", border: "1px solid #f5a623" }}>
        <div>
          <p className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: "#5a4020" }}>
            {currentGW ? PHASE_LABEL[currentGW.phase] || currentGW.label : "Noch nicht gestartet"}
          </p>
          <p className="text-2xl font-black" style={{ color: "#f5a623" }}>
            {currentGW ? `GW ${currentGW.gameweek}` : "Draft Phase"}
          </p>
          <p className="text-[9px] font-black mt-1" style={{ color: "#5a4020" }}>
            {teams.filter(t => t.user_id).length}/{league?.max_teams} Teams
            · {settings ? `${settings.squad_size}+${settings.bench_size}` : "11"} Spieler
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <button onClick={() => window.location.href = `/wm/${leagueId}/draft`}
            className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest"
            style={{ background: "#f5a623", color: "#0c0900" }}>
            Draft →
          </button>
          <button onClick={() => window.location.href = `/wm/${leagueId}/waiver`}
            className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest"
            style={{ background: "#141008", border: "1px solid #3a2a10", color: "#c8b080" }}>
            Waiver →
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 w-full max-w-md mb-4 p-1 rounded-xl" style={{ background: "#141008", border: "1px solid #2a2010" }}>
        {([
          { id: "standings", label: "Tabelle" },
          { id: "nations",   label: "Nationen" },
          { id: "settings",  label: "Einstellungen" },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex-1 py-2 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all"
            style={{
              background: tab === t.id ? "#f5a623" : "transparent",
              color: tab === t.id ? "#0c0900" : "#5a4020",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* STANDINGS */}
      {tab === "standings" && (
        <div className="w-full max-w-md space-y-2">
          {teams.length === 0 ? (
            <div className="text-center py-12" style={{ color: "#5a4020" }}>
              <p className="text-4xl mb-2">👥</p>
              <p className="text-sm font-black">Noch keine Teams</p>
            </div>
          ) : teams.map((team, i) => (
            <div key={team.id} className="flex items-center justify-between p-4 rounded-2xl"
              style={{
                background: "#141008",
                border: `1px solid ${team.user_id === user?.id ? "#3a2a10" : "#2a2010"}`,
              }}>
              <div className="flex items-center gap-3">
                <span className="font-black text-sm w-5 text-center"
                  style={{ color: i === 0 ? "#f5a623" : i === 1 ? "#c8b080" : i === 2 ? "#a07040" : "#2a2010" }}>
                  {i + 1}
                </span>
                <div>
                  <p className="font-black text-sm"
                    style={{ color: team.user_id === user?.id ? "#f5a623" : "#c8b080" }}>
                    {team.name}
                    {!team.user_id && <span className="ml-1 text-[8px]" style={{ color: "#2a2010" }}>(Bot)</span>}
                  </p>
                  <p className="text-[9px] font-black uppercase tracking-widest mt-0.5" style={{ color: "#5a4020" }}>
                    {team.profiles?.username || (team.user_id ? "—" : "KI")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="font-black text-lg" style={{ color: i === 0 ? "#f5a623" : "#c8b080" }}>
                    {team.total_points?.toFixed(1) || "0.0"}
                  </p>
                  <p className="text-[8px] font-black uppercase" style={{ color: "#2a2010" }}>FPTS</p>
                </div>
                {team.user_id === user?.id && (
                  <button onClick={() => window.location.href = `/wm/${leagueId}/lineup`}
                    className="px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase"
                    style={{ background: "#2a2010", color: "#c8b080" }}>
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
              <p className="text-sm font-black" style={{ color: "#5a4020" }}>Noch keine Nationen geladen</p>
              <p className="text-xs mt-1" style={{ color: "#2a2010" }}>
                Werden nach Bekanntgabe der Gruppen geladen
              </p>
            </div>
          ) : Object.entries(groups).sort().map(([letter, groupNations]) => (
            <div key={letter}>
              <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "#2a2010" }}>
                Gruppe {letter}
              </p>
              <div className="space-y-1.5">
                {groupNations.map(nation => (
                  <div key={nation.id} className="flex items-center justify-between p-3 rounded-xl"
                    style={{
                      background: "#141008",
                      border: `1px solid ${nation.eliminated_after_gameweek ? "#2a1010" : "#2a2010"}`,
                      opacity: nation.eliminated_after_gameweek ? 0.5 : 1,
                    }}>
                    <div className="flex items-center gap-2">
                      {nation.flag_url && (
                        <img src={nation.flag_url} className="w-6 h-4 rounded-sm object-cover" alt="" />
                      )}
                      <p className="font-black text-sm" style={{ color: "#c8b080" }}>{nation.name}</p>
                    </div>
                    {nation.eliminated_after_gameweek ? (
                      <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: "#2a1010", color: "#ff4d6d" }}>
                        Raus GW{nation.eliminated_after_gameweek}
                      </span>
                    ) : (
                      <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: "#0a1a0a", color: "#00ce7d", border: "1px solid #00ce7d40" }}>
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
              style={{ background: "#141008", border: "1px solid #2a2010" }}>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>{label}</p>
              <p className="text-sm font-black" style={{ color: "#c8b080" }}>{value}</p>
            </div>
          ))}
          <div className="p-3 rounded-xl" style={{ background: "#141008", border: "1px solid #2a2010" }}>
            <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "#5a4020" }}>
              Formationen
            </p>
            <div className="flex flex-wrap gap-2">
              {(settings.allowed_formations || []).map(f => (
                <span key={f} className="px-3 py-1 rounded-lg text-[10px] font-black"
                  style={{ background: "#2a2010", color: "#f5a623" }}>
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
