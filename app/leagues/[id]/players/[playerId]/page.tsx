"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { BottomNav } from "@/app/components/BottomNav";
import { Spinner } from "@/app/components/ui/Spinner";
import { EmptyState } from "@/app/components/ui/EmptyState";

const POS_COLOR: Record<string, string> = {
  GK: "var(--color-primary)", DF: "var(--color-info)", MF: "var(--color-success)", FW: "var(--color-error)",
};

const STAT_LABELS: { key: string; label: string; short: string }[] = [
  { key: "goals",         label: "Tore",          short: "TOR" },
  { key: "assists",       label: "Assists",        short: "ASS" },
  { key: "minutes",       label: "Minuten",        short: "MIN" },
  { key: "shots_on",      label: "Schüsse aufs Tor", short: "S+T" },
  { key: "key_passes",    label: "Torschussvorlagen", short: "KP" },
  { key: "tackles",       label: "Tackles",        short: "TKL" },
  { key: "interceptions", label: "Abfangen",       short: "INT" },
  { key: "saves",         label: "Paraden",        short: "PAR" },
  { key: "yellow_cards",  label: "Gelbe Karten",   short: "GK" },
  { key: "red_cards",     label: "Rote Karten",    short: "ROT" },
  { key: "clean_sheet",   label: "Clean Sheet",    short: "CS" },
];

