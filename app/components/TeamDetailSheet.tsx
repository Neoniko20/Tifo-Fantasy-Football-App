"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { PlayerCard } from "@/app/components/PlayerCard";
import { Spinner } from "@/app/components/ui/Spinner";
import { EmptyState } from "@/app/components/ui/EmptyState";
import tsdbClubs from "@/lib/tsdb-clubs.json";

// ── Helpers ───────────────────────────────────────────────────

const clubAsset = (teamName: string) => (tsdbClubs as Record<string, any>)[teamName] || null;

const POS_COLOR: Record<string, string> = {
  GK: "var(--color-primary)", DF: "var(--color-info)", MF: "var(--color-success)", FW: "var(--color-error)",
};
const POS_ORDER: Record<string, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };

// ── Types ─────────────────────────────────────────────────────

type Player = {
  id: number;
  name: string;
  photo_url: string;
  position: string;
  team_name: string;
  api_team_id?: number;
  fpts: number;
};

// ── Props ─────────────────────────────────────────────────────

export interface TeamDetailSheetProps {
  team:      any | null;
  leagueId:  string;
  user:      any;
  isH2H:    boolean;
  onClose:  () => void;
  onOpenDM?: (otherUserId: string, teamName: string) => void;
  isWm?:    boolean;
}

// ── Component ─────────────────────────────────────────────────

