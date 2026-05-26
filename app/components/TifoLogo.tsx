"use client";

import React from "react";

// ─── TifoIcon ──────────────────────────────────────────────────────────────
// Fabric T mark. Works from 24 px (BottomNav) to 512 px (splash).
// At small sizes fraying is kept subtle via low-opacity stroke hints.

export function TifoIcon({
  size = 28,
  monochrome = false,
  className = "",
}: {
  size?: number;
  monochrome?: boolean;
  className?: string;
}) {
  const fill = monochrome ? "currentColor" : "var(--color-primary, #F4C430)";
  const stroke = monochrome ? "currentColor" : "var(--color-primary, #F4C430)";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* horizontal fabric banner */}
      <path
        d="M12 13.5C21 12.5 35 12.2 52 13.8L50.5 24.5C36 23.3 23 23.5 10.5 25.2L12 13.5Z"
        fill={fill}
      />
      {/* shadow gap between banner and stem */}
      <path
        d="M17 26.5C28 25.7 39 25.8 48 27L47.2 30.2C36 29.1 26 29.2 17.5 30.1L17 26.5Z"
        fill="black"
        opacity="0.42"
      />
      {/* vertical fabric stem */}
      <path
        d="M27 25.5C31.2 25.2 35.2 25.3 38.8 25.8L39.5 52C35.8 53.2 31.8 53.2 27.6 52L27 25.5Z"
        fill={fill}
      />
      {/* fraying hints — only visible above ~20 px */}
      <path
        d="M14 15L10 14.4M18 13L16.2 10.8M48 14L54 13.4M51 21L56 22.2M28 51L25 55M38 51L41 55"
        stroke={stroke}
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

// ─── TifoLogo ──────────────────────────────────────────────────────────────
// Horizontal: fabric T + "TIFO" wordmark.
// Use in TopNav / Header.

const LOGO_SIZES = {
  sm: { icon: 22, font: 14, gap: 7 },
  md: { icon: 30, font: 19, gap: 9 },
  lg: { icon: 42, font: 26, gap: 12 },
};

export function TifoLogo({
  size = "md",
  monochrome = false,
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  monochrome?: boolean;
  className?: string;
}) {
  const s = LOGO_SIZES[size];
  const color = monochrome ? "currentColor" : "var(--color-primary, #F4C430)";

  return (
    <div
      className={className}
      style={{ display: "flex", alignItems: "center", gap: s.gap }}
    >
      <TifoIcon size={s.icon} monochrome={monochrome} />
      <span
        style={{
          fontFamily: "'Unbounded', sans-serif",
          fontWeight: 900,
          fontSize: s.font,
          color,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          userSelect: "none",
        }}
      >
        TIFO
      </span>
    </div>
  );
}

// ─── TifoAppIcon ───────────────────────────────────────────────────────────
// Rounded-square container for PWA icons, favicons, loading screens.

export function TifoAppIcon({
  size = 96,
  glow = false,
  className = "",
}: {
  size?: number;
  glow?: boolean;
  className?: string;
}) {
  const radius = Math.round(size * 0.22);
  const iconSize = Math.round(size * 0.58);

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "var(--bg-page, #0c0900)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: glow
          ? `0 0 ${Math.round(size * 0.28)}px var(--color-glow, rgba(244,196,48,0.45)),
             0 0 ${Math.round(size * 0.10)}px var(--color-glow, rgba(244,196,48,0.45))`
          : undefined,
      }}
    >
      <TifoIcon size={iconSize} />
    </div>
  );
}

// ─── TifoHeroLogo ──────────────────────────────────────────────────────────
// Stacked: large fabric T + TIFO wordmark + subtitle.
// Use on Home Hero / Splash screen.

export function TifoHeroLogo({ className = "" }: { className?: string }) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
      }}
    >
      {/* fabric T with radial glow behind */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            position: "absolute",
            width: 160,
            height: 160,
            borderRadius: "50%",
            background: "var(--color-glow, rgba(244,196,48,0.22))",
            filter: "blur(40px)",
          }}
        />
        <TifoIcon size={120} />
      </div>

      {/* TIFO wordmark */}
      <span
        style={{
          fontFamily: "'Unbounded', sans-serif",
          fontWeight: 900,
          fontSize: 52,
          color: "var(--color-primary, #F4C430)",
          letterSpacing: "-0.04em",
          lineHeight: 1,
          userSelect: "none",
        }}
      >
        TIFO
      </span>

      {/* subtitle */}
      <span
        style={{
          fontFamily: "'Unbounded', sans-serif",
          fontWeight: 400,
          fontSize: 8,
          color: "var(--color-text-secondary, #a88858)",
          letterSpacing: "0.38em",
          textTransform: "uppercase",
          marginTop: 2,
          userSelect: "none",
        }}
      >
        Fantasy Football
      </span>
    </div>
  );
}

export default TifoLogo;
