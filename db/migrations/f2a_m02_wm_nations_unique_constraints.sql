-- F2-A M-02: Add missing unique constraints to wm_nations
-- These are defined in wm_schema.sql but may not exist in the live DB
-- if the table was created before the constraints were added.
-- Idempotent — safe to run multiple times.

-- Unique constraint for upsert by (tournament_id, api_team_id)
-- Required by ingest script: .upsert(rows, { onConflict: "tournament_id,api_team_id" })
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wm_nations'::regclass
      AND contype = 'u'
      AND conname = 'wm_nations_tournament_id_api_team_id_key'
  ) THEN
    ALTER TABLE wm_nations
      ADD CONSTRAINT wm_nations_tournament_id_api_team_id_key
      UNIQUE (tournament_id, api_team_id);
  END IF;
END $$;

-- Unique constraint for (tournament_id, name)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wm_nations'::regclass
      AND contype = 'u'
      AND conname = 'wm_nations_tournament_id_name_key'
  ) THEN
    ALTER TABLE wm_nations
      ADD CONSTRAINT wm_nations_tournament_id_name_key
      UNIQUE (tournament_id, name);
  END IF;
END $$;
