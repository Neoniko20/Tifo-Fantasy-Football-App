-- Push subscriptions (one per browser/device per user)
create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz default now()
);
create unique index on push_subscriptions(user_id, endpoint);

-- RLS
alter table push_subscriptions enable row level security;
create policy "Users manage own subscriptions"
  on push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Global notification preferences (one row per user)
create table user_notification_prefs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  prefs      jsonb not null default '{}',
  updated_at timestamptz default now()
);
alter table user_notification_prefs enable row level security;
create policy "Users manage own global prefs"
  on user_notification_prefs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Per-league notification preferences
create table league_notification_prefs (
  user_id    uuid not null references auth.users(id) on delete cascade,
  league_id  uuid not null references leagues(id) on delete cascade,
  prefs      jsonb not null default '{}',
  updated_at timestamptz default now(),
  primary key (user_id, league_id)
);
create index on league_notification_prefs(league_id);
alter table league_notification_prefs enable row level security;
create policy "Users manage own league prefs"
  on league_notification_prefs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
