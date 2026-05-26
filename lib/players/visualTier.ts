import type { PlayerCardViewModel, VisualTier } from "@/app/types/player";

const HERO_POINTS_THRESHOLD = 15;

/**
 * Determines the visual treatment for a player card.
 *
 * hero     — gold rim-light; captain or exceptional GW performance
 * standard — normal rendering with image
 * fallback — no image available; show silhouette
 */
export function getVisualTier(vm: PlayerCardViewModel): VisualTier {
  const hasImage = !!(vm.tsdbImageUrl || vm.imageUrl);
  if (!hasImage) return "fallback";
  if (vm.isCaptain) return "hero";
  if (vm.gameweekPoints !== undefined && vm.gameweekPoints >= HERO_POINTS_THRESHOLD) return "hero";
  return "standard";
}
