-- F-26: Taxi Squad für U21-Talente
-- Run in Supabase SQL Editor

ALTER TABLE squad_players
  ADD COLUMN IF NOT EXISTS is_taxi BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS squad_players_taxi_idx
  ON squad_players (team_id, is_taxi)
  WHERE is_taxi = TRUE;

COMMENT ON COLUMN squad_players.is_taxi IS
  'TRUE = player is on taxi squad (U21 development slot). Cannot be placed in starting XI or bench.';
