"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/app/components/ui/Spinner";
import { calculateWMGameweekPoints } from "@/lib/wm-points";
import type { WMNation, WMGameweek, WMLeagueSettings } from "@/lib/wm-types";
import type { GWStats } from "@/lib/wm-points";
import { useToast } from "@/app/components/ToastProvider";

const PHASE_LABEL: Record<string, string> = {
  group:        "Gruppenphase",
  round_of_32:  "Sechzehntelfinale",
  round_of_16:  "Achtelfinale",
  quarter:      "Viertelfinale",
  semi:         "Halbfinale",
  final:        "Finale",
};

const EMPTY_STATS: Omit<GWStats, "position"> = {
  goals: 0, assists: 0, minutes: 0, shots_on: 0, key_passes: 0,
  pass_accuracy: 0, dribbles: 0, tackles: 0, interceptions: 0,
  saves: 0, clean_sheet: false, yellow_cards: 0, red_cards: 0,
};

type PlayerWithStats = {
  id: number;
  name: string;
  position: string;
  team_name: string;
  stats: Omit<GWStats, "position">;
};

export default function WMAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [user, setUser] = useState<any>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [league, setLeague] = useState<any>(null);
  const [settings, setSettings] = useState<WMLeagueSettings | null>(null);
  const [gameweeks, setGameweeks] = useState<WMGameweek[]>([]);
  const [nations, setNations] = useState<WMNation[]>([]);
  const [selectedGW, setSelectedGW] = useState<number>(1);
  const [squadPlayers, setSquadPlayers] = useState<any[]>([]);
  const [playerStats, setPlayerStats] = useState<Record<number, Omit<GWStats, "position">>>({});
  const [saving, setSaving] = useState(false);
  const [processingWaivers, setProcessingWaivers] = useState(false);
  const [tab, setTab] = useState<"points" | "nations" | "gameweeks">("points");
  const { toast } = useToast();
  const [eliminateNation, setEliminateNation] = useState<string>("");
  const [tournament, setTournament] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
    });
  }, []);

  async function loadAll(userId: string) {
    const { data: leagueData } = await supabase
      .from("leagues").select("*").eq("id", leagueId).single();
    setLeague(leagueData);

    if (leagueData?.owner_id !== userId) {
      setIsOwner(false);
      setLoading(false);
      return;
    }
    setIsOwner(true);

    const { data: settingsData } = await supabase
      .from("wm_league_settings")
      .select("*, wm_tournaments(id, name, status, start_date, end_date)")
      .eq("league_id", leagueId)
      .maybeSingle();
    setSettings(settingsData);
    if (settingsData?.wm_tournaments) setTournament(settingsData.wm_tournaments);

    if (settingsData?.tournament_id) {
      const { data: gws } = await supabase
        .from("wm_gameweeks")
        .select("*")
        .eq("tournament_id", settingsData.tournament_id)
        .order("gameweek");
      setGameweeks(gws || []);

      const active = (gws || []).find(g => g.status === "active");
      if (active) setSelectedGW(active.gameweek);

      const { data: nationsData } = await supabase
        .from("wm_nations")
        .select("*")
        .eq("tournament_id", settingsData.tournament_id)
        .order("group_letter");
      setNations(nationsData || []);
    }

    // Alle Spieler aus allen Teams der Liga laden
    const { data: teamsData } = await supabase
      .from("teams").select("id").eq("league_id", leagueId);
    const teamIds = (teamsData || []).map((t: any) => t.id);

    if (teamIds.length > 0) {
      const { data: picks } = await supabase
        .from("squad_players")
        .select("player_id, players(id, name, position, team_name)")
        .in("team_id", teamIds);

      // De-duplizieren (gleicher Spieler in mehreren Teams)
      const seen = new Set<number>();
      const unique: any[] = [];
      for (const p of (picks || [])) {
        if (!seen.has(p.player_id)) {
          seen.add(p.player_id);
          unique.push(p);
        }
      }
      setSquadPlayers(unique);

      // Stats-Defaults laden (falls bereits eingetragen)
      const playerIds = unique.map((p: any) => p.player_id);
      if (playerIds.length > 0) {
        const { data: existingStats } = await supabase
          .from("wm_gameweek_points")
          .select("player_id, goals, assists, minutes, shots_on, key_passes, pass_accuracy, dribbles, tackles, interceptions, saves, clean_sheet, yellow_cards, red_cards")
          .eq("gameweek", selectedGW)
          .in("player_id", playerIds);

        const statsMap: Record<number, Omit<GWStats, "position">> = {};
        for (const s of (existingStats || [])) {
          statsMap[s.player_id] = {
            goals: s.goals || 0, assists: s.assists || 0, minutes: s.minutes || 0,
            shots_on: s.shots_on || 0, key_passes: s.key_passes || 0,
            pass_accuracy: s.pass_accuracy || 0, dribbles: s.dribbles || 0,
            tackles: s.tackles || 0, interceptions: s.interceptions || 0,
            saves: s.saves || 0, clean_sheet: s.clean_sheet || false,
            yellow_cards: s.yellow_cards || 0, red_cards: s.red_cards || 0,
          };
        }
        setPlayerStats(statsMap);
      }
    }

    setLoading(false);
  }

  function getStat(playerId: number): Omit<GWStats, "position"> {
    return playerStats[playerId] || { ...EMPTY_STATS };
  }

  function updateStat(playerId: number, field: keyof Omit<GWStats, "position">, value: number | boolean) {
    setPlayerStats(prev => ({
      ...prev,
      [playerId]: { ...getStat(playerId), [field]: value },
    }));
  }

  async function savePoints() {
    setSaving(true);
    try {
      // Alle Teams der Liga
      const { data: teamsData } = await supabase
        .from("teams").select("id").eq("league_id", leagueId);
      const teamIds = (teamsData || []).map((t: any) => t.id);

      for (const teamId of teamIds) {
        // Lineup für diesen GW laden
        const { data: lineup } = await supabase
          .from("team_lineups")
          .select("starting_xi, bench, captain_id, vice_captain_id, formation")
          .eq("team_id", teamId)
          .eq("gameweek", selectedGW)
          .maybeSingle();

        const xi: number[] = lineup?.starting_xi || [];
        const captainId: number | null = lineup?.captain_id || null;

        let teamGWPoints = 0;

        for (const playerId of xi) {
          const stats = getStat(playerId);
          const player = squadPlayers.find(p => p.player_id === playerId)?.players;
          if (!player) continue;

          // Nation des Spielers finden
          const playerNation = nations.find(n => n.name === player.team_name);

          const result = calculateWMGameweekPoints(
            { ...stats, position: player.position },
            playerNation || null,
            selectedGW,
            playerId === captainId
          );

          // In DB speichern
          await supabase.from("wm_gameweek_points").upsert({
            team_id: teamId,
            player_id: playerId,
            gameweek: selectedGW,
            points: result.points,
            nation_active: result.nation_active,
            is_captain: playerId === captainId,
            ...stats,
          }, { onConflict: "team_id,player_id,gameweek" });

          teamGWPoints += result.points;
        }

        // Team-Gesamtpunkte aktualisieren
        const { data: allPoints } = await supabase
          .from("wm_gameweek_points")
          .select("points")
          .eq("team_id", teamId);
        const total = (allPoints || []).reduce((s: number, r: any) => s + (r.points || 0), 0);
        await supabase.from("teams").update({ total_points: Math.round(total * 10) / 10 }).eq("id", teamId);
      }

      toast(`GW ${selectedGW} Punkte gespeichert!`, "success");
    } catch (e: any) {
      toast("Fehler: " + e.message, "error");
    }
    setSaving(false);
  }

  async function markEliminatedNation() {
    if (!eliminateNation) return;
    await supabase
      .from("wm_nations")
      .update({ eliminated_after_gameweek: selectedGW })
      .eq("id", eliminateNation);
    // Lokal aktualisieren
    setNations(prev => prev.map(n =>
      n.id === eliminateNation ? { ...n, eliminated_after_gameweek: selectedGW } : n
    ));
    setEliminateNation("");
  }

  async function processWaivers(gwNum: number) {
    if (processingWaivers) return;
    setProcessingWaivers(true);
    try {
      const res = await fetch("/api/process-waivers-wm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId, gameweek: gwNum }),
      });
      const data = await res.json();
      if (data.ok) {
        toast(`Waivers verarbeitet: ${data.approved} genehmigt, ${data.rejected} abgelehnt`, "success");
      } else {
        toast("Fehler: " + (data.error || "Unbekannt"), "error");
      }
    } catch (e: any) {
      toast("Fehler: " + e.message, "error");
    }
    setProcessingWaivers(false);
  }

  async function updateGameweekStatus(gwNum: number, status: "upcoming" | "active" | "finished") {
    const gw = gameweeks.find(g => g.gameweek === gwNum);
    if (!gw) return;
    await supabase.from("wm_gameweeks").update({ status }).eq("id", gw.id);
    setGameweeks(prev => prev.map(g => g.gameweek === gwNum ? { ...g, status } : g));

    if (status === "active" || status === "finished") {
      const event = status === "active" ? "gw_started" : "gw_finished";
      const title = status === "active" ? `▶ WM GW ${gwNum} gestartet` : `■ WM GW ${gwNum} beendet`;
      const body = status === "active" ? "Die WM-Spieltag-Wertung läuft!" : "Der WM-Spieltag ist abgeschlossen.";
      fetch("/api/notifications/push-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, gwId: gw.id, payload: { title, body, link: `/wm/${leagueId}` } }),
      }).catch((err) => console.warn("[push-dispatch] WM GW push failed:", err));
    }
  }

  async function updateTournamentStatus(status: "upcoming" | "active" | "finished") {
    if (!settings?.tournament_id) return;
    const { error } = await supabase
      .from("wm_tournaments")
      .update({ status })
      .eq("id", settings.tournament_id);
    if (error) { toast("Fehler: " + error.message, "error"); return; }
    setTournament((prev: any) => ({ ...prev, status }));
    toast(
      status === "active" ? "Turnier gestartet" : status === "finished" ? "Turnier beendet" : "Turnier zurückgesetzt",
      status === "finished" ? "success" : "info"
    );
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <Spinner text="Lade Admin..." />
    </main>
  );

  if (!isOwner) return (
    <main className="flex min-h-screen items-center justify-center flex-col gap-4"
      style={{ background: "var(--bg-page)" }}>
      <p className="text-sm font-black" style={{ color: "var(--color-error)" }}>Kein Zugriff</p>
      <button onClick={() => window.location.href = `/wm/${leagueId}`}
        className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
        ← Zurück
      </button>
    </main>
  );

  const activeNations = nations.filter(n => !n.eliminated_after_gameweek);

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-12" style={{ background: "var(--bg-page)" }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "var(--color-primary)" }} />

      {/* Header */}
      <div className="w-full max-w-xl flex justify-between items-center mb-5">
        <button onClick={() => window.location.href = `/wm/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          ← WM
        </button>
        <div className="text-center">
          <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Admin</p>
          <p className="text-sm font-black" style={{ color: "var(--color-primary)" }}>{league?.name}</p>
        </div>
        <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
          style={{ background: "color-mix(in srgb, var(--color-primary) 10%, var(--bg-page))", border: "1px solid var(--color-primary)", color: "var(--color-primary)" }}>
          Liga-Owner
        </span>
      </div>

      {/* GW Selector */}
      <div className="w-full max-w-xl mb-4">
        <p className="text-[8px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>
          Spieltag
        </p>
        <div className="flex gap-2 flex-wrap">
          {gameweeks.map(gw => (
            <button key={gw.gameweek} onClick={() => setSelectedGW(gw.gameweek)}
              className="px-3 py-2 rounded-xl text-[10px] font-black transition-all"
              style={{
                background: selectedGW === gw.gameweek ? "var(--color-primary)" : "var(--bg-card)",
                color: selectedGW === gw.gameweek ? "var(--bg-page)" : "var(--color-muted)",
                border: `1px solid ${selectedGW === gw.gameweek ? "var(--color-primary)" : gw.status === "active" ? "var(--color-border-subtle)" : "var(--color-border)"}`,
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

      {/* Tabs */}
      <div className="flex gap-1 w-full max-w-xl mb-4 p-1 rounded-xl" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
        {([
          { id: "points",    label: "Punkte eintragen" },
          { id: "nations",   label: "Ausscheidungen" },
          { id: "gameweeks", label: "GW-Status" },
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

      {/* PUNKTE EINTRAGEN */}
      {tab === "points" && (
        <div className="w-full max-w-xl">
          <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
            GW{selectedGW} · {squadPlayers.length} Spieler im Pool
          </p>
          <div className="space-y-2 mb-4">
            {squadPlayers.map(({ player_id, players: p }) => {
              if (!p) return null;
              const s = getStat(player_id);
              const nation = nations.find(n => n.name === p.team_name);
              const isElim = nation?.eliminated_after_gameweek && selectedGW > nation.eliminated_after_gameweek;
              return (
                <div key={player_id} className="rounded-xl p-3"
                  style={{
                    background: "var(--bg-card)",
                    border: `1px solid ${isElim ? "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))" : "var(--color-border)"}`,
                    opacity: isElim ? 0.5 : 1,
                  }}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-black text-sm" style={{ color: isElim ? "var(--color-muted)" : "var(--color-text)" }}>{p.name}</p>
                      <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                        {p.position} · {p.team_name}
                        {isElim && <span style={{ color: "var(--color-error)" }}> · AUSGESCHIEDEN</span>}
                      </p>
                    </div>
                    {isElim ? (
                      <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))", color: "var(--color-error)" }}>0 Pts</span>
                    ) : (
                      <span className="text-sm font-black" style={{ color: "var(--color-primary)" }}>
                        {calculateWMGameweekPoints({ ...s, position: p.position }, nation || null, selectedGW).points.toFixed(1)}
                      </span>
                    )}
                  </div>
                  {!isElim && (
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { key: "minutes",  label: "Min", type: "number" },
                        { key: "goals",    label: "Tore", type: "number" },
                        { key: "assists",  label: "Assists", type: "number" },
                        { key: "shots_on", label: "Schüsse", type: "number" },
                        { key: "key_passes",   label: "KeyPass", type: "number" },
                        { key: "tackles",      label: "Tackles", type: "number" },
                        { key: "interceptions",label: "Int.", type: "number" },
                        { key: "saves",        label: "Saves", type: "number" },
                        { key: "yellow_cards", label: "Gelb", type: "number" },
                        { key: "red_cards",    label: "Rot", type: "number" },
                        { key: "dribbles",     label: "Dribbl.", type: "number" },
                        { key: "pass_accuracy",label: "Pass%", type: "number" },
                      ].map(({ key, label, type }) => (
                        <div key={key}>
                          <p className="text-[7px] font-black uppercase mb-0.5" style={{ color: "var(--color-border)" }}>{label}</p>
                          <input
                            type={type}
                            value={s[key as keyof typeof s] as number}
                            min={0}
                            max={key === "pass_accuracy" ? 100 : undefined}
                            onChange={e => updateStat(player_id, key as keyof Omit<GWStats, "position">, Number(e.target.value))}
                            className="w-full p-1 rounded text-xs text-center font-black focus:outline-none"
                            style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                          />
                        </div>
                      ))}
                      <div className="col-span-4 flex items-center gap-2 mt-1">
                        <input
                          type="checkbox"
                          id={`cs-${player_id}`}
                          checked={s.clean_sheet}
                          onChange={e => updateStat(player_id, "clean_sheet", e.target.checked)}
                          className="w-4 h-4"
                        />
                        <label htmlFor={`cs-${player_id}`} className="text-[9px] font-black uppercase"
                          style={{ color: "var(--color-muted)" }}>
                          Clean Sheet
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button onClick={savePoints} disabled={saving}
            className="w-full py-4 rounded-xl text-sm font-black uppercase tracking-widest transition-all"
            style={{
              background: saving ? "var(--color-border)" : "var(--color-primary)",
              color: saving ? "var(--color-muted)" : "var(--bg-page)",
            }}>
            {saving ? "Speichern..." : `GW${selectedGW} Punkte berechnen & speichern`}
          </button>
        </div>
      )}

      {/* AUSSCHEIDUNGEN */}
      {tab === "nations" && (
        <div className="w-full max-w-xl space-y-3">
          <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
              Nation nach GW{selectedGW} ausscheiden lassen
            </p>
            <select
              value={eliminateNation}
              onChange={e => setEliminateNation(e.target.value)}
              className="w-full p-2 rounded-lg text-sm font-black focus:outline-none mb-3"
              style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}>
              <option value="">Nation wählen...</option>
              {activeNations.map(n => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
            <button onClick={markEliminatedNation} disabled={!eliminateNation}
              className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest"
              style={{
                background: eliminateNation ? "var(--color-error)" : "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))",
                color: eliminateNation ? "var(--color-text)" : "var(--color-muted)",
              }}>
              Nach GW{selectedGW} ausscheiden
            </button>
          </div>

          <div className="space-y-1.5">
            {nations.map(n => (
              <div key={n.id} className="flex items-center justify-between p-3 rounded-xl"
                style={{
                  background: "var(--bg-card)",
                  border: `1px solid ${n.eliminated_after_gameweek ? "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))" : "var(--color-border)"}`,
                  opacity: n.eliminated_after_gameweek ? 0.6 : 1,
                }}>
                <p className="font-black text-sm" style={{ color: "var(--color-text)" }}>{n.name}</p>
                {n.eliminated_after_gameweek ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
                      style={{ background: "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))", color: "var(--color-error)" }}>
                      Raus nach GW{n.eliminated_after_gameweek}
                    </span>
                    <button onClick={async () => {
                      await supabase.from("wm_nations")
                        .update({ eliminated_after_gameweek: null })
                        .eq("id", n.id);
                      setNations(prev => prev.map(x => x.id === n.id ? { ...x, eliminated_after_gameweek: null } : x));
                    }} className="text-[8px] font-black" style={{ color: "var(--color-muted)" }}>✕</button>
                  </div>
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
      )}

      {/* GW-STATUS */}
      {tab === "gameweeks" && (
        <div className="w-full max-w-xl space-y-2">
          {gameweeks.map(gw => (
            <div key={gw.gameweek} className="flex items-center justify-between p-4 rounded-xl"
              style={{ background: "var(--bg-card)", border: `1px solid ${gw.status === "active" ? "var(--color-border-subtle)" : "var(--color-border)"}` }}>
              <div>
                <p className="font-black text-sm" style={{ color: "var(--color-text)" }}>
                  GW{gw.gameweek}
                  {gw.label && <span className="ml-2 text-[9px]" style={{ color: "var(--color-muted)" }}>{gw.label}</span>}
                </p>
                <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                  {PHASE_LABEL[gw.phase] || gw.phase}
                </p>
              </div>
              <div className="flex flex-col gap-1.5 items-end">
                <div className="flex gap-1.5">
                  {(["upcoming", "active", "finished"] as const).map(s => (
                    <button key={s} onClick={() => updateGameweekStatus(gw.gameweek, s)}
                      className="px-2.5 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all"
                      style={{
                        background: gw.status === s
                          ? s === "active" ? "var(--color-primary)" : s === "finished" ? "var(--color-success)" : "var(--color-border)"
                          : "var(--bg-page)",
                        color: gw.status === s
                          ? s === "active" ? "var(--bg-page)" : s === "finished" ? "var(--bg-page)" : "var(--color-text)"
                          : "var(--color-muted)",
                        border: `1px solid ${gw.status === s ? "transparent" : "var(--color-border)"}`,
                      }}>
                      {s === "upcoming" ? "Bald" : s === "active" ? "Aktiv" : "Fertig"}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => processWaivers(gw.gameweek)}
                  disabled={processingWaivers}
                  className="px-2.5 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all disabled:opacity-50"
                  style={{
                    background: "color-mix(in srgb, var(--color-info) 15%, var(--bg-page))",
                    color: "var(--color-info)",
                    border: "1px solid var(--color-info)40",
                  }}>
                  {processingWaivers ? "..." : "Waivers ▶"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TURNIER-LIFECYCLE */}
      {tab === "gameweeks" && tournament && (
        <div className="w-full max-w-xl mt-4">
          <p className="text-[8px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>
            Turnier-Status
          </p>
          <div className="flex items-center justify-between p-4 rounded-xl"
            style={{ background: "var(--bg-card)", border: `1px solid ${tournament.status === "active" ? "var(--color-primary)" : tournament.status === "finished" ? "var(--color-success)" : "var(--color-border)"}` }}>
            <div>
              <p className="font-black text-sm" style={{ color: "var(--color-text)" }}>{tournament.name}</p>
              <p className="text-[8px] font-black uppercase mt-0.5"
                style={{ color: tournament.status === "active" ? "var(--color-primary)" : tournament.status === "finished" ? "var(--color-success)" : "var(--color-muted)" }}>
                {tournament.status === "active" ? "● Aktiv" : tournament.status === "finished" ? "✓ Beendet" : "○ Geplant"}
              </p>
            </div>
            <div className="flex gap-1.5">
              {(["upcoming", "active", "finished"] as const).map(s => (
                <button key={s} onClick={() => updateTournamentStatus(s)}
                  disabled={tournament.status === s}
                  className="px-2.5 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all disabled:opacity-40"
                  style={{
                    background: tournament.status === s
                      ? s === "active" ? "var(--color-primary)" : s === "finished" ? "var(--color-success)" : "var(--color-border)"
                      : "var(--bg-page)",
                    color: tournament.status === s
                      ? s === "active" || s === "finished" ? "var(--bg-page)" : "var(--color-text)"
                      : "var(--color-muted)",
                    border: `1px solid ${tournament.status === s ? "transparent" : "var(--color-border)"}`,
                  }}>
                  {s === "upcoming" ? "Geplant" : s === "active" ? "Starten" : "Beenden"}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
