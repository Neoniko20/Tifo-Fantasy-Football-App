-- F1-B M-03a: Backfill is_test_player and player_source for existing test players.
-- Uses ID range 90001–90168 — THIS IS THE LAST LEGITIMATE USE OF THIS RANGE.
-- After this runs, all queries must use is_test_player flag, never ID ranges.
-- Idempotent: WHERE clause prevents double-update.

UPDATE players
SET
  is_test_player = true,
  player_source  = 'test'
WHERE id BETWEEN 90001 AND 90168
  AND is_test_player = false;
