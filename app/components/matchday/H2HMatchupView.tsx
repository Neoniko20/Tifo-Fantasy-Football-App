"use client";

import { useMemo } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface H2HTeam {
  id: string;
  name: string;
}

export interface H2HPlayer {
  id: string | number;
  name: string;
  position: string;
  teamName: string;
  points: number;
  minutes?: number;
  isCaptain?: boolean;
  isViceCaptain?: boolean;
  status: "live" | "finished" | "upcoming";
  kickoff?: string;
}

export interface H2HMatchup {
  homeTeam: H2HTeam;
  awayTeam: H2HTeam;
  homePlayers: H2HPlayer[];       // starters in lineup order
  awayPlayers: H2HPlayer[];       // starters in lineup order
  homeBench?: H2HPlayer[];        // optional bench
  awayBench?: H2HPlayer[];        // optional bench
  homePoints: number;
  awayPoints: number;
  projectedHomePoints?: number;
  projectedAwayPoints?: number;
  captainMultiplier?: number;
  viceMode?: "backup" | "bonus";
  viceCaptainMultiplier?: number;
}

interface Props {
  matchup: H2HMatchup;
  isDemoMode?: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

type NormalPos = "GK" | "DEF" | "MID" | "FWD";

const POS_COLOR: Record<NormalPos, string> = {
  GK:  "var(--color-primary)",
  DEF: "var(--color-info)",
  MID: "var(--color-success)",
  FWD: "var(--color-error)",
};

const STATUS_COLOR: Record<H2HPlayer["status"], string> = {
  live:     "#ff6b00",
  finished: "#00ce7d",
  upcoming: "#5a4020",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizePos(raw: string): NormalPos {
  if (raw === "GK")                  return "GK";
  if (raw === "DEF" || raw === "DF") return "DEF";
  if (raw === "MID" || raw === "MF") return "MID";
  if (raw === "FWD" || raw === "FW") return "FWD";
  return "MID";
}

function effectivePoints(
  p: H2HPlayer,
  captainMultiplier = 2,
  viceMode: "backup" | "bonus" = "backup",
  vcMultiplier = 1,
  captainMinutes = 90,
): number {
  if (p.isCaptain) return p.points * captainMultiplier;
  if (p.isViceCaptain) {
    if (viceMode === "bonus") return p.points * vcMultiplier;
    if (viceMode === "backup" && captainMinutes === 0) return p.points * captainMultiplier;
  }
  return p.points;
}

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  if (isToday) return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
}

// ─── PlayerHalf ───────────────────────────────────────────────────────────────
// Renders ONE side (home or away) of a matchup row.
// Home: [Name (C) ● ] [POS] [pts]  — right-aligned, pts close to center
// Away:              [pts] [POS] [● Name (C)]  — left-aligned, pts close to center

function PlayerHalf({
  player,
  side,
  captainMultiplier = 2,
  viceMode = "backup",
  vcMultiplier = 1,
  captainMinutes = 90,
}: {
  player: H2HPlayer | null;
  side: "home" | "away";
  captainMultiplier?: number;
  viceMode?: "backup" | "bonus";
  vcMultiplier?: number;
  captainMinutes?: number;
}) {
  // Empty slot — real gap (team has fewer starters)
  if (!player) {
    return (
      <div className="flex-1 flex items-center px-1" style={{ opacity: 0.15 }}>
        <div className="flex-1 h-px" style={{ background: "var(--color-border)" }} />
      </div>
    );
  }

  const isHome   = side === "home";
  const pts      = effectivePoints(player, captainMultiplier, viceMode, vcMultiplier, captainMinutes);
  const pos      = normalizePos(player.position);
  const posColor = POS_COLOR[pos];
  const dim      = player.status === "upcoming";
  const isLive   = player.status === "live";

  const ptsColor = isLive
    ? STATUS_COLOR.live
    : player.status === "finished"
    ? "var(--color-text)"
    : "var(--color-muted)";

  const ptsGlow = isLive ? `0 0 10px ${STATUS_COLOR.live}70` : undefined;

  const posBadge = (
    <span
      className="text-[6px] font-black px-[5px] py-[2px] rounded flex-shrink-0 uppercase tracking-wide"
      style={{
        background: `color-mix(in srgb, ${posColor} 14%, var(--bg-page))`,
        color: posColor,
        border: `1px solid color-mix(in srgb, ${posColor} 22%, transparent)`,
      }}
    >
      {pos}
    </span>
  );

  const captainPtsColor = player.isCaptain ? "rgba(244,196,48,1)" : ptsColor;
  const captainPtsGlow  = player.isCaptain
    ? `0 0 8px rgba(244,196,48,0.45)`
    : ptsGlow;

  const ptsEl = (
    <p
      className="text-[13px] font-black flex-shrink-0 tabular-nums"
      style={{
        color: captainPtsColor,
        textShadow: captainPtsGlow,
        width: 38,
        textAlign: isHome ? "right" : "left",
      }}
    >
      {pts.toFixed(1)}
    </p>
  );

  const liveDot = isLive ? (
    <span
      className="w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse"
      style={{ background: STATUS_COLOR.live }}
    />
  ) : null;

  // C/V badge — outside the truncating <p> so it's always visible
  const capBadge = player.isCaptain ? (
    <span
      className="flex-shrink-0 text-[7px] font-black leading-none px-1 py-0.5 rounded"
      style={{
        background: "rgba(244,196,48,0.18)",
        color: "rgba(244,196,48,1)",
        border: "1px solid rgba(244,196,48,0.42)",
      }}
    >
      C
    </span>
  ) : player.isViceCaptain ? (
    <span
      className="flex-shrink-0 text-[7px] font-black leading-none px-1 py-0.5 rounded"
      style={{
        background: "rgba(0,0,0,0.55)",
        color: "rgba(244,196,48,0.80)",
        border: "1px solid rgba(244,196,48,0.28)",
      }}
    >
      V
    </span>
  ) : null;

  const nameLine = (
    <p
      className="text-[10px] font-black truncate leading-tight"
      style={{ color: dim ? "var(--color-muted)" : "var(--color-text)" }}
    >
      {player.name}
    </p>
  );

  // ── Home side layout: [name+dot] [pos] [pts]  →  visually right-to-left from center
  if (isHome) {
    return (
      <div
        className="flex-1 flex items-center gap-1.5 min-w-0"
        style={{ opacity: dim ? 0.42 : 1 }}
      >
        {/* Name (flexible, truncates) + badge + live dot */}
        <div className="flex-1 min-w-0 flex items-center justify-end gap-1">
          {liveDot}
          {capBadge}
          <div className="min-w-0 text-right">{nameLine}</div>
        </div>
        {posBadge}
        {ptsEl}
      </div>
    );
  }

  // ── Away side layout: [pts] [pos] [name+dot]  →  visually left-to-right from center
  return (
    <div
      className="flex-1 flex items-center gap-1.5 min-w-0"
      style={{ opacity: dim ? 0.42 : 1 }}
    >
      {ptsEl}
      {posBadge}
      <div className="flex-1 min-w-0 flex items-center gap-1">
        <div className="min-w-0">{nameLine}</div>
        {capBadge}
        {liveDot}
      </div>
    </div>
  );
}

// ─── MatchRow ─────────────────────────────────────────────────────────────────

function MatchRow({
  home, away, captainMultiplier = 2, viceMode = "backup", vcMultiplier = 1,
  homeCapMinutes = 90, awayCapMinutes = 90,
}: {
  home: H2HPlayer | null;
  away: H2HPlayer | null;
  captainMultiplier?: number;
  viceMode?: "backup" | "bonus";
  vcMultiplier?: number;
  homeCapMinutes?: number;
  awayCapMinutes?: number;
}) {
  return (
    <div className="flex items-center py-[7px]">
      <PlayerHalf player={home} side="home" captainMultiplier={captainMultiplier}
        viceMode={viceMode} vcMultiplier={vcMultiplier} captainMinutes={homeCapMinutes} />
      {/* Center divider */}
      <div
        className="flex-shrink-0 mx-1.5"
        style={{ width: 1, height: 16, background: "var(--color-border)", opacity: 0.4 }}
      />
      <PlayerHalf player={away} side="away" captainMultiplier={captainMultiplier}
        viceMode={viceMode} vcMultiplier={vcMultiplier} captainMinutes={awayCapMinutes} />
    </div>
  );
}

// ─── BenchSection ─────────────────────────────────────────────────────────────

function BenchSection({
  homeTeam,
  awayTeam,
  home,
  away,
  captainMultiplier = 2,
  viceMode = "backup",
  vcMultiplier = 1,
  homeCapMinutes = 90,
  awayCapMinutes = 90,
}: {
  homeTeam: H2HTeam;
  awayTeam: H2HTeam;
  home: H2HPlayer[];
  away: H2HPlayer[];
  captainMultiplier?: number;
  viceMode?: "backup" | "bonus";
  vcMultiplier?: number;
  homeCapMinutes?: number;
  awayCapMinutes?: number;
}) {
  if (home.length === 0 && away.length === 0) return null;
  const rowCount = Math.max(home.length, away.length);

  return (
    <div className="px-4 mt-3">
      <p className="text-[7px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--color-muted)" }}>
        Bank
      </p>
      <div style={{ borderTop: "1px dashed var(--color-border)", opacity: 0.4 }} />
      <div className="mt-1 opacity-60">
        {Array.from({ length: rowCount }, (_, i) => (
          <MatchRow key={i} home={home[i] ?? null} away={away[i] ?? null}
            captainMultiplier={captainMultiplier} viceMode={viceMode} vcMultiplier={vcMultiplier}
            homeCapMinutes={homeCapMinutes} awayCapMinutes={awayCapMinutes} />
        ))}
      </div>
    </div>
  );
}

