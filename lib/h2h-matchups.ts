import { createServiceRoleClient } from "@/lib/supabase-server";

export type H2HPairingResult = {
  created: number;
  skipped: boolean;
  reason?: string;
};

/**
 * Generates H2H pairings for a given GW.
 * - Skips silently if league is not H2H or pairings already exist
 * - Uses round-robin rotation so opponents vary across GWs
 * - Handles odd number of teams (last team gets a bye)
 */
export async function generateH2HPairings(
  leagueId: string,
  gameweek: number,
): Promise<H2HPairingResult> {
  const supabase = createServiceRoleClient();

  // Check if this is an H2H league
  const { data: league } = await supabase
    .from("leagues")
    .select("scoring_type")
    .eq("id", leagueId)
    .single();

  if (league?.scoring_type !== "h2h") {
    return { created: 0, skipped: true, reason: "not_h2h" };
  }

  // Skip if pairings already exist for this GW
  const { data: existing } = await supabase
    .from("liga_matchups")
    .select("id")
    .eq("league_id", leagueId)
    .eq("gameweek", gameweek)
    .limit(1);

  if (existing && existing.length > 0) {
    return { created: 0, skipped: true, reason: "already_exists" };
  }

  // Load all teams (ordered by created_at for determinism)
  const { data: teams } = await supabase
    .from("teams")
    .select("id")
    .eq("league_id", leagueId)
    .order("created_at");

  const teamIds = (teams || []).map((t: any) => t.id as string);
  if (teamIds.length < 2) {
    return { created: 0, skipped: true, reason: "not_enough_teams" };
  }

  // Round-robin rotation: fix team[0], rotate the rest
  // GW 1 → rotation 0, GW 2 → rotation 1, ...
  const fixed = teamIds[0];
  const rotating = teamIds.slice(1);
  const round = (gameweek - 1) % rotating.length;
  const rotated = [...rotating.slice(round), ...rotating.slice(0, round)];
  const ordered = [fixed, ...rotated];

  // Pair positions: 0 vs (N-1), 1 vs (N-2), ...
  const rows: object[] = [];
  const half = Math.floor(ordered.length / 2);
  for (let i = 0; i < half; i++) {
    rows.push({
      league_id:     leagueId,
      gameweek,
      home_team_id:  ordered[i],
      away_team_id:  ordered[ordered.length - 1 - i],
      home_points:   0,
      away_points:   0,
      winner_id:     null,
    });
  }

  const { error } = await supabase.from("liga_matchups").insert(rows);
  if (error) throw error;

  return { created: rows.length, skipped: false };
}
