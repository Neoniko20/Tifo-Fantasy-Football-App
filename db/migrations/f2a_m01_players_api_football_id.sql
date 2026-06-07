-- F2-A M-01: Add api_football_player_id to players table
-- Needed for WM 2026 real roster ingestion from API-Football.
-- Idempotent — safe to run multiple times.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS api_football_player_id INT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_api_football_id
  ON players (api_football_player_id)
  WHERE api_football_player_id IS NOT NULL;
