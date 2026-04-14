-- ═══════════════════════════════════════════════════════════════════
-- TIFO — WAIVER CLAIM ORDERING
-- Adds claim_order so teams can rank their own pending claims.
-- Lower number = try first (1 = highest preference).
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE waiver_claims
  ADD COLUMN IF NOT EXISTS claim_order INT DEFAULT 1;

-- Efficient lookup for per-team ordering
CREATE INDEX IF NOT EXISTS idx_waiver_claims_team_order
  ON waiver_claims (league_id, team_id, gameweek, claim_order);
