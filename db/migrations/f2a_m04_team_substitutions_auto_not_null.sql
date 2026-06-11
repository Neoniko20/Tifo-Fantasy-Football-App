-- F2-A M-04: Make team_substitutions.auto NOT NULL
-- Closes #44
--
-- Problem: team_substitutions.auto is declared as BOOLEAN DEFAULT false
-- without a NOT NULL constraint. Any row with auto IS NULL falls outside
-- the partial UNIQUE index added in M-03 (WHERE auto = true), so the
-- schema invariant assumed by application code is not enforced at the
-- DB level. All known insert paths set auto explicitly (true or false),
-- but the schema should prevent the NULL case unconditionally.
--
-- Fix:
--   1. Backfill any existing NULL values → false (safe default).
--   2. Add NOT NULL constraint so future inserts cannot produce NULLs.
--
-- Idempotent — safe to run multiple times (constraint creation uses
-- IF NOT EXISTS-equivalent via ALTER TABLE … SET NOT NULL, which is
-- a no-op if the column is already NOT NULL).
--
-- ── Pre-flight: confirm there are no NULL rows ───────────────────────────────
-- Run before applying to measure blast radius (expected: 0 rows):
--
--   SELECT COUNT(*) AS null_auto_rows
--   FROM team_substitutions
--   WHERE auto IS NULL;
--
-- If the result is > 0, the UPDATE below will fix them automatically.
-- Review those rows manually first if you want to be sure they are
-- genuine default-false cases and not data errors.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Step 1: backfill any existing NULLs to false
  UPDATE team_substitutions
  SET    auto = false
  WHERE  auto IS NULL;

  -- Step 2: add NOT NULL constraint (no-op if already set)
  IF EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_name   = 'team_substitutions'
      AND  column_name  = 'auto'
      AND  is_nullable  = 'YES'
  ) THEN
    ALTER TABLE team_substitutions
      ALTER COLUMN auto SET NOT NULL;
  END IF;
END;
$$;
