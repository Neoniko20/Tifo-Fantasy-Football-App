-- Chat Schema Migration
-- Run this in Supabase SQL Editor to create the chat tables. Requires PostgreSQL 15+ (for UNIQUE NULLS NOT DISTINCT).
-- This migration creates tables for league chat and direct messaging functionality.
-- RLS policies are defined separately in chat_rls.sql.

-- ============================================================================
-- TABLE: league_messages
-- ============================================================================
-- Stores messages in league-wide chat channels.
-- Messages can be user messages (kind='text') or system messages (kind='system').
-- System messages have sender_id=NULL.

CREATE TABLE IF NOT EXISTS league_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  sender_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- sender_id is NULL for system messages (kind='system')
  team_id     UUID REFERENCES teams(id) ON DELETE SET NULL,
  content     TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
  kind        VARCHAR NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'system')),
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_sender_matches_kind CHECK (
    (kind = 'system' AND sender_id IS NULL) OR
    (kind = 'text'   AND sender_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_league_messages_league
  ON league_messages(league_id, created_at DESC);

-- ============================================================================
-- TABLE: direct_threads
-- ============================================================================
-- Represents a direct message conversation between two users within a league.
-- participant_a is always the smaller UUID (enforced by app code) for consistent ordering.
-- One thread per user pair per league.

CREATE TABLE IF NOT EXISTS direct_threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  participant_a   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_b   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  -- Always store smaller UUID as participant_a (enforced by both CHECK constraint and app code)
  CHECK (participant_a < participant_b),
  UNIQUE (league_id, participant_a, participant_b)
);

-- ============================================================================
-- TABLE: direct_messages
-- ============================================================================
-- Individual messages within a direct message thread.

CREATE TABLE IF NOT EXISTS direct_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   UUID NOT NULL REFERENCES direct_threads(id) ON DELETE CASCADE,
  sender_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content     TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_thread
  ON direct_messages(thread_id, created_at DESC);

-- ============================================================================
-- TABLE: chat_reads
-- ============================================================================
-- Tracks the last read timestamp for users in league chats and direct threads.
-- Exactly one of league_id or thread_id must be set per row.

CREATE TABLE IF NOT EXISTS chat_reads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id       UUID REFERENCES leagues(id) ON DELETE CASCADE,
  thread_id       UUID REFERENCES direct_threads(id) ON DELETE CASCADE,
  last_read_at    TIMESTAMPTZ DEFAULT now(),
  -- Exactly one of league_id or thread_id must be set
  CHECK (
    (league_id IS NOT NULL AND thread_id IS NULL) OR
    (league_id IS NULL AND thread_id IS NOT NULL)
  ),
  UNIQUE NULLS NOT DISTINCT (user_id, league_id),
  UNIQUE NULLS NOT DISTINCT (user_id, thread_id)
);

-- ============================================================================
-- REALTIME SUBSCRIPTION
-- ============================================================================
-- Enable Realtime for message tables to support live chat updates.

ALTER PUBLICATION supabase_realtime ADD TABLE league_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE direct_messages;
