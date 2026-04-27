-- F-35: IR Lock-Regeln
-- Adds ir_recall_requires_roster_space to liga_settings.
-- Run in Supabase SQL Editor.

ALTER TABLE liga_settings
  ADD COLUMN IF NOT EXISTS ir_recall_requires_roster_space BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN liga_settings.ir_recall_requires_roster_space IS
  'If TRUE, a player can only return from IR if a free non-IR roster slot exists.';
