-- ═══════════════════════════════════════════════════════════════════
-- TIFO — NOTIFICATIONS
-- One row per user-event. Real-time enabled for per-user push updates.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,                -- recipient (auth.uid())
  actor_id    UUID,                         -- the user who triggered it (may equal user_id for self-events)
  league_id   UUID REFERENCES leagues(id) ON DELETE CASCADE,
  kind        VARCHAR NOT NULL,             -- 'trade_proposed' | 'trade_accepted' | 'trade_rejected' | 'trade_cancelled' | 'lineup_reminder' | 'waiver_result' | 'matchup_won' | 'dynasty_pick'
  title       VARCHAR NOT NULL,             -- short headline, e.g. "Neuer Trade-Vorschlag"
  body        TEXT,                         -- longer body, e.g. "Rocket FC bietet dir Haaland ↔ Kane"
  link        VARCHAR,                      -- deep-link, e.g. "/leagues/abc/trades"
  metadata    JSONB DEFAULT '{}',           -- { trade_id, gameweek, … }
  read_at     TIMESTAMP,                    -- NULL = unread
  created_at  TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_league
  ON notifications (league_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Read: a user sees only their own notifications
CREATE POLICY "Read own notifications"
  ON notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Insert: any authenticated user may create a notification for any other user
-- IF the actor is a member of the same league (same league_id).
CREATE POLICY "Insert notification for league member"
  ON notifications FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND (
      league_id IS NULL  -- global / system notifications allowed when service role inserts
      OR league_id IN (
        SELECT league_id FROM teams WHERE user_id = auth.uid()
        UNION
        SELECT id FROM leagues WHERE owner_id = auth.uid()
      )
    )
  );

-- Update: owner can mark own notifications as read
CREATE POLICY "Update own notifications"
  ON notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════
-- Enable Realtime on this table
-- ═══════════════════════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
