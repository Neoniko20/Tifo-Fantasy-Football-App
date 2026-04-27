"use client";

/**
 * Backward-compatibility shim.
 *
 * The circular player marker component is now called `PlayerAvatar`.
 * All existing call-sites continue to import `PlayerCard` from here
 * and receive the same component + types.
 */

export { PlayerAvatar as PlayerCard } from "./PlayerAvatar";
export type { PlayerCardPlayer, PlayerAvatarProps as PlayerCardProps } from "./PlayerAvatar";
