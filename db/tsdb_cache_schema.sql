-- ═══════════════════════════════════════════════════════════════════
-- TIFO — TSDB PLAYER CACHE
-- Persistent cache for TheSportsDB lookups. Key = (player_name, team_name).
-- Populated by /api/tsdb-player and by the weekly warm-cron.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tsdb_player_cache (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name    TEXT NOT NULL,
  team_name      TEXT NOT NULL DEFAULT '',
  player_id_fk   INT,                        -- optional FK to our players.id (denormalized)
  tsdb_id        TEXT,                       -- TSDB idPlayer
  cutout         TEXT,                       -- TSDB strCutout URL
  render         TEXT,                       -- TSDB strRender URL
  thumb          TEXT,                       -- TSDB strThumb URL
  fanart1        TEXT,
  fanart2        TEXT,
  nationality    TEXT,
  height         TEXT,
  weight         TEXT,
  born           DATE,
  description    TEXT,                       -- strDescriptionEN first 500 chars
  not_found      BOOLEAN NOT NULL DEFAULT false,  -- true = TSDB had no match; don't re-fetch for N days
  fetched_at     TIMESTAMP NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (player_name, team_name)
);

CREATE INDEX IF NOT EXISTS idx_tsdb_cache_fetched_at
  ON tsdb_player_cache (fetched_at);

CREATE INDEX IF NOT EXISTS idx_tsdb_cache_player_fk
  ON tsdb_player_cache (player_id_fk);

-- RLS: public read (the cache is derived from a public API, no user data);
-- only service role can write.
ALTER TABLE tsdb_player_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read tsdb_player_cache"
  ON tsdb_player_cache FOR SELECT USING (true);

-- No INSERT/UPDATE policy for "authenticated" — writes must go through
-- the service role client (lib/supabase-server.ts), which bypasses RLS.
