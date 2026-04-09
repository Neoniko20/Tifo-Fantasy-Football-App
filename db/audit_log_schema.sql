-- ═══════════════════════════════════════════════════════════════════
-- TIFO — LIGA ADMIN AUDIT LOG
-- Records every admin action on a league for traceability.
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS liga_admin_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id     UUID REFERENCES leagues(id) ON DELETE CASCADE,
  actor_id      UUID,                       -- auth.uid() of acting user; NULL = system/cron
  actor_label   VARCHAR,                    -- 'cron' | 'admin' | 'system'
  action        VARCHAR NOT NULL,           -- 'gw_started' | 'gw_finished' | 'gw_imported' | 'gw_recalculated' | 'cron_run'
  gameweek      INT,                        -- nullable
  metadata      JSONB DEFAULT '{}',         -- arbitrary structured detail (api_calls, players_imported, error, ...)
  created_at    TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_league_created
  ON liga_admin_audit_log (league_id, created_at DESC);

ALTER TABLE liga_admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Read: Liga-Owner sees their league's audit log
CREATE POLICY "Owner read liga_admin_audit_log"
  ON liga_admin_audit_log FOR SELECT TO authenticated
  USING (league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid()));

-- Insert: any authenticated user may write entries for leagues they own
CREATE POLICY "Owner insert liga_admin_audit_log"
  ON liga_admin_audit_log FOR INSERT TO authenticated
  WITH CHECK (league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid()));
