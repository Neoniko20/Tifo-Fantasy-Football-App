"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import type { VisualTier } from "@/app/types/player";

interface PlayerImageProps {
  src:        string | null | undefined;
  alt?:       string;
  tier?:      VisualTier;
  /** Fixed pixel size (square). Mutually exclusive with fill. */
  size?:      number;
  /** Fill parent container absolutely — parent must be position:relative with explicit dimensions. */
  fill?:      boolean;
  rounded?:   "full" | "lg" | "none";
  className?: string;
  style?:     CSSProperties;
  /** Club color for subtle rim light in card view */
  rimColor?:  string;
}

export function PlayerImage({
  src,
  alt = "",
  tier = "standard",
  size,
  fill = false,
  rounded = "full",
  className = "",
  style,
  rimColor,
}: PlayerImageProps) {
  const [failed, setFailed] = useState(false);
  const showImage = !!src && !failed;

  const roundedClass =
    rounded === "full" ? "rounded-full" :
    rounded === "lg"   ? "rounded-lg"   :
    "";

  const containerStyle: CSSProperties = fill
    ? { position: "absolute", inset: 0, overflow: "hidden", ...style }
    : { width: size, height: size, position: "relative", overflow: "hidden", ...style };

  const isHero = tier === "hero";

  return (
    <div className={`${roundedClass} ${className}`} style={containerStyle}>

      {showImage ? (
        <img
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          className={`h-full w-full object-cover object-top ${roundedClass}`}
          style={{ filter: "saturate(0.75) contrast(1.09) brightness(0.93)" }}
        />
      ) : (
        <div
          className={`h-full w-full flex items-end justify-center pb-2 ${roundedClass}`}
          style={{ background: "linear-gradient(180deg, #161a15 0%, #0a0d09 100%)" }}
        >
          <svg
            width={size ? size * 0.50 : "50%"}
            height={size ? size * 0.50 : "50%"}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <circle cx="12" cy="8" r="4" fill="rgba(255,255,255,0.09)" />
            <path
              d="M4 20c0-4 3.6-7 8-7s8 3 8 7"
              stroke="rgba(255,255,255,0.09)"
              strokeWidth="2"
              fill="none"
            />
          </svg>
        </div>
      )}

      {/* Bottom scrim — darkens base of image, face stays unaffected */}
      {rounded !== "full" && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.52) 0%, transparent 44%)",
          }}
        />
      )}

      {/* Grain overlay — filmic texture */}
      <div
        className={`pointer-events-none absolute inset-0 ${roundedClass}`}
        style={{
          backgroundImage: "url('/noise.svg')",
          opacity: 0.06,
          mixBlendMode: "overlay",
        }}
      />

      {/* Gold rim-light for hero tier */}
      {isHero && showImage && (
        <div
          className={`pointer-events-none absolute inset-0 ${roundedClass}`}
          style={{
            boxShadow: "inset 0 0 0 1.5px rgba(244,196,48,0.70), inset 0 0 14px rgba(244,196,48,0.10)",
          }}
        />
      )}

      {/* Club color rim light — subtle edge glow for card context */}
      {rimColor && !isHero && showImage && rounded !== "full" && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            boxShadow: `inset 0 0 16px ${rimColor}1a, inset 0 -6px 12px ${rimColor}12`,
          }}
        />
      )}
    </div>
  );
}
