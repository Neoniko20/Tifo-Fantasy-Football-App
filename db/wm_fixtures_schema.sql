-- ═══════════════════════════════════════════════════════════════════
-- TIFO — WM FIXTURES SCHEMA
-- Documents the wm_fixtures table used by matchday page, import-fixtures
-- route, live-center, and ingest layer.
-- Safe to run on existing DB — all statements are IF NOT EXISTS / idempotent.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS wm_fixtures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   UUID NOT NULL REFERENCES wm_tournaments(id) ON DELETE CASCADE,
  gameweek        INT NOT NULL,
  stage           VARCHAR NOT NULL,               -- group, round_of_32, round_of_16, quarter, semi, final
  home_nation_id  UUID NOT NULL REFERENCES wm_nations(id),
  away_nation_id  UUID NOT NULL REFERENCES wm_nations(id),
  kickoff         TIMESTAMPTZ NOT NULL,
  stadium         VARCHAR,
  city            VARCHAR,
  status          VARCHAR NOT NULL DEFAULT 'scheduled',  -- scheduled, live, finished
  home_score      INT DEFAULT NULL,
  away_score      INT DEFAULT NULL,
  api_fixture_id  INT,                            -- ID from API-Football, unique per tournament
  extra_status    VARCHAR,                        -- HT, ET, PEN, delayed, interrupted
  created_at      TIMESTAMP DEFAULT now(),
  updated_at      TIMESTAMP DEFAULT now(),

  -- Allow upsert by composite key when api_fixture_id is absent
  UNIQUE(tournament_id, gameweek, home_nation_id, away_nation_id)
);

-- Unique index for api_fixture_id (partial — only when set)
CREATE UNIQUE INDEX IF NOT EXISTS idx_wm_fixtures_api_fixture_id
  ON wm_fixtures (tournament_id, api_fixture_id)
  WHERE api_fixture_id IS NOT NULL;

-- Index for common query pattern: tournament + gameweek
CREATE INDEX IF NOT EXISTS idx_wm_fixtures_tournament_gameweek
  ON wm_fixtures (tournament_id, gameweek);

-- ── RLS ─────────────────────────────────────────────────────────────

ALTER TABLE wm_fixtures ENABLE ROW LEVEL SECURITY;

-- Idempotent: drop-if-exists before recreating (CREATE POLICY IF NOT EXISTS is not valid PG syntax)
DROP POLICY IF EXISTS "Public read wm_fixtures"          ON wm_fixtures;
DROP POLICY IF EXISTS "Service role insert wm_fixtures"  ON wm_fixtures;
DROP POLICY IF EXISTS "Service role update wm_fixtures"  ON wm_fixtures;
DROP POLICY IF EXISTS "Service role delete wm_fixtures"  ON wm_fixtures;

-- Public read — anyone can read fixture data (same pattern as wm_tournaments)
CREATE POLICY "Public read wm_fixtures"
  ON wm_fixtures FOR SELECT
  USING (true);

-- Service role write — only backend (import-fixtures route, ingest) can insert/update
CREATE POLICY "Service role insert wm_fixtures"
  ON wm_fixtures FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role update wm_fixtures"
  ON wm_fixtures FOR UPDATE
  TO service_role
  USING (true);

CREATE POLICY "Service role delete wm_fixtures"
  ON wm_fixtures FOR DELETE
  TO service_role
  USING (true);