// ─── RemainingSection ─────────────────────────────────────────────────────────

function RemainingSection({
  homeTeam,
  awayTeam,
  home,
  away,
}: {
  homeTeam: H2HTeam;
  awayTeam: H2HTeam;
  home: H2HPlayer[];
  away: H2HPlayer[];
}) {
  if (home.length === 0 && away.length === 0) return null;

  const totalRemaining = home.length + away.length;
  return (
    <div className="mx-4 mt-3 mb-1 p-3 rounded-2xl" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
      <div className="flex items-center gap-2 mb-2.5">
        <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Ausstehend
        </p>
        <span
          className="text-[7px] font-black px-1.5 py-0.5 rounded-full"
          style={{ background: "rgba(255,107,0,0.15)", color: "#ff6b00", border: "1px solid rgba(255,107,0,0.30)" }}
        >
          {totalRemaining} offen
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {([
          { team: homeTeam, players: home },
          { team: awayTeam, players: away },
        ] as const).map(({ team, players }) => (
          <div key={team.id}>
            <p className="text-[7px] font-black uppercase tracking-widest mb-1.5 truncate" style={{ color: "var(--color-border)" }}>
              {team.name}
            </p>
            {players.length === 0 ? (
              <p className="text-[8px]" style={{ color: "var(--color-border)" }}>–</p>
            ) : (
              <div className="space-y-1">
                {players.map(p => (
                  <div key={p.id} className="flex items-center gap-1.5">
                    <span className="text-[8px]" style={{ color: "var(--color-border-subtle)" }}>·</span>
                    <p className="text-[9px] font-black truncate flex-1" style={{ color: "var(--color-text)" }}>
                      {p.name}
                      {p.isCaptain     && <span style={{ color: "rgba(244,196,48,1)" }}> (C)</span>}
                      {p.isViceCaptain && <span style={{ color: "rgba(244,196,48,0.55)" }}> (V)</span>}
                    </p>
                    {p.kickoff && (
                      <span className="text-[7px] flex-shrink-0" style={{ color: "var(--color-muted)" }}>
                        {formatKickoff(p.kickoff)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MomentumBar ─────────────────────────────────────────────────────────────

function MomentumBar({ homePoints, awayPoints }: { homePoints: number; awayPoints: number }) {
  const total = homePoints + awayPoints;
  if (total === 0) return null;
  const homeShare = homePoints / total;

  return (
    <div className="px-4 pt-1 pb-3">
      <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
          style={{
            width: `${homeShare * 100}%`,
            background: homePoints > awayPoints
              ? "linear-gradient(90deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 40%, transparent))"
              : homePoints === awayPoints
              ? "linear-gradient(90deg, var(--color-muted), transparent)"
              : "linear-gradient(90deg, rgba(255,255,255,0.12), transparent)",
          }}
        />
        {/* Trailing bar for away leader */}
        {awayPoints > homePoints && (
          <div
            className="absolute inset-y-0 right-0 rounded-full transition-all duration-700"
            style={{
              width: `${(1 - homeShare) * 100}%`,
              background: "linear-gradient(270deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 40%, transparent))",
            }}
          />
        )}
      </div>
      {homePoints !== awayPoints && (
        <div className="flex justify-between mt-0.5">
          <span className="text-[7px] font-black" style={{ color: "var(--color-muted)" }}>
            {homePoints > awayPoints ? `+${(homePoints - awayPoints).toFixed(1)}` : ""}
          </span>
          <span className="text-[7px] font-black" style={{ color: "var(--color-muted)" }}>
            {awayPoints > homePoints ? `+${(awayPoints - homePoints).toFixed(1)}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function H2HMatchupView({ matchup, isDemoMode }: Props) {
  const {
    homeTeam, awayTeam,
    homePlayers, awayPlayers,
    homeBench = [], awayBench = [],
    homePoints, awayPoints,
    projectedHomePoints, projectedAwayPoints,
    captainMultiplier = 2,
    viceMode = "backup",
    viceCaptainMultiplier = 1,
  } = matchup;

  const homeCapMinutes = useMemo(
    () => homePlayers.find(p => p.isCaptain)?.minutes ?? 90,
    [homePlayers],
  );
  const awayCapMinutes = useMemo(
    () => awayPlayers.find(p => p.isCaptain)?.minutes ?? 90,
    [awayPlayers],
  );

  const homePlayed = useMemo(
    () => homePlayers.filter(p => p.status !== "upcoming").length,
    [homePlayers],
  );
  const awayPlayed = useMemo(
    () => awayPlayers.filter(p => p.status !== "upcoming").length,
    [awayPlayers],
  );
  const hasLive = useMemo(
    () => [...homePlayers, ...awayPlayers].some(p => p.status === "live"),
    [homePlayers, awayPlayers],
  );
  const homeRemaining = useMemo(() => homePlayers.filter(p => p.status === "upcoming"), [homePlayers]);
  const awayRemaining = useMemo(() => awayPlayers.filter(p => p.status === "upcoming"), [awayPlayers]);

  // Index-based pairing — each team follows its own lineup order
  // Empty slots only for genuinely missing starters (team has < max players)
  const starterRowCount = Math.max(homePlayers.length, awayPlayers.length);

  const homeLeading = homePoints > awayPoints;
  const awayLeading = awayPoints > homePoints;

  return (
    <div className="flex flex-col max-w-[480px] mx-auto w-full">

      {/* ── Score Header ─────────────────────────────────────────────── */}
      <div
        className="px-4 pt-4 pb-5 relative overflow-hidden"
        style={{ background: "linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-page) 100%)" }}
      >
        {hasLive && (
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: `radial-gradient(ellipse at 50% 0%, ${STATUS_COLOR.live}08 0%, transparent 70%)` }} />
        )}

        {/* Demo badge */}
        {isDemoMode && (
          <div className="absolute top-2 right-2">
            <span className="text-[6px] font-black uppercase tracking-widest px-1.5 py-[3px] rounded-full"
              style={{ background: "var(--bg-elevated)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
              Demo
            </span>
          </div>
        )}

        {/* Team names */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-[9px] font-black uppercase tracking-widest truncate max-w-[38%]"
            style={{ color: homeLeading ? "var(--color-primary)" : "var(--color-muted)" }}>
            {homeTeam.name}
          </p>
          {hasLive ? (
            <span className="flex items-center gap-1 text-[7px] font-black uppercase px-2 py-0.5 rounded-full"
              style={{ background: `${STATUS_COLOR.live}18`, color: STATUS_COLOR.live, border: `1px solid ${STATUS_COLOR.live}40` }}>
              <span className="w-1 h-1 rounded-full inline-block animate-pulse" style={{ background: STATUS_COLOR.live }} />
              live
            </span>
          ) : (
            <span className="text-[8px] font-black" style={{ color: "var(--color-border)" }}>vs</span>
          )}
          <p className="text-[9px] font-black uppercase tracking-widest truncate max-w-[38%] text-right"
            style={{ color: awayLeading ? "var(--color-primary)" : "var(--color-muted)" }}>
            {awayTeam.name}
          </p>
        </div>

        {/* Big score */}
        <div className="flex items-end justify-center gap-3">
          <p className="text-[48px] font-black leading-none tabular-nums"
            style={{
              color: homeLeading ? "var(--color-primary)" : "var(--color-text)",
              textShadow: homeLeading
                ? `0 0 24px var(--color-primary), 0 0 60px var(--color-primary)60`
                : undefined,
              letterSpacing: "-2px",
            }}>
            {homePoints.toFixed(1)}
          </p>
          <span className="text-[16px] font-black mb-2" style={{ color: "var(--color-border)" }}>—</span>
          <p className="text-[48px] font-black leading-none tabular-nums"
            style={{
              color: awayLeading ? "var(--color-primary)" : "var(--color-text)",
              textShadow: awayLeading
                ? `0 0 24px var(--color-primary), 0 0 60px var(--color-primary)60`
                : undefined,
              letterSpacing: "-2px",
            }}>
            {awayPoints.toFixed(1)}
          </p>
        </div>

        {/* Meta */}
        <div className="flex items-start justify-between mt-2.5 px-1">
          <div>
            {projectedHomePoints !== undefined && (
              <p className="text-[8px] font-black" style={{ color: "var(--color-muted)" }}>
                Proj. {projectedHomePoints.toFixed(1)}
              </p>
            )}
            <p className="text-[7px]" style={{ color: "var(--color-border)" }}>
              {homePlayed}/{homePlayers.length} gespielt
            </p>
          </div>
          <div className="text-right">
            {projectedAwayPoints !== undefined && (
              <p className="text-[8px] font-black" style={{ color: "var(--color-muted)" }}>
                Proj. {projectedAwayPoints.toFixed(1)}
              </p>
            )}
            <p className="text-[7px]" style={{ color: "var(--color-border)" }}>
              {awayPlayed}/{awayPlayers.length} gespielt
            </p>
          </div>
        </div>
      </div>

      {/* ── Momentum bar ─────────────────────────────────────────────── */}
      <MomentumBar homePoints={homePoints} awayPoints={awayPoints} />

      {/* ── Starters: index-based rows, each team in own order ───────── */}
      <div className="px-4">
        {/* Column headers */}
        <div className="flex items-center mb-0.5">
          <p className="flex-1 text-right text-[7px] font-black uppercase tracking-widest truncate pr-4"
            style={{ color: "var(--color-border)" }}>
            {homeTeam.name}
          </p>
          <div style={{ width: 1 }} />
          <p className="flex-1 text-[7px] font-black uppercase tracking-widest truncate pl-4"
            style={{ color: "var(--color-border)" }}>
            {awayTeam.name}
          </p>
        </div>

        {Array.from({ length: starterRowCount }, (_, i) => (
          <MatchRow
            key={i}
            home={homePlayers[i] ?? null}
            away={awayPlayers[i] ?? null}
            captainMultiplier={captainMultiplier}
            viceMode={viceMode}
            vcMultiplier={viceCaptainMultiplier}
            homeCapMinutes={homeCapMinutes}
            awayCapMinutes={awayCapMinutes}
          />
        ))}
      </div>

      {/* ── Bench (optional) ─────────────────────────────────────────── */}
      <BenchSection
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        home={homeBench}
        away={awayBench}
        captainMultiplier={captainMultiplier}
        viceMode={viceMode}
        vcMultiplier={viceCaptainMultiplier}
        homeCapMinutes={homeCapMinutes}
        awayCapMinutes={awayCapMinutes}
      />

      {/* ── Remaining / upcoming ─────────────────────────────────────── */}
      <RemainingSection
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        home={homeRemaining}
        away={awayRemaining}
      />

      <div className="h-4" />
    </div>
  );
}
