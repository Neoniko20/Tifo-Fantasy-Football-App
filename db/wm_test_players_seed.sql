-- =====================================================================
-- TIFO -- WM 2026 Test-Spieler Seed
-- Zweck: 120 synthetische Testdaten fuer den WM-Draft E2E-Test
-- Ausfuehren: Supabase SQL Editor (oder psql)
-- Idempotent: ON CONFLICT (id) DO NOTHING -- mehrfach ausfuehrbar
-- IDs: 90001-90168 (reservierter Test-Bereich)
-- WICHTIG: ID-Range ist kein Sicherheits-Guard mehr. Schutz laeuft ueber
--          is_test_player=true und player_source='test'.
-- team_name muss exakt mit wm_nations.name uebereinstimmen!
-- =====================================================================

INSERT INTO players (id, name, position, team_name, nationality, photo_url, api_team_id, rating, fpts, goals, assists, is_test_player, player_source)
VALUES

  -- GERMANY (Gruppe E) -- 5 Spieler
  (90001, 'WM Test GK 1 (GER)',  'GK', 'Germany',      'German',      NULL, NULL, 7.2,  54.0,  0, 1, true, 'test'),
  (90002, 'WM Test DF 1 (GER)',  'DF', 'Germany',      'German',      NULL, NULL, 7.0,  42.0,  2, 3, true, 'test'),
  (90003, 'WM Test DF 2 (GER)',  'DF', 'Germany',      'German',      NULL, NULL, 6.8,  38.0,  1, 2, true, 'test'),
  (90004, 'WM Test MF 1 (GER)',  'MF', 'Germany',      'German',      NULL, NULL, 7.5,  61.0,  4, 6, true, 'test'),
  (90005, 'WM Test FW 1 (GER)',  'FW', 'Germany',      'German',      NULL, NULL, 7.8,  72.0,  8, 4, true, 'test'),

  -- FRANCE (Gruppe I) -- 5 Spieler
  (90006, 'WM Test GK 1 (FRA)',  'GK', 'France',       'French',      NULL, NULL, 7.4,  56.0,  0, 0, true, 'test'),
  (90007, 'WM Test DF 1 (FRA)',  'DF', 'France',       'French',      NULL, NULL, 7.1,  44.0,  2, 4, true, 'test'),
  (90008, 'WM Test DF 2 (FRA)',  'DF', 'France',       'French',      NULL, NULL, 6.9,  40.0,  1, 2, true, 'test'),
  (90009, 'WM Test MF 1 (FRA)',  'MF', 'France',       'French',      NULL, NULL, 7.6,  65.0,  5, 7, true, 'test'),
  (90010, 'WM Test FW 1 (FRA)',  'FW', 'France',       'French',      NULL, NULL, 8.1,  78.0,  9, 5, true, 'test'),

  -- BRAZIL (Gruppe C) -- 5 Spieler
  (90011, 'WM Test GK 1 (BRA)',  'GK', 'Brazil',       'Brazilian',   NULL, NULL, 7.3,  52.0,  0, 1, true, 'test'),
  (90012, 'WM Test DF 1 (BRA)',  'DF', 'Brazil',       'Brazilian',   NULL, NULL, 7.0,  41.0,  2, 3, true, 'test'),
  (90013, 'WM Test DF 2 (BRA)',  'DF', 'Brazil',       'Brazilian',   NULL, NULL, 6.7,  37.0,  1, 2, true, 'test'),
  (90014, 'WM Test MF 1 (BRA)',  'MF', 'Brazil',       'Brazilian',   NULL, NULL, 7.7,  68.0,  5, 8, true, 'test'),
  (90015, 'WM Test FW 1 (BRA)',  'FW', 'Brazil',       'Brazilian',   NULL, NULL, 8.0,  75.0,  9, 3, true, 'test'),

  -- ARGENTINA (Gruppe J) -- 5 Spieler
  (90016, 'WM Test GK 1 (ARG)',  'GK', 'Argentina',    'Argentine',   NULL, NULL, 7.5,  55.0,  0, 0, true, 'test'),
  (90017, 'WM Test DF 1 (ARG)',  'DF', 'Argentina',    'Argentine',   NULL, NULL, 7.2,  43.0,  3, 3, true, 'test'),
  (90018, 'WM Test DF 2 (ARG)',  'DF', 'Argentina',    'Argentine',   NULL, NULL, 7.0,  39.0,  1, 2, true, 'test'),
  (90019, 'WM Test MF 1 (ARG)',  'MF', 'Argentina',    'Argentine',   NULL, NULL, 7.8,  70.0,  6, 7, true, 'test'),
  (90020, 'WM Test FW 1 (ARG)',  'FW', 'Argentina',    'Argentine',   NULL, NULL, 8.3,  82.0, 11, 6, true, 'test'),

  -- SPAIN (Gruppe H) -- 5 Spieler
  (90021, 'WM Test GK 1 (ESP)',  'GK', 'Spain',        'Spanish',     NULL, NULL, 7.1,  50.0,  0, 1, true, 'test'),
  (90022, 'WM Test DF 1 (ESP)',  'DF', 'Spain',        'Spanish',     NULL, NULL, 6.9,  40.0,  2, 4, true, 'test'),
  (90023, 'WM Test DF 2 (ESP)',  'DF', 'Spain',        'Spanish',     NULL, NULL, 6.8,  36.0,  1, 3, true, 'test'),
  (90024, 'WM Test MF 1 (ESP)',  'MF', 'Spain',        'Spanish',     NULL, NULL, 7.6,  63.0,  4, 9, true, 'test'),
  (90025, 'WM Test FW 1 (ESP)',  'FW', 'Spain',        'Spanish',     NULL, NULL, 7.9,  71.0,  8, 5, true, 'test'),

  -- ENGLAND (Gruppe L) -- 5 Spieler
  (90026, 'WM Test GK 1 (ENG)',  'GK', 'England',      'English',     NULL, NULL, 7.2,  51.0,  0, 0, true, 'test'),
  (90027, 'WM Test DF 1 (ENG)',  'DF', 'England',      'English',     NULL, NULL, 7.0,  41.0,  2, 3, true, 'test'),
  (90028, 'WM Test DF 2 (ENG)',  'DF', 'England',      'English',     NULL, NULL, 6.8,  37.0,  1, 2, true, 'test'),
  (90029, 'WM Test MF 1 (ENG)',  'MF', 'England',      'English',     NULL, NULL, 7.5,  62.0,  4, 6, true, 'test'),
  (90030, 'WM Test FW 1 (ENG)',  'FW', 'England',      'English',     NULL, NULL, 8.0,  74.0,  9, 4, true, 'test'),

  -- NETHERLANDS (Gruppe F) -- 5 Spieler
  (90031, 'WM Test GK 1 (NED)',  'GK', 'Netherlands',  'Dutch',       NULL, NULL, 7.0,  48.0,  0, 1, true, 'test'),
  (90032, 'WM Test DF 1 (NED)',  'DF', 'Netherlands',  'Dutch',       NULL, NULL, 6.9,  39.0,  2, 2, true, 'test'),
  (90033, 'WM Test DF 2 (NED)',  'DF', 'Netherlands',  'Dutch',       NULL, NULL, 6.7,  35.0,  1, 2, true, 'test'),
  (90034, 'WM Test MF 1 (NED)',  'MF', 'Netherlands',  'Dutch',       NULL, NULL, 7.4,  60.0,  4, 5, true, 'test'),
  (90035, 'WM Test FW 1 (NED)',  'FW', 'Netherlands',  'Dutch',       NULL, NULL, 7.8,  69.0,  7, 4, true, 'test'),

  -- JAPAN (Gruppe F) -- 5 Spieler
  (90036, 'WM Test GK 1 (JPN)',  'GK', 'Japan',        'Japanese',    NULL, NULL, 6.9,  46.0,  0, 0, true, 'test'),
  (90037, 'WM Test DF 1 (JPN)',  'DF', 'Japan',        'Japanese',    NULL, NULL, 6.8,  37.0,  1, 2, true, 'test'),
  (90038, 'WM Test DF 2 (JPN)',  'DF', 'Japan',        'Japanese',    NULL, NULL, 6.6,  33.0,  0, 1, true, 'test'),
  (90039, 'WM Test MF 1 (JPN)',  'MF', 'Japan',        'Japanese',    NULL, NULL, 7.3,  57.0,  3, 5, true, 'test'),
  (90040, 'WM Test FW 1 (JPN)',  'FW', 'Japan',        'Japanese',    NULL, NULL, 7.6,  64.0,  6, 3, true, 'test'),

  -- USA (Gruppe D) -- 5 Spieler
  (90041, 'WM Test GK 1 (USA)',  'GK', 'USA',          'American',    NULL, NULL, 7.0,  49.0,  0, 0, true, 'test'),
  (90042, 'WM Test DF 1 (USA)',  'DF', 'USA',          'American',    NULL, NULL, 6.8,  38.0,  1, 2, true, 'test'),
  (90043, 'WM Test DF 2 (USA)',  'DF', 'USA',          'American',    NULL, NULL, 6.7,  35.0,  1, 1, true, 'test'),
  (90044, 'WM Test MF 1 (USA)',  'MF', 'USA',          'American',    NULL, NULL, 7.2,  58.0,  3, 5, true, 'test'),
  (90045, 'WM Test FW 1 (USA)',  'FW', 'USA',          'American',    NULL, NULL, 7.5,  66.0,  6, 3, true, 'test'),

  -- MEXICO (Gruppe A) -- 5 Spieler
  (90046, 'WM Test GK 1 (MEX)',  'GK', 'Mexico',       'Mexican',     NULL, NULL, 7.0,  48.0,  0, 0, true, 'test'),
  (90047, 'WM Test DF 1 (MEX)',  'DF', 'Mexico',       'Mexican',     NULL, NULL, 6.8,  38.0,  1, 2, true, 'test'),
  (90048, 'WM Test DF 2 (MEX)',  'DF', 'Mexico',       'Mexican',     NULL, NULL, 6.7,  34.0,  0, 1, true, 'test'),
  (90049, 'WM Test MF 1 (MEX)',  'MF', 'Mexico',       'Mexican',     NULL, NULL, 7.3,  59.0,  3, 6, true, 'test'),
  (90050, 'WM Test FW 1 (MEX)',  'FW', 'Mexico',       'Mexican',     NULL, NULL, 7.7,  68.0,  7, 4, true, 'test'),

  -- PORTUGAL (Gruppe K) -- 5 Spieler
  (90051, 'WM Test GK 1 (POR)',  'GK', 'Portugal',     'Portuguese',  NULL, NULL, 7.1,  50.0,  0, 0, true, 'test'),
  (90052, 'WM Test DF 1 (POR)',  'DF', 'Portugal',     'Portuguese',  NULL, NULL, 7.0,  40.0,  2, 3, true, 'test'),
  (90053, 'WM Test DF 2 (POR)',  'DF', 'Portugal',     'Portuguese',  NULL, NULL, 6.8,  37.0,  1, 2, true, 'test'),
  (90054, 'WM Test MF 1 (POR)',  'MF', 'Portugal',     'Portuguese',  NULL, NULL, 7.5,  62.0,  4, 7, true, 'test'),
  (90055, 'WM Test FW 1 (POR)',  'FW', 'Portugal',     'Portuguese',  NULL, NULL, 8.0,  76.0,  9, 5, true, 'test'),

  -- BELGIUM (Gruppe G) -- 5 Spieler
  (90056, 'WM Test GK 1 (BEL)',  'GK', 'Belgium',      'Belgian',     NULL, NULL, 7.0,  47.0,  0, 0, true, 'test'),
  (90057, 'WM Test DF 1 (BEL)',  'DF', 'Belgium',      'Belgian',     NULL, NULL, 6.9,  39.0,  1, 3, true, 'test'),
  (90058, 'WM Test DF 2 (BEL)',  'DF', 'Belgium',      'Belgian',     NULL, NULL, 6.7,  35.0,  1, 1, true, 'test'),
  (90059, 'WM Test MF 1 (BEL)',  'MF', 'Belgium',      'Belgian',     NULL, NULL, 7.4,  61.0,  4, 6, true, 'test'),
  (90060, 'WM Test FW 1 (BEL)',  'FW', 'Belgium',      'Belgian',     NULL, NULL, 7.8,  70.0,  7, 4, true, 'test'),

  -- CROATIA (Gruppe L) -- 5 Spieler
  (90061, 'WM Test GK 1 (CRO)',  'GK', 'Croatia',      'Croatian',    NULL, NULL, 6.9,  46.0,  0, 0, true, 'test'),
  (90062, 'WM Test DF 1 (CRO)',  'DF', 'Croatia',      'Croatian',    NULL, NULL, 6.8,  37.0,  1, 2, true, 'test'),
  (90063, 'WM Test DF 2 (CRO)',  'DF', 'Croatia',      'Croatian',    NULL, NULL, 6.7,  34.0,  0, 1, true, 'test'),
  (90064, 'WM Test MF 1 (CRO)',  'MF', 'Croatia',      'Croatian',    NULL, NULL, 7.4,  60.0,  4, 6, true, 'test'),
  (90065, 'WM Test FW 1 (CRO)',  'FW', 'Croatia',      'Croatian',    NULL, NULL, 7.6,  65.0,  6, 3, true, 'test'),

  -- CANADA (Gruppe B) -- 5 Spieler
  (90066, 'WM Test GK 1 (CAN)',  'GK', 'Canada',       'Canadian',    NULL, NULL, 6.8,  44.0,  0, 0, true, 'test'),
  (90067, 'WM Test DF 1 (CAN)',  'DF', 'Canada',       'Canadian',    NULL, NULL, 6.7,  36.0,  1, 1, true, 'test'),
  (90068, 'WM Test DF 2 (CAN)',  'DF', 'Canada',       'Canadian',    NULL, NULL, 6.6,  33.0,  0, 1, true, 'test'),
  (90069, 'WM Test MF 1 (CAN)',  'MF', 'Canada',       'Canadian',    NULL, NULL, 7.2,  56.0,  3, 4, true, 'test'),
  (90070, 'WM Test FW 1 (CAN)',  'FW', 'Canada',       'Canadian',    NULL, NULL, 7.5,  63.0,  5, 3, true, 'test'),

  -- SWITZERLAND (Gruppe B) -- 5 Spieler
  (90071, 'WM Test GK 1 (SUI)',  'GK', 'Switzerland',  'Swiss',       NULL, NULL, 7.0,  48.0,  0, 1, true, 'test'),
  (90072, 'WM Test DF 1 (SUI)',  'DF', 'Switzerland',  'Swiss',       NULL, NULL, 6.8,  38.0,  1, 2, true, 'test'),
  (90073, 'WM Test DF 2 (SUI)',  'DF', 'Switzerland',  'Swiss',       NULL, NULL, 6.7,  35.0,  1, 1, true, 'test'),
  (90074, 'WM Test MF 1 (SUI)',  'MF', 'Switzerland',  'Swiss',       NULL, NULL, 7.3,  58.0,  3, 5, true, 'test'),
  (90075, 'WM Test FW 1 (SUI)',  'FW', 'Switzerland',  'Swiss',       NULL, NULL, 7.5,  64.0,  5, 3, true, 'test'),

  -- MOROCCO (Gruppe C) -- 5 Spieler
  (90076, 'WM Test GK 1 (MAR)',  'GK', 'Morocco',      'Moroccan',    NULL, NULL, 7.0,  47.0,  0, 0, true, 'test'),
  (90077, 'WM Test DF 1 (MAR)',  'DF', 'Morocco',      'Moroccan',    NULL, NULL, 6.9,  38.0,  1, 2, true, 'test'),
  (90078, 'WM Test DF 2 (MAR)',  'DF', 'Morocco',      'Moroccan',    NULL, NULL, 6.7,  34.0,  0, 1, true, 'test'),
  (90079, 'WM Test MF 1 (MAR)',  'MF', 'Morocco',      'Moroccan',    NULL, NULL, 7.3,  59.0,  3, 5, true, 'test'),
  (90080, 'WM Test FW 1 (MAR)',  'FW', 'Morocco',      'Moroccan',    NULL, NULL, 7.6,  65.0,  6, 3, true, 'test'),

  -- SOUTH KOREA (Gruppe A) -- 5 Spieler
  (90081, 'WM Test GK 1 (KOR)',  'GK', 'South Korea',  'Korean',      NULL, NULL, 6.9,  46.0,  0, 0, true, 'test'),
  (90082, 'WM Test DF 1 (KOR)',  'DF', 'South Korea',  'Korean',      NULL, NULL, 6.8,  37.0,  1, 2, true, 'test'),
  (90083, 'WM Test DF 2 (KOR)',  'DF', 'South Korea',  'Korean',      NULL, NULL, 6.6,  33.0,  0, 1, true, 'test'),
  (90084, 'WM Test MF 1 (KOR)',  'MF', 'South Korea',  'Korean',      NULL, NULL, 7.2,  56.0,  3, 5, true, 'test'),
  (90085, 'WM Test FW 1 (KOR)',  'FW', 'South Korea',  'Korean',      NULL, NULL, 7.5,  63.0,  5, 3, true, 'test'),

  -- COLOMBIA (Gruppe K) -- 5 Spieler
  (90086, 'WM Test GK 1 (COL)',  'GK', 'Colombia',     'Colombian',   NULL, NULL, 7.0,  48.0,  0, 0, true, 'test'),
  (90087, 'WM Test DF 1 (COL)',  'DF', 'Colombia',     'Colombian',   NULL, NULL, 6.8,  38.0,  1, 2, true, 'test'),
  (90088, 'WM Test DF 2 (COL)',  'DF', 'Colombia',     'Colombian',   NULL, NULL, 6.7,  35.0,  1, 1, true, 'test'),
  (90089, 'WM Test MF 1 (COL)',  'MF', 'Colombia',     'Colombian',   NULL, NULL, 7.3,  59.0,  3, 5, true, 'test'),
  (90090, 'WM Test FW 1 (COL)',  'FW', 'Colombia',     'Colombian',   NULL, NULL, 7.7,  68.0,  6, 4, true, 'test'),

  -- SWEDEN (Gruppe F) -- 5 Spieler
  (90091, 'WM Test GK 1 (SWE)',  'GK', 'Sweden',       'Swedish',     NULL, NULL, 6.9,  46.0,  0, 0, true, 'test'),
  (90092, 'WM Test DF 1 (SWE)',  'DF', 'Sweden',       'Swedish',     NULL, NULL, 6.8,  37.0,  1, 2, true, 'test'),
  (90093, 'WM Test DF 2 (SWE)',  'DF', 'Sweden',       'Swedish',     NULL, NULL, 6.6,  33.0,  0, 1, true, 'test'),
  (90094, 'WM Test MF 1 (SWE)',  'MF', 'Sweden',       'Swedish',     NULL, NULL, 7.2,  56.0,  3, 4, true, 'test'),
  (90095, 'WM Test FW 1 (SWE)',  'FW', 'Sweden',       'Swedish',     NULL, NULL, 7.6,  65.0,  6, 3, true, 'test'),

  -- URUGUAY (Gruppe H) -- 5 Spieler
  (90096, 'WM Test GK 1 (URU)',  'GK', 'Uruguay',      'Uruguayan',   NULL, NULL, 7.0,  48.0,  0, 0, true, 'test'),
  (90097, 'WM Test DF 1 (URU)',  'DF', 'Uruguay',      'Uruguayan',   NULL, NULL, 6.9,  39.0,  1, 2, true, 'test'),
  (90098, 'WM Test DF 2 (URU)',  'DF', 'Uruguay',      'Uruguayan',   NULL, NULL, 6.7,  35.0,  1, 1, true, 'test'),
  (90099, 'WM Test MF 1 (URU)',  'MF', 'Uruguay',      'Uruguayan',   NULL, NULL, 7.3,  59.0,  3, 5, true, 'test'),
  (90100, 'WM Test FW 1 (URU)',  'FW', 'Uruguay',      'Uruguayan',   NULL, NULL, 7.7,  68.0,  7, 4, true, 'test'),

  -- SENEGAL (Gruppe I) -- 5 Spieler
  (90101, 'WM Test GK 1 (SEN)',  'GK', 'Senegal',      'Senegalese',  NULL, NULL, 7.0,  48.0,  0, 0, true, 'test'),
  (90102, 'WM Test DF 1 (SEN)',  'DF', 'Senegal',      'Senegalese',  NULL, NULL, 6.8,  38.0,  1, 2, true, 'test'),
  (90103, 'WM Test DF 2 (SEN)',  'DF', 'Senegal',      'Senegalese',  NULL, NULL, 6.7,  35.0,  0, 1, true, 'test'),
  (90104, 'WM Test MF 1 (SEN)',  'MF', 'Senegal',      'Senegalese',  NULL, NULL, 7.2,  57.0,  3, 5, true, 'test'),
  (90105, 'WM Test FW 1 (SEN)',  'FW', 'Senegal',      'Senegalese',  NULL, NULL, 7.6,  65.0,  6, 3, true, 'test'),

  -- NORWAY (Gruppe I) -- 5 Spieler
  (90106, 'WM Test GK 1 (NOR)',  'GK', 'Norway',       'Norwegian',   NULL, NULL, 6.9,  46.0,  0, 0, true, 'test'),
  (90107, 'WM Test DF 1 (NOR)',  'DF', 'Norway',       'Norwegian',   NULL, NULL, 6.8,  37.0,  1, 2, true, 'test'),
  (90108, 'WM Test DF 2 (NOR)',  'DF', 'Norway',       'Norwegian',   NULL, NULL, 6.6,  33.0,  0, 1, true, 'test'),
  (90109, 'WM Test MF 1 (NOR)',  'MF', 'Norway',       'Norwegian',   NULL, NULL, 7.3,  58.0,  4, 6, true, 'test'),
  (90110, 'WM Test FW 1 (NOR)',  'FW', 'Norway',       'Norwegian',   NULL, NULL, 7.8,  70.0,  8, 4, true, 'test'),

  -- AUSTRIA (Gruppe J) -- 5 Spieler
  (90111, 'WM Test GK 1 (AUT)',  'GK', 'Austria',      'Austrian',    NULL, NULL, 6.9,  46.0,  0, 0, true, 'test'),
  (90112, 'WM Test DF 1 (AUT)',  'DF', 'Austria',      'Austrian',    NULL, NULL, 6.8,  37.0,  1, 2, true, 'test'),
  (90113, 'WM Test DF 2 (AUT)',  'DF', 'Austria',      'Austrian',    NULL, NULL, 6.6,  33.0,  0, 1, true, 'test'),
  (90114, 'WM Test MF 1 (AUT)',  'MF', 'Austria',      'Austrian',    NULL, NULL, 7.2,  56.0,  3, 4, true, 'test'),
  (90115, 'WM Test FW 1 (AUT)',  'FW', 'Austria',      'Austrian',    NULL, NULL, 7.5,  63.0,  5, 3, true, 'test'),

  -- ALGERIA (Gruppe J) -- 5 Spieler
  (90116, 'WM Test GK 1 (ALG)',  'GK', 'Algeria',      'Algerian',    NULL, NULL, 6.8,  44.0,  0, 0, true, 'test'),
  (90117, 'WM Test DF 1 (ALG)',  'DF', 'Algeria',      'Algerian',    NULL, NULL, 6.7,  36.0,  1, 1, true, 'test'),
  (90118, 'WM Test DF 2 (ALG)',  'DF', 'Algeria',      'Algerian',    NULL, NULL, 6.5,  32.0,  0, 1, true, 'test'),
  (90119, 'WM Test MF 1 (ALG)',  'MF', 'Algeria',      'Algerian',    NULL, NULL, 7.1,  54.0,  3, 4, true, 'test'),
  (90120, 'WM Test FW 1 (ALG)',  'FW', 'Algeria',      'Algerian',    NULL, NULL, 7.4,  61.0,  5, 3, true, 'test')

