import type { PlayerCardViewModel } from "@/app/types/player";

export type ResolvedImages = {
  imageUrl:         string | null;
  tsdbImageUrl:     string | null;
  fallbackImageUrl: string;
};

/** Returns the best available player photo URL (tsdb > photo_url > null). */
export function resolvePlayerImageUrl(
  vm: Pick<PlayerCardViewModel, "tsdbImageUrl" | "imageUrl">,
): string | null {
  return vm.tsdbImageUrl ?? vm.imageUrl ?? null;
}

/** Returns all image URLs for a player, including the static fallback. */
export function resolveImages(vm: PlayerCardViewModel): ResolvedImages {
  return {
    imageUrl:         vm.imageUrl         ?? null,
    tsdbImageUrl:     vm.tsdbImageUrl     ?? null,
    fallbackImageUrl: "/player-placeholder.png",
  };
}

/** Club logo from api-sports.io. */
export function resolveClubLogoUrl(apiTeamId?: number | null): string | null {
  if (!apiTeamId) return null;
  return `https://media.api-sports.io/football/teams/${apiTeamId}.png`;
}
