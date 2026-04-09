"use client";

import { useState, useEffect, useRef } from "react";
import { BottomNav } from "@/app/components/BottomNav";

const LEAGUES = [
  { id: 0,   name: "Alle",  flag: "🌍" },
  { id: 78,  name: "BL",    flag: "🇩🇪" },
  { id: 39,  name: "PL",    flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: 140, name: "LaLiga",flag: "🇪🇸" },
  { id: 135, name: "SerieA",flag: "🇮🇹" },
  { id: 61,  name: "L1",    flag: "🇫🇷" },
];

const STATUS_LABEL: Record<string, string> = {
  NS: "Anpfiff", "1H": "1. HZ", HT: "Pause", "2H": "2. HZ",
  ET: "Verl.", P: "Elfm.", FT: "Ende", AET: "n.V.", PEN: "Elf.",
  PST: "Versch.", CANC: "Abges.", SUSP: "Unterb.",
};

function formatKickoff(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function addDays(base: string, n: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
}

export default function ScoresPage() {
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeLeague, setActiveLeague] = useState(0);
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" })
  );
  const [hasLive, setHasLive] = useState(false);
  const pollRef = useRef<any>(null);

  useEffect(() => {
    loadFixtures(date, false);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [date]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (hasLive) {
      pollRef.current = setInterval(() => loadFixtures(date, true), 60_000);
    }
  }, [hasLive, date]);

  async function loadFixtures(d: string, silent = false) {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/fixtures?date=${d}${silent ? "&refresh=1" : ""}`);
      const json = await res.json();
      setGroups(json.groups || []);
      setHasLive(json.hasLive || false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const days = [-2, -1, 0, 1, 2].map(n => addDays(today, n));

  const visibleGroups = activeLeague === 0
    ? groups
    : groups.filter(g => g.leagueId === activeLeague);

  const totalGames = visibleGroups.reduce((s, g) => s + g.fixtures.length, 0);
  const liveCount  = visibleGroups.reduce((s, g) => s + g.fixtures.filter((f: any) => f.isLive).length, 0);

  return (
    <main className="flex min-h-screen flex-col pb-24" style={{ background: "#0c0900" }}>

      {/* Header */}
      <div className="sticky top-0 z-40" style={{ background: "#0c0900", borderBottom: "1px solid #1a1208" }}>
        <div className="max-w-[480px] mx-auto">
          {/* Title row */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <h1 className="text-sm font-black uppercase tracking-widest" style={{ color: "#c8b080" }}>
              Scores
            </h1>
            <div className="flex items-center gap-2">
              {liveCount > 0 && (
                <span className="flex items-center gap-1 text-[8px] font-black uppercase"
                  style={{ color: "#00ce7d" }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block"
                    style={{ background: "#00ce7d" }} />
                  {liveCount} live
                </span>
              )}
              <button onClick={() => loadFixtures(date, false)}
                className="text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg"
                style={{ background: "#141008", color: "#5a4020", border: "1px solid #2a2010" }}>
                ↻
              </button>
            </div>
          </div>

          {/* Date strip */}
          <div className="flex overflow-x-auto gap-1 px-4 pb-2 no-scrollbar">
            {days.map(d => {
              const isToday = d === today;
              const isActive = d === date;
              return (
                <button key={d} onClick={() => setDate(d)}
                  className="flex-shrink-0 flex flex-col items-center px-3 py-1.5 rounded-xl transition-all"
                  style={{
                    background: isActive ? "#f5a623" : "#141008",
                    border: `1px solid ${isActive ? "#f5a623" : "#2a2010"}`,
                    minWidth: 56,
                  }}>
                  <span className="text-[7px] font-black uppercase"
                    style={{ color: isActive ? "#0c0900" : isToday ? "#f5a623" : "#5a4020" }}>
                    {isToday ? "Heute" : new Date(d).toLocaleDateString("de-DE", { weekday: "short" })}
                  </span>
                  <span className="text-[9px] font-black"
                    style={{ color: isActive ? "#0c0900" : "#c8b080" }}>
                    {new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                  </span>
                </button>
              );
            })}
          </div>

          {/* League filter */}
          <div className="flex overflow-x-auto gap-1.5 px-4 pb-2.5 no-scrollbar">
            {LEAGUES.map(l => (
              <button key={l.id} onClick={() => setActiveLeague(l.id)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all"
                style={{
                  background: activeLeague === l.id ? "#f5a623" : "#141008",
                  border: `1px solid ${activeLeague === l.id ? "#f5a623" : "#2a2010"}`,
                }}>
                <span className="text-xs">{l.flag}</span>
                <span className="text-[8px] font-black uppercase tracking-widest"
                  style={{ color: activeLeague === l.id ? "#0c0900" : "#5a4020" }}>
                  {l.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-[480px] mx-auto w-full px-4 pt-3">
        {loading ? (
          <div className="text-center py-16 text-[9px] font-black uppercase tracking-widest animate-pulse"
            style={{ color: "#2a2010" }}>Lade Partien...</div>
        ) : error ? (
          <div className="text-center py-12 text-[9px] font-black uppercase"
            style={{ color: "#ff4d6d" }}>{error}</div>
        ) : totalGames === 0 ? (
          <div className="text-center py-16" style={{ color: "#2a2010" }}>
            <p className="text-3xl mb-3">⚽</p>
            <p className="text-[9px] font-black uppercase tracking-widest">
              Keine Spiele für diesen Tag
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleGroups.map(group => (
              <div key={group.leagueId}>
                {/* League header */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">{group.flag}</span>
                  <span className="text-[9px] font-black uppercase tracking-widest"
                    style={{ color: "#5a4020" }}>{group.name}</span>
                  <span className="text-[8px] font-black" style={{ color: "#2a2010" }}>
                    · {group.fixtures.length} Spiele
                  </span>
                  {group.fixtures.some((f: any) => f.isLive) && (
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse ml-auto flex-shrink-0"
                      style={{ background: "#00ce7d" }} />
                  )}
                </div>

                <div className="space-y-1.5">
                  {group.fixtures.map((f: any) => (
                    <FixtureCard key={f.id} fixture={f} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomNav />
    </main>
  );
}

function FixtureCard({ fixture: f }: { fixture: any }) {
  const isLive = f.isLive;
  const isFinished = f.isFinished;
  const isScheduled = !isLive && !isFinished && f.status !== "PST" && f.status !== "CANC";

  return (
    <a href={`/scores/${f.id}`}
      className="flex items-center gap-3 p-3 rounded-xl transition-all"
      style={{
        background: isLive ? "#0a1a0a" : "#141008",
        border: `1px solid ${isLive ? "#00ce7d30" : "#2a2010"}`,
        display: "flex",
      }}>

      {/* Home */}
      <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
        <p className="font-black text-xs truncate text-right"
          style={{ color: f.home.winner === true ? "#f5a623" : f.home.winner === false ? "#5a4020" : "#c8b080" }}>
          {f.home.name}
        </p>
        <img src={f.home.logo} alt="" className="w-6 h-6 object-contain flex-shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      </div>

      {/* Score / Time */}
      <div className="flex-shrink-0 text-center" style={{ minWidth: 64 }}>
        {isLive ? (
          <>
            <p className="font-black text-base leading-none" style={{ color: "#f5a623" }}>
              {f.goals.home ?? 0} <span style={{ color: "#3a2a10" }}>–</span> {f.goals.away ?? 0}
            </p>
            <p className="text-[7px] font-black mt-0.5 flex items-center justify-center gap-1"
              style={{ color: "#00ce7d" }}>
              <span className="w-1 h-1 rounded-full inline-block animate-pulse"
                style={{ background: "#00ce7d" }} />
              {f.elapsed ? `${f.elapsed}'` : STATUS_LABEL[f.status] || f.status}
            </p>
          </>
        ) : isFinished ? (
          <>
            <p className="font-black text-base leading-none" style={{ color: "#c8b080" }}>
              {f.goals.home ?? "–"} <span style={{ color: "#3a2a10" }}>–</span> {f.goals.away ?? "–"}
            </p>
            <p className="text-[7px] font-black mt-0.5" style={{ color: "#3a2a10" }}>
              {STATUS_LABEL[f.status] || f.status}
            </p>
          </>
        ) : f.status === "PST" ? (
          <p className="text-[8px] font-black" style={{ color: "#ff4d6d" }}>Versch.</p>
        ) : f.status === "CANC" ? (
          <p className="text-[8px] font-black" style={{ color: "#ff4d6d" }}>Abges.</p>
        ) : (
          <>
            <p className="font-black text-sm leading-none" style={{ color: "#c8b080" }}>
              {formatKickoff(f.date)}
            </p>
            <p className="text-[7px] mt-0.5" style={{ color: "#2a2010" }}>Uhr</p>
          </>
        )}
      </div>

      {/* Away */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <img src={f.away.logo} alt="" className="w-6 h-6 object-contain flex-shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        <p className="font-black text-xs truncate"
          style={{ color: f.away.winner === true ? "#f5a623" : f.away.winner === false ? "#5a4020" : "#c8b080" }}>
          {f.away.name}
        </p>
      </div>

      {/* Arrow */}
      <span className="text-[10px] flex-shrink-0" style={{ color: "#2a2010" }}>›</span>
    </a>
  );
}
