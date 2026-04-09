import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ items: [] });

  try {
    const query = encodeURIComponent(`${name} Fußball`);
    const url = `https://news.google.com/rss/search?q=${query}&hl=de&gl=DE&ceid=DE:de`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return NextResponse.json({ items: [] });
    const xml = await res.text();

    const items: { title: string; link: string; pubDate: string; source: string }[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 6) {
      const chunk = match[1];
      const title = (
        chunk.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ||
        chunk.match(/<title>(.*?)<\/title>/)?.[1] || ""
      ).replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
      const link    = chunk.match(/<link>(.*?)<\/link>/)?.[1]?.trim() || "";
      const pubDate = chunk.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() || "";
      const source  = (
        chunk.match(/<source[^>]*>(.*?)<\/source>/)?.[1] ||
        chunk.match(/<source.*?url="([^"]+)"/)?.[1] || ""
      ).trim();
      if (title) items.push({ title, link, pubDate, source });
    }

    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
