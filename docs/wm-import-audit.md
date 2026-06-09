# WM 2026 — Import Audit

**Date:** 2026-06-08  
**Status:** Read-only audit. No data was modified.  
**Source query:** `db/audit/wm_legacy_rows.sql`

---

## Summary

| Table        | Total | With API ID | Without API ID |
|-------------|-------|-------------|----------------|
| `wm_nations`   | 64    | 48          | **16**         |
| `wm_fixtures`  | 78    | 72          | **6**          |
| `players`      | —     | 0           | — (squads not yet released by API-Football) |

---

## 1. Nations missing `api_team_id` (16 rows)

### Origin

These 16 rows were created **before** the API-Football ingest ran on 2026-06-08. They originate from:

- **WM schema seed** (`db/wm_schema.sql`) — placeholder nations used during schema development and early UI testing (groups A–H, 4×8 = 32 teams originally, later expanded to 48).
- **Manual admin inserts** — nations added via the admin panel during pre-import integration testing.

None of these rows have an `api_team_id`, meaning they were never matched to API-Football team IDs during the import. The ingest script upserts by `(tournament_id, name)` — so pre-existing rows whose `name` did not exactly match the API-Football `team.name` were left unmodified.

### Recommended action

**Delete later** — these rows are orphaned test/placeholder records. They do not have corresponding fixtures, player data, or league scoring associations. Safe to remove once the real tournament is confirmed active and all 48 API-mapped nations are verified correct.

Do not delete now: the tournament has not started, and a cleanup script should be reviewed before execution.

---

## 2. Fixtures missing `api_fixture_id` (6 rows)

### Origin

These 6 fixtures were created **before** the API-Football fixture ingest. Likely origins:

- **Seed/test fixtures** created during WM fixture schema development (`db/wm_fixtures_schema.sql`).
- **Admin-created fixtures** added manually for early draft and scoring tests.

The ingest script upserts fixtures by `api_fixture_id` — rows without one were never touched by the import.

### Recommended action

**Delete later** — these fixtures are not linked to real API-Football data. They may have stale or incorrect `home_nation_id` / `away_nation_id` foreign keys pointing at the legacy nation rows above. Safe to remove together with the 16 legacy nations once cleanup is executed.

---

## 3. Players (0 with `api_football_player_id`)

No real World Cup squad data has been imported yet. API-Football typically exposes official tournament squads **a few days before the tournament starts** (start date: 2026-06-11).

This is **expected behavior**, not a data problem. The 168 `is_test_player = true` rows currently serve as draft placeholders for test leagues.

**Next step:** Re-run the ingest script after squads are published:

```bash
node --experimental-strip-types scripts/ingest-wm-2026-api-football.ts
```

---

## 4. Draft Safety

With `players.api_football_player_id = 0`, the WM draft is **blocked** for real tournaments. The draft page shows:

> ❌ Draft blockiert – Keine Spieler importiert  
> Re-run import when API-Football exposes WC 2026 squads.

Test tournaments using `is_test_player = true` players are **not affected**.

---

## 5. Cleanup Plan (not yet executed)

Once the tournament is confirmed active and API data is verified:

1. Run `db/audit/wm_legacy_rows.sql` in Supabase SQL Editor to review exact rows.
2. Manually verify that the 16 nations without `api_team_id` have no active league associations.
3. Execute a targeted `DELETE` (separate, reviewed script — not included here) to remove orphaned rows.
4. Re-run `wm-import-status.ts` to confirm clean state.

**No destructive SQL is included in this document.**
