-- Add penalty shootout columns to wm_fixtures (display only, no scoring impact)
alter table wm_fixtures
  add column if not exists penalties_home integer check (penalties_home >= 0),
  add column if not exists penalties_away  integer check (penalties_away  >= 0);
