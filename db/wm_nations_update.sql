-- ═══════════════════════════════════════════════════════════════════
-- WM 2026 — Korrekte Gruppen & Spielplan
-- In Supabase SQL Editor ausführen
-- ═══════════════════════════════════════════════════════════════════

-- 1. Alte (falsche) Nationen löschen
DELETE FROM wm_nations
WHERE tournament_id = 'a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7';

-- 2. Korrekte 48 Nationen einfügen
INSERT INTO wm_nations (tournament_id, name, code, flag_url, group_letter) VALUES
  -- Gruppe A
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Mexico',             'MEX', 'https://media.api-sports.io/flags/mx.svg', 'A'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'South Africa',       'RSA', 'https://media.api-sports.io/flags/za.svg', 'A'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'South Korea',        'KOR', 'https://media.api-sports.io/flags/kr.svg', 'A'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Czech Republic',     'CZE', 'https://media.api-sports.io/flags/cz.svg', 'A'),
  -- Gruppe B
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Canada',             'CAN', 'https://media.api-sports.io/flags/ca.svg', 'B'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Bosnia-Herzegovina', 'BIH', 'https://media.api-sports.io/flags/ba.svg', 'B'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Qatar',              'QAT', 'https://media.api-sports.io/flags/qa.svg', 'B'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Switzerland',        'SUI', 'https://media.api-sports.io/flags/ch.svg', 'B'),
  -- Gruppe C
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Brazil',             'BRA', 'https://media.api-sports.io/flags/br.svg', 'C'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Morocco',            'MAR', 'https://media.api-sports.io/flags/ma.svg', 'C'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Haiti',              'HAI', 'https://media.api-sports.io/flags/ht.svg', 'C'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Scotland',           'SCO', 'https://media.api-sports.io/flags/gb-sct.svg', 'C'),
  -- Gruppe D
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'USA',                'USA', 'https://media.api-sports.io/flags/us.svg', 'D'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Australia',          'AUS', 'https://media.api-sports.io/flags/au.svg', 'D'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Paraguay',           'PAR', 'https://media.api-sports.io/flags/py.svg', 'D'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Turkey',             'TUR', 'https://media.api-sports.io/flags/tr.svg', 'D'),
  -- Gruppe E
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Germany',            'GER', 'https://media.api-sports.io/flags/de.svg', 'E'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Curacao',            'CUR', 'https://media.api-sports.io/flags/cw.svg', 'E'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Ivory Coast',        'CIV', 'https://media.api-sports.io/flags/ci.svg', 'E'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Ecuador',            'ECU', 'https://media.api-sports.io/flags/ec.svg', 'E'),
  -- Gruppe F
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Netherlands',        'NED', 'https://media.api-sports.io/flags/nl.svg', 'F'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Japan',              'JPN', 'https://media.api-sports.io/flags/jp.svg', 'F'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Sweden',             'SWE', 'https://media.api-sports.io/flags/se.svg', 'F'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Tunisia',            'TUN', 'https://media.api-sports.io/flags/tn.svg', 'F'),
  -- Gruppe G
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Belgium',            'BEL', 'https://media.api-sports.io/flags/be.svg', 'G'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Egypt',              'EGY', 'https://media.api-sports.io/flags/eg.svg', 'G'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'IR Iran',            'IRN', 'https://media.api-sports.io/flags/ir.svg', 'G'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'New Zealand',        'NZL', 'https://media.api-sports.io/flags/nz.svg', 'G'),
  -- Gruppe H
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Spain',              'ESP', 'https://media.api-sports.io/flags/es.svg', 'H'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Cape Verde',         'CPV', 'https://media.api-sports.io/flags/cv.svg', 'H'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Saudi Arabia',       'KSA', 'https://media.api-sports.io/flags/sa.svg', 'H'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Uruguay',            'URU', 'https://media.api-sports.io/flags/uy.svg', 'H'),
  -- Gruppe I
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'France',             'FRA', 'https://media.api-sports.io/flags/fr.svg', 'I'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Senegal',            'SEN', 'https://media.api-sports.io/flags/sn.svg', 'I'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Iraq',               'IRQ', 'https://media.api-sports.io/flags/iq.svg', 'I'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Norway',             'NOR', 'https://media.api-sports.io/flags/no.svg', 'I'),
  -- Gruppe J
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Argentina',          'ARG', 'https://media.api-sports.io/flags/ar.svg', 'J'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Algeria',            'ALG', 'https://media.api-sports.io/flags/dz.svg', 'J'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Austria',            'AUT', 'https://media.api-sports.io/flags/at.svg', 'J'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Jordan',             'JOR', 'https://media.api-sports.io/flags/jo.svg', 'J'),
  -- Gruppe K
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Portugal',           'POR', 'https://media.api-sports.io/flags/pt.svg', 'K'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'DR Congo',           'COD', 'https://media.api-sports.io/flags/cd.svg', 'K'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Colombia',           'COL', 'https://media.api-sports.io/flags/co.svg', 'K'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Uzbekistan',         'UZB', 'https://media.api-sports.io/flags/uz.svg', 'K'),
  -- Gruppe L
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'England',            'ENG', 'https://media.api-sports.io/flags/gb-eng.svg', 'L'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Croatia',            'CRO', 'https://media.api-sports.io/flags/hr.svg', 'L'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Ghana',              'GHA', 'https://media.api-sports.io/flags/gh.svg', 'L'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 'Panama',             'PAN', 'https://media.api-sports.io/flags/pa.svg', 'L');

-- 3. Gameweeks aktualisieren (8 statt 7 — WM 2026 hat Sechzehntelfinale)
DELETE FROM wm_gameweeks
WHERE tournament_id = 'a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7';

INSERT INTO wm_gameweeks (tournament_id, gameweek, label, phase, start_date, end_date, status) VALUES
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 1, 'Vorrunde — Spieltag 1',  'group',       '2026-06-11', '2026-06-18', 'upcoming'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 2, 'Vorrunde — Spieltag 2',  'group',       '2026-06-18', '2026-06-24', 'upcoming'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 3, 'Vorrunde — Spieltag 3',  'group',       '2026-06-24', '2026-06-28', 'upcoming'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 4, 'Sechzehntelfinale',      'round_of_32', '2026-06-28', '2026-07-04', 'upcoming'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 5, 'Achtelfinale',           'round_of_16', '2026-07-04', '2026-07-08', 'upcoming'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 6, 'Viertelfinale',          'quarter',     '2026-07-11', '2026-07-12', 'upcoming'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 7, 'Halbfinale',             'semi',        '2026-07-14', '2026-07-15', 'upcoming'),
  ('a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7', 8, 'Finale',                 'final',       '2026-07-19', '2026-07-19', 'upcoming');

-- 4. waiver_mode_starts_gameweek auf 4 updaten (Sechzehntelfinale statt GW4=Achtelfinale)
UPDATE wm_league_settings
SET waiver_mode_starts_gameweek = 4
WHERE tournament_id = 'a3e45ea3-71e7-4a00-aa16-fa54ef0eeee7';
