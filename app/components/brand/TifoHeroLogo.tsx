"use client";

import Image from "next/image";

const SIZE_MAP = {
  sm: 180,
  md: 320,
  lg: 420,
};

/**
 * Hero-Logo mit echtem Stoff-Foto (Seile, gritty Textur).
 * Asset: /public/brand/tifo-hero-fabric.png
 *
 * Einsatz: Auth, Splash, Home Hero — NICHT in Navigation oder kleinen UI-Flächen.
 */
export function TifoHeroLogo({
  size = "md",
  className = "",
  priority = false,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
  priority?: boolean;
}) {
  const px = SIZE_MAP[size];

  return (
    <div className={`relative ${className}`}>
      <Image
        src="/brand/tifo-hero-fabric.png"
        alt="TIFO"
        width={px}
        height={px}
        priority={priority}
        className="object-contain"
      />
      {/* radial glow hinter dem Logo */}
      <div
        className="absolute inset-0 -z-10 blur-2xl opacity-30"
        style={{ background: "var(--color-glow, rgba(244,196,48,0.45))" }}
      />
    </div>
  );
}

export default TifoHeroLogo;
