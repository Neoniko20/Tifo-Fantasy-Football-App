"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Bell, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BottomNav } from "@/app/components/BottomNav";
import { TifoUILogo } from "@/app/components/brand/TifoUILogo";
import { Spinner } from "@/app/components/ui/Spinner";

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
  status: string;
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

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function rankEmoji(rank: number) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `${rank}.`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [user, setUser]             = useState<any>(null);
  const [cards, setCards]           = useState<LeagueCard[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading]       = useState(true);

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
      const { data: myTeams } = await supabase
        .from("teams")
        .select("id, league_id, name, total_points")
        .eq("user_id", userId)
        .not("league_id", "is", null);

      if (!myTeams || myTeams.length === 0) { setLoading(false); return; }

      const leagueIds = myTeams.map((t: MyTeam) => t.league_id);

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

      const leagueMap = new Map<string, League>(leagues.map((l) => [l.id, l]));

      const allTeamsMap = new Map<string, typeof allTeams>();
      allTeams.forEach((t) => {
        const arr = allTeamsMap.get(t.league_id) || [];
        arr.push(t);
        allTeamsMap.set(t.league_id, arr);
      });

      const gwMap = new Map<string, Gameweek>();
      gameweeks.forEach((gw) => {
        const existing = gwMap.get(gw.league_id);
        if (!existing || gw.status === "active" || gw.gameweek > existing.gameweek) {
          gwMap.set(gw.league_id, gw);
        }
      });

      const teamNameMap = new Map<string, string>();
      myTeams.forEach((t: MyTeam) => teamNameMap.set(t.id, t.name));

      const result: LeagueCard[] = myTeams
        .filter((t: MyTeam) => leagueMap.has(t.league_id))
        .map((t: MyTeam) => {
          const league = leagueMap.get(t.league_id)!;
          const leagueTeams = (allTeamsMap.get(t.league_id) || [])
            .sort((a, b) => b.total_points - a.total_points);
          const rank = leagueTeams.findIndex((lt) => lt.id === t.id) + 1;
          const activeGW = gwMap.get(t.league_id) ?? null;

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
          if (a.activeGW?.status === "active" && b.activeGW?.status !== "active") return -1;
          if (b.activeGW?.status === "active" && a.activeGW?.status !== "active") return 1;
          return b.myTeam.total_points - a.myTeam.total_points;
        });

      setCards(result);
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

  // ── Derived hero values (no business logic change) ──────────────────────
  const activeCard   = cards.find(c => c.activeGW?.status === "active") ?? cards[0] ?? null;
  const activeGWNum  = activeCard?.activeGW?.gameweek;
  const firstLineup  = activeCard ? `/leagues/${activeCard.league.id}/lineup` : "/leagues";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[var(--bg-page)] text-[var(--color-text)]">
      <div className="relative mx-auto max-w-[430px]">

        {/* ══════════════════════════════════════════════════════
            HERO CONTAINER  –  Stadium photo background
        ══════════════════════════════════════════════════════ */}
        <div className="relative h-[580px] overflow-hidden">

          {/* ── L1: Stadium photo — T rechts sichtbar lassen ── */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/tifo-hero-stadium.png"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: "68% center" }}
          />

          {/* ── L2: Links-Gradient — rechte Seite frei ── */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.60) 40%, rgba(0,0,0,0.20) 70%, transparent 100%)",
            }}
          />

          {/* ── L3: Pulsierender Floodlight Beam oben rechts ── */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 80% 8%, rgba(255,175,50,0.32), transparent 50%)",
              animation: "tifo-beam-pulse 4s ease-in-out infinite",
              transformOrigin: "80% 8%",
            }}
          />

          {/* ── L4: Grain / Depth Layer ── */}
          <div
            className="pointer-events-none absolute inset-0 mix-blend-overlay"
            style={{
              backgroundImage: "url('/noise.svg')",
              opacity: 0.06,
            }}
          />

          {/* ── L5: Top fade — TopNav lesbar ── */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-28"
            style={{
              background: "linear-gradient(to bottom, rgba(0,0,0,0.50) 0%, transparent 100%)",
            }}
          />

          {/* ── L6: Bottom fade — 25% Hero-Höhe, teased content sichtbar ── */}
          <div
            className="pointer-events-none absolute bottom-0 left-0 right-0"
            style={{
              height: "25%",
              background:
                "linear-gradient(to bottom, transparent 0%, rgba(5,3,1,0.80) 60%, var(--bg-page) 100%)",
            }}
          />

          {/* ── Floating Gold Particles ── */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {[
              { left: "8%",  bottom: "28%", size: 3, delay: "0s",    dur: "7s"  },
              { left: "18%", bottom: "22%", size: 2, delay: "1.2s",  dur: "9s"  },
              { left: "28%", bottom: "35%", size: 2, delay: "2.5s",  dur: "8s"  },
              { left: "14%", bottom: "18%", size: 3, delay: "0.8s",  dur: "10s" },
              { left: "22%", bottom: "42%", size: 2, delay: "3.1s",  dur: "7s"  },
              { left: "6%",  bottom: "50%", size: 2, delay: "1.8s",  dur: "9s"  },
              { left: "32%", bottom: "25%", size: 3, delay: "4s",    dur: "8s"  },
              { left: "10%", bottom: "60%", size: 2, delay: "2.2s",  dur: "11s" },
            ].map((p, i) => (
              <span
                key={i}
                className="absolute rounded-full bg-[var(--color-primary)]"
                style={{
                  left: p.left,
                  bottom: p.bottom,
                  width: p.size,
                  height: p.size,
                  animation: `tifo-particle-drift ${p.dur} ${p.delay} ease-in-out infinite`,
                }}
              />
            ))}
          </div>

          {/* ── Content layer (z-10) ── */}
          <div className="relative z-10 flex h-full flex-col pt-5">

            {/* TopNav — volle Breite */}
            <header className="flex items-center justify-between px-5">
              <TifoUILogo variant="wordmark" size="sm" />
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-[var(--color-primary)] backdrop-blur"
                style={{ border: "1px solid rgba(255,255,255,0.12)" }}
                aria-label="Benachrichtigungen"
              >
                <Bell size={18} />
              </button>
            </header>

            {/* Hero copy — links fixiert, max-w-[260px], T-Bereich rechts frei */}
            <div className="flex flex-1 flex-col items-start justify-end pb-32 pl-5" style={{ paddingRight: "40%" }}>
              <div className="w-full max-w-[260px]">

                {/* Spieltag label */}
                <p
                  className="mb-2 text-[9px] font-black uppercase tracking-[0.35em] text-[var(--color-primary)]"
                  style={{ opacity: 0.85 }}
                >
                  {activeGWNum ? `Spieltag ${activeGWNum}` : "Fantasy Football"}
                </p>

                {/* Headline — tight typo */}
                <h1
                  className="text-left text-[52px] font-black uppercase text-white"
                  style={{
                    lineHeight: 0.9,
                    letterSpacing: "-0.02em",
                    textShadow:
                      "0 2px 24px rgba(0,0,0,0.90), 0 0 20px rgba(255,200,80,0.15)",
                  }}
                >
                  GAME<br />ON.
                </h1>

                {/* Subtext */}
                <p className="mt-3 text-left text-[12px] font-semibold leading-snug text-white/55">
                  Set your lineup and chase the glory.
                </p>

                {/* CTA — premium warm button */}
                <div className="mt-4">
                  <Link
                    href={firstLineup}
                    className="inline-flex items-center rounded-full px-6 py-2.5 text-[11px] font-black uppercase tracking-[0.18em] transition-transform duration-200 active:scale-[0.97]"
                    style={{
                      background:
                        "linear-gradient(135deg, #f5c842 0%, #e8950a 100%)",
                      color: "#050301",
                      animation: "tifo-cta-glow 2s ease-in-out infinite",
                    }}
                  >
                    Set Lineup
                  </Link>
                </div>

              </div>
            </div>
          </div>
        </div>

        {/* ── Gold Divider ── */}
        <div className="relative z-20 mt-0 flex items-center justify-center">
          <div
            style={{
              width: "60%",
              height: 1,
              background:
                "linear-gradient(to right, transparent, rgba(244,196,48,0.55), transparent)",
              opacity: 0.2,
            }}
          />
        </div>

        {/* ══════════════════════════════════════════════════════
            CONTENT — erste Card wird angeteasert
        ══════════════════════════════════════════════════════ */}
        <section className="relative z-20 -mt-10 px-5 pb-28">

          {/* ── Subtle gold glow behind first card ── */}
          <div className="pointer-events-none absolute left-1/2 top-4 h-24 w-[75%] -translate-x-1/2 rounded-full blur-2xl"
            style={{ background: "radial-gradient(circle, rgba(244,196,48,0.16), transparent 70%)" }}
          />

          {/* ── Lift-in wrapper ── */}
          <div className="relative motion-safe:animate-[tifo-card-lift_520ms_ease-out_forwards]"
            style={{ transform: "translateY(14px)", opacity: 0.96, transition: "transform 500ms ease-out, opacity 500ms ease-out" }}
          >

          <h2
            className="mb-4 text-[10px] font-black uppercase tracking-[0.32em]"
            style={{ color: "var(--color-primary)", opacity: 0.7 }}
          >
            Deine Ligen
          </h2>

          {/* ── League Cards ── */}
          <div className="space-y-4">
            {loading ? (
              <div className="flex justify-center py-16">
                <Spinner text="Lade Ligen..." />
              </div>
            ) : cards.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-2xl text-3xl"
                  style={{ background: "var(--bg-elevated)" }}
                >
                  🏆
                </div>
                <p className="text-sm font-black uppercase tracking-wider" style={{ color: "var(--color-muted)" }}>
                  Noch keine Ligen
                </p>
                <p className="text-[10px] leading-relaxed" style={{ color: "var(--color-border)" }}>
                  Erstelle oder tritt einer Liga bei, um loszulegen.
                </p>
              </div>
            ) : (
              cards.map(({ league, myTeam, rank, teamCount, activeGW, matchup }) => {
                const isLive = activeGW?.status === "active";
                const mode =
                  league.status === "drafting" || league.status === "setup"
                    ? "Draft"
                    : league.scoring_type === "h2h"
                    ? "H2H"
                    : "Classic";
                const matchdayLabel = activeGW ? `MD ${activeGW.gameweek}` : undefined;

                return (
                  <Link
                    key={league.id}
                    href={`/leagues/${league.id}/lineup`}
                    className="group block overflow-hidden rounded-[24px] border border-[var(--color-border)] p-4 shadow-[0_0_30px_rgba(0,0,0,0.55)] backdrop-blur-md transition active:scale-[0.99]"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(244,196,48,0.10), rgba(0,0,0,0.58) 40%, rgba(0,0,0,0.82))",
                      borderColor: isLive
                        ? "color-mix(in srgb, var(--color-primary) 45%, transparent)"
                        : "var(--color-border)",
                      boxShadow: isLive
                        ? "0 0 30px color-mix(in srgb, var(--color-primary) 10%, transparent)"
                        : "0 0 30px rgba(0,0,0,0.55)",
                    }}
                  >
                    <div className="relative">
                      {/* Card light streak */}
                      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[var(--color-primary)]/10 blur-2xl" />

                      {/* Row 1: initials + name + MD badge */}
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          {/* Initials circle */}
                          <div
                            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-black shadow-[0_0_18px_rgba(244,196,48,0.16)]"
                            style={{
                              background: "var(--color-primary-soft)",
                              border: "1.5px solid var(--color-primary)",
                              color: "var(--color-primary)",
                            }}
                          >
                            {getInitials(league.name)}
                          </div>

                          <div>
                            <h2 className="text-lg font-black uppercase tracking-[-0.03em] text-[var(--color-text)]">
                              {league.name}
                            </h2>
                            <div className="mt-1 flex items-center gap-2">
                              {isLive && (
                                <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--color-success)]">
                                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-success)] shadow-[0_0_10px_var(--color-success)]" />
                                  Live
                                </span>
                              )}
                              <span className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--color-primary)]/70">
                                {mode}
                              </span>
                            </div>
                          </div>
                        </div>

                        {matchdayLabel && (
                          <div
                            className="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em]"
                            style={{
                              background: "rgba(0,0,0,0.30)",
                              border: "1px solid var(--color-border)",
                              color: "var(--color-primary)",
                            }}
                          >
                            {matchdayLabel}
                          </div>
                        )}
                      </div>

                      {/* Divider */}
                      <div
                        className="my-4 h-px"
                        style={{ background: "color-mix(in srgb, var(--color-border) 45%, transparent)" }}
                      />

                      {/* Row 2: rank/opponent | points */}
                      <div className="grid grid-cols-[1fr_auto] items-end gap-4">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--color-primary)]/55">
                            Mein Team
                          </p>
                          <p className="mt-1 text-sm font-black text-[var(--color-text)]">
                            {rankEmoji(rank)}{" "}
                            <span className="text-[var(--color-text-secondary)]">
                              Platz von {teamCount}
                            </span>
                          </p>

                          {matchup && (
                            <p className="mt-3 text-xs font-bold text-[var(--color-text-secondary)]">
                              vs {matchup.opponentName}
                              {matchup.opponentPoints > 0 && (
                                <span className="ml-1 text-[var(--color-primary)]">
                                  · {matchup.opponentPoints.toLocaleString("de-DE")} Pkt
                                </span>
                              )}
                              {isLive && (
                                <span className="ml-1 text-[var(--color-success)]"> · Live</span>
                              )}
                            </p>
                          )}
                        </div>

                        <div className="text-right">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--color-primary)]/55">
                            Gesamt
                          </p>
                          <p className="text-[34px] font-black leading-none tracking-[-0.06em] text-[var(--color-primary)]">
                            {(myTeam.total_points ?? 0).toLocaleString("de-DE")}
                          </p>
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--color-primary)]/65">
                            Pkt
                          </p>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}

            {/* Join / Create */}
            {!loading && (
              <Link
                href="/leagues"
                className="flex h-16 items-center justify-center rounded-[22px] text-xs font-black uppercase tracking-[0.16em] text-[var(--color-primary)]"
                style={{
                  border: "1.5px dashed color-mix(in srgb, var(--color-primary) 45%, transparent)",
                  background: "rgba(0,0,0,0.20)",
                }}
              >
                <Plus size={15} className="mr-2" />
                Liga beitreten / erstellen
              </Link>
            )}
          </div>

          {/* ── Aktivitäten ── */}
          {activities.length > 0 && (
            <div className="mt-8">
              <p
                className="mb-3 text-[9px] font-black uppercase tracking-[0.25em]"
                style={{ color: "var(--color-muted)" }}
              >
                Aktivitäten
              </p>
              <div className="flex flex-col gap-2">
                {activities.slice(0, 5).map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <span className="flex-shrink-0 text-sm">
                      {a.type === "transfer"
                        ? "🔄"
                        : a.type === "waiver"
                        ? "📋"
                        : a.type === "trade"
                        ? "🤝"
                        : "📝"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-[10px] font-black"
                        style={{ color: "var(--color-text)" }}
                      >
                        {a.player_name || a.description}
                      </p>
                      {a.team_name && (
                        <p
                          className="mt-0.5 truncate text-[8px] font-black uppercase tracking-widest"
                          style={{ color: "var(--color-muted)" }}
                        >
                          {a.team_name}
                        </p>
                      )}
                    </div>
                    <p
                      className="flex-shrink-0 text-[8px] font-black"
                      style={{ color: "var(--color-border)" }}
                    >
                      {new Date(a.created_at).toLocaleDateString("de-DE", {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>
        </section>

        <BottomNav />
      </div>
    </main>
  );
}
