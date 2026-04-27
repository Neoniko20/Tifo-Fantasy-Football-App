"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { BottomNav } from "@/app/components/BottomNav";
import { TifoIcon } from "@/app/components/TifoLogo";
import { NotificationsBell } from "@/app/components/NotificationsBell";
import { Spinner } from "@/app/components/ui/Spinner";

// ── Hero Section ──────────────────────────────────────────────────────────────

/** Generates a bumpy "crowd profile" SVG path from cubic bezier arcs. */
function crowdPath(y: number, count: number, bumpH: number, fillDown: number, w = 375): string {
  const bw = w / count;
  let d = `M 0 ${y}`;
  for (let i = 0; i < count; i++) {
    const x0 = i * bw;
    const x1 = x0 + bw;
    d += ` C ${x0 + bw * 0.18} ${y - bumpH} ${x1 - bw * 0.18} ${y - bumpH} ${x1} ${y}`;
  }
  d += ` L ${w} ${y + fillDown} L 0 ${y + fillDown} Z`;
  return d;
}

function HeroSection({
  username,
  greeting,
  leagueCount,
}: {
  username: string;
  greeting: string;
  leagueCount: number;
}) {
  return (
    <div
      className="relative w-full max-w-md overflow-hidden flex-shrink-0"
      style={{ height: 230 }}
    >
      {/* ── 1. Base — pitch-black warm dark ── */}
      <div className="absolute inset-0" style={{ background: "#050301" }} />

      {/* ── 2. Floodlight — two beams from top-right ── */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: [
            /* wide outer cone */
            "radial-gradient(ellipse 90% 160% at 110% -20%, rgba(245,166,35,0.26) 0%, rgba(245,166,35,0.09) 38%, transparent 65%)",
            /* tight inner beam */
            "radial-gradient(ellipse 40% 80% at 100% -8%, rgba(255,210,90,0.22) 0%, transparent 48%)",
            /* floor bounce — faint warm glow at very bottom */
            "radial-gradient(ellipse 110% 30% at 50% 108%, rgba(245,166,35,0.07) 0%, transparent 60%)",
          ].join(", "),
        }}
      />

      {/* ── 3. Fan-curve silhouette (three tiers) ── */}
      <svg
        aria-hidden
        className="absolute bottom-0 left-0 w-full pointer-events-none"
        height="90"
        viewBox="0 0 375 90"
        preserveAspectRatio="none"
      >
        {/* back row — barely visible */}
        <path d={crowdPath(22, 28, 9,  68)} fill="rgba(245,166,35,0.028)" />
        {/* middle row */}
        <path d={crowdPath(46, 21, 12, 44)} fill="rgba(245,166,35,0.048)" />
        {/* front row — most defined */}
        <path d={crowdPath(68, 15, 15, 22)} fill="rgba(245,166,35,0.075)" />
        {/* solid floor strip so crowd doesn't bleed into cards */}
        <rect x="0" y="79" width="375" height="11" fill="#050301" />
      </svg>

      {/* ── 4. Abstract TIFO banner strip ── */}
      <div
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          top: 60,
          left: "8%",
          right: "8%",
          height: 22,
          background:
            "linear-gradient(90deg, transparent 0%, rgba(245,166,35,0.10) 15%, rgba(245,166,35,0.20) 50%, rgba(245,166,35,0.10) 85%, transparent 100%)",
          borderTop: "1px solid rgba(245,166,35,0.14)",
          borderBottom: "1px solid rgba(245,166,35,0.08)",
          transform: "rotate(-0.6deg)",
        }}
      />
      {/* secondary banner — thinner, offset */}
      <div
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          top: 86,
          left: "20%",
          right: "25%",
          height: 10,
          background:
            "linear-gradient(90deg, transparent, rgba(245,166,35,0.08) 30%, rgba(245,166,35,0.13) 60%, transparent)",
          transform: "rotate(0.4deg)",
        }}
      />

      {/* ── 5. Film-grain overlay ── */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='250' height='250'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='250' height='250' filter='url(%23g)'/%3E%3C/svg%3E")`,
          opacity: 0.038,
          mixBlendMode: "overlay",
        }}
      />

      {/* ── 6. Bottom fade to page background ── */}
      <div
        aria-hidden
        className="absolute bottom-0 left-0 right-0 pointer-events-none"
        style={{
          height: 72,
          background: "linear-gradient(to bottom, transparent, var(--bg-page))",
        }}
      />

      {/* ── UI LAYER ── */}

      {/* Top bar: logo + bell */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-5 pt-4 z-20">
        <TifoIcon size={30} />
        <NotificationsBell />
      </div>

      {/* Greeting text */}
      <div className="absolute bottom-10 left-0 right-0 px-5 z-20">
        <p
          className="text-[9px] font-black uppercase tracking-[0.28em] mb-0.5"
          style={{ color: "var(--color-muted)" }}
        >
          {greeting},
        </p>
        <h1
          className="text-[34px] font-black uppercase leading-none tracking-tight"
          style={{
            color: "var(--color-text)",
            textShadow:
              "0 0 80px rgba(245,166,35,0.40), 0 0 24px rgba(245,166,35,0.18), 0 2px 16px rgba(0,0,0,0.95)",
          }}
        >
          {username}
        </h1>
        {leagueCount > 0 && (
          <p
            className="text-[8px] font-black uppercase tracking-[0.28em] mt-2"
            style={{ color: "var(--color-muted)" }}
          >
            {leagueCount} {leagueCount === 1 ? "Liga" : "Ligen"}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

type League = {
  id: string;
  name: string;
  status: string;
  scoring_type: string;
};

type MyTeam = {
  id: string;
  league_id: string;
  name: string;
  total_points: number;
};

type Gameweek = {
  league_id: string;
  gameweek: number;
  status: string; // "upcoming" | "active" | "finished"
};

type Matchup = {
  league_id: string;
  gameweek: number;
  home_team_id: string;
  away_team_id: string;
  home_points: number | null;
  away_points: number | null;
  winner_team_id: string | null;
};

type LeagueCard = {
  league: League;
  myTeam: MyTeam;
  rank: number;
  teamCount: number;
  activeGW: Gameweek | null;
  matchup: { opponentName: string; opponentPoints: number } | null;
};

type Activity = {
  id: string;
  league_id: string;
  type: string;
  description: string;
  created_at: string;
  player_name?: string;
  team_name?: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Guten Morgen";
  if (h < 18) return "Guten Tag";
  return "Guten Abend";
}

function gwStatusChip(gw: Gameweek | null, leagueStatus: string) {
  if (!gw) {
    if (leagueStatus === "drafting") return { label: "Draft",        color: "var(--color-accent)",   live: false };
    if (leagueStatus === "setup")    return { label: "Setup",        color: "var(--color-muted)",    live: false };
    return                                  { label: "–",            color: "var(--color-border)",   live: false };
  }
  if (gw.status === "active")   return     { label: "Live",          color: "var(--color-success)",  live: true  };
  if (gw.status === "finished") return     { label: "Abgeschlossen", color: "var(--color-muted)",    live: false };
  return                                   { label: "Bald",          color: "var(--color-info)",     live: false };
}

/** Circle badge with 2-char initials */
function LeagueBadge({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
  return (
    <div
      className="w-12 h-12 rounded-full flex items-center justify-center font-black text-sm flex-shrink-0"
      style={{
        background: "linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 25%, var(--bg-elevated)), var(--bg-elevated))",
        border: "1.5px solid color-mix(in srgb, var(--color-primary) 45%, transparent)",
        color: "var(--color-primary)",
        letterSpacing: "0.05em",
      }}
    >
      {initials}
    </div>
  );
}

function rankDisplay(rank: number) {
  if (rank === 1) return "🥇 1. Platz";
  if (rank === 2) return "🥈 2. Platz";
  if (rank === 3) return "🥉 3. Platz";
  return `${rank}. Platz`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [user, setUser] = useState<any>(null);
  const [cards, setCards] = useState<LeagueCard[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadData(data.user.id);
    });
  }, []);

  async function loadData(userId: string) {
    setLoading(true);
    try {
      // 1. User's league teams
      const { data: myTeams } = await supabase
        .from("teams")
        .select("id, league_id, name, total_points")
        .eq("user_id", userId)
        .not("league_id", "is", null);

      if (!myTeams || myTeams.length === 0) { setLoading(false); return; }

      const leagueIds = myTeams.map((t: MyTeam) => t.league_id);

      // 2–6: Parallel fetches
      const [leaguesRes, allTeamsRes, gwRes, matchupRes, activityRes] = await Promise.all([
        supabase.from("leagues").select("id, name, status, scoring_type").in("id", leagueIds),
        supabase.from("teams").select("id, league_id, total_points").in("league_id", leagueIds),
        supabase.from("liga_gameweeks").select("league_id, gameweek, status").in("league_id", leagueIds).order("gameweek", { ascending: false }),
        supabase.from("liga_matchups").select("league_id, gameweek, home_team_id, away_team_id, home_points, away_points, winner_team_id").in("league_id", leagueIds),
        supabase.from("liga_transactions").select("id, league_id, type, description, created_at, player_name, team_name").in("league_id", leagueIds).order("created_at", { ascending: false }).limit(8),
      ]);

      const leagues: League[] = leaguesRes.data || [];
      const allTeams: { id: string; league_id: string; total_points: number }[] = allTeamsRes.data || [];
      const gameweeks: Gameweek[] = gwRes.data || [];
      const matchups: Matchup[] = matchupRes.data || [];

      // Build lookup maps
      const leagueMap = new Map<string, League>(leagues.map((l) => [l.id, l]));

      const allTeamsMap = new Map<string, typeof allTeams>();
      allTeams.forEach((t) => {
        const arr = allTeamsMap.get(t.league_id) || [];
        arr.push(t);
        allTeamsMap.set(t.league_id, arr);
      });

      // Best GW per league: prefer active, then highest number
      const gwMap = new Map<string, Gameweek>();
      gameweeks.forEach((gw) => {
        const existing = gwMap.get(gw.league_id);
        if (!existing || gw.status === "active" || gw.gameweek > existing.gameweek) {
          gwMap.set(gw.league_id, gw);
        }
      });

      // Opponent name lookup (all teams by id)
      const teamNameMap = new Map<string, string>();
      myTeams.forEach((t: MyTeam) => teamNameMap.set(t.id, t.name));

      // Build cards
      const result: LeagueCard[] = myTeams
        .filter((t: MyTeam) => leagueMap.has(t.league_id))
        .map((t: MyTeam) => {
          const league = leagueMap.get(t.league_id)!;
          const leagueTeams = (allTeamsMap.get(t.league_id) || [])
            .sort((a, b) => b.total_points - a.total_points);
          const rank = leagueTeams.findIndex((lt) => lt.id === t.id) + 1;
          const activeGW = gwMap.get(t.league_id) ?? null;

          // Find this team's matchup in the active GW
          let matchup: LeagueCard["matchup"] = null;
          if (activeGW) {
            const mu = matchups.find(
              (m) =>
                m.league_id === t.league_id &&
                m.gameweek === activeGW.gameweek &&
                (m.home_team_id === t.id || m.away_team_id === t.id)
            );
            if (mu) {
              const isHome = mu.home_team_id === t.id;
              const opponentId = isHome ? mu.away_team_id : mu.home_team_id;
              const opponentPoints = isHome ? (mu.away_points ?? 0) : (mu.home_points ?? 0);
              // Find opponent name from allTeams
              const opponentTeam = allTeams.find((at) => at.id === opponentId);
              const opponentName = teamNameMap.get(opponentId) || opponentTeam?.id?.slice(0, 8) || "Gegner";
              matchup = { opponentName, opponentPoints };
            }
          }

          return {
            league,
            myTeam: t,
            rank: rank > 0 ? rank : leagueTeams.length,
            teamCount: leagueTeams.length,
            activeGW,
            matchup,
          };
        })
        .sort((a, b) => {
          // Active live first, then drafting, then by points
          if (a.activeGW?.status === "active" && b.activeGW?.status !== "active") return -1;
          if (b.activeGW?.status === "active" && a.activeGW?.status !== "active") return 1;
          return b.myTeam.total_points - a.myTeam.total_points;
        });

      setCards(result);

      // Activities (best-effort — table might not exist yet)
      if (activityRes.data) setActivities(activityRes.data as Activity[]);

    } catch (e) {
      console.error("Home loadData:", e);
    }
    setLoading(false);
  }

  const username =
    user?.user_metadata?.username ||
    user?.email?.split("@")[0] ||
    "Manager";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main
      className="flex min-h-screen flex-col items-center pb-28"
      style={{ background: "var(--bg-page)" }}
    >
      {/* ── Hero ── */}
      <HeroSection
        username={username}
        greeting={greeting()}
        leagueCount={cards.length}
      />

      {/* ── League cards ── */}
      <div className="w-full max-w-md px-4">
      {loading ? (
        <div className="w-full flex justify-center py-16">
          <Spinner text="Lade Ligen..." />
        </div>
      ) : cards.length === 0 ? (
        <div className="w-full max-w-md flex flex-col items-center gap-3 py-12">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl" style={{ background: "var(--bg-elevated)" }}>🏆</div>
          <p className="text-sm font-black uppercase tracking-wider" style={{ color: "var(--color-muted)" }}>Noch keine Ligen</p>
          <p className="text-[10px] text-center leading-relaxed" style={{ color: "var(--color-border)" }}>
            Erstelle oder tritt einer Liga bei, um loszulegen.
          </p>
        </div>
      ) : (
        <div className="w-full max-w-md flex flex-col gap-3 relative z-10">
          {cards.map(({ league, myTeam, rank, teamCount, activeGW, matchup }) => {
            const chip = gwStatusChip(activeGW, league.status);
            const isLive = chip.live;

            return (
              <a
                key={league.id}
                href={`/leagues/${league.id}/lineup`}
                className="block rounded-2xl overflow-hidden transition-all active:scale-[0.98]"
                style={{
                  background: "var(--bg-card)",
                  border: `1px solid ${isLive
                    ? "color-mix(in srgb, var(--color-primary) 45%, transparent)"
                    : "color-mix(in srgb, var(--color-border) 80%, transparent)"}`,
                  boxShadow: isLive
                    ? "0 0 24px color-mix(in srgb, var(--color-primary) 10%, transparent)"
                    : undefined,
                }}
              >
                {/* Card body */}
                <div className="p-4">
                  {/* Row 1: badge + name + MD badge */}
                  <div className="flex items-center gap-3 mb-3">
                    <LeagueBadge name={league.name} />

                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-black uppercase tracking-wide leading-tight truncate"
                        style={{ color: "var(--color-text)" }}>
                        {league.name}
                      </p>
                      {/* Status + type row */}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest"
                          style={{ color: chip.color }}>
                          {isLive && (
                            <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block"
                              style={{ background: "var(--color-success)" }} />
                          )}
                          {chip.label}
                        </span>
                        <span style={{ color: "var(--color-border)" }} className="text-[8px]">·</span>
                        <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                          {league.scoring_type === "h2h" ? "H2H" : "Punkte"}
                        </span>
                      </div>
                    </div>

                    {/* MD badge */}
                    {activeGW && (
                      <span className="flex-shrink-0 rounded-lg px-2 py-1 text-[8px] font-black uppercase tracking-widest"
                        style={{
                          background: "var(--bg-elevated)",
                          color: "var(--color-muted)",
                          border: "1px solid var(--color-border)",
                        }}>
                        MD {activeGW.gameweek}
                      </span>
                    )}
                  </div>

                  {/* Divider */}
                  <div style={{ height: 1, background: "var(--color-border)", opacity: 0.4 }} className="mb-3" />

                  {/* Row 2: rank + points */}
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
                        {myTeam.name}
                      </p>
                      <p className="text-[11px] font-black" style={{ color: "var(--color-text)" }}>
                        {rankDisplay(rank)}
                        <span className="ml-1 font-black" style={{ color: "var(--color-border)" }}>
                          von {teamCount}
                        </span>
                      </p>
                      {/* Matchup line */}
                      {matchup && (
                        <p className="text-[9px] mt-1 font-black" style={{ color: "var(--color-muted)" }}>
                          vs {matchup.opponentName}
                          {matchup.opponentPoints > 0 && (
                            <span style={{ color: "var(--color-border)" }}> · {matchup.opponentPoints.toFixed(1)} Pkt</span>
                          )}
                          {isLive && <span style={{ color: "var(--color-success)" }}> · Live</span>}
                        </p>
                      )}
                    </div>

                    {/* Points */}
                    <div className="text-right">
                      <p className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: "var(--color-muted)" }}>
                        Gesamt
                      </p>
                      <p className="text-[28px] font-black leading-none tracking-tight" style={{ color: "var(--color-primary)" }}>
                        {myTeam.total_points.toFixed(1)}
                      </p>
                      <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                        Pkt
                      </p>
                    </div>
                  </div>
                </div>

                {/* Live footer strip */}
                {isLive && (
                  <div className="px-4 py-2 flex items-center gap-2"
                    style={{ background: "color-mix(in srgb, var(--color-primary) 8%, transparent)" }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--color-success)" }} />
                    <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-success)" }}>
                      Spieltag läuft
                    </span>
                  </div>
                )}
              </a>
            );
          })}
        </div>
      )}

      </div>{/* end px-4 wrapper */}

      {/* ── Join / Create ── */}
      <div className="w-full max-w-md px-4 mt-4 relative z-10">
        <a
          href="/leagues"
          className="flex items-center justify-center gap-2 w-full rounded-2xl py-3.5 transition-all active:scale-[0.98]"
          style={{
            background: "var(--bg-elevated)",
            border: "1px dashed color-mix(in srgb, var(--color-primary) 28%, transparent)",
          }}
        >
          <span className="text-base" style={{ color: "var(--color-primary)" }}>+</span>
          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            Liga beitreten / erstellen
          </span>
        </a>
      </div>

      {/* ── Aktivitäten ── */}
      {activities.length > 0 && (
        <div className="w-full max-w-md px-4 mt-6 relative z-10">
          <p className="text-[9px] font-black uppercase tracking-[0.25em] mb-3" style={{ color: "var(--color-muted)" }}>
            Aktivitäten
          </p>
          <div className="flex flex-col gap-2">
            {activities.slice(0, 5).map((a) => (
              <div key={a.id} className="flex items-center gap-3 py-2.5 px-3 rounded-xl"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}>
                <span className="text-sm flex-shrink-0">
                  {a.type === "transfer" ? "🔄" : a.type === "waiver" ? "📋" : a.type === "trade" ? "🤝" : "📝"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black truncate" style={{ color: "var(--color-text)" }}>
                    {a.player_name || a.description}
                  </p>
                  {a.team_name && (
                    <p className="text-[8px] font-black uppercase tracking-widest mt-0.5 truncate" style={{ color: "var(--color-muted)" }}>
                      {a.team_name}
                    </p>
                  )}
                </div>
                <p className="text-[8px] font-black flex-shrink-0" style={{ color: "var(--color-border)" }}>
                  {new Date(a.created_at).toLocaleDateString("de-DE", { day: "numeric", month: "short" })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