ON CONFLICT (id) DO UPDATE SET
  is_test_player = true,
  player_source  = 'test';

-- =====================================================================
-- ERWEITERUNG: +48 Spieler (IDs 90121-90168)
-- 1 extra DF + 1 extra MF pro Nation = 24+24 = 48 zusaetzliche Spieler
-- Neue Gesamtverteilung: 24 GK + 72 DF + 48 MF + 24 FW = 168 Spieler
-- Kapazitaet: 8 Teams x 15 Spieler = 120 Draft-Picks, 48 als Waiver-Pool
-- =====================================================================

INSERT INTO players (id, name, position, team_name, nationality, photo_url, api_team_id, rating, fpts, goals, assists, is_test_player, player_source)
VALUES
  -- Extra DF + MF pro Nation (IDs 90121-90168)
  (90121, 'WM Test DF 3 (GER)',  'DF', 'Germany',      'German',      NULL, NULL, 6.6,  36.0,  0, 1, true, 'test'),
  (90122, 'WM Test MF 2 (GER)',  'MF', 'Germany',      'German',      NULL, NULL, 7.4,  59.0,  3, 5, true, 'test'),
  (90123, 'WM Test DF 3 (FRA)',  'DF', 'France',       'French',      NULL, NULL, 6.7,  37.0,  1, 2, true, 'test'),
  (90124, 'WM Test MF 2 (FRA)',  'MF', 'France',       'French',      NULL, NULL, 7.5,  62.0,  4, 6, true, 'test'),
  (90125, 'WM Test DF 3 (BRA)',  'DF', 'Brazil',       'Brazilian',   NULL, NULL, 6.6,  36.0,  1, 1, true, 'test'),
  (90126, 'WM Test MF 2 (BRA)',  'MF', 'Brazil',       'Brazilian',   NULL, NULL, 7.4,  60.0,  4, 6, true, 'test'),
  (90127, 'WM Test DF 3 (ARG)',  'DF', 'Argentina',    'Argentine',   NULL, NULL, 6.8,  38.0,  1, 2, true, 'test'),
  (90128, 'WM Test MF 2 (ARG)',  'MF', 'Argentina',    'Argentine',   NULL, NULL, 7.6,  64.0,  5, 6, true, 'test'),
  (90129, 'WM Test DF 3 (ESP)',  'DF', 'Spain',        'Spanish',     NULL, NULL, 6.6,  35.0,  0, 2, true, 'test'),
  (90130, 'WM Test MF 2 (ESP)',  'MF', 'Spain',        'Spanish',     NULL, NULL, 7.4,  61.0,  3, 7, true, 'test'),
  (90131, 'WM Test DF 3 (ENG)',  'DF', 'England',      'English',     NULL, NULL, 6.6,  35.0,  1, 1, true, 'test'),
  (90132, 'WM Test MF 2 (ENG)',  'MF', 'England',      'English',     NULL, NULL, 7.3,  59.0,  3, 5, true, 'test'),
  (90133, 'WM Test DF 3 (NED)',  'DF', 'Netherlands',  'Dutch',       NULL, NULL, 6.5,  33.0,  0, 1, true, 'test'),
  (90134, 'WM Test MF 2 (NED)',  'MF', 'Netherlands',  'Dutch',       NULL, NULL, 7.2,  57.0,  3, 5, true, 'test'),
  (90135, 'WM Test DF 3 (POR)',  'DF', 'Portugal',     'Portuguese',  NULL, NULL, 6.7,  37.0,  1, 2, true, 'test'),
  (90136, 'WM Test MF 2 (POR)',  'MF', 'Portugal',     'Portuguese',  NULL, NULL, 7.5,  62.0,  4, 6, true, 'test'),
  (90137, 'WM Test DF 3 (BEL)',  'DF', 'Belgium',      'Belgian',     NULL, NULL, 6.6,  36.0,  1, 1, true, 'test'),
  (90138, 'WM Test MF 2 (BEL)',  'MF', 'Belgium',      'Belgian',     NULL, NULL, 7.3,  58.0,  3, 5, true, 'test'),
  (90139, 'WM Test DF 3 (KOR)',  'DF', 'South Korea',  'Korean',      NULL, NULL, 6.5,  33.0,  0, 1, true, 'test'),
  (90140, 'WM Test MF 2 (KOR)',  'MF', 'South Korea',  'Korean',      NULL, NULL, 7.1,  55.0,  2, 4, true, 'test'),
  (90141, 'WM Test DF 3 (MEX)',  'DF', 'Mexico',       'Mexican',     NULL, NULL, 6.5,  33.0,  0, 1, true, 'test'),
  (90142, 'WM Test MF 2 (MEX)',  'MF', 'Mexico',       'Mexican',     NULL, NULL, 7.1,  54.0,  2, 4, true, 'test'),
  (90143, 'WM Test DF 3 (COL)',  'DF', 'Colombia',     'Colombian',   NULL, NULL, 6.5,  33.0,  0, 1, true, 'test'),
  (90144, 'WM Test MF 2 (COL)',  'MF', 'Colombia',     'Colombian',   NULL, NULL, 7.2,  56.0,  3, 4, true, 'test'),
  (90145, 'WM Test DF 3 (CRO)',  'DF', 'Croatia',      'Croatian',    NULL, NULL, 6.6,  35.0,  1, 1, true, 'test'),
  (90146, 'WM Test MF 2 (CRO)',  'MF', 'Croatia',      'Croatian',    NULL, NULL, 7.2,  57.0,  3, 5, true, 'test'),
  (90147, 'WM Test DF 3 (MAR)',  'DF', 'Morocco',      'Moroccan',    NULL, NULL, 6.5,  32.0,  0, 1, true, 'test'),
  (90148, 'WM Test MF 2 (MAR)',  'MF', 'Morocco',      'Moroccan',    NULL, NULL, 7.1,  55.0,  2, 4, true, 'test'),
  (90149, 'WM Test DF 3 (JPN)',  'DF', 'Japan',        'Japanese',    NULL, NULL, 6.5,  32.0,  0, 1, true, 'test'),
  (90150, 'WM Test MF 2 (JPN)',  'MF', 'Japan',        'Japanese',    NULL, NULL, 7.1,  55.0,  2, 4, true, 'test'),
  (90151, 'WM Test DF 3 (SEN)',  'DF', 'Senegal',      'Senegalese',  NULL, NULL, 6.5,  33.0,  0, 1, true, 'test'),
  (90152, 'WM Test MF 2 (SEN)',  'MF', 'Senegal',      'Senegalese',  NULL, NULL, 7.1,  54.0,  2, 4, true, 'test'),
  (90153, 'WM Test DF 3 (USA)',  'DF', 'USA',          'American',    NULL, NULL, 6.5,  32.0,  0, 1, true, 'test'),
  (90154, 'WM Test MF 2 (USA)',  'MF', 'USA',          'American',    NULL, NULL, 7.0,  53.0,  2, 4, true, 'test'),
  (90155, 'WM Test DF 3 (URU)',  'DF', 'Uruguay',      'Uruguayan',   NULL, NULL, 6.5,  33.0,  0, 1, true, 'test'),
  (90156, 'WM Test MF 2 (URU)',  'MF', 'Uruguay',      'Uruguayan',   NULL, NULL, 7.2,  57.0,  3, 5, true, 'test'),
  (90157, 'WM Test DF 3 (SUI)',  'DF', 'Switzerland',  'Swiss',       NULL, NULL, 6.5,  32.0,  0, 1, true, 'test'),
  (90158, 'WM Test MF 2 (SUI)',  'MF', 'Switzerland',  'Swiss',       NULL, NULL, 7.0,  53.0,  2, 4, true, 'test'),
  (90159, 'WM Test DF 3 (NOR)',  'DF', 'Norway',       'Norwegian',   NULL, NULL, 6.5,  32.0,  0, 1, true, 'test'),
  (90160, 'WM Test MF 2 (NOR)',  'MF', 'Norway',       'Norwegian',   NULL, NULL, 7.1,  55.0,  2, 4, true, 'test'),
  (90161, 'WM Test DF 3 (SWE)',  'DF', 'Sweden',       'Swedish',     NULL, NULL, 6.4,  31.0,  0, 1, true, 'test'),
  (90162, 'WM Test MF 2 (SWE)',  'MF', 'Sweden',       'Swedish',     NULL, NULL, 7.0,  52.0,  2, 3, true, 'test'),
  (90163, 'WM Test DF 3 (CAN)',  'DF', 'Canada',       'Canadian',    NULL, NULL, 6.5,  32.0,  0, 1, true, 'test'),
  (90164, 'WM Test MF 2 (CAN)',  'MF', 'Canada',       'Canadian',    NULL, NULL, 7.0,  53.0,  2, 3, true, 'test'),
  (90165, 'WM Test DF 3 (AUT)',  'DF', 'Austria',      'Austrian',    NULL, NULL, 6.4,  31.0,  0, 1, true, 'test'),
  (90166, 'WM Test MF 2 (AUT)',  'MF', 'Austria',      'Austrian',    NULL, NULL, 6.9,  51.0,  2, 3, true, 'test'),
  (90167, 'WM Test DF 3 (ALG)',  'DF', 'Algeria',      'Algerian',    NULL, NULL, 6.4,  30.0,  0, 1, true, 'test'),
  (90168, 'WM Test MF 2 (ALG)',  'MF', 'Algeria',      'Algerian',    NULL, NULL, 6.9,  51.0,  2, 3, true, 'test')

ON CONFLICT (id) DO UPDATE SET
  is_test_player = true,
  player_source  = 'test';

-- =====================================================================
-- Verify-Query fuer 168 Spieler:
-- =====================================================================
-- SELECT
--   COUNT(*)                                      AS total_players,
--   COUNT(DISTINCT team_name)                     AS nations,
--   COUNT(*) FILTER (WHERE position = 'GK')       AS gk,
--   COUNT(*) FILTER (WHERE position = 'DF')       AS df,
--   COUNT(*) FILTER (WHERE position = 'MF')       AS mf,
--   COUNT(*) FILTER (WHERE position = 'FW')       AS fw
-- FROM players
-- WHERE id BETWEEN 90001 AND 90168;
--
-- Erwartetes Ergebnis:
--   total_players = 168
--   nations       = 24
--   gk            = 24  (1 pro Nation)
--   df            = 72  (3 pro Nation)
--   mf            = 48  (2 pro Nation)
--   fw            = 24  (1 pro Nation)
--
-- Kapazitaet:  8 Teams x 15 Spieler = 120 Draft-Picks
--              48 Spieler bleiben als Waiver-Pool uebrig
-- =====================================================================
