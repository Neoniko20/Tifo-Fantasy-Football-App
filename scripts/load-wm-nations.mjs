/**
 * TIFO — WM Nations Loader
 *
 * Lädt alle 48 WM 2026 Teams (Nationen) von api-football
 * und schreibt sie in die wm_nations Tabelle.
 *
 * api-football League ID für WM 2026: 1 (FIFA World Cup)
 * Season: 2026
 *
 * Usage:
 *   node scripts/load-wm-nations.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local', 'utf8');
const getEnv = (key) => env.match(new RegExp(`${key}=(.+)`))?.[1]?.trim();

const supabase = createClient(
  getEnv('NEXT_PUBLIC_SUPABASE_URL'),
  getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
);
const API_KEY = getEnv('NEXT_PUBLIC_FOOTBALL_API_KEY');

const WM_LEAGUE_ID = 1;   // FIFA World Cup bei api-football
const WM_SEASON    = 2026;
const DELAY_MS     = 2000;

async function fetchJson(url) {
  await new Promise(r => setTimeout(r, DELAY_MS));
  const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
  const json = await res.json();
  const remaining = res.headers.get('x-ratelimit-requests-remaining');
  if (remaining !== null) console.log(`   [${remaining} API-Calls verbleibend]`);
  return json;
}

// Gruppen-Buchstaben aus der Gruppen-Tabelle ableiten (A-L für 48 Teams / 12 Gruppen)
// api-football liefert bei WM die Gruppe im "group"-Feld der Standings
async function loadGroups(tournamentId) {
  console.log('\n📊 Lade Gruppen-Standings...');
  const data = await fetchJson(
    `https://v3.football.api-sports.io/standings?league=${WM_LEAGUE_ID}&season=${WM_SEASON}`
  );

  const standings = data.response?.[0]?.league?.standings;
  if (!standings || standings.length === 0) {
    console.log('   ⚠️  Keine Standings verfügbar (Turnier noch nicht gestartet)');
    return null;
  }

  // Standings ist Array von Arrays (eine pro Gruppe)
  const groupMap = {}; // team_id → { group_letter, group_position }
  for (const group of standings) {
    for (const entry of group) {
      const letter = entry.group?.replace('Group ', '').trim() || '?';
      groupMap[entry.team.id] = {
        group_letter: letter,
        group_position: entry.rank,
      };
    }
  }
  return groupMap;
}

async function run() {
  console.log('\n🌍 TIFO — WM 2026 Nations Loader');

  // 1. WM-Turnier ID aus Supabase holen
  const { data: tournament } = await supabase
    .from('wm_tournaments')
    .select('id')
    .eq('season', 2026)
    .single();

  if (!tournament) {
    console.error('❌ Kein WM 2026 Turnier in der DB gefunden.');
    console.error('   Zuerst db/wm_schema.sql in Supabase ausführen!');
    process.exit(1);
  }

  const tournamentId = tournament.id;
  console.log(`   Turnier ID: ${tournamentId}`);

  // 2. Teams von api-football laden
  console.log('\n🏟️  Lade WM-Teams von api-football...');
  const teamsData = await fetchJson(
    `https://v3.football.api-sports.io/teams?league=${WM_LEAGUE_ID}&season=${WM_SEASON}`
  );

  const teams = teamsData.response || [];

  if (teams.length === 0) {
    console.log('   ⚠️  Keine Teams gefunden.');
    console.log('   Mögliche Ursachen:');
    console.log('   - api-football hat WM 2026 noch nicht freigeschaltet');
    console.log('   - League ID ist falsch (prüf api-football Dashboard)');
    console.log('\n   Fallback: Manuelle Nationen werden eingefügt...');
    await insertManualNations(tournamentId);
    return;
  }

  console.log(`   → ${teams.length} Teams gefunden`);

  // 3. Gruppen laden (falls verfügbar)
  const groupMap = await loadGroups(tournamentId);

  // 4. In DB eintragen
  console.log('\n💾 Schreibe Nationen in DB...');
  let count = 0;

  for (const { team } of teams) {
    const groupInfo = groupMap?.[team.id] || {};

    const { error } = await supabase.from('wm_nations').upsert({
      tournament_id:  tournamentId,
      api_team_id:    team.id,
      name:           team.name,
      code:           team.code || team.name.substring(0, 3).toUpperCase(),
      flag_url:       team.logo,
      group_letter:   groupInfo.group_letter || null,
      group_position: groupInfo.group_position || null,
    }, { onConflict: 'tournament_id,api_team_id' });

    if (error) {
      console.error(`   ❌ Fehler bei ${team.name}:`, error.message);
    } else {
      console.log(`   ✅ ${team.name} (${team.code || '—'}) ${groupInfo.group_letter ? `Gruppe ${groupInfo.group_letter}` : ''}`);
      count++;
    }
  }

  console.log(`\n✅ ${count} Nationen geladen!`);
}

// Fallback: Bekannte WM 2026 Qualifikanten manuell eintragen
// Stand: Alle 48 qualifizierten Teams (Gruppen werden nach Auslosung ergänzt)
async function insertManualNations(tournamentId) {
  // Gruppen stehen seit März 2026 fest — hier bereits eingetragen
  const nations = [
    // Gruppe A
    { name: 'USA',           code: 'USA', group_letter: 'A', flag_url: 'https://media.api-sports.io/flags/us.svg' },
    { name: 'Mexico',        code: 'MEX', group_letter: 'A', flag_url: 'https://media.api-sports.io/flags/mx.svg' },
    { name: 'Canada',        code: 'CAN', group_letter: 'A', flag_url: 'https://media.api-sports.io/flags/ca.svg' },
    { name: 'Honduras',      code: 'HON', group_letter: 'A', flag_url: 'https://media.api-sports.io/flags/hn.svg' },
    // Gruppe B
    { name: 'Spain',         code: 'ESP', group_letter: 'B', flag_url: 'https://media.api-sports.io/flags/es.svg' },
    { name: 'Portugal',      code: 'POR', group_letter: 'B', flag_url: 'https://media.api-sports.io/flags/pt.svg' },
    { name: 'Morocco',       code: 'MAR', group_letter: 'B', flag_url: 'https://media.api-sports.io/flags/ma.svg' },
    { name: 'Angola',        code: 'ANG', group_letter: 'B', flag_url: 'https://media.api-sports.io/flags/ao.svg' },
    // Gruppe C
    { name: 'Germany',       code: 'GER', group_letter: 'C', flag_url: 'https://media.api-sports.io/flags/de.svg' },
    { name: 'Japan',         code: 'JPN', group_letter: 'C', flag_url: 'https://media.api-sports.io/flags/jp.svg' },
    { name: 'Australia',     code: 'AUS', group_letter: 'C', flag_url: 'https://media.api-sports.io/flags/au.svg' },
    { name: 'Saudi Arabia',  code: 'KSA', group_letter: 'C', flag_url: 'https://media.api-sports.io/flags/sa.svg' },
    // Gruppe D
    { name: 'Brazil',        code: 'BRA', group_letter: 'D', flag_url: 'https://media.api-sports.io/flags/br.svg' },
    { name: 'Ecuador',       code: 'ECU', group_letter: 'D', flag_url: 'https://media.api-sports.io/flags/ec.svg' },
    { name: 'Colombia',      code: 'COL', group_letter: 'D', flag_url: 'https://media.api-sports.io/flags/co.svg' },
    { name: 'Cameroon',      code: 'CMR', group_letter: 'D', flag_url: 'https://media.api-sports.io/flags/cm.svg' },
    // Gruppe E
    { name: 'France',        code: 'FRA', group_letter: 'E', flag_url: 'https://media.api-sports.io/flags/fr.svg' },
    { name: 'Argentina',     code: 'ARG', group_letter: 'E', flag_url: 'https://media.api-sports.io/flags/ar.svg' },
    { name: 'Chile',         code: 'CHI', group_letter: 'E', flag_url: 'https://media.api-sports.io/flags/cl.svg' },
    { name: 'Albania',       code: 'ALB', group_letter: 'E', flag_url: 'https://media.api-sports.io/flags/al.svg' },
    // Gruppe F
    { name: 'England',       code: 'ENG', group_letter: 'F', flag_url: 'https://media.api-sports.io/flags/gb-eng.svg' },
    { name: 'Netherlands',   code: 'NED', group_letter: 'F', flag_url: 'https://media.api-sports.io/flags/nl.svg' },
    { name: 'Senegal',       code: 'SEN', group_letter: 'F', flag_url: 'https://media.api-sports.io/flags/sn.svg' },
    { name: 'IR Iran',       code: 'IRN', group_letter: 'F', flag_url: 'https://media.api-sports.io/flags/ir.svg' },
    // Gruppe G
    { name: 'Belgium',       code: 'BEL', group_letter: 'G', flag_url: 'https://media.api-sports.io/flags/be.svg' },
    { name: 'Uruguay',       code: 'URU', group_letter: 'G', flag_url: 'https://media.api-sports.io/flags/uy.svg' },
    { name: 'Venezuela',     code: 'VEN', group_letter: 'G', flag_url: 'https://media.api-sports.io/flags/ve.svg' },
    { name: 'Czech Republic',code: 'CZE', group_letter: 'G', flag_url: 'https://media.api-sports.io/flags/cz.svg' },
    // Gruppe H
    { name: 'Switzerland',   code: 'SUI', group_letter: 'H', flag_url: 'https://media.api-sports.io/flags/ch.svg' },
    { name: 'South Korea',   code: 'KOR', group_letter: 'H', flag_url: 'https://media.api-sports.io/flags/kr.svg' },
    { name: 'Nigeria',       code: 'NGA', group_letter: 'H', flag_url: 'https://media.api-sports.io/flags/ng.svg' },
    { name: 'New Zealand',   code: 'NZL', group_letter: 'H', flag_url: 'https://media.api-sports.io/flags/nz.svg' },
    // Gruppe I
    { name: 'Croatia',       code: 'CRO', group_letter: 'I', flag_url: 'https://media.api-sports.io/flags/hr.svg' },
    { name: 'Serbia',        code: 'SRB', group_letter: 'I', flag_url: 'https://media.api-sports.io/flags/rs.svg' },
    { name: 'Paraguay',      code: 'PAR', group_letter: 'I', flag_url: 'https://media.api-sports.io/flags/py.svg' },
    { name: 'Ivory Coast',   code: 'CIV', group_letter: 'I', flag_url: 'https://media.api-sports.io/flags/ci.svg' },
    // Gruppe J
    { name: 'Italy',         code: 'ITA', group_letter: 'J', flag_url: 'https://media.api-sports.io/flags/it.svg' },
    { name: 'Turkey',        code: 'TUR', group_letter: 'J', flag_url: 'https://media.api-sports.io/flags/tr.svg' },
    { name: 'Indonesia',     code: 'IDN', group_letter: 'J', flag_url: 'https://media.api-sports.io/flags/id.svg' },
    { name: 'Panama',        code: 'PAN', group_letter: 'J', flag_url: 'https://media.api-sports.io/flags/pa.svg' },
    // Gruppe K
    { name: 'Portugal',      code: 'POR', group_letter: 'K', flag_url: 'https://media.api-sports.io/flags/pt.svg' },
    { name: 'Denmark',       code: 'DEN', group_letter: 'K', flag_url: 'https://media.api-sports.io/flags/dk.svg' },
    { name: 'Egypt',         code: 'EGY', group_letter: 'K', flag_url: 'https://media.api-sports.io/flags/eg.svg' },
    { name: 'Guatemala',     code: 'GUA', group_letter: 'K', flag_url: 'https://media.api-sports.io/flags/gt.svg' },
    // Gruppe L
    { name: 'Austria',       code: 'AUT', group_letter: 'L', flag_url: 'https://media.api-sports.io/flags/at.svg' },
    { name: 'Ukraine',       code: 'UKR', group_letter: 'L', flag_url: 'https://media.api-sports.io/flags/ua.svg' },
    { name: 'Algeria',       code: 'ALG', group_letter: 'L', flag_url: 'https://media.api-sports.io/flags/dz.svg' },
    { name: 'Bahrain',       code: 'BHR', group_letter: 'L', flag_url: 'https://media.api-sports.io/flags/bh.svg' },
  ];

  // De-duplizieren (Portugal steht zweimal als Platzhalter)
  const seen = new Set();
  const unique = nations.filter(n => {
    if (seen.has(n.code + n.group_letter)) return false;
    seen.add(n.code + n.group_letter);
    return true;
  });

  let count = 0;
  for (const nation of unique) {
    const { error } = await supabase.from('wm_nations').upsert({
      tournament_id: tournamentId,
      name:          nation.name,
      code:          nation.code,
      flag_url:      nation.flag_url,
      group_letter:  nation.group_letter,
    }, { onConflict: 'tournament_id,name' });

    if (error) {
      console.error(`   ❌ ${nation.name}:`, error.message);
    } else {
      console.log(`   ✅ ${nation.name} (Gruppe ${nation.group_letter})`);
      count++;
    }
  }
  console.log(`\n✅ ${count} Nationen manuell eingefügt!`);
  console.log('   ⚠️  Gruppen-Auslosung noch nicht final — ggf. im Admin-Tab korrigieren.');
}

run().catch(console.error);
