/**
 * Navigation utilities — shared by BottomNav and tests.
 *
 * Extracted so the routing logic is pure and independently testable
 * without mounting a React component.
 */

/** Parses league id and mode from either /wm/[id]/... or /leagues/[id]/... paths. */
export function extractLeagueInfo(pathname: string): { id: string; isWm: boolean } | null {
  const wmMatch = pathname.match(/\/wm\/([^/]+)/);
  if (wmMatch) return { id: wmMatch[1], isWm: true };
  const lgMatch = pathname.match(/\/leagues\/([^/]+)/);
  if (lgMatch) return { id: lgMatch[1], isWm: false };
  return null;
}

/**
 * Derives BottomNav hrefs from the current pathname and any persisted
 * league info (used as fallback when pathname is not a league route).
 *
 * URL-derived info always wins over stored info so that the nav is
 * immediately correct on the first render — no useEffect required.
 */
export function computeNavHrefs(
  pathname: string,
  storedId: string | null,
  storedIsWm: boolean,
): {
  myTeamHref: string;
  matchdayHref: string;
  leaguesHref: string;
} {
  const urlInfo  = extractLeagueInfo(pathname);
  const leagueId = urlInfo?.id   ?? storedId;
  const isWm     = urlInfo?.isWm ?? storedIsWm;

  return {
    myTeamHref:   !leagueId ? "/my-team" : isWm ? `/wm/${leagueId}/lineup`   : `/leagues/${leagueId}/lineup`,
    matchdayHref: !leagueId ? "/scores"  : isWm ? `/wm/${leagueId}/matchday` : `/leagues/${leagueId}/matchday`,
    leaguesHref:  !leagueId ? "/leagues" : isWm ? `/wm/${leagueId}`          : `/leagues/${leagueId}`,
  };
}
