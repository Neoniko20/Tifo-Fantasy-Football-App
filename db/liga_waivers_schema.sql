-- ═══════════════════════════════════════════════════════════════════
-- TIFO — LIGA WAIVER SETTINGS
-- Mirrors wm_league_settings waiver fields onto liga_settings so the
-- same UI + processor can drive both modes.
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE liga_settings
  ADD COLUMN IF NOT EXISTS waiver_enabled                   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS waiver_mode_starts_gameweek      INT     DEFAULT 4,
  ADD COLUMN IF NOT EXISTS waiver_priority_enabled          BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS waiver_budget_enabled            BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS waiver_budget_starting           INT     DEFAULT 100,
  ADD COLUMN IF NOT EXISTS waiver_claims_limit_enabled      BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS waiver_max_claims_per_gameweek   INT     DEFAULT 3,
  ADD COLUMN IF NOT EXISTS waiver_process_cron              VARCHAR DEFAULT '0 10 * * 3',
  ADD COLUMN IF NOT EXISTS waiver_window_close_hours_before INT     DEFAULT 2;

-- liga_gameweeks needs waiver_window_open so the UI can block/unblock claims
ALTER TABLE liga_gameweeks
  ADD COLUMN IF NOT EXISTS waiver_window_open BOOLEAN DEFAULT false;

-- faab_budget tracked per team for liga waivers
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS faab_budget INT;

-- Convenience index
CREATE INDEX IF NOT EXISTS idx_waiver_claims_league_gw_status
  ON waiver_claims (league_id, gameweek, status);
