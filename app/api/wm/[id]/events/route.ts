import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { processIngestEvent } from "@/lib/wm-ingest";
import type { WMIngestEvent } from "@/lib/wm-types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: { user } } = await anonClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });

  // ── Ownership ─────────────────────────────────────────────────────────────
  const supabase = createServiceRoleClient();
  const { data: league, error: leagueError } = await supabase
    .from("leagues").select("owner_id").eq("id", leagueId).single();
  if (leagueError || !league)
    return NextResponse.json({ error: "Liga nicht gefunden" }, { status: 404 });
  if (league.owner_id !== user.id)
    return NextResponse.json({ error: "Kein Zugriff — nur Liga-Owner" }, { status: 403 });

  // ── Parse body ────────────────────────────────────────────────────────────
  let event: WMIngestEvent;
  try {
    event = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger Request-Body (kein JSON)" }, { status: 400 });
  }

  if (!event?.type || !event?.tournament_id) {
    return NextResponse.json(
      { error: "Pflichtfelder fehlen: type, tournament_id" },
      { status: 400 },
    );
  }

  // ── Process ───────────────────────────────────────────────────────────────
  const result = await processIngestEvent(leagueId, event, "ingest_api");

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json(result);
}
