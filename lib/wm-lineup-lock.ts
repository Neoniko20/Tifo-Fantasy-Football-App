export type LineupLockCheckResult =
  | { allow: true }
  | { allow: false; error: string; status: 409 };

/**
 * Pure guard: can a lineup save proceed?
 *
 * Blocked when:
 *  1. Gameweek is finished
 *  2. Gameweek is active (started — even if no row exists yet)
 *  3. Existing row is locked (double-guard against race with gameweek-start)
 */
export function shouldAllowLineupSave({
  gameweekStatus,
  existingLocked,
}: {
  gameweekStatus: string;
  existingLocked: boolean | null | undefined;
}): LineupLockCheckResult {
  if (gameweekStatus === "finished") {
    return {
      allow: false,
      error: "Dieser Spieltag ist bereits abgeschlossen",
      status: 409,
    };
  }
  if (gameweekStatus === "active") {
    return {
      allow: false,
      error: "Dieser Spieltag hat bereits begonnen — Aufstellung kann nicht mehr geändert werden",
      status: 409,
    };
  }
  if (existingLocked) {
    return {
      allow: false,
      error: "Aufstellung ist gesperrt und kann nicht mehr geändert werden",
      status: 409,
    };
  }
  return { allow: true };
}
