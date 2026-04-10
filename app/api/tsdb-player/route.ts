import { NextRequest, NextResponse } from "next/server";
import { getCached, upsertCached, fetchTsdbPlayer, isStale, toClientPayload } from "@/lib/tsdb-cache";

// Fire-and-forget revalidation helper (doesn't block the response)
async function revalidateInBackground(name: string, team: string): Promise<void> {
  try {
    const fresh = await fetchTsdbPlayer(name, team);
    await upsertCached(fresh);
  } catch {
    /* swallow — best effort */
  }
}

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name") || "";
  const team = req.nextUrl.searchParams.get("team") || "";
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  // 1. Look up cache
  const cached = await getCached(name, team);

  // 2a. Cached and fresh → serve from cache
  if (cached && !isStale(cached)) {
    return NextResponse.json(toClientPayload(cached));
  }

  // 2b. Cached but stale → serve cache, revalidate in background
  if (cached && isStale(cached)) {
    revalidateInBackground(name, team);
    return NextResponse.json(toClientPayload(cached));
  }

  // 3. Miss → fetch synchronously, cache, return
  const fresh = await fetchTsdbPlayer(name, team);
  await upsertCached(fresh);
  return NextResponse.json(toClientPayload(fresh));
}
