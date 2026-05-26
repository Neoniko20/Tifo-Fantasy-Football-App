-- WM Event Log — Audit trail for the WM Ingest Layer (Phase A1)
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS wm_event_log (
  id                  uuid primary key default gen_random_uuid(),
  league_id           text not null,
  tournament_id       text not null,
  gameweek            int,
  event_type          text not null,
  payload             jsonb not null default '{}',
  source              text,
  idempotency_key     text unique,
  status              text not null default 'pending',
  error_message       text,
  processed_by        text,
  related_fixture_id  uuid,
  related_team_id     uuid,
  related_player_id   int,
  processed_at        timestamptz,
  created_at          timestamptz default now()
);

-- Indexes for debug/recovery queries
CREATE INDEX IF NOT EXISTS wm_event_log_league_gw
  ON wm_event_log(league_id, gameweek);
CREATE INDEX IF NOT EXISTS wm_event_log_source
  ON wm_event_log(source);
CREATE INDEX IF NOT EXISTS wm_event_log_status
  ON wm_event_log(status);

-- RLS: service_role only (no user-facing reads in V1)
ALTER TABLE wm_event_log ENABLE ROW LEVEL SECURITY;
