-- ============================================================
-- Migrations (in Supabase SQL Editor ausführen)
-- ============================================================

-- 1. leagues: mode-Spalte hinzufügen
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS mode VARCHAR DEFAULT 'liga' CHECK (mode IN ('liga', 'wm'));

-- 2. Bestehende Ligen auf 'liga' setzen (falls NULL)
UPDATE leagues SET mode = 'liga' WHERE mode IS NULL;

-- 3. wm_nations: UNIQUE Constraints für Upsert
ALTER TABLE wm_nations
  ADD CONSTRAINT IF NOT EXISTS wm_nations_tournament_team_unique UNIQUE (tournament_id, api_team_id);
ALTER TABLE wm_nations
  ADD CONSTRAINT IF NOT EXISTS wm_nations_tournament_name_unique UNIQUE (tournament_id, name);

-- 4. Liga-Einstellungen (Positionslimits, Teamlimits, Kadergröße, IR/Taxi)
CREATE TABLE IF NOT EXISTS liga_settings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id            UUID REFERENCES leagues(id) ON DELETE CASCADE UNIQUE,
  squad_size           INT     DEFAULT 15,
  bench_size           INT     DEFAULT 4,
  ir_spots             INT     DEFAULT 0,   -- Injured Reserve Plätze
  taxi_spots           INT     DEFAULT 0,   -- U21-Taxi-Kader Plätze
  max_players_per_club INT     DEFAULT NULL, -- NULL = kein Limit
  position_limits      JSONB   DEFAULT '{"GK":{"min":1,"max":2},"DF":{"min":3,"max":5},"MF":{"min":2,"max":5},"FW":{"min":1,"max":4}}',
  allowed_formations   JSONB   DEFAULT '["4-3-3","4-4-2","4-2-3-1","3-5-2","5-3-2","3-4-3","4-5-1","5-4-1","5-2-3","3-6-1"]',
  ir_min_gameweeks     INT     DEFAULT 4,   -- Mindest-GW auf IR bevor Reaktivierung
  created_at           TIMESTAMP DEFAULT now(),
  updated_at           TIMESTAMP DEFAULT now()
);

ALTER TABLE liga_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read liga_settings"
  ON liga_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Owner write liga_settings"
  ON liga_settings FOR ALL TO authenticated
  USING (league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid()))
  WITH CHECK (league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid()));

-- IR-Tracking: wann wurde ein Spieler auf IR gesetzt?
CREATE TABLE IF NOT EXISTS liga_ir_slots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         UUID REFERENCES teams(id) ON DELETE CASCADE,
  league_id       UUID REFERENCES leagues(id) ON DELETE CASCADE,
  player_id       INT NOT NULL,
  placed_at_gw    INT NOT NULL,   -- Spieltag an dem er auf IR gesetzt wurde
  min_return_gw   INT NOT NULL,   -- frühester Spieltag zur Reaktivierung
  returned_at_gw  INT,            -- NULL = noch auf IR
  created_at      TIMESTAMP DEFAULT now()
);

ALTER TABLE liga_ir_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read liga_ir_slots"   ON liga_ir_slots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Write own liga_ir_slots" ON liga_ir_slots FOR ALL TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()))
  WITH CHECK (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

-- 5. liga_trades: Trade-Angebote zwischen Teams
CREATE TABLE IF NOT EXISTS liga_trades (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id         UUID REFERENCES leagues(id) ON DELETE CASCADE,
  proposer_team_id  UUID REFERENCES teams(id) ON DELETE CASCADE,
  receiver_team_id  UUID REFERENCES teams(id) ON DELETE CASCADE,
  offer_player_ids  JSONB NOT NULL DEFAULT '[]',   -- Spieler die Proposer gibt
  request_player_ids JSONB NOT NULL DEFAULT '[]',  -- Spieler die Proposer bekommt
  status            VARCHAR DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),
  gameweek          INT,
  created_at        TIMESTAMP DEFAULT now(),
  updated_at        TIMESTAMP DEFAULT now()
);

ALTER TABLE liga_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read liga_trades"
  ON liga_trades FOR SELECT TO authenticated USING (true);

CREATE POLICY "Proposer write liga_trades"
  ON liga_trades FOR INSERT TO authenticated
  WITH CHECK (proposer_team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

CREATE POLICY "Trade participant update liga_trades"
  ON liga_trades FOR UPDATE TO authenticated
  USING (
    proposer_team_id IN (SELECT id FROM teams WHERE user_id = auth.uid())
    OR receiver_team_id IN (SELECT id FROM teams WHERE user_id = auth.uid())
  );

-- 6. wm_gameweeks: deadline + updated_at
--    deadline  = Zeitpunkt bis zu dem Lineups eingereicht werden können
--    updated_at = Änderungs-Timestamp für Admin-Edits
ALTER TABLE wm_gameweeks
  ADD COLUMN IF NOT EXISTS deadline   TIMESTAMPTZ;

ALTER TABLE wm_gameweeks
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT now();

-- 7. liga_gameweeks: Ligen-Felder für Spieltag-Kalender
ALTER TABLE liga_gameweeks
  ADD COLUMN IF NOT EXISTS active_leagues    JSONB DEFAULT '["bundesliga","premier","seriea","ligue1","laliga"]';
ALTER TABLE liga_gameweeks
  ADD COLUMN IF NOT EXISTS double_gw_leagues JSONB DEFAULT '[]';
ALTER TABLE liga_gameweeks
  ADD COLUMN IF NOT EXISTS notes             TEXT;

-- E1: wm_gw_rank_snapshots — Rang-Snapshot aller Teams bei GW-Start
-- Basis für rank_delta im Live Center.
-- UPSERT via ON CONFLICT (league_id, gameweek, team_id) → idempotent.
CREATE TABLE IF NOT EXISTS public.wm_gw_rank_snapshots (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  league_id     uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  gameweek      integer NOT NULL,
  team_id       uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rank          integer NOT NULL,
  total_points  numeric(8,1) NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (league_id, gameweek, team_id)
);

ALTER TABLE public.wm_gw_rank_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "league members can read gw rank snapshots"
  ON public.wm_gw_rank_snapshots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = wm_gw_rank_snapshots.league_id
        AND lm.user_id = auth.uid()
    )
  );
