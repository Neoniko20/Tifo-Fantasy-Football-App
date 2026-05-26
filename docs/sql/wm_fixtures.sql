-- wm_fixtures: one row per match in a WM tournament
-- api_fixture_id: nullable reference to API-Football for future live-data sync

create table if not exists wm_fixtures (
  id                uuid        primary key default gen_random_uuid(),
  tournament_id     uuid        not null references wm_tournaments(id) on delete cascade,
  gameweek          integer     not null check (gameweek > 0),
  stage             text        not null check (stage in ('group','round_of_32','round_of_16','quarter','semi','final')),
  home_nation_id    uuid        not null references wm_nations(id),
  away_nation_id    uuid        not null references wm_nations(id),
  kickoff           timestamptz not null,
  stadium           text,
  city              text,
  status            text        not null default 'scheduled' check (status in ('scheduled','live','finished')),
  home_score        integer,
  away_score        integer,
  api_fixture_id    integer     unique,
  created_at        timestamptz not null default now(),

  -- prevent duplicate fixture (same two nations in same tournament+gameweek)
  constraint uq_fixture_tournament_nations unique (tournament_id, gameweek, home_nation_id, away_nation_id)
);

-- Lookup by tournament + gameweek (primary Matchday query)
create index if not exists idx_wm_fixtures_tournament_gw
  on wm_fixtures (tournament_id, gameweek);

-- Lookup by status for live-score queries
create index if not exists idx_wm_fixtures_status
  on wm_fixtures (status);

-- Lookup by api_fixture_id for future sync
create index if not exists idx_wm_fixtures_api_id
  on wm_fixtures (api_fixture_id)
  where api_fixture_id is not null;

-- RLS: public read, no writes from client
alter table wm_fixtures enable row level security;

create policy "wm_fixtures_select"
  on wm_fixtures for select using (true);
