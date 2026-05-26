-- D2: Add server-side timer anchor to draft_sessions.
-- The pick API sets this to NOW() on every current_pick increment.
-- Clients calculate timeLeft = seconds_per_pick - (Date.now() - pick_started_at)
-- instead of running a local countdown, eliminating timer drift and refresh-reset.
ALTER TABLE draft_sessions
  ADD COLUMN IF NOT EXISTS pick_started_at TIMESTAMPTZ;
