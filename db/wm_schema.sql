-- ═══════════════════════════════════════════════════════════════════
-- TIFO — WM MODUS SCHEMA
-- Ausführen in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- 1. WM TOURNAMENT ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wm_tournaments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR NOT NULL,           -- "WM 2026"
  season      INT NOT NULL,               -- 2026
  api_league_id INT,                      -- ID von api-football
  start_date  DATE,
  end_date    DATE,
  status      VARCHAR DEFAULT 'upcoming', -- upcoming, active, finished
  created_at  TIMESTAMP DEFAULT now()
);

-- 2. WM NATIONS (teilnehmende Länder) ────────────────────────────────
CREATE TABLE IF NOT EXISTS wm_nations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   UUID REFERENCES wm_tournaments(id) ON DELETE CASCADE,
  api_team_id     INT,                    -- ID von api-football
  name            VARCHAR NOT NULL,       -- "Germany"
  code            VARCHAR(3),             -- "GER"
  flag_url        VARCHAR,
  group_letter    CHAR(1),               -- A, B, C, D, E, F, G, H
  group_position  INT,                   -- 1-4 final standing in group
  eliminated_after_gameweek INT,          -- NULL = aktiv, 2 = nach GW2 raus
  final_position  INT,                   -- 1=Winner, 2=Runner-up, etc.
  created_at      TIMESTAMP DEFAULT now(),
  UNIQUE(tournament_id, api_team_id),
  UNIQUE(tournament_id, name)
);

-- 3. WM GAMEWEEKS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wm_gameweeks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id         UUID REFERENCES wm_tournaments(id) ON DELETE CASCADE,
  gameweek              INT NOT NULL,     -- 1-7
  label                 VARCHAR,          -- "Gruppenphase GW1", "Achtelfinale", etc.
  phase                 VARCHAR,          -- group, round_of_16, quarter, semi, final
  start_date            DATE,
  end_date              DATE,
  status                VARCHAR DEFAULT 'upcoming', -- upcoming, active, finished
  transfer_window_open  BOOLEAN DEFAULT false,
  waiver_window_open    BOOLEAN DEFAULT false,
  created_at            TIMESTAMP DEFAULT now(),
  UNIQUE(tournament_id, gameweek)
);

-- 4. WM LEAGUE SETTINGS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wm_league_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       UUID REFERENCES leagues(id) ON DELETE CASCADE UNIQUE,
  tournament_id   UUID REFERENCES wm_tournaments(id),

  -- Kader-Konfiguration
  squad_size      INT DEFAULT 11,         -- Startelf-Größe
  bench_size      INT DEFAULT 4,          -- Bankgröße
  position_limits JSONB DEFAULT '{
    "GK": {"min": 1, "max": 2},
    "DF": {"min": 2, "max": 5},
    "MF": {"min": 2, "max": 5},
    "FW": {"min": 1, "max": 3}
  }',

  -- Erlaubte Formationen
  allowed_formations JSONB DEFAULT '["4-3-3","4-2-3-1","3-5-2","5-3-2","4-4-2","3-4-3"]',

  -- Transfer-Einstellungen (Gruppenphase)
  transfers_per_gameweek          INT DEFAULT 3,
  transfers_unlimited             BOOLEAN DEFAULT false,

  -- Waiver-Einstellungen (K.O.-Phase)
  waiver_mode_starts_gameweek     INT DEFAULT 4,
  waiver_priority_enabled         BOOLEAN DEFAULT true,
  waiver_budget_enabled           BOOLEAN DEFAULT false,
  waiver_budget_starting          INT DEFAULT 100,
  waiver_claims_limit_enabled     BOOLEAN DEFAULT true,
  waiver_max_claims_per_gameweek  INT DEFAULT 3,

  -- Auto-Subs
  auto_subs_enabled               BOOLEAN DEFAULT true,

  created_at  TIMESTAMP DEFAULT now(),
  updated_at  TIMESTAMP DEFAULT now()
);

