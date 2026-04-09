import { NextRequest, NextResponse } from "next/server";

const TSDB_BASE = "https://www.thesportsdb.com/api/v1/json/3";

// In-memory cache: "PlayerName|TeamName" → { cutout, render, fanart1, thumb }
const cache = new Map<string, any>();

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name") || "";
  const team = req.nextUrl.searchParams.get("team") || "";

  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const cacheKey = `${name}|${team}`;
  if (cache.has(cacheKey)) {
    return NextResponse.json(cache.get(cacheKey));
  }

  try {
    const encoded = encodeURIComponent(name);
    const res = await fetch(`${TSDB_BASE}/searchplayers.php?p=${encoded}`, {
      next: { revalidate: 86400 }, // 24h cache at CDN level
    });
    const data = await res.json();
    const players: any[] = data.player || [];

    // Pick the best match: same team preferred.
    // If team is provided but no match found, return null to avoid wrong player images.
    // Only fall back to players[0] when no team hint was given.
    let match: any = players.find((p: any) =>
      p.strTeam?.toLowerCase().includes(team.toLowerCase()) ||
      team.toLowerCase().includes(p.strTeam?.toLowerCase() || "")
    );
    if (!match && !team) match = players[0] || null;

    const result = match
      ? {
          tsdb_id:  match.idPlayer,
          cutout:   match.strCutout  || null,
          render:   match.strRender  || null,
          thumb:    match.strThumb   || null,
          fanart1:  match.strFanart1 || null,
          fanart2:  match.strFanart2 || null,
          nationality: match.strNationality || null,
          height:   match.strHeight  || null,
          weight:   match.strWeight  || null,
          born:     match.dateBorn   || null,
          desc:     match.strDescriptionEN?.slice(0, 300) || null,
        }
      : null;

    cache.set(cacheKey, result);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(null);
  }
}
