/**
 * TIFO — WM 2026 Players Loader
 *
 * Lädt alle Spieler der 48 WM-Nationen von api-football
 * und speichert sie in der players-Tabelle (gleiche Struktur wie Liga-Spieler).
 *
 * Voraussetzung: wm_nations muss bereits befüllt sein (load-wm-nations.mjs)
 *
 * Limit: 100 API-Calls/Tag → Script stoppt bei 90 (Sicherheitspuffer).
 * Einfach erneut ausführen — upsert ist idempotent.
 *
 * Usage:
 *   node scripts/load-wm-players.mjs           → alle 48 Nationen
 *   node scripts/load-wm-players.mjs GER FRA   → nur Deutschland + Frankreich
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

const WM_LEAGUE_ID = 1;    // FIFA World Cup bei api-football
const WM_SEASON    = 2026;
const CALL_LIMIT   = 90;
const DELAY_MS     = 3500;

let apiCalls = 0;

// CLI: optional Nation-Codes als Filter
const argCodes = process.argv.slice(2).map(s => s.toUpperCase());

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizePosition(pos) {
  const p = (pos || '').toLowerCase();
  if (p.includes('attack') || p.includes('forward') || p.includes('striker') || p === 'fw') return 'FW';
  if (p.includes('mid') || p === 'mf') return 'MF';
  if (p.includes('defend') || p.includes('back') || p === 'df') return 'DF';
  if (p.includes('goal') || p.includes('keeper') || p === 'gk') return 'GK';
  return (pos || '').toUpperCase().slice(0, 2) || 'MF';
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
  if      (position === 'GK') p += goals * 6;
  else if (position === 'DF') p += goals * 6;
  else if (position === 'MF') p += goals * 5;
  else                         p += goals * 4;

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

async function fetchJson(url, isRetry = false) {
  apiCalls++;
  if (apiCalls > CALL_LIMIT) {
    console.log(`\n⚠️  Call-Limit (${CALL_LIMIT}) erreicht – stoppe.`);
    console.log('   Morgen erneut ausführen um fortzufahren.\n');
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, isRetry ? 12000 : DELAY_MS));
  const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
  const json = await res.json();
  const remaining = res.headers.get('x-ratelimit-requests-remaining');
  if (remaining !== null) process.stdout.write(` [${remaining} left]`);
  return json;
}

async function fetchWithRetry(url) {
  const data = await fetchJson(url);
  if ((data.response || []).length === 0 && data.errors && Object.keys(data.errors).length === 0) {
    process.stdout.write(' ⏳ throttled, retry...');
    return await fetchJson(url, true);
  }
  return data;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n🌍 TIFO — WM 2026 Players Loader');
  console.log(`   API-Calls Limit: ${CALL_LIMIT}`);

  // 1. Nationen aus DB laden
  const { data: tournament } = await supabase
    .from('wm_tournaments')
    .select('id')
    .eq('season', 2026)
    .single();

  if (!tournament) {
    console.error('❌ Kein WM 2026 Turnier gefunden. Erst load-wm-nations.mjs ausführen!');
    process.exit(1);
  }

  const { data: nations } = await supabase
    .from('wm_nations')
    .select('id, name, code, api_team_id, group_letter')
    .eq('tournament_id', tournament.id)
    .order('group_letter');

  if (!nations || nations.length === 0) {
    console.error('❌ Keine Nationen in DB. Erst load-wm-nations.mjs ausführen!');
    process.exit(1);
  }

  // Filter nach CLI-Argumenten
  const filteredNations = argCodes.length > 0
    ? nations.filter(n => argCodes.includes(n.code))
    : nations;

  console.log(`\n   ${filteredNations.length} Nationen werden geladen:`);
  filteredNations.forEach(n => console.log(`   · ${n.name} (${n.code}) ${n.api_team_id ? `[api_id: ${n.api_team_id}]` : '[kein api_id]'}`));

  let totalPlayers = 0;

  for (const nation of filteredNations) {
    console.log(`\n🏳️  ${nation.name} (Gruppe ${nation.group_letter || '?'})`);

    // api_team_id aus DB oder von api-football suchen
    let teamId = nation.api_team_id;

    if (!teamId) {
      process.stdout.write('   Suche Team-ID...');
      const searchData = await fetchWithRetry(
        `https://v3.football.api-sports.io/teams?name=${encodeURIComponent(nation.name)}&league=${WM_LEAGUE_ID}&season=${WM_SEASON}`
      );
      const found = searchData.response?.[0]?.team;
      if (found) {
        teamId = found.id;
        // api_team_id in DB speichern für nächste Ausführung
        await supabase.from('wm_nations')
          .update({ api_team_id: teamId, flag_url: found.logo })
          .eq('id', nation.id);
        console.log(` → ID ${teamId}`);
      } else {
        console.log(' → nicht gefunden, überspringe');
        continue;
      }
    }

    // Spieler laden (mit Pagination)
    let page = 1;
    let totalPages = 1;
    let nationPlayers = 0;

    while (page <= totalPages) {
      process.stdout.write(`   Spieler (S.${page})...`);

      const data = await fetchWithRetry(
        `https://v3.football.api-sports.io/players?team=${teamId}&season=${WM_SEASON}&page=${page}`
      );

      // Fallback: Vorherige Saison wenn 2026 noch keine Daten
      let players = data.response || [];
      if (players.length === 0 && page === 1) {
        process.stdout.write(' (2026 leer, versuche 2025)...');
        const fallback = await fetchWithRetry(
          `https://v3.football.api-sports.io/players?team=${teamId}&season=2025&page=${page}`
        );
        players = fallback.response || [];
        totalPages = fallback.paging?.pages || 1;
      } else {
        totalPages = data.paging?.pages || 1;
      }

      for (const item of players) {
        const stats    = item.statistics?.[0];
        const position = normalizePosition(stats?.games?.position || item.player?.position || '');
        const fpts     = calcFpts(stats, position);

        const { error } = await supabase.from('players').upsert({
          id:            item.player.id,
          name:          item.player.name,
          position,
          nationality:   item.player.nationality,
          photo_url:     item.player.photo,
          // team_name = Nation name (damit WM-Filter funktioniert)
          team_name:     nation.name,
          api_team_id:   teamId,
          goals:         stats?.goals?.total        || 0,
          assists:       stats?.goals?.assists       || 0,
          saves:         stats?.goals?.saves         || 0,
          minutes:       stats?.games?.minutes       || 0,
          appearances:   stats?.games?.appearances   || 0,
          rating:        Math.round((parseFloat(stats?.games?.rating) || 0) * 100) / 100,
          shots_on:      stats?.shots?.on            || 0,
          key_passes:    stats?.passes?.key          || 0,
          pass_accuracy: Math.round(parseFloat(stats?.passes?.accuracy) || 0),
          tackles:       stats?.tackles?.total       || 0,
          interceptions: stats?.tackles?.interceptions || 0,
          dribbles:      stats?.dribbles?.attempts   || 0,
          yellow_cards:  (stats?.cards?.yellow || 0) + (stats?.cards?.yellowred || 0),
          red_cards:     (stats?.cards?.red    || 0) + (stats?.cards?.yellowred || 0),
          fpts,
        }, { onConflict: 'id' });

        if (error) console.error(`\n   ❌ ${item.player.name}: ${error.message}`);
        else nationPlayers++;
      }

      console.log(` ${players.length} Spieler | ${apiCalls}/${CALL_LIMIT} Calls`);
      page++;
    }

    totalPlayers += nationPlayers;
    console.log(`   ✅ ${nation.name}: ${nationPlayers} Spieler`);
  }

  console.log(`\n✅ Fertig! ${totalPlayers} Spieler aus ${filteredNations.length} Nationen geladen.`);
  console.log('   Tipp: node scripts/load-wm-players.mjs GER → nur Deutschland nachladen');
}

run().catch(console.error);