-- 5. TEAM LINEUPS (Aufstellung pro Spieltag) ─────────────────────────
CREATE TABLE IF NOT EXISTS team_lineups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID REFERENCES teams(id) ON DELETE CASCADE,
  tournament_id UUID REFERENCES wm_tournaments(id),
  gameweek      INT NOT NULL,
  formation     VARCHAR NOT NULL,         -- "4-3-3"
  -- Ordered array: [GK, DF, DF, DF, DF, MF, MF, MF, FW, FW, FW]
  starting_xi   JSONB NOT NULL DEFAULT '[]',
  bench         JSONB NOT NULL DEFAULT '[]',
  captain_id    INT,
  vice_captain_id INT,
  locked        BOOLEAN DEFAULT false,    -- true = Gameweek hat begonnen
  created_at    TIMESTAMP DEFAULT now(),
  updated_at    TIMESTAMP DEFAULT now(),
  UNIQUE(team_id, gameweek)
);

-- 6. TEAM SUBSTITUTIONS (Auto-Subs History) ──────────────────────────
CREATE TABLE IF NOT EXISTS team_substitutions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID REFERENCES teams(id),
  gameweek    INT NOT NULL,
  player_out  INT NOT NULL,
  player_in   INT NOT NULL,
  reason      VARCHAR,                    -- 'eliminated', 'injured', 'manual'
  auto        BOOLEAN DEFAULT false,
  created_at  TIMESTAMP DEFAULT now()
);

-- 7. WAIVER WIRE (verfügbare Spieler) ────────────────────────────────
CREATE TABLE IF NOT EXISTS waiver_wire (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       UUID REFERENCES leagues(id) ON DELETE CASCADE,
  player_id       INT NOT NULL,
  available_from_gameweek INT DEFAULT 1,
  status          VARCHAR DEFAULT 'available', -- available, claimed
  created_at      TIMESTAMP DEFAULT now(),
  UNIQUE(league_id, player_id)
);

-- 8. WAIVER PRIORITY (welches Team darf als erstes waiven) ────────────
CREATE TABLE IF NOT EXISTS waiver_priority (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   UUID REFERENCES leagues(id) ON DELETE CASCADE,
  team_id     UUID REFERENCES teams(id) ON DELETE CASCADE,
  priority    INT NOT NULL,               -- 1 = schlechtester = darf zuerst
  gameweek    INT NOT NULL,               -- für Tracking
  updated_at  TIMESTAMP DEFAULT now(),
  UNIQUE(league_id, team_id)
);

-- 9. WAIVER CLAIMS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waiver_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       UUID REFERENCES leagues(id) ON DELETE CASCADE,
  team_id         UUID REFERENCES teams(id) ON DELETE CASCADE,
  player_in       INT NOT NULL,           -- gewünschter Spieler
  player_out      INT,                    -- abzugebender Spieler (optional)
  gameweek        INT NOT NULL,
  priority        INT NOT NULL,           -- Priority zum Zeitpunkt des Claims
  -- Budget-basiert (FAAB)
  bid_amount      INT DEFAULT 0,
  status          VARCHAR DEFAULT 'pending', -- pending, approved, rejected
  rejected_reason VARCHAR,
  processed_at    TIMESTAMP,
  created_at      TIMESTAMP DEFAULT now()
);

-- 10. WM GAMEWEEK POINTS (Punkte pro Spieler pro GW) ─────────────────
CREATE TABLE IF NOT EXISTS wm_gameweek_points (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         UUID REFERENCES teams(id) ON DELETE CASCADE,
  player_id       INT NOT NULL,
  gameweek        INT NOT NULL,
  points          NUMERIC DEFAULT 0,
  nation_active   BOOLEAN DEFAULT true,   -- false = Nation raus = 0 Punkte
  is_captain      BOOLEAN DEFAULT false,
  -- Snapshot der Stats für diesen GW
  goals           INT DEFAULT 0,
  assists         INT DEFAULT 0,
  minutes         INT DEFAULT 0,
  shots_on        INT DEFAULT 0,
  key_passes      INT DEFAULT 0,
  pass_accuracy   NUMERIC DEFAULT 0,
  dribbles        INT DEFAULT 0,
  tackles         INT DEFAULT 0,
  interceptions   INT DEFAULT 0,
  saves           INT DEFAULT 0,
  yellow_cards    INT DEFAULT 0,
  red_cards       INT DEFAULT 0,
  clean_sheet     BOOLEAN DEFAULT false,
  created_at      TIMESTAMP DEFAULT now(),
  UNIQUE(team_id, player_id, gameweek)
);

