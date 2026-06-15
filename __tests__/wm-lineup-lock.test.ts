/**
 * WM Lineup Lock — Unit Tests
 *
 * Covers shouldAllowLineupSave() pure helper and route file contracts.
 *
 * 1. GW status: finished → block
 * 2. GW status: active → block (closes the "no existing row + GW active" gap)
 * 3. Existing row locked=true → block
 * 4. upcoming + not locked → allow
 * 5. upcoming + no existing row (locked=null/undefined) → allow
 * 6. active beats locked (both reasons, same outcome)
 * 7. finished beats locked (same)
 * 8. Other leagues / gameweeks are not affected (contract check on route)
 * 9. gameweek-start route contains lineup lock step
 * 10. lineup route uses shouldAllowLineupSave
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { shouldAllowLineupSave } from "../lib/wm-lineup-lock";

// ── 1–7. shouldAllowLineupSave pure logic ────────────────────────────────

describe("shouldAllowLineupSave", () => {
  it("finished + not locked → deny with 409", () => {
    const r = shouldAllowLineupSave({ gameweekStatus: "finished", existingLocked: false });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.status).toBe(409);
  });

  it("active + not locked → deny (closes no-row gap)", () => {
    const r = shouldAllowLineupSave({ gameweekStatus: "active", existingLocked: false });
    expect(r.allow).toBe(false);
    if (!r.allow) {
      expect(r.status).toBe(409);
      expect(r.error).toContain("begonnen");
    }
  });

  it("active + no existing row (null) → deny", () => {
    const r = shouldAllowLineupSave({ gameweekStatus: "active", existingLocked: null });
    expect(r.allow).toBe(false);
  });

  it("active + undefined existingLocked → deny", () => {
    const r = shouldAllowLineupSave({ gameweekStatus: "active", existingLocked: undefined });
    expect(r.allow).toBe(false);
  });

  it("upcoming + locked=true → deny with lock message", () => {
    const r = shouldAllowLineupSave({ gameweekStatus: "upcoming", existingLocked: true });
    expect(r.allow).toBe(false);
    if (!r.allow) {
      expect(r.status).toBe(409);
      expect(r.error).toContain("gesperrt");
    }
  });

  it("upcoming + locked=false → allow", () => {
    const r = shouldAllowLineupSave({ gameweekStatus: "upcoming", existingLocked: false });
    expect(r.allow).toBe(true);
  });

  it("upcoming + no existing row (null) → allow", () => {
    const r = shouldAllowLineupSave({ gameweekStatus: "upcoming", existingLocked: null });
    expect(r.allow).toBe(true);
  });

  it("upcoming + undefined existingLocked → allow", () => {
    const r = shouldAllowLineupSave({ gameweekStatus: "upcoming", existingLocked: undefined });
    expect(r.allow).toBe(true);
  });

  it("active + locked=true → deny (status check wins, same outcome)", () => {
    const r = shouldAllowLineupSave({ gameweekStatus: "active", existingLocked: true });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.status).toBe(409);
  });

  it("finished + locked=true → deny (finished check wins)", () => {
    const r = shouldAllowLineupSave({ gameweekStatus: "finished", existingLocked: true });
    expect(r.allow).toBe(false);
    if (!r.allow) {
      expect(r.status).toBe(409);
      expect(r.error).toContain("abgeschlossen");
    }
  });

  it("unknown status + not locked → allow (forward-compat)", () => {
    const r = shouldAllowLineupSave({ gameweekStatus: "scheduled", existingLocked: false });
    expect(r.allow).toBe(true);
  });
});

// ── 8–10. Route file contracts ───────────────────────────────────────────

describe("gameweek-start route: lineup lock step", () => {
  const routePath = path.join(
    process.cwd(),
    "app/api/wm/[id]/gameweek-start/route.ts",
  );

  it("route file exists", () => {
    expect(fs.existsSync(routePath)).toBe(true);
  });

  it("bulk-updates team_lineups with locked=true", () => {
    const content = fs.readFileSync(routePath, "utf-8");
    expect(content).toContain("team_lineups");
    expect(content).toContain("locked: true");
  });

  it("lock step uses same tournamentId + gameweek scope as GW update", () => {
    const content = fs.readFileSync(routePath, "utf-8");
    // Both the GW update and the lock update reference tournamentId and gameweek
    const lockBlock = content.slice(content.indexOf("locked: true") - 300, content.indexOf("locked: true") + 50);
    expect(lockBlock).toContain("tournament_id");
    expect(lockBlock).toContain("gameweek");
  });

  it("returns lineups_locked in response", () => {
    const content = fs.readFileSync(routePath, "utf-8");
    expect(content).toContain("lineups_locked");
  });
});

describe("lineup route: uses shouldAllowLineupSave", () => {
  const routePath = path.join(
    process.cwd(),
    "app/api/wm/[id]/lineup/route.ts",
  );

  it("imports shouldAllowLineupSave", () => {
    const content = fs.readFileSync(routePath, "utf-8");
    expect(content).toContain("shouldAllowLineupSave");
    expect(content).toContain("wm-lineup-lock");
  });

  it("does not force-reset locked=false in upsert", () => {
    const content = fs.readFileSync(routePath, "utf-8");
    // The upsert block should not contain locked: false
    const upsertStart = content.indexOf(".upsert(");
    const upsertEnd = content.indexOf("}", upsertStart) + 1;
    const upsertBlock = content.slice(upsertStart, upsertEnd + 100);
    expect(upsertBlock).not.toContain("locked: false");
  });

  it("checks gameweekStatus and existingLocked together via helper", () => {
    const content = fs.readFileSync(routePath, "utf-8");
    expect(content).toContain("gameweekStatus");
    expect(content).toContain("existingLocked");
  });
});
