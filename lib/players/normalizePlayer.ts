import type { PlayerCardViewModel, PositionLabel, PlayerSlot } from "@/app/types/player";

// ── Raw shape from the lineup page DB query ───────────────────
export type RawLineupPlayer = {
  id:           number;
  name:         string;
  photo_url?:   string | null;
  position:     string;
  team_name?:   string;
  api_team_id?: number | null;
  fpts?:        number;
};

export type NormalizeOptions = {
  gwPoints?:      number;
  isCaptain?:     boolean;
  isViceCaptain?: boolean;
  isInjured?:     boolean;
  isLocked?:      boolean;
  isLive?:        boolean;
  slot?:          PlayerSlot;
};

// ── Position mapping — DB codes → UI labels ───────────────────

/**
 * Maps raw DB position strings to the four UI labels.
 * DB stores: GK | DF | MF | FW (primary codes)
 */
export function toPositionLabel(position: string): PositionLabel {
  const p = (position ?? "").toUpperCase();
  if (p === "GK" || p === "TW" || p === "G") return "TW";
  if (
    p === "DF" || p === "AB" || p === "D" ||
    /^(L|R|C)?B$/.test(p) ||
    /^(LCB|RCB|LWB|RWB|SW)$/.test(p)
  ) return "AB";
  if (
    p === "FW" || p === "ST" || p === "F" ||
    /^(LW|RW|CF|SS|LF|RF)$/.test(p)
  ) return "ST";
  return "MF";
}

// ── Raw shape from transfer / roster queries ──────────────────
export type RawTransferPlayer = {
  id:              number;
  name:            string;
  photo_url?:      string | null;
  position:        string;
  team_name?:      string;
  club_slug?:      string;
  api_team_id?:    number | null;
  fpts?:           number;       // season total
  avg_points?:     number;
  ownership_pct?:  number;
  form?:           number;
};

/** Converts a raw transfer/roster player into a display ViewModel. */
export function normalizeTransferPlayer(player: RawTransferPlayer): PlayerCardViewModel {
  return {
    id:               player.id,
    name:             player.name,
    positionLabel:    toPositionLabel(player.position),
    clubName:         player.team_name,
    clubSlug:         player.club_slug,
    apiTeamId:        player.api_team_id ?? undefined,
    imageUrl:         player.photo_url ?? null,
    seasonPoints:     player.fpts,
    avgPoints:        player.avg_points,
    ownershipPercent: player.ownership_pct,
    form:             player.form,
    status:           "available",
  };
}

// ── Normalizer ────────────────────────────────────────────────

/** Converts a raw lineup player + context into a display ViewModel. */
export function normalizeLineupPlayer(
  player: RawLineupPlayer,
  opts: NormalizeOptions = {},
): PlayerCardViewModel {
  const status: PlayerCardViewModel["status"] =
    opts.isLocked   ? "locked"    :
    opts.isInjured  ? "injured"   :
    opts.isCaptain  ? "active"    :
    "available";

  return {
    id:            player.id,
    name:          player.name,
    positionLabel: toPositionLabel(player.position),
    clubName:      player.team_name,
    apiTeamId:     player.api_team_id ?? undefined,
    imageUrl:      player.photo_url ?? null,
    gameweekPoints: opts.gwPoints,
    seasonPoints:   player.fpts,
    isCaptain:      opts.isCaptain,
    isViceCaptain:  opts.isViceCaptain,
    isInjured:      opts.isInjured,
    isLocked:       opts.isLocked,
    isLive:         opts.isLive,
    slot:           opts.slot,
    status,
  };
}