-- ═══════════════════════════════════════════════════════════════════
-- WM 2026 VORBELEGUNG (nach Bekanntgabe der Gruppen)
-- Kann direkt eingefügt werden wenn Gruppen feststehen
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO wm_tournaments (name, season, start_date, end_date, status)
VALUES ('WM 2026', 2026, '2026-06-11', '2026-07-19', 'upcoming')
ON CONFLICT DO NOTHING;

-- Gameweeks vorbelegen
DO $$
DECLARE
  t_id UUID;
BEGIN
  SELECT id INTO t_id FROM wm_tournaments WHERE season = 2026 LIMIT 1;

  INSERT INTO wm_gameweeks (tournament_id, gameweek, label, phase, status)
  VALUES
    (t_id, 1, 'Gruppenphase — Spieltag 1', 'group', 'upcoming'),
    (t_id, 2, 'Gruppenphase — Spieltag 2', 'group', 'upcoming'),
    (t_id, 3, 'Gruppenphase — Spieltag 3', 'group', 'upcoming'),
    (t_id, 4, 'Achtelfinale',               'round_of_16', 'upcoming'),
    (t_id, 5, 'Viertelfinale',              'quarter', 'upcoming'),
    (t_id, 6, 'Halbfinale',                 'semi', 'upcoming'),
    (t_id, 7, 'Finale',                     'final', 'upcoming')
  ON CONFLICT (tournament_id, gameweek) DO NOTHING;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- RLS POLICIES
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE wm_tournaments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wm_nations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE wm_gameweeks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE wm_league_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_lineups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_substitutions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE waiver_wire         ENABLE ROW LEVEL SECURITY;
ALTER TABLE waiver_priority     ENABLE ROW LEVEL SECURITY;
ALTER TABLE waiver_claims       ENABLE ROW LEVEL SECURITY;
ALTER TABLE wm_gameweek_points  ENABLE ROW LEVEL SECURITY;

-- Öffentlich lesbar (alle können WM-Daten lesen)
CREATE POLICY "Public read wm_tournaments"    ON wm_tournaments    FOR SELECT USING (true);
CREATE POLICY "Public read wm_nations"        ON wm_nations        FOR SELECT USING (true);
CREATE POLICY "Public read wm_gameweeks"      ON wm_gameweeks      FOR SELECT USING (true);
CREATE POLICY "Public read wm_gameweek_points" ON wm_gameweek_points FOR SELECT USING (true);

-- Liga-Settings: alle Liga-Mitglieder können lesen, nur Owner schreibt
CREATE POLICY "Member read wm_league_settings"
  ON wm_league_settings FOR SELECT TO authenticated
  USING (league_id IN (
    SELECT league_id FROM teams WHERE user_id = auth.uid()
    UNION
    SELECT id FROM leagues WHERE owner_id = auth.uid()
  ));

CREATE POLICY "Owner write wm_league_settings"
  ON wm_league_settings FOR INSERT TO authenticated
  WITH CHECK (league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid()));

CREATE POLICY "Owner update wm_league_settings"
  ON wm_league_settings FOR UPDATE TO authenticated
  USING (league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid()));

-- Lineups: Team-Owner kann eigene Lineup schreiben, alle lesen
CREATE POLICY "Read team_lineups"
  ON team_lineups FOR SELECT TO authenticated USING (true);

CREATE POLICY "Write own team_lineups"
  ON team_lineups FOR INSERT TO authenticated
  WITH CHECK (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

CREATE POLICY "Update own team_lineups"
  ON team_lineups FOR UPDATE TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

-- Waiver: Liga-Mitglieder können Claims einreichen
CREATE POLICY "Read waiver_wire"
  ON waiver_wire FOR SELECT TO authenticated USING (true);

CREATE POLICY "Read waiver_claims"
  ON waiver_claims FOR SELECT TO authenticated
  USING (league_id IN (
    SELECT league_id FROM teams WHERE user_id = auth.uid()
  ));

CREATE POLICY "Submit waiver_claims"
  ON waiver_claims FOR INSERT TO authenticated
  WITH CHECK (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

CREATE POLICY "Read waiver_priority"
  ON waiver_priority FOR SELECT TO authenticated USING (true);

-- Substitutions: alle lesen, Team-Owner schreiben
CREATE POLICY "Read team_substitutions"
  ON team_substitutions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Write own team_substitutions"
  ON team_substitutions FOR INSERT TO authenticated
  WITH CHECK (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));
