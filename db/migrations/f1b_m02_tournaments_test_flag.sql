-- F1-B M-02: Add is_test_tournament to wm_tournaments table
-- Default false: all existing tournaments start as real (non-test).
-- Mark existing test tournaments manually after running this (see Task 8).

ALTER TABLE wm_tournaments
  ADD COLUMN IF NOT EXISTS is_test_tournament BOOLEAN NOT NULL DEFAULT false;
