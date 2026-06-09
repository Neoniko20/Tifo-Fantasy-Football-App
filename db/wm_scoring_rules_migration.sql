-- WM Scoring Rules — per-league configurable scoring
-- Run in Supabase SQL Editor

ALTER TABLE wm_league_settings
  ADD COLUMN IF NOT EXISTS scoring_rules JSONB DEFAULT NULL;

COMMENT ON COLUMN wm_league_settings.scoring_rules IS
  'Custom scoring weights. NULL = use DEFAULT_SCORING_RULES from lib/scoring.ts';
