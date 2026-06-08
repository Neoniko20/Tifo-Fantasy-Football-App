-- =====================================================================
-- TIFO — WM Legacy Row Audit
-- READ-ONLY — no writes, no deletes.
--
-- Run in Supabase SQL Editor to identify rows imported before
-- the API-Football ingest (pre-existing test/placeholder data).
-- Use results to decide whether manual cleanup is needed.
-- =====================================================================

-- ── 1. wm_nations without api_team_id ─────────────────────────────────────
-- These are nations created before the API-Football import.
-- Candidates for manual review or cleanup (not deleted by ingest).

SELECT
  id,
  name,
  code,
  group_letter,
  api_team_id,      -- NULL = not yet matched to API-Football
  flag_url,
  created_at
FROM wm_nations
WHERE api_team_id IS NULL
ORDER BY created_at;

-- ── 2. wm_fixtures without api_fixture_id ─────────────────────────────────
-- These are fixtures created manually (e.g. via admin UI or seed data)
-- before the API-Football fixture ingest.

SELECT
  id,
  gameweek,
  stage,
  kickoff,
  status,
  home_score,
  away_score,
  api_fixture_id,   -- NULL = not from API-Football
  created_at
FROM wm_fixtures
WHERE api_fixture_id IS NULL
ORDER BY gameweek, kickoff;

-- ── 3. Summary counts ─────────────────────────────────────────────────────
SELECT
  'wm_nations total'               AS label, COUNT(*)::text AS value FROM wm_nations
UNION ALL
SELECT
  'wm_nations with api_team_id',    COUNT(*)::text FROM wm_nations WHERE api_team_id IS NOT NULL
UNION ALL
SELECT
  'wm_nations without api_team_id', COUNT(*)::text FROM wm_nations WHERE api_team_id IS NULL
UNION ALL
SELECT
  'wm_fixtures total',              COUNT(*)::text FROM wm_fixtures
UNION ALL
SELECT
  'wm_fixtures with api_fixture_id',    COUNT(*)::text FROM wm_fixtures WHERE api_fixture_id IS NOT NULL
UNION ALL
SELECT
  'wm_fixtures without api_fixture_id', COUNT(*)::text FROM wm_fixtures WHERE api_fixture_id IS NULL
UNION ALL
SELECT
  'players with api_football_player_id', COUNT(*)::text FROM players WHERE api_football_player_id IS NOT NULL
UNION ALL
SELECT
  'players (test)',                      COUNT(*)::text FROM players WHERE is_test_player = true;
