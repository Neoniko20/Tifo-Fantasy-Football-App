-- ============================================================================
-- Chat RLS Policies
-- ============================================================================
-- PREREQUISITE: Apply db/chat_schema.sql before running this file.
--
-- NOTE ON SYSTEM MESSAGES:
--   System messages (kind='system') are inserted exclusively via the Supabase
--   service role key on the server side. The service role key bypasses RLS
--   entirely — this is intentional. Normal authenticated users are blocked
--   from inserting system messages by the league_messages_insert policy below
--   (which requires kind='text').
-- ============================================================================


-- ============================================================================
-- TABLE: league_messages
-- ============================================================================

ALTER TABLE league_messages ENABLE ROW LEVEL SECURITY;

-- SELECT: league members can read all messages in their league
CREATE POLICY "league_messages_select" ON league_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.league_id = league_messages.league_id
        AND teams.user_id = auth.uid()
    )
  );

-- INSERT: league members can insert their own TEXT messages only
-- kind='system' is blocked because kind must be 'text' and sender_id must equal auth.uid()
CREATE POLICY "league_messages_insert" ON league_messages
  FOR INSERT WITH CHECK (
    kind = 'text'
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM teams
      WHERE teams.league_id = league_messages.league_id
        AND teams.user_id = auth.uid()
    )
  );


-- ============================================================================
-- TABLE: direct_threads
-- ============================================================================

ALTER TABLE direct_threads ENABLE ROW LEVEL SECURITY;

-- SELECT: only the two participants can see the thread
CREATE POLICY "direct_threads_select" ON direct_threads
  FOR SELECT USING (
    participant_a = auth.uid() OR participant_b = auth.uid()
  );

-- INSERT: a league member can create a DM thread if they are one of the participants
-- AND the other participant is also a member of the same league
CREATE POLICY "direct_threads_insert" ON direct_threads
  FOR INSERT WITH CHECK (
    (participant_a = auth.uid() OR participant_b = auth.uid())
    AND EXISTS (
      SELECT 1 FROM teams t_me
      WHERE t_me.league_id = direct_threads.league_id
        AND t_me.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM teams t_other
      WHERE t_other.league_id = direct_threads.league_id
        AND t_other.user_id = CASE
          WHEN participant_a = auth.uid() THEN participant_b
          ELSE participant_a
        END
    )
  );


-- ============================================================================
-- TABLE: direct_messages
-- ============================================================================

ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;

-- SELECT: only thread participants can read messages
CREATE POLICY "direct_messages_select" ON direct_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM direct_threads
      WHERE direct_threads.id = direct_messages.thread_id
        AND (direct_threads.participant_a = auth.uid()
          OR direct_threads.participant_b = auth.uid())
    )
  );

-- INSERT: only thread participants can send messages, and sender_id must match auth.uid()
CREATE POLICY "direct_messages_insert" ON direct_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM direct_threads
      WHERE direct_threads.id = direct_messages.thread_id
        AND (direct_threads.participant_a = auth.uid()
          OR direct_threads.participant_b = auth.uid())
    )
  );


-- ============================================================================
-- TABLE: chat_reads
-- ============================================================================

ALTER TABLE chat_reads ENABLE ROW LEVEL SECURITY;

-- SELECT: users see only their own read watermarks
CREATE POLICY "chat_reads_select" ON chat_reads
  FOR SELECT USING (user_id = auth.uid());

-- INSERT: users can only create their own read watermarks
CREATE POLICY "chat_reads_insert" ON chat_reads
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- UPDATE: users can only update their own read watermarks
CREATE POLICY "chat_reads_update" ON chat_reads
  FOR UPDATE USING (user_id = auth.uid());
