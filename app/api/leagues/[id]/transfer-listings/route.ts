import { NextRequest, NextResponse } from "next/server";
import { createClient }             from "@supabase/supabase-js";
import { createServiceRoleClient }  from "@/lib/supabase-server";

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getUserFromRequest(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token      = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  const supabaseAuth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// ── GET /api/leagues/[id]/transfer-listings ───────────────────────────────────
// Returns all active listings for the league, including player + team name data.

export async function GET(
  req:      NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;

  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const db = createServiceRoleClient();

  // Verify caller is a league member
  const { data: callerTeam } = await db
    .from("teams")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!callerTeam) {
    return NextResponse.json({ ok: false, error: "not_a_member" }, { status: 403 });
  }

  // Fetch active listings + owning team name
  const { data: listings, error: listErr } = await db
    .from("transfer_listings")
    .select("id, team_id, player_id, note, created_at, teams(name)")
    .eq("league_id", leagueId)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (listErr) {
    return NextResponse.json({ ok: false, error: listErr.message }, { status: 500 });
  }

  if (!listings || listings.length === 0) {
    return NextResponse.json({ ok: true, listings: [] });
  }

  // Fetch player details for all listed player IDs
  const playerIds = [...new Set((listings as any[]).map((l) => l.player_id as number))];
  const { data: players } = await db
    .from("players")
    .select("id, name, photo_url, position, team_name, fpts, goals, assists")
    .in("id", playerIds);

  const playerMap = new Map<number, any>((players ?? []).map((p: any) => [p.id, p]));

  const result = (listings as any[]).map((l) => ({
    id:              l.id as string,
    team_id:         l.team_id as string,
    player_id:       l.player_id as number,
    note:            l.note as string | null,
    created_at:      l.created_at as string,
    owner_team_name: (l.teams as any)?.name ?? null,
    player:          playerMap.get(l.player_id) ?? null,
  }));

  return NextResponse.json({ ok: true, listings: result });
}

// ── POST /api/leagues/[id]/transfer-listings ──────────────────────────────────
// Creates or reactivates a listing for a player the caller owns.
// Body: { playerId: number, note?: string }

export async function POST(
  req:      NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;

  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { playerId, note } = body as { playerId?: number; note?: string };
  if (!playerId) {
    return NextResponse.json({ ok: false, error: "playerId required" }, { status: 400 });
  }

  const db = createServiceRoleClient();

  // Get caller's team in this league
  const { data: callerTeam } = await db
    .from("teams")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!callerTeam) {
    return NextResponse.json({ ok: false, error: "not_a_member" }, { status: 403 });
  }

  // Verify player is in the caller's squad (squad_players or draft_picks fallback)
  const [{ data: squadRow }, { data: pickRow }] = await Promise.all([
    db.from("squad_players").select("player_id").eq("team_id", callerTeam.id).eq("player_id", playerId).maybeSingle(),
    db.from("draft_picks").select("player_id").eq("team_id", callerTeam.id).eq("player_id", playerId).maybeSingle(),
  ]);

  if (!squadRow && !pickRow) {
    return NextResponse.json({ ok: false, error: "player_not_in_squad" }, { status: 422 });
  }

  // Upsert: insert new or reactivate if previously withdrawn
  const { data: listing, error: upsertErr } = await db
    .from("transfer_listings")
    .upsert(
      {
        league_id:  leagueId,
        team_id:    callerTeam.id,
        player_id:  playerId,
        note:       note ?? null,
        status:     "active",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "league_id,team_id,player_id" },
    )
    .select("id, player_id, status")
    .single();

  if (upsertErr) {
    return NextResponse.json({ ok: false, error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, listing }, { status: 201 });
}

// ── PATCH /api/leagues/[id]/transfer-listings ─────────────────────────────────
// Withdraws a listing. Body: { listingId?: string } or { playerId?: number }

export async function PATCH(
  req:      NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;

  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { listingId, playerId } = body as { listingId?: string; playerId?: number };
  if (!listingId && !playerId) {
    return NextResponse.json({ ok: false, error: "listingId or playerId required" }, { status: 400 });
  }

  const db = createServiceRoleClient();

  // Get caller's team
  const { data: callerTeam } = await db
    .from("teams")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!callerTeam) {
    return NextResponse.json({ ok: false, error: "not_a_member" }, { status: 403 });
  }

  let query = db
    .from("transfer_listings")
    .update({ status: "withdrawn", updated_at: new Date().toISOString() })
    .eq("league_id", leagueId)
    .eq("team_id", callerTeam.id);  // ownership guard

  if (listingId) query = query.eq("id", listingId);
  else           query = query.eq("player_id", playerId!);

  const { error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
