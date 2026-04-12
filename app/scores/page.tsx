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
    <main className="flex min-h-screen flex-col pb-24" style={{ background: "var(--bg-page)" }}>

      {/* Header */}
      <div className="sticky top-0 z-40" style={{ background: "var(--bg-page)", borderBottom: "1px solid var(--bg-elevated)" }}>
        <div className="max-w-[480px] mx-auto">
          {/* Title row */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <h1 className="text-sm font-black uppercase tracking-widest" style={{ color: "var(--color-text)" }}>
              Scores
            </h1>
            <div className="flex items-center gap-2">
              {liveCount > 0 && (
                <span className="flex items-center gap-1 text-[8px] font-black uppercase"
                  style={{ color: "var(--color-success)" }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block"
                    style={{ background: "var(--color-success)" }} />
                  {liveCount} live
                </span>
              )}
              <button onClick={() => loadFixtures(date, false)}
                className="text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg"
                style={{ background: "var(--bg-card)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
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
                    background: isActive ? "var(--color-primary)" : "var(--bg-card)",
                    border: `1px solid ${isActive ? "var(--color-primary)" : "var(--color-border)"}`,
                    minWidth: 56,
                  }}>
                  <span className="text-[7px] font-black uppercase"
                    style={{ color: isActive ? "var(--bg-page)" : isToday ? "var(--color-primary)" : "var(--color-muted)" }}>
                    {isToday ? "Heute" : new Date(d).toLocaleDateString("de-DE", { weekday: "short" })}
                  </span>
                  <span className="text-[9px] font-black"
                    style={{ color: isActive ? "var(--bg-page)" : "var(--color-text)" }}>
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
                  background: activeLeague === l.id ? "var(--color-primary)" : "var(--bg-card)",
                  border: `1px solid ${activeLeague === l.id ? "var(--color-primary)" : "var(--color-border)"}`,
                }}>
                <span className="text-xs">{l.flag}</span>
                <span className="text-[8px] font-black uppercase tracking-widest"
                  style={{ color: activeLeague === l.id ? "var(--bg-page)" : "var(--color-muted)" }}>
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
            style={{ color: "var(--color-border-subtle)" }}>Lade Partien...</div>
        ) : error ? (
          <div className="text-center py-12 text-[9px] font-black uppercase"
            style={{ color: "var(--color-error)" }}>{error}</div>
        ) : totalGames === 0 ? (
          <div className="text-center py-16" style={{ color: "var(--color-border-subtle)" }}>
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
                    style={{ color: "var(--color-muted)" }}>{group.name}</span>
                  <span className="text-[8px] font-black" style={{ color: "var(--color-border-subtle)" }}>
                    · {group.fixtures.length} Spiele
                  </span>
                  {group.fixtures.some((f: any) => f.isLive) && (
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse ml-auto flex-shrink-0"
                      style={{ background: "var(--color-success)" }} />
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

  return (
    <a href={`/scores/${f.id}`}
      className="flex items-center gap-3 p-3 rounded-xl transition-all"
      style={{
        background: isLive
          ? "color-mix(in srgb, var(--color-success) 8%, var(--bg-page))"
          : "var(--bg-card)",
        border: `1px solid ${isLive ? "color-mix(in srgb, var(--color-success) 20%, transparent)" : "var(--color-border)"}`,
        display: "flex",
      }}>

      {/* Home */}
      <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
        <p className="font-black text-xs truncate text-right"
          style={{ color: f.home.winner === true ? "var(--color-primary)" : f.home.winner === false ? "var(--color-muted)" : "var(--color-text)" }}>
          {f.home.name}
        </p>
        <img src={f.home.logo} alt="" className="w-6 h-6 object-contain flex-shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      </div>

      {/* Score / Time */}
      <div className="flex-shrink-0 text-center" style={{ minWidth: 64 }}>
        {isLive ? (
          <>
            <p className="font-black text-base leading-none" style={{ color: "var(--color-primary)" }}>
              {f.goals.home ?? 0} <span style={{ color: "var(--color-border-subtle)" }}>–</span> {f.goals.away ?? 0}
            </p>
            <p className="text-[7px] font-black mt-0.5 flex items-center justify-center gap-1"
              style={{ color: "var(--color-success)" }}>
              <span className="w-1 h-1 rounded-full inline-block animate-pulse"
                style={{ background: "var(--color-success)" }} />
              {f.elapsed ? `${f.elapsed}'` : STATUS_LABEL[f.status] || f.status}
            </p>
          </>
        ) : isFinished ? (
          <>
            <p className="font-black text-base leading-none" style={{ color: "var(--color-text)" }}>
              {f.goals.home ?? "–"} <span style={{ color: "var(--color-border-subtle)" }}>–</span> {f.goals.away ?? "–"}
            </p>
            <p className="text-[7px] font-black mt-0.5" style={{ color: "var(--color-border-subtle)" }}>
              {STATUS_LABEL[f.status] || f.status}
            </p>
          </>
        ) : f.status === "PST" ? (
          <p className="text-[8px] font-black" style={{ color: "var(--color-error)" }}>Versch.</p>
        ) : f.status === "CANC" ? (
          <p className="text-[8px] font-black" style={{ color: "var(--color-error)" }}>Abges.</p>
        ) : (
          <>
            <p className="font-black text-sm leading-none" style={{ color: "var(--color-text)" }}>
              {formatKickoff(f.date)}
            </p>
            <p className="text-[7px] mt-0.5" style={{ color: "var(--color-border-subtle)" }}>Uhr</p>
          </>
        )}
      </div>

      {/* Away */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <img src={f.away.logo} alt="" className="w-6 h-6 object-contain flex-shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        <p className="font-black text-xs truncate"
          style={{ color: f.away.winner === true ? "var(--color-primary)" : f.away.winner === false ? "var(--color-muted)" : "var(--color-text)" }}>
          {f.away.name}
        </p>
      </div>

      {/* Arrow */}
      <span className="text-[10px] flex-shrink-0" style={{ color: "var(--color-border-subtle)" }}>›</span>
    </a>
  );
}
