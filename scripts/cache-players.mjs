/**
 * Global Dynasty – Player Cache Script
 *
 * Lädt alle Spieler aller 5 Ligen mit vollständigen Stats von api-football.com
 * und speichert sie in Supabase.
 *
 * Limit: 100 API-Calls/Tag → Script stoppt bei 90 (Sicherheitspuffer).
 * Einfach erneut ausführen um weiterzumachen – upsert ist idempotent.
 *
 * Usage:
 *   node scripts/cache-players.mjs              → alle Ligen
 *   node scripts/cache-players.mjs 78           → nur Bundesliga
 *   node scripts/cache-players.mjs 78 39        → BL + PL
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

const ALL_LEAGUES = [
  { id: 78,  name: 'Bundesliga',     season: 2024 },
  { id: 39,  name: 'Premier League', season: 2024 },
  { id: 140, name: 'La Liga',        season: 2024 },
  { id: 135, name: 'Serie A',        season: 2024 },
  { id: 61,  name: 'Ligue 1',        season: 2024 },
];

const CALL_LIMIT  = 90;
const DELAY_MS    = 7000; // ms zwischen Calls (~8 Calls/min, sicher unter 10/min Limit)
const RETRY_DELAY = 65000; // ms Wartezeit bei Throttling (volles Minute-Fenster überspringen)

// CLI: optional liga-ids als Argumente
const argLeagueIds = process.argv.slice(2).map(Number).filter(Boolean);
const LEAGUES = argLeagueIds.length
  ? ALL_LEAGUES.filter(l => argLeagueIds.includes(l.id))
  : ALL_LEAGUES;

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizePosition(pos) {
  const p = (pos || '').toLowerCase();
  if (p.includes('attack') || p.includes('forward') || p.includes('striker') || p === 'fw') return 'FW';
  if (p.includes('mid') || p === 'mf') return 'MF';
  if (p.includes('defend') || p.includes('back') || p === 'df') return 'DF';
  if (p.includes('goal') || p.includes('keeper') || p === 'gk') return 'GK';
  return (pos || '').toUpperCase().slice(0, 2);
}

function calcFpts(stats, position) {
  const goals         = stats?.goals?.total        || 0;
  const assists       = stats?.goals?.assists       || 0;
  const saves         = stats?.goals?.saves         || 0;
  const minutes       = stats?.games?.minutes       || 0;
  const shotsOn       = stats?.shots?.on            || 0;
  const keyPasses     = stats?.passes?.key          || 0;
  const passAccuracy  = stats?.passes?.accuracy     || 0;
  const tackles       = stats?.tackles?.total       || 0;
  const interceptions = stats?.tackles?.interceptions || 0;
  const dribbles      = stats?.dribbles?.attempts   || 0;
  const yellow        = stats?.cards?.yellow        || 0;
  const yellowred     = stats?.cards?.yellowred     || 0;
  const red           = stats?.cards?.red           || 0;

  let p = 0;

  // Positionsabhängige Tor-Punkte
  if      (position === 'GK') p += goals * 6;
  else if (position === 'DF') p += goals * 6;
  else if (position === 'MF') p += goals * 5;
  else                         p += goals * 4; // FW

  p += assists * 3;
  if (position === 'GK') p += saves * 1.5;

  p += shotsOn       * 0.5;
  p += keyPasses     * 0.8;
  p += (passAccuracy / 100) * 0.5;
  p += dribbles      * 0.2;
  p += tackles       * 0.6;
  p += interceptions * 0.6;
  p -= yellow        * 1;
  p -= (yellowred + red) * 3;

  if      (minutes >= 60) p += 1;
  else if (minutes  >  0) p += 0.4;

  return Math.round(p * 10) / 10;
}

let apiCalls = 0;

async function fetchJson(url, isRetry = false) {
  apiCalls++;
  if (apiCalls > CALL_LIMIT) {
    console.log(`\n⚠️  Call-Limit (${CALL_LIMIT}) erreicht – stoppe.`);
    console.log('   Morgen erneut ausführen um fortzufahren.\n');
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, isRetry ? RETRY_DELAY : DELAY_MS));
  const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
  const json = await res.json();
  const remaining = res.headers.get('x-ratelimit-requests-remaining');
  if (remaining !== null) process.stdout.write(` [${remaining} left]`);
  return json;
}

async function fetchWithRetry(url) {
  const data = await fetchJson(url);
  const results = data.response || [];
  // Wenn 0 Ergebnisse → einmal mit längerer Pause wiederholen
  if (results.length === 0 && data.errors && Object.keys(data.errors).length === 0) {
    process.stdout.write(' ⏳ throttled, retry...');
    const retry = await fetchJson(url, true);
    return retry;
  }
  return data;
}

async function upsertPlayer(item, teamName, teamId, leagueId) {
  const stats    = item.statistics?.[0];
  const position = normalizePosition(stats?.games?.position || item.player?.position || '');

  const goals         = stats?.goals?.total          || 0;
  const assists       = stats?.goals?.assists         || 0;
  const saves         = stats?.goals?.saves           || 0;
  const minutes       = stats?.games?.minutes         || 0;
  const appearances   = stats?.games?.appearances     || 0;
  const rating        = parseFloat(stats?.games?.rating) || 0;
  const shotsOn       = stats?.shots?.on              || 0;
  const keyPasses     = stats?.passes?.key            || 0;
  const passAccuracy  = parseFloat(stats?.passes?.accuracy) || 0;
  const tackles       = stats?.tackles?.total         || 0;
  const interceptions = stats?.tackles?.interceptions  || 0;
  const dribbles      = stats?.dribbles?.attempts     || 0;
  const yellow        = stats?.cards?.yellow          || 0;
  const yellowred     = stats?.cards?.yellowred       || 0;
  const red           = stats?.cards?.red             || 0;

  const fpts = calcFpts(stats, position);

  const { error } = await supabase.from('players').upsert({
    id:            item.player.id,
    name:          item.player.name,
    position,
    nationality:   item.player.nationality,
    photo_url:     item.player.photo,
    team_name:     teamName,
    api_league_id: leagueId,
    api_team_id:   teamId,
    goals,
    assists,
    saves,
    minutes,
    appearances,
    rating:        Math.round(rating * 100) / 100,
    shots_on:      shotsOn,
    key_passes:    keyPasses,
    pass_accuracy: Math.round(passAccuracy),
    tackles,
    interceptions,
    dribbles,
    yellow_cards:  yellow + yellowred,
    red_cards:     red + yellowred,
    fpts,
  }, { onConflict: 'id' });

  if (error) console.error(`   ❌ Upsert Fehler für ${item.player.name}:`, error.message);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n🌍 Global Dynasty – Player Cache`);
  console.log(`   Ligen: ${LEAGUES.map(l => l.name).join(', ')}`);
  console.log(`   Call-Limit: ${CALL_LIMIT}\n`);

  let totalPlayers = 0;
  let totalUpserted = 0;

  for (const { id: leagueId, name: leagueName, season } of LEAGUES) {
    console.log(`\n🏆 ${leagueName} (${season})`);

    process.stdout.write('   Teams laden...');
    const teamsData = await fetchWithRetry(
      `https://v3.football.api-sports.io/teams?league=${leagueId}&season=${season}`
    );
    const teams = teamsData.response || [];
    console.log(` → ${teams.length} Teams`);

    for (const teamObj of teams) {
      const teamId   = teamObj.team.id;
      const teamName = teamObj.team.name;

      let page = 1;
      let totalPages = 1;

      while (page <= totalPages) {
        process.stdout.write(`   ${teamName} (S.${page})...`);

        const data = await fetchWithRetry(
          `https://v3.football.api-sports.io/players?team=${teamId}&season=${season}&page=${page}`
        );

        totalPages = data.paging?.pages || 1;
        const players = data.response || [];

        for (const item of players) {
          await upsertPlayer(item, teamName, teamId, leagueId);
          totalUpserted++;
        }

        console.log(` ${players.length} Spieler | ${apiCalls}/${CALL_LIMIT} Calls`);
        totalPlayers += players.length;
        page++;
      }
    }

    console.log(`   ✅ ${leagueName} fertig`);
  }

  console.log(`\n✅ Komplett! ${totalUpserted} Spieler upserted in ${apiCalls} API-Calls`);
}

run().catch(console.error);
