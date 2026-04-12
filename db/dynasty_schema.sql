-- F-33: Dynasty-Modus
-- Run in Supabase SQL Editor

-- 1. Liga-Einstellungen: Dynasty-Flag + Rookie-Draft Runden
ALTER TABLE liga_settings
  ADD COLUMN IF NOT EXISTS dynasty_mode        BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS dynasty_rookie_rounds INT     DEFAULT 5;

-- 2. Ligen: aktuelle Saison-Nummer
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS current_season INT DEFAULT 1;

-- 3. Draft Sessions: Saison-Zuordnung
ALTER TABLE draft_sessions
  ADD COLUMN IF NOT EXISTS season INT DEFAULT 1;

-- 4. Saison-Statistik pro Team (Historien-Tabelle)
CREATE TABLE IF NOT EXISTS team_season_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  UUID REFERENCES leagues(id)  ON DELETE CASCADE,
  team_id    UUID REFERENCES teams(id)    ON DELETE CASCADE,
  season     INT  NOT NULL,
  total_points NUMERIC DEFAULT 0,
  wins       INT DEFAULT 0,
  losses     INT DEFAULT 0,
  draws      INT DEFAULT 0,
  final_rank INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(team_id, season)
);

CREATE INDEX IF NOT EXISTS team_season_history_league_idx
  ON team_season_history (league_id, season);

COMMENT ON TABLE team_season_history IS
  'End-of-season snapshot per team für Dynasty-Ligen.';
