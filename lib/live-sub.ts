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
