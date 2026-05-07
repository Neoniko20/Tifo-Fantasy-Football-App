import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getUserFromRequest(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  const supabaseAuth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// ── POST /api/leagues/[id]/system-message ─────────────────────────────────────
// Inserts a system message into league_messages using the service role client
// (bypasses RLS). Caller must be authenticated and a member of the league.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;

  // 1. Verify caller auth
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Verify league membership (caller must have a team in this league)
  const anonSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: team } = await anonSupabase
    .from("teams")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!team) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 3. Parse and validate request body
  const body = await req.json().catch(() => null);
  if (!body || typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  const content = body.content.trim().slice(0, 500);
  const metadata =
    body.metadata && typeof body.metadata === "object" ? body.metadata : {};

  // 4. Insert system message via service role (bypasses RLS)
  const serviceSupabase = createServiceRoleClient();
  const { error: insertError } = await serviceSupabase
    .from("league_messages")
    .insert({
      league_id: leagueId,
      sender_id: null,
      team_id: null,
      content,
      kind: "system",
      metadata,
    });

  if (insertError) {
    console.error("[system-message] insert error:", insertError.message);
    return NextResponse.json({ error: "Failed to insert" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
