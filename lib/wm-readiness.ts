/**
 * WM Import Readiness — pure, testable status computation.
 *
 * Used by:
 *  - scripts/wm-import-status.ts  (CLI diagnostics)
 *  - __tests__/wm-import-status.test.ts
 *
 * No side effects, no DB calls.
 */

export const WM_EXPECTED_NATIONS   = 48;
export const WM_EXPECTED_FIXTURES  = 72;

export type ReadinessStatus = {
  nations:  { ready: boolean; count: number; expected: number };
  fixtures: { ready: boolean; count: number; expected: number };
  players:  { ready: boolean; count: number };
  /** true when no real players are imported — draft must be blocked */
  draftBlocked: boolean;
};

export function computeReadinessStatus(opts: {
  nationsWithId:  number;
  fixturesWithId: number;
  playersWithId:  number;
}): ReadinessStatus {
  const nationsReady  = opts.nationsWithId  >= WM_EXPECTED_NATIONS;
  const fixturesReady = opts.fixturesWithId >= WM_EXPECTED_FIXTURES;
  const playersReady  = opts.playersWithId  > 0;

  return {
    nations:  { ready: nationsReady,  count: opts.nationsWithId,  expected: WM_EXPECTED_NATIONS },
    fixtures: { ready: fixturesReady, count: opts.fixturesWithId, expected: WM_EXPECTED_FIXTURES },
    players:  { ready: playersReady,  count: opts.playersWithId },
    draftBlocked: !playersReady,
  };
}

export function formatReadinessLines(status: ReadinessStatus): string[] {
  const { nations, fixtures, players } = status;
  return [
    `${nations.ready  ? "✅" : "⚠️ "} Nations Ready   (${nations.count}/${nations.expected})`,
    `${fixtures.ready ? "✅" : "⚠️ "} Fixtures Ready  (${fixtures.count}/${fixtures.expected})`,
    `${players.ready  ? "✅" : "⏳"} Squads ${players.ready ? "Ready" : "Pending"}  (${players.count} imported)`,
    status.draftBlocked
      ? "❌ Draft Blocked – No Players Imported"
      : "✅ Draft Ready",
  ];
}