export default function PlayerDetailPage({
  params,
}: {
  params: Promise<{ id: string; playerId: string }>;
}) {
  const { id: leagueId, playerId } = React.use(params);

  const [user, setUser]           = useState<any>(null);
  const [player, setPlayer]       = useState<any>(null);
  const [myTeam, setMyTeam]       = useState<any>(null);
  const [ownerTeam, setOwnerTeam] = useState<any>(null);
  const [gameLog, setGameLog]     = useState<any[]>([]);
  const [gameweeks, setGameweeks] = useState<Record<number, any>>({});
  const [history, setHistory]     = useState<any[]>([]);
  const [news, setNews]           = useState<any[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [tab, setTab]             = useState<"summary" | "gamelog" | "history" | "news">("summary");
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
    });
  }, []);

  async function loadAll(userId: string) {
    const pid = Number(playerId);

    // Player
    const { data: p } = await supabase
      .from("players").select("*").eq("id", pid).single();
    setPlayer(p);

    // My team
    const { data: myT } = await supabase
      .from("teams").select("*").eq("league_id", leagueId).eq("user_id", userId).maybeSingle();
    setMyTeam(myT);

    // Wer besitzt diesen Spieler in dieser Liga?
    // draft_picks hat keine league_id — über team_id filtern
    const { data: leagueTeams } = await supabase
      .from("teams").select("id").eq("league_id", leagueId);
    const leagueTeamIds = (leagueTeams || []).map((t: any) => t.id);
    let ownerTeamData = null;
    if (leagueTeamIds.length > 0) {
      const { data: pick } = await supabase
        .from("draft_picks")
        .select("team_id, teams(id, name, user_id, profiles(username))")
        .in("team_id", leagueTeamIds)
        .eq("player_id", pid)
        .maybeSingle();
      ownerTeamData = (pick as any)?.teams || null;
      // Fallback: check squad_players
      if (!ownerTeamData) {
        const { data: sp } = await supabase
          .from("squad_players")
          .select("team_id, teams(id, name, user_id, profiles(username))")
          .in("team_id", leagueTeamIds)
          .eq("player_id", pid)
          .maybeSingle();
        ownerTeamData = (sp as any)?.teams || null;
      }
    }
    setOwnerTeam(ownerTeamData);

    // Gameweeks (für Labels)
    const { data: gwData } = await supabase
      .from("liga_gameweeks").select("gameweek, label, start_date")
      .eq("league_id", leagueId);
    const gwMap: Record<number, any> = {};
    for (const g of (gwData || [])) gwMap[g.gameweek] = g;
    setGameweeks(gwMap);

    // Game Log
    const { data: gwPts } = await supabase
      .from("liga_gameweek_points")
      .select("*")
      .eq("league_id", leagueId)
      .eq("player_id", pid)
      .order("gameweek");
    setGameLog(gwPts || []);

    // History aufbauen
    const histItems: any[] = [];

    // Draft-Pick
    const { data: draftPick } = leagueTeamIds.length > 0 ? await supabase
      .from("draft_picks")
      .select("pick_number, round, created_at, teams(name)")
      .in("team_id", leagueTeamIds)
      .eq("player_id", pid)
      .maybeSingle() : { data: null };
    if (draftPick) {
      histItems.push({
        type: "draft",
        date: draftPick.created_at,
        team: (draftPick as any).teams?.name,
        detail: `Pick ${draftPick.pick_number} · Runde ${draftPick.round}`,
      });
    }

    // Transfers
    const { data: transfers } = await supabase
      .from("liga_transfers")
      .select("*, team:team_id(name)")
      .eq("league_id", leagueId)
      .or(`player_in_id.eq.${pid},player_out_id.eq.${pid}`)
      .order("created_at");
    for (const t of (transfers || [])) {
      histItems.push({
        type: t.player_in_id === pid ? "transfer_in" : "transfer_out",
        date: t.created_at,
        team: (t as any).team?.name,
        detail: t.player_in_id === pid ? "Verpflichtet (Transfer)" : "Entlassen (Transfer)",
      });
    }

    // Trades (falls vorhanden)
    const { data: trades } = await supabase
      .from("liga_trades")
      .select("*")
      .eq("league_id", leagueId)
      .eq("status", "accepted")
      .or(`offer_player_ids.cs.{${pid}},request_player_ids.cs.{${pid}}`);
    for (const t of (trades || [])) {
      histItems.push({
        type: "trade",
        date: t.updated_at,
        team: "Trade",
        detail: "Über Trade gewechselt",
      });
    }

    histItems.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    setHistory(histItems);
    setLoading(false);

    // News separat laden (async, kein Blocking)
    if (p?.name) {
      fetch(`/api/player-news?name=${encodeURIComponent(p.name)}`)
        .then(r => r.json())
        .then(data => { setNews(data.items || []); setNewsLoading(false); })
        .catch(() => setNewsLoading(false));
    } else {
      setNewsLoading(false);
    }
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <Spinner text="Lade Spieler..." />
    </main>
  );

  if (!player) return (
    <main className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-page)", color: "var(--color-muted)" }}>
      Spieler nicht gefunden.
    </main>
  );

  const posColor = POS_COLOR[player.position] || "var(--color-text)";
  const isMine = ownerTeam?.user_id === user?.id;
  const seasonPts = gameLog.reduce((s, g) => s + (g.points || 0), 0);
  const avgPts = gameLog.length > 0 ? seasonPts / gameLog.length : 0;

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });

  const formatNewsDate = (d: string) => {
    try { return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "short" }); }
    catch { return ""; }
  };

  return (
    <main className="flex min-h-screen flex-col items-center pb-28" style={{ background: "var(--bg-page)" }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-96 h-48 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: posColor }} />

      {/* Header mit Spieler-Bild */}
      <div className="w-full max-w-md relative overflow-hidden"
        style={{ background: `linear-gradient(180deg, ${posColor}15 0%, var(--bg-page) 100%)` }}>
        <div className="flex items-end gap-4 p-4 pt-6">
          {/* Zurück */}
          <button onClick={() => window.history.back()}
            className="absolute top-4 left-4 text-[9px] font-black uppercase tracking-widest z-10"
            style={{ color: "var(--color-muted)" }}>
            ←
          </button>

          {/* Foto */}
          <div className="relative flex-shrink-0">
            <img
              src={player.photo_url || "/player-placeholder.png"}
              alt={player.name}
              className="w-24 h-24 rounded-2xl object-cover"
              style={{ border: `2px solid ${posColor}40` }}
            />
            <span className="absolute -bottom-1 -right-1 text-[9px] font-black px-2 py-0.5 rounded-full"
              style={{ background: posColor, color: "var(--bg-page)" }}>
              {player.position}
            </span>
          </div>

          {/* Info */}
          <div className="flex-1 pb-1">
            <p className="text-xl font-black leading-tight" style={{ color: "var(--color-text)" }}>
              {player.name}
            </p>
            <p className="text-sm font-black mt-0.5" style={{ color: posColor }}>
              {player.team_name}
            </p>
            <div className="flex gap-3 mt-1.5">
              {player.nationality && (
                <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                  {player.nationality}
                </span>
              )}
              {player.rating > 0 && (
                <span className="text-[9px] font-black" style={{ color: "var(--color-primary)" }}>
                  ★ {player.rating?.toFixed(1)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Besitzer-Band */}
        <div className="mx-4 mb-4 px-3 py-2 rounded-xl flex items-center justify-between"
          style={{ background: "var(--bg-card)", border: `1px solid ${isMine ? "var(--color-primary)" : "var(--color-border)"}` }}>
          {ownerTeam ? (
            <>
              <div>
                <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>
                  Besitzer
                </p>
                <p className="text-xs font-black" style={{ color: isMine ? "var(--color-primary)" : "var(--color-text)" }}>
                  {ownerTeam.name} {isMine && "· Mein Team"}
                </p>
              </div>
              {isMine && (
                <button
                  onClick={() => window.location.href = `/leagues/${leagueId}/transfers`}
                  className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase"
                  style={{ background: "var(--color-border)", color: "var(--color-text)" }}>
                  Transfer
                </button>
              )}
              {!isMine && myTeam && (
                <button
                  onClick={() => window.location.href = `/leagues/${leagueId}/trades?target=${ownerTeam.id}&player=${player.id}`}
                  className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}>
                  Trade anfragen
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center justify-between w-full">
              <div>
                <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>Status</p>
                <p className="text-xs font-black" style={{ color: "var(--color-success)" }}>Freier Spieler</p>
              </div>
              <button
                onClick={() => window.location.href = `/leagues/${leagueId}/transfers`}
                className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase"
                style={{ background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))", border: "1px solid var(--color-success)", color: "var(--color-success)" }}>
                Verpflichten
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex w-full max-w-md border-b px-4" style={{ borderColor: "var(--color-border)" }}>
        {(["summary", "gamelog", "history", "news"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-2.5 text-[9px] font-black uppercase tracking-widest transition-all"
            style={{
              color: tab === t ? posColor : "var(--color-border)",
              borderBottom: tab === t ? `2px solid ${posColor}` : "2px solid transparent",
            }}>
            {t === "summary" ? "Übersicht" : t === "gamelog" ? "Game Log" : t === "history" ? "Historie" : "News"}
          </button>
        ))}
      </div>

      <div className="w-full max-w-md p-4">

        {/* ÜBERSICHT */}
        {tab === "summary" && (
          <div className="space-y-4">
            {/* Saison-Stats */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Saison-Pts", value: seasonPts.toFixed(1), highlight: true },
                { label: "Ø / Spieltag", value: avgPts.toFixed(1) },
                { label: "Einsätze", value: gameLog.length },
                { label: "Tore", value: gameLog.reduce((s, g) => s + (g.goals || 0), 0) },
                { label: "Assists", value: gameLog.reduce((s, g) => s + (g.assists || 0), 0) },
                { label: "Minuten", value: gameLog.reduce((s, g) => s + (g.minutes || 0), 0) },
              ].map(({ label, value, highlight }) => (
                <div key={label} className="p-3 rounded-xl text-center"
                  style={{ background: "var(--bg-card)", border: `1px solid ${highlight ? posColor + "40" : "var(--color-border)"}` }}>
                  <p className="text-xl font-black" style={{ color: highlight ? posColor : "var(--color-text)" }}>{value}</p>
                  <p className="text-[7px] font-black uppercase tracking-widest mt-0.5" style={{ color: "var(--color-border)" }}>{label}</p>
                </div>
              ))}
            </div>

            {/* Detaillierte Stats */}
            <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
              <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-border)" }}>
                Saison-Statistiken
              </p>
              <div className="grid grid-cols-2 gap-y-2">
                {[
                  { label: "Schüsse aufs Tor", val: gameLog.reduce((s,g) => s+(g.shots_on||0),0) },
                  { label: "Key Passes", val: gameLog.reduce((s,g) => s+(g.key_passes||0),0) },
                  { label: "Tackles", val: gameLog.reduce((s,g) => s+(g.tackles||0),0) },
                  { label: "Abfangen", val: gameLog.reduce((s,g) => s+(g.interceptions||0),0) },
                  { label: "Gelbe Karten", val: gameLog.reduce((s,g) => s+(g.yellow_cards||0),0) },
                  { label: "Rote Karten", val: gameLog.reduce((s,g) => s+(g.red_cards||0),0) },
                  ...(player.position === "GK" ? [{ label: "Paraden", val: gameLog.reduce((s,g) => s+(g.saves||0),0) }] : []),
                  { label: "Clean Sheets", val: gameLog.filter(g => g.clean_sheet).length },
                ].map(({ label, val }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-[9px]" style={{ color: "var(--color-muted)" }}>{label}</span>
                    <span className="text-sm font-black" style={{ color: "var(--color-text)" }}>{val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* GAME LOG */}
        {tab === "gamelog" && (
          <div className="space-y-2">
            {gameLog.length === 0 ? (
              <EmptyState title="Noch keine Spieltag-Daten" />
            ) : (
              <>
                {/* Header */}
                <div className="grid grid-cols-6 gap-1 px-2 pb-1"
                  style={{ borderBottom: "1px solid var(--color-border)" }}>
                  {["GW","TOR","ASS","MIN","CS","PTS"].map(h => (
                    <p key={h} className="text-[8px] font-black uppercase text-center" style={{ color: "var(--color-border)" }}>{h}</p>
                  ))}
                </div>
                {gameLog.map(g => {
                  const gwInfo = gameweeks[g.gameweek];
                  return (
                    <div key={g.id} className="rounded-xl overflow-hidden"
                      style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                      {/* GW Label */}
                      <div className="px-3 py-1.5 flex items-center justify-between"
                        style={{ borderBottom: "1px solid var(--bg-elevated)" }}>
                        <span className="text-[9px] font-black" style={{ color: posColor }}>
                          GW{g.gameweek} {gwInfo?.label ? `· ${gwInfo.label}` : ""}
                        </span>
                        {gwInfo?.start_date && (
                          <span className="text-[8px]" style={{ color: "var(--color-border)" }}>
                            {new Date(gwInfo.start_date).toLocaleDateString("de-DE", { day: "2-digit", month: "short" })}
                          </span>
                        )}
                      </div>
                      {/* Stats Row */}
                      <div className="grid grid-cols-6 gap-1 px-2 py-2">
                        {[
                          { val: `GW${g.gameweek}`, key: "gw" },
                          { val: g.goals || 0, key: "goals" },
                          { val: g.assists || 0, key: "assists" },
                          { val: g.minutes || 0, key: "minutes" },
                          { val: g.clean_sheet ? "✓" : "—", key: "cs" },
                          { val: g.points?.toFixed(1) || "0.0", key: "points", highlight: true },
                        ].map(({ val, key, highlight }) => (
                          <p key={key} className="text-center text-xs font-black"
                            style={{ color: highlight ? posColor : "var(--color-text)" }}>
                            {val}
                          </p>
                        ))}
                      </div>
                      {/* Detailzeile */}
                      <div className="grid grid-cols-4 gap-2 px-3 pb-2 pt-0">
                        {[
                          { label: "S+T", val: g.shots_on || 0 },
                          { label: "KP", val: g.key_passes || 0 },
                          { label: "TKL", val: g.tackles || 0 },
                          { label: "INT", val: g.interceptions || 0 },
                        ].map(({ label, val }) => (
                          <div key={label} className="text-center">
                            <p className="text-[7px] uppercase" style={{ color: "var(--color-border)" }}>{label}</p>
                            <p className="text-[10px] font-black" style={{ color: "var(--color-muted)" }}>{val}</p>
                          </div>
                        ))}
                      </div>
                      {g.is_captain && (
                        <div className="px-3 pb-2">
                          <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
                            style={{ background: "var(--color-primary)20", color: "var(--color-primary)" }}>
                            C Kapitän × 2 gewertet
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* HISTORIE */}
        {tab === "history" && (
          <div className="space-y-2">
            {history.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>
                  Keine Historie vorhanden
                </p>
              </div>
            ) : (
              <div className="relative pl-5">
                {/* Timeline Linie */}
                <div className="absolute left-2 top-2 bottom-2 w-px" style={{ background: "var(--color-border)" }} />
                {history.map((h, i) => {
                  const colors: Record<string, string> = {
                    draft: "var(--color-primary)",
                    transfer_in: "var(--color-success)",
                    transfer_out: "var(--color-error)",
                    trade: "var(--color-info)",
                  };
                  const icons: Record<string, string> = {
                    draft: "🏈",
                    transfer_in: "▲",
                    transfer_out: "▼",
                    trade: "⇄",
                  };
                  const col = colors[h.type] || "var(--color-text)";
                  return (
                    <div key={i} className="relative mb-4">
                      {/* Dot */}
                      <div className="absolute -left-3 top-3 w-3 h-3 rounded-full flex items-center justify-center text-[7px]"
                        style={{ background: col, color: "var(--bg-page)" }}>
                      </div>
                      <div className="p-3 rounded-xl ml-2"
                        style={{ background: "var(--bg-card)", border: `1px solid ${col}30` }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: col }}>
                            {icons[h.type]} {h.detail}
                          </span>
                          <span className="text-[8px]" style={{ color: "var(--color-border)" }}>
                            {formatDate(h.date)}
                          </span>
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

        {/* NEWS */}
        {tab === "news" && (
          <div className="space-y-3">
            {newsLoading ? (
              <div className="text-center py-12 animate-pulse">
                <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>
                  Lade News...
                </p>
              </div>
            ) : news.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>
                  Keine aktuellen News gefunden
                </p>
                <p className="text-[8px] mt-2" style={{ color: "var(--bg-elevated)" }}>
                  Google News · {player.name}
                </p>
              </div>
            ) : (
              news.map((item, i) => (
                <a key={i} href={item.link} target="_blank" rel="noopener noreferrer"
                  className="block p-4 rounded-xl transition-all"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                  <p className="text-sm font-black leading-snug mb-2" style={{ color: "var(--color-text)" }}>
                    {item.title}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                      {item.source}
                    </span>
                    <span className="text-[8px]" style={{ color: "var(--color-border)" }}>
                      {formatNewsDate(item.pubDate)}
                    </span>
                  </div>
                </a>
              ))
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
