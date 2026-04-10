-- F-34: Configurable scoring rules per league
-- Run in Supabase SQL Editor

ALTER TABLE liga_settings
  ADD COLUMN IF NOT EXISTS scoring_rules JSONB DEFAULT NULL;

COMMENT ON COLUMN liga_settings.scoring_rules IS
  'Custom scoring weights. NULL = use DEFAULT_SCORING_RULES from lib/scoring.ts';
