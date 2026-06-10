/**
 * F-37: Live-Sub — automatische Einwechslung wenn Starter 0 Minuten spielt.
 *
 * Regeln:
 * - Bank in Reihenfolge durchgehen (bench[0] = erste Option)
 * - Nur Einwechslung wenn Bank-Spieler > 0 Minuten gespielt hat
 * - GK kann nur durch GK ersetzt werden
 * - Ein Bank-Spieler kann nur einmal eingewechselt werden
 */

export type SubRecord = {
  out: number;   // player_id who didn't play
  in: number;    // player_id who came in from bench
};

/**
 * Returns the effective starting XI after applying automatic live substitutions.
 *
 * @param startingXI  Ordered array of 11 player IDs
 * @param bench       Ordered bench (bench[0] = first sub option)
 * @param playerMinutes  Map of player_id -> minutes played (0 = didn't play)
 * @param playerPositionMap  Map of player_id -> position string ("GK"|"DF"|"MF"|"FW")
 */
export function applyLiveSubs(
  startingXI: number[],
  bench: number[],
  playerMinutes: Record<number, number>,
  playerPositionMap: Record<number, string>,
  playerEliminated?: Record<number, boolean>,
): { effectiveXI: number[]; subs: SubRecord[] } {
  const effectiveXI = [...startingXI];
  const usedBench = new Set<number>();
  const subs: SubRecord[] = [];

  for (let i = 0; i < effectiveXI.length; i++) {
    const starter = effectiveXI[i];
    if ((playerMinutes[starter] ?? 0) > 0) continue; // played — no sub needed

    const starterPos = playerPositionMap[starter] ?? "MF";

    for (const benchPid of bench) {
      if (usedBench.has(benchPid)) continue;
      if ((playerMinutes[benchPid] ?? 0) === 0) continue; // bench player also didn't play
      if (playerEliminated?.[benchPid]) continue; // bench player's nation eliminated — skip

      const benchPos = playerPositionMap[benchPid] ?? "MF";

      // GK may only be replaced by another GK
      if (starterPos === "GK" && benchPos !== "GK") continue;
      if (benchPos === "GK" && starterPos !== "GK") continue;

      effectiveXI[i] = benchPid;
      usedBench.add(benchPid);
      subs.push({ out: starter, in: benchPid });
      break;
    }
  }

  return { effectiveXI, subs };
}

// ── Single-sub helper ─────────────────────────────────────────────────────────

/**
 * Applies one auto-sub to a lineup snapshot.
 *
 * Returns the updated arrays and whether the sub was new.
 * applied=false when player_out is not in starting_xi — covers both the
 * "already applied" (idempotent) and "bad data" edge cases.
 */
export function applyAutoSubToLineup(
  startingXI: number[],
  bench: number[],
  playerOutId: number,
  playerInId: number,
): { startingXI: number[]; bench: number[]; applied: boolean } {
  if (!startingXI.includes(playerOutId)) {
    return { startingXI: [...startingXI], bench: [...bench], applied: false };
  }

  const newXI  = startingXI.map(id => (id === playerOutId ? playerInId : id));
  const newBench = bench.filter(id => id !== playerInId);

  return { startingXI: newXI, bench: newBench, applied: true };
}

// ── Reset helper ──────────────────────────────────────────────────────────────

/**
 * Reverses a list of auto-subs applied to a lineup snapshot.
 *
 * Processes subs in reverse application order (last applied first).
 * For each sub:
 *   - replaces player_in with player_out in startingXI
 *   - re-adds player_in to the front of bench (restoring original bench order)
 * Idempotent: duplicate player_in entries in bench are suppressed.
 */
export function reverseAutoSubs(
  startingXI: number[],
  bench: number[],
  subs: Array<{ player_out: number; player_in: number }>,
): { startingXI: number[]; bench: number[] } {
  let xi       = [...startingXI];
  let newBench = [...bench];

  for (const sub of [...subs].reverse()) {
    // Restore XI
    const inIdx = xi.indexOf(sub.player_in);
    if (inIdx !== -1) {
      xi[inIdx] = sub.player_out;
    } else if (!xi.includes(sub.player_out)) {
      xi = [...xi, sub.player_out];
    }

    // Restore bench: prepend player_in (preserves original bench order on reverse iteration)
    if (!newBench.includes(sub.player_in)) {
      newBench = [sub.player_in, ...newBench];
    }
  }

  return { startingXI: xi, bench: newBench };
}
