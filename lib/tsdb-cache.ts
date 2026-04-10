import { createServiceRoleClient } from "@/lib/supabase-server";

const supabaseServer = createServiceRoleClient();

const TSDB_BASE             = "https://www.thesportsdb.com/api/v1/json/3";
const FRESH_DAYS            = 30;
const NOT_FOUND_RETRY_DAYS  = 7;

export interface TsdbCacheRow {
  player_name:  string;
  team_name:    string;
  tsdb_id:      string | null;
  cutout:       string | null;
  render:       string | null;
  thumb:        string | null;
  fanart1:      string | null;
  fanart2:      string | null;
  nationality:  string | null;
  height:       string | null;
  weight:       string | null;
  born:         string | null;
  description:  string | null;
  not_found:    boolean;
  fetched_at:   string;
}

// ───────────────────────────────────────────────────────────
// Staleness check
// ───────────────────────────────────────────────────────────

function ageInDays(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

export function isStale(row: Pick<TsdbCacheRow, "fetched_at" | "not_found">): boolean {
  const age = ageInDays(row.fetched_at);
  if (row.not_found) return age > NOT_FOUND_RETRY_DAYS;
  return age > FRESH_DAYS;
}

// ───────────────────────────────────────────────────────────
// DB reads / writes
// ───────────────────────────────────────────────────────────

export async function getCached(playerName: string, teamName: string): Promise<TsdbCacheRow | null> {
  const { data } = await supabaseServer
    .from("tsdb_player_cache")
    .select("*")
    .eq("player_name", playerName)
    .eq("team_name", teamName)
    .maybeSingle();
  return (data as TsdbCacheRow | null) ?? null;
}

export async function upsertCached(
  row: Partial<TsdbCacheRow> & { player_name: string; team_name: string; player_id_fk?: number }
): Promise<void> {
  await supabaseServer
    .from("tsdb_player_cache")
    .upsert(
      { ...row, fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "player_name,team_name" }
    );
}

// ───────────────────────────────────────────────────────────
// Remote fetch (TSDB)
// ───────────────────────────────────────────────────────────

interface TsdbRawPlayer {
  idPlayer?: string;
  strTeam?: string;
  strCutout?: string;
  strRender?: string;
  strThumb?: string;
  strFanart1?: string;
  strFanart2?: string;
  strNationality?: string;
  strHeight?: string;
  strWeight?: string;
  dateBorn?: string;
  strDescriptionEN?: string;
}

export async function fetchTsdbPlayer(playerName: string, teamName: string): Promise<TsdbCacheRow> {
  const emptyHit: TsdbCacheRow = {
    player_name: playerName,
    team_name:   teamName,
    tsdb_id: null, cutout: null, render: null, thumb: null, fanart1: null, fanart2: null,
    nationality: null, height: null, weight: null, born: null, description: null,
    not_found: true,
    fetched_at: new Date().toISOString(),
  };

  try {
    const encoded = encodeURIComponent(playerName);
    const res = await fetch(`${TSDB_BASE}/searchplayers.php?p=${encoded}`);
    if (!res.ok) return emptyHit;
    const data = await res.json();
    const players: TsdbRawPlayer[] = data?.player || [];

    let match: TsdbRawPlayer | undefined = players.find(p => {
      const t = (p.strTeam || "").toLowerCase();
      const want = (teamName || "").toLowerCase();
      if (!want) return false;
      return t.includes(want) || want.includes(t);
    });
    if (!match && !teamName) match = players[0];

    if (!match) return emptyHit;

    return {
      player_name: playerName,
      team_name:   teamName,
      tsdb_id:     match.idPlayer || null,
      cutout:      match.strCutout || null,
      render:      match.strRender || null,
      thumb:       match.strThumb || null,
      fanart1:     match.strFanart1 || null,
      fanart2:     match.strFanart2 || null,
      nationality: match.strNationality || null,
      height:      match.strHeight || null,
      weight:      match.strWeight || null,
      born:        match.dateBorn || null,
      description: (match.strDescriptionEN || "").slice(0, 500) || null,
      not_found:   false,
      fetched_at:  new Date().toISOString(),
    };
  } catch {
    return emptyHit;
  }
}

// ───────────────────────────────────────────────────────────
// Public API payload shape (matches existing route)
// ───────────────────────────────────────────────────────────

export function toClientPayload(row: TsdbCacheRow | null): Record<string, unknown> | null {
  if (!row || row.not_found) return null;
  return {
    tsdb_id:     row.tsdb_id,
    cutout:      row.cutout,
    render:      row.render,
    thumb:       row.thumb,
    fanart1:     row.fanart1,
    fanart2:     row.fanart2,
    nationality: row.nationality,
    height:      row.height,
    weight:      row.weight,
    born:        row.born,
    desc:        row.description,
  };
}
