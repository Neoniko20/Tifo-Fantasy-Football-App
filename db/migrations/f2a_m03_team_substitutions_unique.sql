-- F2-A M-03: Add UNIQUE index to team_substitutions (auto-subs only)
-- Closes #37
--
-- Problem: the admin auto-subs API guards against duplicates at the application
-- level (teamsWithAutoSubs check), but two concurrent requests can both pass the
-- guard before either INSERT commits — a classic TOCTOU race condition.
--
-- Fix: a partial UNIQUE index ensures the DB rejects the second INSERT regardless
-- of application-level timing. Scoped to auto=true so manual substitutions are
-- unaffected (different semantics, managed separately).
--
-- Idempotent — safe to run multiple times.
--
-- ── Pre-flight: detect existing duplicates ───────────────────────────────────
-- Run this SELECT before applying to confirm no duplicates will block the index:
--
--   SELECT team_id, gameweek, player_out, player_in, COUNT(*) AS cnt
--   FROM team_substitutions
--   WHERE auto = true
--   GROUP BY team_id, gameweek, player_out, player_in
--   HAVING COUNT(*) > 1;
--
-- Expected result: 0 rows. If any rows are returned, resolve duplicates first
-- (keep the earliest by created_at, delete the rest) before applying this
-- migration. No automated deletion is performed here.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_substitutions_auto_sub_unique
  ON team_substitutions (team_id, gameweek, player_out, player_in)
  WHERE auto = true;
