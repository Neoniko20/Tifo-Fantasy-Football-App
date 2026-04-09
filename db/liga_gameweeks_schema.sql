-- ═══════════════════════════════════════════════════════════════════
-- TIFO — SAISON-LIGA GAMEWEEK SCHEMA
-- Ausführen in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- 1. GAMEWEEKS pro Liga ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liga_gameweeks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   UUID REFERENCES leagues(id) ON DELETE CASCADE,
  gameweek    INT NOT NULL,              -- 1, 2, 3, ...
  label       VARCHAR,                   -- "Spieltag 1", "GW 1"
  start_date  DATE,
  end_date    DATE,
  status      VARCHAR DEFAULT 'upcoming', -- upcoming, active, finished
  created_at  TIMESTAMP DEFAULT now(),
  UNIQUE(league_id, gameweek)
);

-- 2. LINEUPS pro Team pro Spieltag ────────────────────────────────────
CREATE TABLE IF NOT EXISTS liga_lineups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         UUID REFERENCES teams(id) ON DELETE CASCADE,
  league_id       UUID REFERENCES leagues(id) ON DELETE CASCADE,
  gameweek        INT NOT NULL,
  formation       VARCHAR NOT NULL DEFAULT '4-3-3',
  starting_xi     JSONB NOT NULL DEFAULT '[]',  -- array of player_ids
  bench           JSONB NOT NULL DEFAULT '[]',
  captain_id      INT,
  vice_captain_id INT,
  locked          BOOLEAN DEFAULT false,
  created_at      TIMESTAMP DEFAULT now(),
  updated_at      TIMESTAMP DEFAULT now(),
  UNIQUE(team_id, gameweek)
);

-- 3. GAMEWEEK PUNKTE pro Spieler pro Team ─────────────────────────────
CREATE TABLE IF NOT EXISTS liga_gameweek_points (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      UUID REFERENCES teams(id) ON DELETE CASCADE,
  league_id    UUID REFERENCES leagues(id) ON DELETE CASCADE,
  player_id    INT NOT NULL,
  gameweek     INT NOT NULL,
  points       NUMERIC DEFAULT 0,
  is_captain   BOOLEAN DEFAULT false,
  -- Stats Snapshot
  goals        INT DEFAULT 0,
  assists      INT DEFAULT 0,
  minutes      INT DEFAULT 0,
  shots_on     INT DEFAULT 0,
  key_passes   INT DEFAULT 0,
  pass_accuracy NUMERIC DEFAULT 0,
  dribbles     INT DEFAULT 0,
  tackles      INT DEFAULT 0,
  interceptions INT DEFAULT 0,
  saves        INT DEFAULT 0,
  yellow_cards INT DEFAULT 0,
  red_cards    INT DEFAULT 0,
  clean_sheet  BOOLEAN DEFAULT false,
  created_at   TIMESTAMP DEFAULT now(),
  UNIQUE(team_id, player_id, gameweek)
);

-- 4. H2H MATCHUPS (für H2H-Ligen) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS liga_matchups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id    UUID REFERENCES leagues(id) ON DELETE CASCADE,
  gameweek     INT NOT NULL,
  home_team_id UUID REFERENCES teams(id),
  away_team_id UUID REFERENCES teams(id),
  home_points  NUMERIC DEFAULT 0,
  away_points  NUMERIC DEFAULT 0,
  winner_id    UUID REFERENCES teams(id), -- NULL = draw
  created_at   TIMESTAMP DEFAULT now(),
  UNIQUE(league_id, gameweek, home_team_id, away_team_id)
);

-- 5. TRANSFERS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liga_transfers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID REFERENCES teams(id) ON DELETE CASCADE,
  league_id     UUID REFERENCES leagues(id) ON DELETE CASCADE,
  player_out_id INT NOT NULL,
  player_in_id  INT NOT NULL,
  gameweek      INT,               -- optional: welcher GW war aktiv
  created_at    TIMESTAMP DEFAULT now()
);

-- ─── RLS ─────────────────────────────────────────────────────────────

ALTER TABLE liga_gameweeks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE liga_lineups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE liga_gameweek_points  ENABLE ROW LEVEL SECURITY;
ALTER TABLE liga_matchups         ENABLE ROW LEVEL SECURITY;

-- Gameweeks: alle lesen, nur Liga-Owner schreiben
CREATE POLICY "Read liga_gameweeks"
  ON liga_gameweeks FOR SELECT TO authenticated USING (true);

CREATE POLICY "Owner write liga_gameweeks"
  ON liga_gameweeks FOR ALL TO authenticated
  USING (league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid()))
  WITH CHECK (league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid()));

-- Lineups: alle lesen, Team-Owner schreiben
CREATE POLICY "Read liga_lineups"
  ON liga_lineups FOR SELECT TO authenticated USING (true);

CREATE POLICY "Write own liga_lineups"
  ON liga_lineups FOR INSERT TO authenticated
  WITH CHECK (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

CREATE POLICY "Update own liga_lineups"
  ON liga_lineups FOR UPDATE TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

-- GW-Punkte: alle lesen, Liga-Owner schreiben
CREATE POLICY "Read liga_gameweek_points"
  ON liga_gameweek_points FOR SELECT TO authenticated USING (true);

CREATE POLICY "Owner write liga_gameweek_points"
  ON liga_gameweek_points FOR ALL TO authenticated
  USING (league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid()))
  WITH CHECK (league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid()));

-- Matchups: alle lesen, Liga-Owner schreiben
CREATE POLICY "Read liga_matchups"
  ON liga_matchups FOR SELECT TO authenticated USING (true);

CREATE POLICY "Owner write liga_matchups"
  ON liga_matchups FOR ALL TO authenticated
  USING (league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid()))
  WITH CHECK (league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid()));

-- Transfers: RLS
ALTER TABLE liga_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read liga_transfers"
  ON liga_transfers FOR SELECT TO authenticated USING (true);

CREATE POLICY "Write own liga_transfers"
  ON liga_transfers FOR INSERT TO authenticated
  WITH CHECK (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));
