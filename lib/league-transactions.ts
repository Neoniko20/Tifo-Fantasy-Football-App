import { supabase } from "@/lib/supabase";

// ───────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────

export type TransactionKind = "transfer" | "trade" | "waiver";

export interface PlayerStub {
  id: number;
  name: string;
  position: string;
  team_name?: string | null;
}

export interface TeamStub {
  id: string;
  name: string;
  user_id: string | null;
}

export interface BaseTransaction {
  id: string;
  kind: TransactionKind;
  created_at: string;   // ISO
  gameweek?: number | null;
  league_id: string;
}

export interface TransferTransaction extends BaseTransaction {
  kind: "transfer";
  team: TeamStub;
  playerIn?: PlayerStub | null;
  playerOut?: PlayerStub | null;
}

export interface TradeTransaction extends BaseTransaction {
  kind: "trade";
  proposer: TeamStub;
  receiver: TeamStub;
  offerPlayers: PlayerStub[];    // proposer gives
  requestPlayers: PlayerStub[];  // proposer receives
  status: "pending" | "accepted" | "rejected" | "cancelled";
}

export interface WaiverTransaction extends BaseTransaction {
  kind: "waiver";
  team: TeamStub;
  playerIn?: PlayerStub | null;
  playerOut?: PlayerStub | null;
  bidAmount?: number | null;
  status: "pending" | "approved" | "rejected";
}

export type LeagueTransaction = TransferTransaction | TradeTransaction | WaiverTransaction;

// ───────────────────────────────────────────────────────────
// Loader
// ───────────────────────────────────────────────────────────

/**
 * Fetch all three transaction kinds for one league, resolve player + team
 * names in bulk, merge into a single array sorted by created_at DESC.
 *
 * Limit defaults to 50 per kind → max 150 rows total before sort/trim.
 */
export async function loadLeagueTransactions(
  leagueId: string,
  opts?: { limit?: number; onlyTeamId?: string }
): Promise<LeagueTransaction[]> {
  const perKindLimit = opts?.limit ?? 50;

  // 1. Teams (needed for name lookups in all three)
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, user_id")
    .eq("league_id", leagueId);
  const teamMap = new Map<string, TeamStub>(
    (teams || []).map((t: any) => [t.id, { id: t.id, name: t.name, user_id: t.user_id }])
  );

  // 2. Transfers
  let txQuery = supabase
    .from("liga_transfers")
    .select("id, team_id, player_in_id, player_out_id, created_at, gameweek")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false })
    .limit(perKindLimit);
  if (opts?.onlyTeamId) txQuery = txQuery.eq("team_id", opts.onlyTeamId);
  const { data: txRows } = await txQuery;

  // 3. Trades
  let trQuery = supabase
    .from("liga_trades")
    .select("id, proposer_team_id, receiver_team_id, offer_player_ids, request_player_ids, status, gameweek, created_at")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false })
    .limit(perKindLimit);
  if (opts?.onlyTeamId) {
    trQuery = trQuery.or(`proposer_team_id.eq.${opts.onlyTeamId},receiver_team_id.eq.${opts.onlyTeamId}`);
  }
  const { data: trRows } = await trQuery;

  // 4. Waivers
  let wvQuery = supabase
    .from("waiver_claims")
    .select("id, team_id, player_in, player_out, status, bid_amount, gameweek, processed_at, created_at")
    .eq("league_id", leagueId)
    .in("status", ["approved", "pending"])
    .order("created_at", { ascending: false })
    .limit(perKindLimit);
  if (opts?.onlyTeamId) wvQuery = wvQuery.eq("team_id", opts.onlyTeamId);
  const { data: wvRows } = await wvQuery;

  // 5. Collect all player ids and fetch in one go
  const playerIds = new Set<number>();
  (txRows || []).forEach((r: any) => {
    if (r.player_in_id)  playerIds.add(r.player_in_id);
    if (r.player_out_id) playerIds.add(r.player_out_id);
  });
  (trRows || []).forEach((r: any) => {
    (r.offer_player_ids   || []).forEach((id: number) => playerIds.add(id));
    (r.request_player_ids || []).forEach((id: number) => playerIds.add(id));
  });
  (wvRows || []).forEach((r: any) => {
    if (r.player_in)  playerIds.add(r.player_in);
    if (r.player_out) playerIds.add(r.player_out);
  });

  const { data: players } = playerIds.size > 0
    ? await supabase.from("players").select("id, name, position, team_name").in("id", Array.from(playerIds))
    : { data: [] };
  const playerMap = new Map<number, PlayerStub>(
    (players || []).map((p: any) => [p.id, { id: p.id, name: p.name, position: p.position, team_name: p.team_name }])
  );

  // 6. Normalize
  const all: LeagueTransaction[] = [];

  for (const r of (txRows || [])) {
    const team = teamMap.get(r.team_id);
    if (!team) continue;
    all.push({
      kind: "transfer",
      id: `tx_${r.id}`,
      league_id: leagueId,
      created_at: r.created_at,
      gameweek: r.gameweek ?? null,
      team,
      playerIn:  r.player_in_id  ? playerMap.get(r.player_in_id)  ?? null : null,
      playerOut: r.player_out_id ? playerMap.get(r.player_out_id) ?? null : null,
    });
  }

  for (const r of (trRows || [])) {
    const proposer = teamMap.get(r.proposer_team_id);
    const receiver = teamMap.get(r.receiver_team_id);
    if (!proposer || !receiver) continue;
    all.push({
      kind: "trade",
      id: `tr_${r.id}`,
      league_id: leagueId,
      created_at: r.created_at,
      gameweek: r.gameweek ?? null,
      proposer,
      receiver,
      offerPlayers:   (r.offer_player_ids   || []).map((id: number) => playerMap.get(id)).filter(Boolean) as PlayerStub[],
      requestPlayers: (r.request_player_ids || []).map((id: number) => playerMap.get(id)).filter(Boolean) as PlayerStub[],
      status: r.status,
    });
  }

  for (const r of (wvRows || [])) {
    const team = teamMap.get(r.team_id);
    if (!team) continue;
    all.push({
      kind: "waiver",
      id: `wv_${r.id}`,
      league_id: leagueId,
      created_at: r.processed_at || r.created_at,
      gameweek: r.gameweek ?? null,
      team,
      playerIn:  r.player_in  ? playerMap.get(r.player_in)  ?? null : null,
      playerOut: r.player_out ? playerMap.get(r.player_out) ?? null : null,
      bidAmount: r.bid_amount ?? null,
      status: r.status,
    });
  }

  // 7. Sort by created_at DESC
  all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return all.slice(0, perKindLimit * 3);
}

// ───────────────────────────────────────────────────────────
// Label helpers (UI)
// ───────────────────────────────────────────────────────────

export function kindLabel(kind: TransactionKind): string {
  if (kind === "transfer") return "Transfer";
  if (kind === "trade")    return "Trade";
  return "Waiver";
}

export function kindColor(kind: TransactionKind): string {
  if (kind === "transfer") return "#f5a623"; // Tifo yellow
  if (kind === "trade")    return "#4a9eff"; // blue
  return "#00ce7d";                          // green
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
