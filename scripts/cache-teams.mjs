import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local', 'utf8');
const getEnv = (key) => env.match(new RegExp(`${key}=(.+)`))?.[1]?.trim();

const supabase = createClient(
  getEnv('NEXT_PUBLIC_SUPABASE_URL'),
  getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
);

const API_KEY = getEnv('NEXT_PUBLIC_FOOTBALL_API_KEY');

const LEAGUES = [
  // { id: 140, season: 2024 },  // La Liga – bereits gecacht
  { id: 135, season: 2024 },  // Serie A – nochmal (Bologna–Monza fehlten)
  { id: 61, season: 2024 },   // Ligue 1
];

function normalizePosition(pos) {
  const p = (pos || '').toLowerCase();
  if (p.includes('attack') || p.includes('forward') || p.includes('striker')) return 'FW';
  if (p.includes('mid')) return 'MF';
  if (p.includes('defend') || p.includes('back')) return 'DF';
  if (p.includes('goal') || p.includes('keeper')) return 'GK';
  return (pos || '').toUpperCase().slice(0, 2);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
  return res.json();
}

async function run() {
  let totalPlayers = 0;
  let apiCalls = 0;

  for (const { id: leagueId, season } of LEAGUES) {
    console.log(`\n🏆 Liga ${leagueId} (Season ${season})...`);
    const teamsData = await fetchJson(
      `https://v3.football.api-sports.io/teams?league=${leagueId}&season=${season}`
    );
    apiCalls++;
    const teams = teamsData.response || [];
    console.log(`   ${teams.length} Teams gefunden`);
    if (teams.length === 0) console.log(`   ⚠️  API Response:`, JSON.stringify(teamsData).slice(0, 300));

    for (const teamObj of teams) {
      const teamId = teamObj.team.id;
      const teamName = teamObj.team.name;
      console.log(`   → ${teamName}`);

      const playersData = await fetchJson(
        `https://v3.football.api-sports.io/players?team=${teamId}&season=${season}&page=1`
      );
      apiCalls++;

      const players = playersData.response || [];

      for (const item of players) {
        const stats = item.statistics?.[0];
        const goals = stats?.goals?.total || 0;
        const assists = stats?.goals?.assists || 0;
        const minutes = stats?.games?.minutes || 0;
        const shotsOn = stats?.shots?.on || 0;
        const keyPasses = stats?.passes?.key || 0;
        const position = normalizePosition(stats?.games?.position || '');
        let fpts = goals * 4 + assists * 3 + shotsOn * 0.5 + keyPasses * 0.8;
        if (minutes >= 60) fpts += 1; else if (minutes > 0) fpts += 0.4;

        await supabase.from('players').upsert({
          id: item.player.id,
          name: item.player.name,
          position,
          nationality: item.player.nationality,
          photo_url: item.player.photo,
          team_name: teamName,
          api_league_id: leagueId,
          api_team_id: teamId,
          goals, assists, minutes,
          shots_on: shotsOn,
          key_passes: keyPasses,
          fpts: Math.round(fpts * 10) / 10,
        }, { onConflict: 'id' });

        totalPlayers++;
      }

      console.log(`   ✅ ${totalPlayers} Spieler | ${apiCalls} Calls`);
      await sleep(7000); // 10 req/min limit → 7s Pause

      if (apiCalls >= 50) {
        console.log('\n⚠️  Limit erreicht – stoppe!');
        console.log(`✅ ${totalPlayers} Spieler gecacht`);
        process.exit(0);
      }
    }
  }

  console.log(`\n✅ Fertig! ${totalPlayers} Spieler in ${apiCalls} Calls`);
}

run().catch(console.error);
