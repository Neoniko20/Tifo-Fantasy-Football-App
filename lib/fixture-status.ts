// API-Football fixture.status.short values we care about
export type ApiFixtureStatusShort =
  | "TBD" | "NS"                                          // not started
  | "1H" | "HT" | "2H" | "ET" | "BT" | "P" | "LIVE"     // playing
  | "FT" | "AET" | "PEN" | "AWD" | "WO"                  // finished
  | "CANC" | "ABD" | "SUSP" | "INT" | "PST";             // abnormal

export type LiveState = "upcoming" | "live" | "finished" | "abnormal";

export function liveStateOf(short: string | null | undefined): LiveState {
  if (!short) return "upcoming";
  if (["TBD", "NS"].includes(short))                                        return "upcoming";
  if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE"].includes(short))          return "live";
  if (["FT", "AET", "PEN", "AWD", "WO"].includes(short))                    return "finished";
  return "abnormal";
}

/** Human label for UI badges. */
export function liveStateLabel(short: string | null | undefined): string {
  const state = liveStateOf(short);
  if (state === "live")     return short === "HT" ? "HZ" : "LIVE";
  if (state === "finished") return "FT";
  if (state === "upcoming") return "–";
  return "Ø";
}

/** Tifo color for a state (Flutlicht palette). */
export function liveStateColor(state: LiveState): string {
  if (state === "live")     return "#ff6b00";   // hot orange — actively playing
  if (state === "finished") return "#00ce7d";   // Tifo green
  if (state === "upcoming") return "#5a4020";   // muted beige
  return "#ff4d6d";                             // red for abnormal
}

/** True when every player's fixture is finished (poll-stop condition). */
export function allFixturesFinished(shorts: (string | null | undefined)[]): boolean {
  if (shorts.length === 0) return false;
  return shorts.every(s => liveStateOf(s) === "finished");
}
