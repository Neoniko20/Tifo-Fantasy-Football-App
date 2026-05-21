// lib/wm-simulator.ts
// Pure simulation logic — no Supabase calls, no side effects.
// All randomness goes through the seeded RNG for reproducibility.

import type { WMIngestEvent, WMPhase } from "@/lib/wm-types";

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────

export type SimRng = () => number;

export function createRng(seed?: number): SimRng {
  if (seed === undefined) return Math.random;
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Weighted random ───────────────────────────────────────────────────────────

function weightedPick<T>(rng: SimRng, items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ── Score generation ──────────────────────────────────────────────────────────

export interface SimScore {
  home: number;
  away: number;
  penalties_home?: number;
  penalties_away?: number;
}

export function generateScore(phase: WMPhase, rng: SimRng): SimScore {
  // WM-realistic goal distribution
  const homeGoals = weightedPick(rng, [0, 1, 2, 3, 4], [0.28, 0.34, 0.24, 0.10, 0.04]);
  const awayGoals = weightedPick(rng, [0, 1, 2, 3, 4], [0.28, 0.34, 0.24, 0.10, 0.04]);

  const isKO = phase !== "group";
  if (isKO && homeGoals === awayGoals) {
    // KO: must have a winner — generate penalties
    const penHome = Math.floor(rng() * 6); // 0–5
    // penAway must differ from penHome (simple: offset by 1-3)
    const penAway = (penHome + 1 + Math.floor(rng() * 3)) % 6;
    return { home: homeGoals, away: awayGoals, penalties_home: penHome, penalties_away: penAway };
  }

  return { home: homeGoals, away: awayGoals };
}

// ── Player stats generation ───────────────────────────────────────────────────

export interface PlayerStatsSim {
  player_id: number;
  goals: number;
  assists: number;
  minutes: number;
  shots_on: number;
  key_passes: number;
  pass_accuracy: number;
  dribbles: number;
  tackles: number;
  interceptions: number;
  saves: number;
  yellow_cards: number;
  red_cards: number;
  clean_sheet: boolean;
}

export function generatePlayerStats(
  playerIds: number[],
  score: SimScore,
  rng: SimRng,
): PlayerStatsSim[] {
  if (playerIds.length === 0) return [];

  const totalGoals = score.home + score.away;
  const stats: PlayerStatsSim[] = playerIds.map((id) => ({
    player_id: id,
    goals: 0,
    assists: 0,
    minutes: weightedPick(rng, [0, 45, 60, 75, 90], [0.05, 0.10, 0.10, 0.15, 0.60]),
    shots_on: 0,
    key_passes: Math.floor(rng() * 3),
    pass_accuracy: 60 + Math.floor(rng() * 35),
    dribbles: Math.floor(rng() * 3),
    tackles: Math.floor(rng() * 3),
    interceptions: Math.floor(rng() * 2),
    saves: 0,
    yellow_cards: rng() < 0.08 ? 1 : 0,
    red_cards: rng() < 0.01 ? 1 : 0,
    clean_sheet: score.home === 0 || score.away === 0,
  }));

  // Distribute goals and assists among players who played ≥45 min
  const eligible = stats.filter((s) => s.minutes >= 45);
  if (eligible.length === 0) return stats;

  for (let g = 0; g < totalGoals; g++) {
    const scorer = eligible[Math.floor(rng() * eligible.length)];
    scorer.goals += 1;
    scorer.shots_on += 1 + Math.floor(rng() * 2);
    // ~70% chance of an assist
    if (rng() < 0.70) {
      const assisters = eligible.filter((s) => s !== scorer);
      if (assisters.length > 0) {
        assisters[Math.floor(rng() * assisters.length)].assists += 1;
      }
    }
  }

  return stats;
}

// ── Event builders ────────────────────────────────────────────────────────────

export interface SimFixture {
  id: string;
  home_nation_id: string;
  away_nation_id: string;
  gameweek: number;
  stage: WMPhase;
}

export function buildFixtureEvents(
  fixture: SimFixture,
  score: SimScore,
  playerStats: PlayerStatsSim[],
  tournamentId: string,
  idempotencyPrefix: string,
): WMIngestEvent[] {
  const events: WMIngestEvent[] = [];
  const key = (suffix: string) => `${idempotencyPrefix}:${fixture.id}:${suffix}`;

  // 1. Fixture live
  events.push({
    type: "fixture.status_changed",
    version: 1,
    tournament_id: tournamentId,
    gameweek: fixture.gameweek,
    source: "simulator",
    idempotency_key: key("status:live"),
    payload: { fixture_id: fixture.id, status: "live" },
  });

  // 2. Score update
  events.push({
    type: "fixture.score_updated",
    version: 1,
    tournament_id: tournamentId,
    gameweek: fixture.gameweek,
    source: "simulator",
    idempotency_key: key("score"),
    payload: { fixture_id: fixture.id, home_score: score.home, away_score: score.away },
  });

  // 3. Penalties (if any)
  if (score.penalties_home !== undefined) {
    events.push({
      type: "fixture.penalties_updated",
      version: 1,
      tournament_id: tournamentId,
      gameweek: fixture.gameweek,
      source: "simulator",
      idempotency_key: key("penalties"),
      payload: {
        fixture_id: fixture.id,
        penalties_home: score.penalties_home,
        penalties_away: score.penalties_away,
      },
    });
  }

  // 4. Player stats
  for (const ps of playerStats) {
    events.push({
      type: "player.stat_update",
      version: 1,
      tournament_id: tournamentId,
      gameweek: fixture.gameweek,
      source: "simulator",
      idempotency_key: key(`player:${ps.player_id}`),
      payload: { ...ps },
    });
  }

  // 5. Fixture finished
  events.push({
    type: "fixture.status_changed",
    version: 1,
    tournament_id: tournamentId,
    gameweek: fixture.gameweek,
    source: "simulator",
    idempotency_key: key("status:finished"),
    payload: { fixture_id: fixture.id, status: "finished" },
  });

  return events;
}
