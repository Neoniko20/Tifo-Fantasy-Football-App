-- ═══════════════════════════════════════════════════════════════════
-- WM PLAYER NATIONS BACKFILL FOR TEST PLAYERS
-- Purpose: Populate wm_player_nations for all test players
-- Prerequisite: M-03a must have run (is_test_player/player_source set)
-- Previously covered only 90001-90120; now covers all player_source='test'
-- Idempotent: ON CONFLICT DO NOTHING — safe to run multiple times
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO wm_player_nations (tournament_id, player_id, nation_id)
SELECT DISTINCT
  n.tournament_id,
  p.id          AS player_id,
  n.id          AS nation_id
FROM players p
JOIN wm_nations n ON n.name = p.team_name
WHERE p.player_source = 'test'          -- replaces: id BETWEEN 90001 AND 90120
ON CONFLICT (tournament_id, player_id) DO NOTHING;
