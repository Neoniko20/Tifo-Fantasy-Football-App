-- F1-B M-01: Add is_test_player and player_source to players table
-- Safe to run multiple times (IF NOT EXISTS / idempotent).
-- After this migration, run M-03a to backfill existing test players.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS is_test_player BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS player_source  TEXT    NOT NULL DEFAULT 'api_football'
    CONSTRAINT players_source_check
    CHECK (player_source IN ('api_football', 'test', 'manual'));

CREATE INDEX IF NOT EXISTS idx_players_is_test ON players (is_test_player);
CREATE INDEX IF NOT EXISTS idx_players_source  ON players (player_source);
