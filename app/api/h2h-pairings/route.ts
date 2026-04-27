import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { generateH2HPairings } from "@/lib/h2h-matchups";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Auth: require bearer token (Supabase session)
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supabaseAuth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { leagueId, gameweek } = body as { leagueId?: string; gameweek?: number };
  if (!leagueId || !gameweek) {
    return NextResponse.json({ ok: false, error: "leagueId and gameweek required" }, { status: 400 });
  }

  // Verify user is the league owner
  const supabase = createServiceRoleClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("owner_id")
    .eq("id", leagueId)
    .single();

  if (league?.owner_id !== user.id) {
    return NextResponse.json({ ok: false, error: "not_owner" }, { status: 403 });
  }

  try {
    const result = await generateH2HPairings(leagueId, gameweek);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    console.error("[h2h-pairings]", e?.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
