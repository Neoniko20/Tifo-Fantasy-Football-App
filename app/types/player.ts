export type PositionLabel = "TW" | "AB" | "MF" | "ST";
export type PlayerSlot   = "starter" | "bench" | "ir" | "taxi";
export type VisualTier   = "hero" | "standard" | "fallback";

export interface PlayerCardViewModel {
  id:             number;
  name:           string;
  positionLabel:  PositionLabel;

  // Club
  clubName?:      string;
  clubSlug?:      string;       // key in tsdb-clubs.json
  apiTeamId?:     number;       // api-sports.io team id

  // Images
  imageUrl?:      string | null;
  tsdbImageUrl?:  string | null;

  // Stats — only these are shown in the UI, no ratings
  gameweekPoints?:    number;
  seasonPoints?:      number;
  avgPoints?:         number;
  ownershipPercent?:  number;
  form?:              number;
  lastFivePoints?:    number[];

  // Badges / state
  status?:        "available" | "injured" | "locked" | "active";
  isCaptain?:     boolean;
  isViceCaptain?: boolean;
  isStarter?:     boolean;
  isLive?:        boolean;
  isLocked?:      boolean;
  isInjured?:     boolean;
  isFavorite?:    boolean;
  slot?:          PlayerSlot;
}
