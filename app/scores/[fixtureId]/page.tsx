"use client";

import React, { useState, useEffect, useRef } from "react";
import { BottomNav } from "@/app/components/BottomNav";

const STATUS_LABEL: Record<string, string> = {
  NS: "Noch nicht angepfiffen", "1H": "1. Halbzeit", HT: "Halbzeitpause",
  "2H": "2. Halbzeit", ET: "Verlängerung", P: "Elfmeterschießen",
  FT: "Abgepfiffen", AET: "n. Verlängerung", PEN: "Elfmeter", SUSP: "Unterbrochen",
  PST: "Verschoben", CANC: "Abgesagt",
};

const EVENT_ICON: Record<string, string> = {
  "Normal Goal": "⚽", "Own Goal": "⚽", "Penalty": "⚽",
  "Missed Penalty": "✗", "Yellow Card": "🟨", "Red Card": "🟥",
  "Yellow Red Card": "🟧", "Substitution 1": "↕", "Substitution 2": "↕",
  "Substitution 3": "↕", "Substitution 4": "↕", "Substitution 5": "↕",
  "Var": "📺",
};

const POS_COLOR: Record<string, string> = {
  G: "#f5a623", D: "#4a9eff", M: "#00ce7d", F: "#ff4d6d",
};

export default function FixtureDetailPage({ params }: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = React.use(params);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"events" | "lineup" | "stats">("events");
  const pollRef = useRef<any>(null);

  useEffect(() => {
    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fixtureId]);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/fixtures/${fixtureId}`);
      const json = await res.json();
      setData(json);
      // Poll every 45s if live
      if (json.isLive) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(() => load(true), 45_000);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center"
      style={{ background: "#0c0900" }}>
      <p className="text-[9px] font-black uppercase tracking-widest animate-pulse"
        style={{ color: "#2a2010" }}>Lade Partie...</p>
    </main>
  );

  if (!data || data.error) return (
    <main className="flex min-h-screen items-center justify-center"
      style={{ background: "#0c0900" }}>
      <p className="text-[9px] font-black uppercase" style={{ color: "#ff4d6d" }}>
        Spiel nicht gefunden
      </p>
    </main>
  );

  const homeGoals = data.goals.home ?? (data.isFinished || data.isLive ? 0 : null);
  const awayGoals = data.goals.away ?? (data.isFinished || data.isLive ? 0 : null);
  const hasScore = homeGoals !== null;

  // Separate events by team
  const homeEvents = (data.events || []).filter((e: any) =>
    e.teamId === data.home.id && e.type !== "subst"
  );
  const awayEvents = (data.events || []).filter((e: any) =>
    e.teamId === data.away.id && e.type !== "subst"
  );
  const allEvents = [...(data.events || [])].sort((a, b) => a.time - b.time);

  // Sub events
  const subs = allEvents.filter((e: any) => e.type?.toLowerCase() === "subst");
  const nonSubs = allEvents.filter((e: any) => e.type?.toLowerCase() !== "subst");

  const homeLineup = data.lineups?.find((l: any) => l.teamId === data.home.id);
  const awayLineup = data.lineups?.find((l: any) => l.teamId === data.away.id);

  // Stats side by side
  const homeStats = data.statistics?.find((s: any) => s.teamId === data.home.id)?.stats || {};
  const awayStats = data.statistics?.find((s: any) => s.teamId === data.away.id)?.stats || {};
  const statKeys = [
    ["Ball Possession",    "Ballbesitz"],
    ["Total Shots",        "Torschüsse"],
    ["Shots on Goal",      "Aufs Tor"],
    ["Shots off Goal",     "Daneben"],
    ["Blocked Shots",      "Geblockt"],
    ["Corner Kicks",       "Ecken"],
    ["Fouls",              "Fouls"],
    ["Yellow Cards",       "Gelb"],
    ["Red Cards",          "Rot"],
    ["Passes",             "Pässe"],
    ["Passes %",           "Pass %"],
    ["Goalkeeper Saves",   "Paraden"],
    ["Offsides",           "Abseits"],
  ];

  function parseNum(val: any): number {
    if (val === null || val === undefined) return 0;
    return parseFloat(String(val).replace("%", "")) || 0;
  }

  return (
    <main className="flex min-h-screen flex-col pb-24" style={{ background: "#0c0900" }}>

      {/* Back + live indicator */}
      <div className="flex items-center justify-between px-4 pt-3 pb-0 max-w-[480px] mx-auto w-full">
        <button onClick={() => window.history.back()}
          className="text-[9px] font-black uppercase tracking-widest flex items-center gap-1"
          style={{ color: "#5a4020" }}>
          ‹ Zurück
        </button>
        {data.isLive && (
          <span className="flex items-center gap-1.5 text-[8px] font-black uppercase"
            style={{ color: "#00ce7d" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block"
              style={{ background: "#00ce7d" }} />
            Live
          </span>
        )}
        <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "#3a2a10" }}>
          {data.league?.name} · {data.league?.round?.replace("Regular Season - ", "GW ")}
        </p>
      </div>

      {/* Scoreboard */}
      <div className="max-w-[480px] mx-auto w-full px-4 pt-4 pb-2">
        <div className="rounded-2xl p-4"
          style={{ background: "#141008", border: `1px solid ${data.isLive ? "#00ce7d30" : "#2a2010"}` }}>

          <div className="flex items-center justify-between gap-2">
            {/* Home */}
            <div className="flex-1 flex flex-col items-center gap-2">
              <img src={data.home.logo} alt={data.home.name}
                className="w-12 h-12 object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <p className="font-black text-xs text-center"
                style={{ color: data.home.winner === true ? "#f5a623" : "#c8b080" }}>
                {data.home.name}
              </p>
            </div>

            {/* Score */}
            <div className="text-center flex-shrink-0 px-2">
              {hasScore ? (
                <>
                  <p className="font-black text-3xl leading-none" style={{ color: "#f5a623" }}>
                    {homeGoals}
                    <span className="mx-2 text-2xl" style={{ color: "#3a2a10" }}>–</span>
                    {awayGoals}
                  </p>
                  {data.score?.halftime && (data.isLive || data.isFinished) && (
                    <p className="text-[7px] font-black mt-1" style={{ color: "#3a2a10" }}>
                      HZ: {data.score.halftime.home ?? 0}–{data.score.halftime.away ?? 0}
                    </p>
                  )}
                </>
              ) : (
                <p className="font-black text-xl" style={{ color: "#5a4020" }}>vs</p>
              )}
              <p className="text-[8px] font-black mt-1"
                style={{ color: data.isLive ? "#00ce7d" : "#5a4020" }}>
                {data.isLive
                  ? `${data.elapsed}'`
                  : data.isFinished
                  ? STATUS_LABEL[data.status] || data.status
                  : new Date(data.date).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr"}
              </p>
              {data.venue && (
                <p className="text-[7px] mt-0.5 truncate max-w-[90px]"
                  style={{ color: "#2a2010" }}>{data.venue}</p>
              )}
            </div>

            {/* Away */}
            <div className="flex-1 flex flex-col items-center gap-2">
              <img src={data.away.logo} alt={data.away.name}
                className="w-12 h-12 object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <p className="font-black text-xs text-center"
                style={{ color: data.away.winner === true ? "#f5a623" : "#c8b080" }}>
                {data.away.name}
              </p>
            </div>
          </div>

          {/* Quick event icons in scoreboard (goals + cards) */}
          {(homeEvents.length > 0 || awayEvents.length > 0) && (
            <div className="flex justify-between mt-3 pt-3 gap-2"
              style={{ borderTop: "1px solid #2a2010" }}>
              <div className="flex-1 space-y-0.5">
                {homeEvents.filter((e: any) => e.type === "Goal").map((e: any, i: number) => (
                  <p key={i} className="text-[8px] font-black text-right"
                    style={{ color: e.detail === "Own Goal" ? "#ff4d6d" : "#c8b080" }}>
                    ⚽ {e.playerName?.split(" ").pop()} {e.time}'
                    {e.detail === "Penalty" && " (E)"}
                    {e.detail === "Own Goal" && " (ET)"}
                  </p>
                ))}
                {homeEvents.filter((e: any) => e.type === "Card").map((e: any, i: number) => (
                  <p key={i} className="text-[8px] font-black text-right"
                    style={{ color: e.detail?.includes("Red") ? "#ff4d6d" : "#f5a623" }}>
                    {e.detail?.includes("Red") ? "🟥" : "🟨"} {e.playerName?.split(" ").pop()} {e.time}'
                  </p>
                ))}
              </div>
              <div className="flex-shrink-0 w-px" style={{ background: "#2a2010" }} />
              <div className="flex-1 space-y-0.5">
                {awayEvents.filter((e: any) => e.type === "Goal").map((e: any, i: number) => (
                  <p key={i} className="text-[8px] font-black"
                    style={{ color: e.detail === "Own Goal" ? "#ff4d6d" : "#c8b080" }}>
                    ⚽ {e.playerName?.split(" ").pop()} {e.time}'
                    {e.detail === "Penalty" && " (E)"}
                    {e.detail === "Own Goal" && " (ET)"}
                  </p>
                ))}
                {awayEvents.filter((e: any) => e.type === "Card").map((e: any, i: number) => (
                  <p key={i} className="text-[8px] font-black"
                    style={{ color: e.detail?.includes("Red") ? "#ff4d6d" : "#f5a623" }}>
                    {e.detail?.includes("Red") ? "🟥" : "🟨"} {e.playerName?.split(" ").pop()} {e.time}'
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-[480px] mx-auto w-full px-4">
        <div className="flex gap-1.5 mb-3">
          {([
            ["events",  "Ereignisse"],
            ["lineup",  "Aufstellung"],
            ["stats",   "Statistiken"],
          ] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className="flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
              style={{
                background: tab === id ? "#f5a623" : "#141008",
                color: tab === id ? "#0c0900" : "#5a4020",
                border: `1px solid ${tab === id ? "#f5a623" : "#2a2010"}`,
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-[480px] mx-auto w-full px-4">

        {/* EREIGNISSE */}
        {tab === "events" && (
          <div>
            {nonSubs.length === 0 ? (
              <div className="text-center py-12" style={{ color: "#2a2010" }}>
                <p className="text-[9px] font-black uppercase tracking-widest">
                  {data.isFinished ? "Keine Ereignisse" : "Noch keine Ereignisse"}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {nonSubs.map((e: any, i: number) => {
                  const isHome = e.teamId === data.home.id;
                  const icon = EVENT_ICON[e.detail] || EVENT_ICON[e.type] || "•";
                  const isGoal = e.type === "Goal";
                  const isCard = e.type === "Card";
                  const color = isGoal
                    ? (e.detail === "Own Goal" ? "#ff4d6d" : "#f5a623")
                    : isCard
                    ? (e.detail?.includes("Red") ? "#ff4d6d" : "#f5a623")
                    : "#5a4020";

                  return (
                    <div key={i}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                      style={{
                        background: isGoal ? "#1a1208" : "#141008",
                        border: `1px solid ${isGoal ? "#3a2a10" : "#2a2010"}`,
                      }}>
                      {/* Home side */}
                      {isHome ? (
                        <>
                          <span className="text-base flex-shrink-0">{icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-black text-xs" style={{ color }}>
                              {e.playerName}
                              {e.detail === "Penalty" && " (P)"}
                              {e.detail === "Own Goal" && " (ET)"}
                            </p>
                            {e.assistName && (
                              <p className="text-[7px]" style={{ color: "#5a4020" }}>
                                Vorlage: {e.assistName}
                              </p>
                            )}
                            <p className="text-[7px]" style={{ color: "#3a2a10" }}>
                              {data.home.name}
                            </p>
                          </div>
                          <span className="font-black text-sm flex-shrink-0"
                            style={{ color: "#5a4020" }}>{e.time}'</span>
                          <div className="w-8" />
                        </>
                      ) : (
                        <>
                          <div className="w-8" />
                          <span className="font-black text-sm flex-shrink-0"
                            style={{ color: "#5a4020" }}>{e.time}'</span>
                          <div className="flex-1 min-w-0 text-right">
                            <p className="font-black text-xs" style={{ color }}>
                              {e.playerName}
                              {e.detail === "Penalty" && " (P)"}
                              {e.detail === "Own Goal" && " (ET)"}
                            </p>
                            {e.assistName && (
                              <p className="text-[7px]" style={{ color: "#5a4020" }}>
                                Vorlage: {e.assistName}
                              </p>
                            )}
                            <p className="text-[7px]" style={{ color: "#3a2a10" }}>
                              {data.away.name}
                            </p>
                          </div>
                          <span className="text-base flex-shrink-0">{icon}</span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Substitutions */}
            {subs.length > 0 && (
              <div className="mt-4">
                <p className="text-[8px] font-black uppercase tracking-widest mb-2"
                  style={{ color: "#2a2010" }}>Einwechslungen</p>
                <div className="space-y-1">
                  {subs.map((e: any, i: number) => {
                    const isHome = e.teamId === data.home.id;
                    return (
                      <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                        style={{ background: "#141008" }}>
                        <span className="text-[7px] font-black w-6 text-center"
                          style={{ color: "#3a2a10" }}>{e.time}'</span>
                        <span className="text-xs">↕</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[8px] font-black" style={{ color: "#00ce7d" }}>
                            ▲ {e.assistName}
                          </span>
                          <span className="text-[7px] mx-1" style={{ color: "#2a2010" }}>·</span>
                          <span className="text-[8px] font-black" style={{ color: "#ff4d6d" }}>
                            ▼ {e.playerName}
                          </span>
                        </div>
                        <span className="text-[7px] font-black" style={{ color: "#3a2a10" }}>
                          {isHome ? data.home.name : data.away.name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* AUFSTELLUNG */}
        {tab === "lineup" && (
          <div>
            {!homeLineup && !awayLineup ? (
              <div className="text-center py-12" style={{ color: "#2a2010" }}>
                <p className="text-[9px] font-black uppercase tracking-widest">
                  Aufstellung noch nicht verfügbar
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {[homeLineup, awayLineup].filter(Boolean).map((lineup: any) => {
                  const isHome = lineup.teamId === data.home.id;
                  const teamObj = isHome ? data.home : data.away;
                  const goalEvents = (data.events || []).filter((e: any) =>
                    e.type === "Goal" && e.teamId === lineup.teamId
                  );
                  const cardEvents = (data.events || []).filter((e: any) =>
                    e.type === "Card" && e.teamId === lineup.teamId
                  );
                  const subOutIds = new Set(
                    (data.events || [])
                      .filter((e: any) => e.type?.toLowerCase() === "subst" && e.teamId === lineup.teamId)
                      .map((e: any) => e.playerId)
                  );

                  return (
                    <div key={lineup.teamId} className="rounded-2xl overflow-hidden"
                      style={{ background: "#141008", border: "1px solid #2a2010" }}>
                      {/* Team header */}
                      <div className="flex items-center gap-3 px-4 py-3"
                        style={{ background: "#1a1208", borderBottom: "1px solid #2a2010" }}>
                        <img src={teamObj.logo} alt="" className="w-6 h-6 object-contain"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        <p className="font-black text-sm" style={{ color: "#c8b080" }}>{teamObj.name}</p>
                        {lineup.formation && (
                          <span className="ml-auto text-[9px] font-black"
                            style={{ color: "#f5a623" }}>{lineup.formation}</span>
                        )}
                      </div>

                      {/* Starters */}
                      <div className="px-3 py-2 space-y-0.5">
                        {lineup.startXI.map((p: any) => {
                          const goals = goalEvents.filter((e: any) => e.playerId === p.id);
                          const cards = cardEvents.filter((e: any) => e.playerId === p.id);
                          const subOut = subOutIds.has(p.id);
                          const posColor = POS_COLOR[p.pos?.charAt(0)] || "#5a4020";
                          return (
                            <div key={p.id} className="flex items-center gap-2 py-1">
                              <span className="text-[8px] font-black w-5 text-center"
                                style={{ color: posColor }}>{p.number}</span>
                              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{ background: posColor }} />
                              <span className="text-[9px] font-black flex-1 truncate"
                                style={{ color: subOut ? "#5a4020" : "#c8b080" }}>
                                {p.name}
                              </span>
                              {/* Events */}
                              <span className="flex gap-0.5 flex-shrink-0">
                                {goals.map((g: any, gi: number) => (
                                  <span key={gi} className="text-[9px]">
                                    {g.detail === "Own Goal" ? "🟦" : "⚽"}
                                  </span>
                                ))}
                                {cards.map((c: any, ci: number) => (
                                  <span key={ci} className="text-[9px]">
                                    {c.detail?.includes("Red") ? "🟥" : "🟨"}
                                  </span>
                                ))}
                                {subOut && <span className="text-[9px]">↓</span>}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Substitutes */}
                      {lineup.substitutes.length > 0 && (
                        <>
                          <div className="px-4 py-1.5"
                            style={{ background: "#0f0c06", borderTop: "1px solid #2a2010" }}>
                            <p className="text-[7px] font-black uppercase tracking-widest"
                              style={{ color: "#2a2010" }}>Ersatzbank</p>
                          </div>
                          <div className="px-3 py-1 space-y-0.5">
                            {lineup.substitutes.map((p: any) => {
                              const goals = goalEvents.filter((e: any) => e.playerId === p.id);
                              const cards = cardEvents.filter((e: any) => e.playerId === p.id);
                              const subIn = (data.events || []).some((e: any) =>
                                e.type?.toLowerCase() === "subst" && e.assistId === p.id
                              );
                              const posColor = POS_COLOR[p.pos?.charAt(0)] || "#3a2a10";
                              return (
                                <div key={p.id} className="flex items-center gap-2 py-0.5">
                                  <span className="text-[7px] font-black w-5 text-center"
                                    style={{ color: "#3a2a10" }}>{p.number}</span>
                                  <span className="w-1 h-1 rounded-full flex-shrink-0"
                                    style={{ background: "#2a2010" }} />
                                  <span className="text-[8px] font-black flex-1 truncate"
                                    style={{ color: subIn ? "#c8b080" : "#5a4020" }}>
                                    {p.name}
                                  </span>
                                  <span className="flex gap-0.5 flex-shrink-0">
                                    {goals.map((g: any, gi: number) => (
                                      <span key={gi} className="text-[9px]">⚽</span>
                                    ))}
                                    {cards.map((c: any, ci: number) => (
                                      <span key={ci} className="text-[9px]">
                                        {c.detail?.includes("Red") ? "🟥" : "🟨"}
                                      </span>
                                    ))}
                                    {subIn && <span className="text-[9px]" style={{ color: "#00ce7d" }}>↑</span>}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}

                      {lineup.coach && (
                        <div className="px-4 py-2" style={{ borderTop: "1px solid #2a2010" }}>
                          <p className="text-[7px] font-black" style={{ color: "#3a2a10" }}>
                            Trainer: {lineup.coach}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* STATISTIKEN */}
        {tab === "stats" && (
          <div>
            {Object.keys(homeStats).length === 0 && Object.keys(awayStats).length === 0 ? (
              <div className="text-center py-12" style={{ color: "#2a2010" }}>
                <p className="text-[9px] font-black uppercase tracking-widest">
                  Statistiken noch nicht verfügbar
                </p>
              </div>
            ) : (
              <>
                {/* Team name header */}
                <div className="flex items-center justify-between mb-3 px-1">
                  <p className="text-[9px] font-black" style={{ color: "#c8b080" }}>{data.home.name}</p>
                  <p className="text-[9px] font-black" style={{ color: "#c8b080" }}>{data.away.name}</p>
                </div>
                <div className="space-y-2">
                  {statKeys.map(([key, label]) => {
                    const hRaw = homeStats[key];
                    const aRaw = awayStats[key];
                    if (hRaw === null && aRaw === null) return null;
                    if (hRaw === undefined && aRaw === undefined) return null;
                    const hNum = parseNum(hRaw);
                    const aNum = parseNum(aRaw);
                    const total = hNum + aNum;
                    const hPct = total > 0 ? (hNum / total) * 100 : 50;
                    const isPct = String(hRaw).includes("%");

                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-black text-xs" style={{ color: "#c8b080" }}>
                            {isPct ? hRaw : hRaw ?? 0}
                          </span>
                          <span className="text-[7px] font-black uppercase tracking-widest"
                            style={{ color: "#3a2a10" }}>{label}</span>
                          <span className="font-black text-xs" style={{ color: "#c8b080" }}>
                            {isPct ? aRaw : aRaw ?? 0}
                          </span>
                        </div>
                        {/* Bar */}
                        <div className="flex rounded-full overflow-hidden h-1"
                          style={{ background: "#2a2010" }}>
                          <div style={{ width: `${hPct}%`, background: "#f5a623", transition: "width 0.5s" }} />
                          <div style={{ flex: 1, background: "#4a9eff" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-4 mt-4 justify-center">
                  <span className="flex items-center gap-1.5 text-[8px] font-black"
                    style={{ color: "#5a4020" }}>
                    <span className="w-3 h-1 rounded-full inline-block" style={{ background: "#f5a623" }} />
                    {data.home.name}
                  </span>
                  <span className="flex items-center gap-1.5 text-[8px] font-black"
                    style={{ color: "#5a4020" }}>
                    <span className="w-3 h-1 rounded-full inline-block" style={{ background: "#4a9eff" }} />
                    {data.away.name}
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