export function TeamDetailSheet({ team, leagueId, user, isH2H, onClose, onOpenDM, isWm = false }: TeamDetailSheetProps) {
  // ── Squad state ──────────────────────────────────────────────
  const [teamSquad,     setTeamSquad]     = useState<Player[]>([]);
  const [teamLineup,    setTeamLineup]    = useState<(Player | null)[]>([]);
  const [teamFormation, setTeamFormation] = useState("");
  const [loadingTeam,   setLoadingTeam]   = useState(false);

  // ── Player overlay state ─────────────────────────────────────
  const [selectedPlayer,       setSelectedPlayer]       = useState<Player | null>(null);
  const [playerDetail,         setPlayerDetail]         = useState<any>(null);
  const [playerOwner,          setPlayerOwner]          = useState<any>(null);
  const [playerGameLog,        setPlayerGameLog]        = useState<any[]>([]);
  const [playerHistory,        setPlayerHistory]        = useState<any[]>([]);
  const [playerNews,           setPlayerNews]           = useState<any[]>([]);
  const [playerNewsLoading,    setPlayerNewsLoading]    = useState(false);
  const [playerDetailLoading,  setPlayerDetailLoading]  = useState(false);
  const [playerTab,            setPlayerTab]            = useState<"summary" | "gamelog" | "history" | "news">("summary");
  const [tsdbPlayer,           setTsdbPlayer]           = useState<any>(null);

  // ── Load squad when team changes ─────────────────────────────
  useEffect(() => {
    if (!team) {
      setTeamSquad([]); setTeamLineup([]); setTeamFormation("");
      setSelectedPlayer(null);
      return;
    }
    let alive = true;
    (async () => {
      setLoadingTeam(true);
      setTeamSquad([]); setTeamLineup([]); setTeamFormation("");

      let playerIds: number[] = [];
      const { data: squadRows } = await supabase
        .from("squad_players").select("player_id").eq("team_id", team.id);
      if (squadRows && squadRows.length > 0) {
        playerIds = squadRows.map((r: any) => r.player_id);
      } else {
        const { data: pickRows } = await supabase
          .from("draft_picks").select("player_id").eq("team_id", team.id);
        playerIds = (pickRows || []).map((r: any) => r.player_id);
      }

      if (!alive) return;

      if (playerIds.length > 0) {
        const { data: playersData } = await supabase
          .from("players")
          .select("id, name, photo_url, position, team_name, api_team_id, fpts")
          .in("id", playerIds);
        if (!alive) return;

        const squad = (playersData || []) as Player[];
        setTeamSquad(squad.sort((a, b) =>
          (POS_ORDER[a.position] ?? 4) - (POS_ORDER[b.position] ?? 4) || b.fpts - a.fpts
        ));

        const { data: gwData } = await supabase
          .from("liga_gameweeks").select("gameweek")
          .eq("league_id", leagueId).order("gameweek", { ascending: false }).limit(1);
        const latestGW = gwData?.[0]?.gameweek || 1;

        let lineupData: any = null;
        const { data: ld1, error: le1 } = await supabase
          .from("liga_lineups").select("lineup_json, formation")
          .eq("team_id", team.id).eq("gameweek", latestGW).maybeSingle();
        if (!le1) {
          lineupData = ld1;
        } else {
          const { data: ld2 } = await supabase
            .from("liga_lineups").select("lineup_json")
            .eq("team_id", team.id).eq("gameweek", latestGW).maybeSingle();
          lineupData = ld2;
        }

        if (alive && lineupData?.lineup_json) {
          try {
            const parsed: (number | null)[] = JSON.parse(lineupData.lineup_json);
            const squadMap = new Map(squad.map(p => [p.id, p]));
            setTeamLineup(parsed.map(id => (id ? squadMap.get(id) || null : null)));
            setTeamFormation(lineupData.formation || "");
          } catch {}
        }
      }

      if (alive) setLoadingTeam(false);
    })();
    return () => { alive = false; };
  }, [team?.id, leagueId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load player detail when overlay opens ────────────────────
  useEffect(() => {
    if (!selectedPlayer) {
      setPlayerDetail(null); setPlayerGameLog([]); setPlayerHistory([]);
      setPlayerNews([]); setTsdbPlayer(null);
      return;
    }
    setPlayerTab("summary");
    setPlayerDetailLoading(true);
    setPlayerOwner(null);
    setTsdbPlayer(null);

    loadPlayerDetail(selectedPlayer.id);
    fetch(`/api/tsdb-player?name=${encodeURIComponent(selectedPlayer.name)}&team=${encodeURIComponent(selectedPlayer.team_name || "")}`)
      .then(r => r.json())
      .then(d => setTsdbPlayer(d))
      .catch(() => {});
  }, [selectedPlayer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadPlayerDetail(pid: number) {
    const { data: p } = await supabase.from("players").select("*").eq("id", pid).single();
    setPlayerDetail(p);

    const { data: leagueTeams } = await supabase.from("teams").select("id, name, user_id").eq("league_id", leagueId);
    const leagueTeamIds = (leagueTeams || []).map((t: any) => t.id);
    if (leagueTeamIds.length > 0) {
      const { data: pick } = await supabase.from("draft_picks").select("team_id").in("team_id", leagueTeamIds).eq("player_id", pid).maybeSingle();
      if (pick) setPlayerOwner((leagueTeams || []).find((t: any) => t.id === pick.team_id) || null);
      else {
        const { data: sp } = await supabase.from("squad_players").select("team_id").in("team_id", leagueTeamIds).eq("player_id", pid).maybeSingle();
        if (sp) setPlayerOwner((leagueTeams || []).find((t: any) => t.id === sp.team_id) || null);
      }
    }

    const { data: gwPts } = await supabase.from("liga_gameweek_points").select("*").eq("league_id", leagueId).eq("player_id", pid).order("gameweek");
    setPlayerGameLog(gwPts || []);

    const hist: any[] = [];
    const { data: dp } = leagueTeamIds.length > 0
      ? await supabase.from("draft_picks").select("pick_number, round, created_at, teams(name)").in("team_id", leagueTeamIds).eq("player_id", pid).maybeSingle()
      : { data: null };
    if (dp) hist.push({ type: "draft", date: dp.created_at, team: (dp as any).teams?.name, detail: `Pick ${dp.pick_number} · Runde ${dp.round}` });
    const { data: txs } = await supabase.from("liga_transfers").select("id, team_id, player_in_id, player_out_id, created_at").eq("league_id", leagueId).or(`player_in_id.eq.${pid},player_out_id.eq.${pid}`).order("created_at");
    for (const t of (txs || [])) {
      const tm = (leagueTeams || []).find((x: any) => x.id === t.team_id);
      hist.push({ type: t.player_in_id === pid ? "transfer_in" : "transfer_out", date: t.created_at, team: tm?.name || "Unbekannt", detail: t.player_in_id === pid ? "Verpflichtet (Transfer)" : "Entlassen (Transfer)" });
    }
    hist.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    setPlayerHistory(hist);
    setPlayerDetailLoading(false);

    if (p?.name) {
      setPlayerNewsLoading(true);
      fetch(`/api/player-news?name=${encodeURIComponent(p.name)}`)
        .then(r => r.json()).then(d => { setPlayerNews(d.items || []); setPlayerNewsLoading(false); })
        .catch(() => setPlayerNewsLoading(false));
    }
  }

  if (!team) return null;

  const isMineTeam = team.user_id === user?.id;

  // ── Team sheet ───────────────────────────────────────────────
  const starters   = teamLineup.filter((p): p is Player => p !== null);
  const hasLineup  = starters.length > 0;
  const starterIds = new Set(starters.map(p => p.id));
  const bench      = teamSquad.filter(p => !starterIds.has(p.id));

  // ── Derived squad stats (no extra query) ────────────────────
  const topPlayer = teamSquad.length > 0
    ? teamSquad.reduce((best, p) => (p.fpts ?? 0) > (best.fpts ?? 0) ? p : best, teamSquad[0])
    : null;

  const posCounts = teamSquad.reduce<Record<string, number>>((acc, p) => {
    const lbl = ({ GK: "TW", DF: "AB", MF: "MF", FW: "ST" } as Record<string, string>)[p.position] ?? p.position;
    acc[lbl] = (acc[lbl] ?? 0) + 1;
    return acc;
  }, {});

  const rank    = team?.rank    ?? team?.standing ?? null;
  const gwScore = team?.gw_score ?? team?.current_gw_score ?? null;

  const renderPlayer = (p: Player, keyPrefix: string) => (
    <button
      key={`${keyPrefix}-${p.id}`}
      onClick={() => setSelectedPlayer(p)}
      className="w-full flex items-center gap-3 px-5 py-3 text-left transition-transform duration-100 active:scale-[0.97]"
      style={{ borderBottom: "1px solid var(--bg-elevated)" }}>
      <span className="text-[8px] font-black w-7 text-center flex-shrink-0 py-1 rounded"
        style={{ background: `${POS_COLOR[p.position] || "var(--color-border)"}20`, color: POS_COLOR[p.position] || "var(--color-muted)" }}>
        {p.position}
      </span>
      <PlayerCard player={p} posColor={POS_COLOR[p.position] || "var(--color-border)"} size={40} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-black truncate" style={{ color: "var(--color-text)" }}>{p.name}</p>
        <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
          <span style={{ color: POS_COLOR[p.position] }}>{p.position}</span>
          {" · "}{p.team_name}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-black" style={{ color: "var(--color-text)" }}>{(p.fpts ?? 0).toFixed(1)}</p>
        <p className="text-[7px] uppercase" style={{ color: "var(--color-border)" }}>FPTS</p>
      </div>
    </button>
  );

  return (
    <>
      {/* Team sheet backdrop */}
      <div className="tifo-backdrop-in fixed inset-0 z-50 flex items-end justify-center"
        style={{ background: "rgba(0,0,0,0.8)" }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="tifo-sheet-in w-full max-w-md rounded-t-3xl flex flex-col"
          style={{ background: "var(--bg-page)", maxHeight: "90vh" }}>

          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-10 h-1 rounded-full" style={{ background: "var(--color-border)" }} />
          </div>

          {/* Header */}
          <div className="flex items-center gap-3 px-5 pt-2 pb-4 flex-shrink-0">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--bg-elevated)", border: "2px solid var(--color-border)" }}>
              <span className="text-lg font-black" style={{ color: "var(--color-primary)" }}>
                {team.name?.[0]?.toUpperCase() || "T"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-base leading-tight truncate" style={{ color: "var(--color-text)" }}>
                {team.name}
              </p>
              <p className="text-[9px] font-black uppercase tracking-widest mt-0.5" style={{ color: "var(--color-muted)" }}>
                {isH2H
                  ? `${team.wins ?? 0}-${team.losses ?? 0}${(team.draws ?? 0) > 0 ? `-${team.draws}` : ""}`
                  : `${(team.total_points ?? 0).toFixed(1)} FPTS`
                }
              </p>
            </div>
            <button onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0"
              style={{ color: "var(--color-muted)", background: "var(--bg-elevated)" }}>✕</button>
          </div>

          {/* Status panel */}
          <div className="flex gap-2 px-5 pb-3 flex-wrap flex-shrink-0">
            {([
              rank != null           && { label: "Rang",   value: `#${rank}`,                                  color: "var(--color-primary)" },
              !isH2H && team.total_points != null && { label: "Gesamt", value: `${(team.total_points as number).toFixed(1)}`, color: "var(--color-text)" },
              gwScore != null        && { label: "GW",     value: `${(gwScore as number).toFixed(1)}`,          color: "var(--color-success)" },
              !loadingTeam && teamSquad.length > 0 && { label: "Kader", value: `${teamSquad.length}`,          color: "var(--color-muted)" },
            ] as const).filter(Boolean).map((item: any) => (
              <div key={item.label} className="flex flex-col items-center px-3 py-1.5 rounded-xl"
                style={{ background: "var(--bg-elevated)" }}>
                <p className="text-[6px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>
                  {item.label}
                </p>
                <p className="text-[12px] font-black leading-tight" style={{ color: item.color }}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          {/* Action buttons (only for other teams) */}
          {!isMineTeam && (
            <div className="flex gap-2 px-5 pb-4 flex-shrink-0">
              {/* Trade — primary CTA (Liga only, not WM) */}
              {!isWm && (
                <a
                  href={`/leagues/${leagueId}/trades?receiverTeamId=${team.id}`}
                  className="flex-1 flex flex-col items-center justify-center py-2 rounded-xl transition-opacity active:opacity-80"
                  style={{ background: "var(--color-primary)", border: "1px solid var(--color-primary)" }}
                >
                  <span className="text-base leading-none" style={{ color: "var(--bg-page)" }}>⇄</span>
                  <span className="text-[7px] font-black uppercase tracking-wider mt-0.5" style={{ color: "var(--bg-page)" }}>
                    Trade mit
                  </span>
                  <span className="text-[6px] font-black truncate max-w-[70px] px-1" style={{ color: "rgba(0,0,0,0.55)" }}>
                    {team.name}
                  </span>
                </a>
              )}
              {/* Trans. (Liga) / Waiver (WM) */}
              {isWm ? (
                <a
                  href={`/wm/${leagueId}/waiver`}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest"
                  style={{ background: "var(--bg-elevated)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
                >
                  <span>📋</span>Waiver
                </a>
              ) : (
                <button
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest"
                  style={{ background: "var(--bg-elevated)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
                >
                  <span>📋</span>Trans.
                </button>
              )}

              {/* Chat — only show for real users (not bots) and not for your own team */}
              {team.user_id && team.user_id !== user?.id && onOpenDM && (
                <button
                  onClick={() => onOpenDM(team.user_id, team.name)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest"
                  style={{ background: "var(--bg-elevated)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
                >
                  <span>💬</span>Chat
                </button>
              )}
            </div>
          )}

          <div style={{ borderTop: "1px solid var(--bg-elevated)" }} />

          {/* Squad */}
          {loadingTeam ? (
            <div className="flex-1 flex items-center justify-center">
              <Spinner text="Lade Kader..." />
            </div>
          ) : teamSquad.length === 0 ? (
            <EmptyState icon="👥" title="Kein Kader vorhanden" />
          ) : (
            <div className="overflow-y-auto flex-1 pb-6 overscroll-y-contain" style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
              {/* Top-Spieler + Positionsverteilung */}
              {topPlayer && (
                <div className="mx-5 mt-3 mb-1 px-3 py-2 rounded-xl flex items-center justify-between gap-2"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                  <div>
                    <p className="text-[6px] font-black uppercase tracking-widest mb-0.5" style={{ color: "var(--color-border)" }}>
                      Top-Spieler
                    </p>
                    <p className="text-[11px] font-black leading-tight" style={{ color: "var(--color-text)" }}>
                      <span style={{ color: "var(--color-primary)" }}>★ </span>
                      {topPlayer.name}
                    </p>
                    <p className="text-[9px] font-black" style={{ color: "var(--color-primary)" }}>
                      {(topPlayer.fpts ?? 0).toFixed(1)} FPTS
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 items-end flex-shrink-0">
                    {(["TW", "AB", "MF", "ST"] as const).map(lbl => {
                      const count = posCounts[lbl] ?? 0;
                      return count > 0 ? (
                        <span key={lbl} className="text-[7px] font-black px-2 py-0.5 rounded-lg w-12 text-center"
                          style={{ background: "var(--bg-elevated)", color: "var(--color-muted)" }}>
                          {lbl} {count}
                        </span>
                      ) : null;
                    })}
                  </div>
                </div>
              )}
              {hasLineup ? (
                <>
                  <div className="px-5 pt-2 pb-2">
                    <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>
                      Startelf {teamFormation && <span style={{ color: "var(--color-primary)" }}>· {teamFormation}</span>}
                    </p>
                  </div>
                  {starters.map(p => renderPlayer(p, "s"))}
                  {bench.length > 0 && (
                    <>
                      <div className="px-5 pt-5 pb-2">
                        <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>
                          Bank · {bench.length}
                        </p>
                      </div>
                      {bench.map(p => renderPlayer(p, "b"))}
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="px-5 pt-4 pb-2">
                    <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-border-subtle)" }}>
                      Kader · {teamSquad.length} Spieler
                    </p>
                  </div>
                  {teamSquad.map(p => renderPlayer(p, "k"))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Player overlay (z-60 — above team sheet) */}
      {selectedPlayer && (() => {
        const posColor  = POS_COLOR[selectedPlayer.position] || "var(--color-text)";
        const seasonPts = playerGameLog.reduce((s, g) => s + (g.points || 0), 0);
        const avgPts    = playerGameLog.length > 0 ? seasonPts / playerGameLog.length : 0;
        const isMine    = playerOwner?.user_id === user?.id;
        const formatD   = (d: string) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
        const club      = clubAsset(selectedPlayer.team_name);
        const c1        = club?.colour1 || null;
        const heroBg    = c1
          ? `linear-gradient(160deg, ${c1}22 0%, ${posColor}12 50%, transparent 80%)`
          : `linear-gradient(160deg, ${posColor}18 0%, transparent 60%)`;
        const photoSrc  = tsdbPlayer?.cutout || tsdbPlayer?.render || selectedPlayer.photo_url || "/player-placeholder.png";
        const isCutout  = !!(tsdbPlayer?.cutout || tsdbPlayer?.render);

        return (
          <div className="tifo-backdrop-in fixed inset-0 flex items-end justify-center"
            style={{ zIndex: 60, background: "rgba(0,0,0,0.6)" }}
            onClick={e => { if (e.target === e.currentTarget) setSelectedPlayer(null); }}>
            <div className="tifo-sheet-in w-full max-w-md rounded-t-3xl flex flex-col"
              style={{ background: "var(--bg-page)", maxHeight: "90vh" }}>

              <div className="flex justify-center pt-3 pb-0 flex-shrink-0">
                <div className="w-10 h-1 rounded-full" style={{ background: "var(--color-border)" }} />
              </div>

              {/* Hero */}
              <div className="relative flex gap-4 px-5 pt-2 pb-3 flex-shrink-0" style={{ background: heroBg }}>
                {club?.fanart1 && (
                  <div className="absolute inset-0 overflow-hidden rounded-none opacity-5 pointer-events-none">
                    <img src={club.fanart1} alt="" className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="relative flex-shrink-0" style={{ width: 88, height: 88 }}>
                  <img
                    src={photoSrc}
                    alt={selectedPlayer.name}
                    className={`w-full h-full object-contain ${isCutout ? "" : "rounded-2xl"}`}
                    style={isCutout ? { filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.6))" } : { border: `2px solid ${posColor}60` }}
                  />
                </div>
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {club?.badge && (
                      <img src={club.badge} alt={selectedPlayer.team_name} className="w-4 h-4 object-contain flex-shrink-0" />
                    )}
                    <p className="text-[8px] font-black uppercase tracking-widest truncate" style={{ color: c1 || "var(--color-muted)" }}>
                      {selectedPlayer.team_name}
                    </p>
                  </div>
                  <p className="text-xl font-black leading-tight" style={{ color: "var(--color-text)" }}>
                    {selectedPlayer.name}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[8px] font-black px-2 py-0.5 rounded"
                      style={{ background: posColor, color: "var(--bg-page)" }}>
                      {selectedPlayer.position}
                    </span>
                    {(playerDetail?.nationality || tsdbPlayer?.nationality) && (
                      <span className="text-[8px] font-black uppercase" style={{ color: "var(--color-border-subtle)" }}>
                        {playerDetail?.nationality || tsdbPlayer?.nationality}
                      </span>
                    )}
                    {club?.kit && (
                      <img src={club.kit} alt="kit" className="h-5 object-contain opacity-70" />
                    )}
                  </div>
                </div>
                <button onClick={() => setSelectedPlayer(null)}
                  className="absolute top-3 right-4 w-7 h-7 flex items-center justify-center rounded-full z-10"
                  style={{ background: "var(--bg-elevated)", color: "var(--color-muted)" }}>✕</button>
              </div>

              {/* Owner band */}
              <div className="mx-5 mb-3 px-3 py-2 rounded-xl flex items-center justify-between flex-shrink-0"
                style={{ background: "var(--bg-card)", border: `1px solid ${playerOwner ? (isMine ? "var(--color-primary)40" : "var(--color-border)") : "var(--color-success)30"}` }}>
                {playerOwner ? (
                  <>
                    <div>
                      <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>Besitzer</p>
                      <p className="text-xs font-black" style={{ color: isMine ? "var(--color-primary)" : "var(--color-text)" }}>
                        {playerOwner.name} {isMine && "· Mein Team"}
                      </p>
                    </div>
                    {!isMine && !isWm && (
                      <a href={`/leagues/${leagueId}/trades?receiverTeamId=${playerOwner.id}&requestPlayerId=${selectedPlayer.id}`}
                        className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase"
                        style={{ background: "color-mix(in srgb, var(--color-primary) 15%, var(--bg-page))", color: "var(--color-primary)", border: "1px solid var(--color-primary)30" }}>
                        Trade anfragen
                      </a>
                    )}
                    {isMine && (
                      <a href={isWm ? `/wm/${leagueId}/waiver` : `/leagues/${leagueId}/transfers`}
                        className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase"
                        style={{ background: "var(--bg-card)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>
                        {isWm ? "Waiver" : "Transfer"}
                      </a>
                    )}
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>Status</p>
                      <p className="text-xs font-black" style={{ color: "var(--color-success)" }}>Freier Spieler</p>
                    </div>
                    <a href={isWm ? `/wm/${leagueId}/waiver` : `/leagues/${leagueId}/transfers`}
                      className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase"
                      style={{ background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))", color: "var(--color-success)", border: "1px solid var(--color-success)30" }}>
                      {isWm ? "Waiver" : "Verpflichten"}
                    </a>
                  </>
                )}
              </div>

              {/* Tabs */}
              <div className="flex border-b flex-shrink-0" style={{ borderColor: "var(--bg-elevated)" }}>
                {(["summary", "gamelog", "history", "news"] as const).map(t => (
                  <button key={t} onClick={() => setPlayerTab(t)}
                    className="flex-1 py-2.5 text-[8px] font-black uppercase tracking-widest transition-all active:scale-[0.97]"
                    style={{
                      color: playerTab === t ? posColor : "var(--color-border)",
                      borderBottom: playerTab === t ? `2px solid ${posColor}` : "2px solid transparent",
                    }}>
                    {t === "summary" ? "Übersicht" : t === "gamelog" ? "Log" : t === "history" ? "Historie" : "News"}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="overflow-y-auto flex-1 pb-6 overscroll-y-contain" style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
                {playerDetailLoading ? (
                  <Spinner text="Lade..." />
                ) : (
                  <>
                    {playerTab === "summary" && (
                      <div className="p-4 space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: "Saison-Pts", value: seasonPts.toFixed(1), hi: true },
                            { label: "Ø / GW",     value: avgPts.toFixed(1) },
                            { label: "Einsätze",   value: playerGameLog.length },
                            { label: "Tore",       value: playerGameLog.reduce((s, g) => s + (g.goals || 0), 0) },
                            { label: "Assists",    value: playerGameLog.reduce((s, g) => s + (g.assists || 0), 0) },
                            { label: "Minuten",    value: playerGameLog.reduce((s, g) => s + (g.minutes || 0), 0) },
                          ].map(({ label, value, hi }) => (
                            <div key={label} className="p-3 rounded-xl text-center"
                              style={{ background: "var(--bg-card)", border: `1px solid ${hi ? posColor + "40" : "var(--color-border)"}` }}>
                              <p className="text-lg font-black" style={{ color: hi ? posColor : "var(--color-text)" }}>{value}</p>
                              <p className="text-[7px] font-black uppercase tracking-widest mt-0.5" style={{ color: "var(--color-border)" }}>{label}</p>
                            </div>
                          ))}
                        </div>
                        <div className="rounded-xl p-3" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                          <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-border)" }}>
                            Saison-Statistiken
                          </p>
                          <div className="grid grid-cols-2 gap-y-2">
                            {[
                              ["Schüsse aufs Tor", playerGameLog.reduce((s,g)=>s+(g.shots_on||0),0)],
                              ["Key Passes",       playerGameLog.reduce((s,g)=>s+(g.key_passes||0),0)],
                              ["Tackles",          playerGameLog.reduce((s,g)=>s+(g.tackles||0),0)],
                              ["Abfangen",         playerGameLog.reduce((s,g)=>s+(g.interceptions||0),0)],
                              ["Gelbe Karten",     playerGameLog.reduce((s,g)=>s+(g.yellow_cards||0),0)],
                              ["Rote Karten",      playerGameLog.reduce((s,g)=>s+(g.red_cards||0),0)],
                              ...(selectedPlayer.position === "GK" ? [["Paraden", playerGameLog.reduce((s,g)=>s+(g.saves||0),0)]] : []),
                              ["Clean Sheets",     playerGameLog.filter(g=>g.clean_sheet).length],
                            ].map(([label, val]) => (
                              <div key={String(label)} className="flex items-center justify-between">
                                <span className="text-[9px]" style={{ color: "var(--color-muted)" }}>{label}</span>
                                <span className="text-sm font-black" style={{ color: "var(--color-text)" }}>{val}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {playerTab === "gamelog" && (
                      <div className="p-4 space-y-2">
                        {playerGameLog.length === 0 ? (
                          <EmptyState icon="📊" title="Noch keine Spieltag-Daten" />
                        ) : playerGameLog.map(g => (
                          <div key={g.id} className="rounded-xl overflow-hidden"
                            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                            <div className="px-3 py-1.5 flex items-center justify-between"
                              style={{ borderBottom: "1px solid var(--bg-elevated)" }}>
                              <span className="text-[9px] font-black" style={{ color: posColor }}>GW{g.gameweek}</span>
                              <span className="text-sm font-black" style={{ color: posColor }}>{g.points?.toFixed(1) || "0.0"} Pts</span>
                            </div>
                            <div className="grid grid-cols-5 gap-1 px-3 py-2">
                              {[["TOR",g.goals||0],["ASS",g.assists||0],["MIN",g.minutes||0],["CS",g.clean_sheet?"✓":"—"],["KP",g.key_passes||0]].map(([l,v]) => (
                                <div key={String(l)} className="text-center">
                                  <p className="text-[7px] uppercase" style={{ color: "var(--color-border)" }}>{l}</p>
                                  <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>{v}</p>
                                </div>
                              ))}
                            </div>
                            {g.is_captain && (
                              <div className="px-3 pb-2">
                                <span className="text-[7px] font-black px-2 py-0.5 rounded-full"
                                  style={{ background: "var(--color-primary)20", color: "var(--color-primary)" }}>C Kapitän ×2</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {playerTab === "history" && (
                      <div className="p-4">
                        {playerHistory.length === 0 ? (
                          <EmptyState icon="📋" title="Keine Historie vorhanden" />
                        ) : (
                          <div className="relative pl-5">
                            <div className="absolute left-2 top-2 bottom-2 w-px" style={{ background: "var(--color-border)" }} />
                            {playerHistory.map((h, i) => {
                              const hColor = ({ draft: "var(--color-primary)", transfer_in: "var(--color-success)", transfer_out: "var(--color-error)", trade: "var(--color-info)" } as Record<string,string>)[h.type] || "var(--color-text)";
                              const hIcon  = ({ draft: "🏈", transfer_in: "▲", transfer_out: "▼", trade: "⇄" } as Record<string,string>)[h.type] || "·";
                              return (
                                <div key={i} className="relative mb-3">
                                  <div className="absolute -left-3 top-3 w-2.5 h-2.5 rounded-full" style={{ background: hColor }} />
                                  <div className="p-3 rounded-xl ml-2" style={{ background: "var(--bg-card)", border: `1px solid ${hColor}25` }}>
                                    <div className="flex items-center justify-between mb-0.5">
                                      <span className="text-[9px] font-black uppercase" style={{ color: hColor }}>{hIcon} {h.detail}</span>
                                      <span className="text-[7px]" style={{ color: "var(--color-border)" }}>{formatD(h.date)}</span>
                                    </div>
                                    <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>{h.team}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {playerTab === "news" && (
                      <div className="p-4 space-y-2">
                        {playerNewsLoading ? (
                          <Spinner text="Lade News..." />
                        ) : playerNews.length === 0 ? (
                          <EmptyState icon="📰" title="Keine News gefunden"
                            action={
                              !isWm ? (
                                <a href={`/leagues/${leagueId}/players/${selectedPlayer.id}`}
                                  className="inline-block mt-1 px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest"
                                  style={{ background: "var(--bg-card)", color: "var(--color-primary)", border: "1px solid var(--color-primary)30" }}>
                                  Vollständiges Profil →
                                </a>
                              ) : undefined
                            }
                          />
                        ) : playerNews.slice(0, 5).map((n: any, i: number) => (
                          <a key={i} href={n.link || "#"} target="_blank" rel="noopener noreferrer"
                            className="block p-3 rounded-xl transition-opacity hover:opacity-80"
                            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                            <p className="text-xs font-black leading-snug" style={{ color: "var(--color-text)" }}>{n.title}</p>
                            {n.pubDate && (
                              <p className="text-[7px] font-black uppercase mt-1" style={{ color: "var(--color-border-subtle)" }}>
                                {new Date(n.pubDate).toLocaleDateString("de-DE", { day: "2-digit", month: "short" })}
                              </p>
                            )}
                          </a>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
