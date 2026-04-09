/**
 * TheSportsDB Asset Cache
 *
 * Holt Club-Badges, -Farben und Kits für alle 65 Clubs in unserer DB
 * sowie Badges/Trophäen für die 5 Fußball-Ligen.
 *
 * Output:
 *   lib/tsdb-clubs.json   → { "Arsenal": { badge, colour1, colour2, kit }, ... }
 *   lib/tsdb-leagues.json → { "4328": { name, badge, logo, trophy }, ... }
 *
 * Usage:
 *   node scripts/cache-tsdb.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

const env    = readFileSync(join(ROOT, '.env.local'), 'utf8');
const getEnv = (k) => env.match(new RegExp(k + '=(.+)'))?.[1]?.trim();

const supabase = createClient(
  getEnv('NEXT_PUBLIC_SUPABASE_URL'),
  getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
);

const TSDB_BASE  = 'https://www.thesportsdb.com/api/v1/json/3';
const DELAY_MS   = 2200; // ~27 req/min, safely under 30/min limit

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Manual name overrides: our DB name → TheSportsDB search term
const NAME_MAP = {
  'Bayern München':           'Bayern Munich',
  'Borussia Mönchengladbach': 'Borussia Monchengladbach',
  'FSV Mainz 05':             'Mainz',
  'Paris Saint Germain':      'Paris Saint-Germain',
  '1899 Hoffenheim':          'TSG 1899 Hoffenheim',
  '1. FC Heidenheim':         'Heidenheim',
  '1. FC Köln':               'FC Cologne',
  'SV Darmstadt 98':          'Darmstadt',
  'VfL Bochum':               'Bochum',
  'SC Freiburg':              'Freiburg',
  'Fortuna Düsseldorf':       'Fortuna Dusseldorf',
  'RB Leipzig':               'RB Leipzig',
  'Eintracht Frankfurt':      'Eintracht Frankfurt',
  'VfB Stuttgart':            'Stuttgart',
  'Werder Bremen':            'Werder Bremen',
  'FC Augsburg':              'FC Augsburg',
  'FC St. Pauli':             'St Pauli',
  'SV Elversberg':            'SV 07 Elversberg',
  'Holstein Kiel':            'Holstein Kiel',
  'Union Berlin':             'Union Berlin',
  'Athletic Club':            'Athletic Bilbao',
  'Atletico Madrid':          'Atletico Madrid',
  'Granada CF':               'Granada',
  'Real Betis':               'Real Betis',
  'Celta Vigo':               'Celta de Vigo',
  'Leganes':                  'CD Leganes',
  'Las Palmas':               'UD Las Palmas',
  'Valladolid':               'Real Valladolid',
  'Osasuna':                  'CA Osasuna',
  'Wolves':                   'Wolverhampton Wanderers',
  'Nottingham Forest':        'Nottingham Forest',
  'West Ham':                 'West Ham United',
  'Sheffield Utd':            'Sheffield United',
  'Bournemouth':              'Bournemouth',
  'Ipswich':                  'Ipswich Town',
  'Newcastle':                'Newcastle United',
  'AC Milan':                 'AC Milan',
  'Empoli':                   'Empoli',
  'Monza':                    'Monza',
  'Inter':                    'Inter Milan',
  '1899 Hoffenheim':          'Hoffenheim',
  'VfL Wolfsburg':            'Wolfsburg',
  'Paris Saint Germain':      'Paris SG',
  '1. FC Heidenheim':         'Heidenheim 1846',
  '1. FC Köln':               'FC Koln',
  'Brighton':                 'Brighton and Hove Albion',
  'Tottenham':                'Tottenham Hotspur',
  'Osasuna':                  'Osasuna',
  'Las Palmas':               'Las Palmas',
  'Leganes':                  'Leganes',
  'SV Elversberg':            'Elversberg',
};

// TheSportsDB IDs for the 5 real leagues
const LEAGUE_IDS = [
  { id: '4328', name: 'Premier League',  apId: 39  },
  { id: '4331', name: 'Bundesliga',      apId: 78  },
  { id: '4332', name: 'Serie A',         apId: 135 },
  { id: '4334', name: 'Ligue 1',         apId: 61  },
  { id: '4335', name: 'La Liga',         apId: 140 },
];

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function searchTeam(name) {
  const searchName = NAME_MAP[name] || name;
  const encoded = encodeURIComponent(searchName);
  const data = await fetchJSON(`${TSDB_BASE}/searchteams.php?t=${encoded}`);
  const teams = data.teams || [];
  if (teams.length === 0) return null;
  // Take first result – search is pretty accurate for top clubs
  return teams[0];
}

// ─── Main ───────────────────────────────────────────────────────────────────

console.log('🌍 TheSportsDB Asset Cache\n');

// 1. Load all unique clubs from players table
const { data: players } = await supabase
  .from('players')
  .select('team_name, api_team_id')
  .limit(3000);

const clubsMap = {};
(players || []).forEach(p => {
  if (p.team_name && !clubsMap[p.team_name]) {
    clubsMap[p.team_name] = p.api_team_id;
  }
});

const clubNames = Object.keys(clubsMap);
console.log(`📋 ${clubNames.length} Clubs gefunden\n`);

// 2. Fetch club data from TheSportsDB
const clubAssets = {};
let calls = 0;

for (const name of clubNames) {
  process.stdout.write(`  ${name}...`);
  try {
    const team = await searchTeam(name);
    if (team) {
      clubAssets[name] = {
        tsdb_id:  team.idTeam,
        badge:    team.strTeamBadge  || null,
        logo:     team.strTeamLogo   || null,
        kit:      team.strEquipment  || null,
        colour1:  team.strColour1    || null,
        colour2:  team.strColour2    || null,
        fanart1:  team.strTeamFanart1 || null,
        stadium:  team.strStadiumThumb || null,
        tsdb_name: team.strTeam,
      };
      console.log(` ✅ ${team.strTeam}`);
    } else {
      clubAssets[name] = null;
      console.log(` ❌ nicht gefunden`);
    }
  } catch (e) {
    clubAssets[name] = null;
    console.log(` ⚠️  Fehler: ${e.message}`);
  }
  calls++;
  await delay(DELAY_MS);
}

// 3. Save clubs JSON
const clubsOut = join(ROOT, 'lib', 'tsdb-clubs.json');
writeFileSync(clubsOut, JSON.stringify(clubAssets, null, 2));
console.log(`\n✅ Clubs gespeichert → lib/tsdb-clubs.json (${calls} API-Calls)\n`);

// 4. Fetch league data
console.log('🏆 Liga-Badges laden...\n');
const leagueAssets = {};

for (const league of LEAGUE_IDS) {
  process.stdout.write(`  ${league.name} (${league.id})...`);
  try {
    const data = await fetchJSON(`${TSDB_BASE}/lookupleague.php?id=${league.id}`);
    const l = (data.leagues || [])[0];
    if (l) {
      leagueAssets[league.apId] = {
        tsdb_id:  league.id,
        name:     l.strLeague,
        badge:    l.strBadge   || null,
        logo:     l.strLogo    || null,
        poster:   l.strPoster  || null,
        trophy:   l.strTrophy  || null,
        banner:   l.strBanner  || null,
        fanart1:  l.strFanart1 || null,
        country:  l.strCountry || null,
      };
      console.log(` ✅`);
    } else {
      console.log(` ❌`);
    }
  } catch (e) {
    console.log(` ⚠️  ${e.message}`);
  }
  await delay(DELAY_MS);
}

// 5. Save leagues JSON
const leaguesOut = join(ROOT, 'lib', 'tsdb-leagues.json');
writeFileSync(leaguesOut, JSON.stringify(leagueAssets, null, 2));
console.log(`\n✅ Ligen gespeichert → lib/tsdb-leagues.json`);

const found = Object.values(clubAssets).filter(Boolean).length;
console.log(`\n🎉 Fertig! ${found}/${clubNames.length} Clubs gefunden, ${LEAGUE_IDS.length} Ligen gecacht.`);
