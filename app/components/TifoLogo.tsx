"use client";

import React from "react";

type TifoLogoVariant = "default" | "ucl";
type TifoLogoMode = "icon" | "wordmark" | "both";

interface TifoLogoProps {
  variant?: TifoLogoVariant;
  mode?: TifoLogoMode;
  size?: number;
  className?: string;
}

const COLORS = {
  default: {
    primary: "var(--color-primary)",
    bg: "var(--bg-page)",
    sub: "#3a3020",
    subText: "FANTASY FOOTBALL",
  },
  ucl: {
    primary: "#7b9fff",
    bg: "#060810",
    sub: "#1a2a4a",
    subText: "UCL MODE",
  },
};

export const TifoIcon = ({
  variant = "default",
  size = 100,
}: {
  variant?: TifoLogoVariant;
  size?: number;
}) => {
  const c = COLORS[variant];
  const id = `tifo_grad_${variant}_${size}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id={id}
          x1="0" y1="18" x2="0" y2="88"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%"   stopColor={c.primary} stopOpacity="1" />
          <stop offset="45%"  stopColor={c.primary} stopOpacity="0.6" />
          <stop offset="80%"  stopColor={c.primary} stopOpacity="0.18" />
          <stop offset="100%" stopColor={c.primary} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Seile */}
      <circle cx="16" cy="8"  r="2" fill={c.primary} fillOpacity="0.45" />
      <line x1="16" y1="10" x2="16" y2="18"
        stroke={c.primary} strokeWidth="1.2" strokeOpacity="0.35" />
      <circle cx="84" cy="8"  r="2" fill={c.primary} fillOpacity="0.45" />
      <line x1="84" y1="10" x2="84" y2="18"
        stroke={c.primary} strokeWidth="1.2" strokeOpacity="0.35" />

      {/* Querbalken */}
      <rect x="10" y="18" width="80" height="8" rx="2" fill={`url(#${id})`} />
      <rect x="10" y="28" width="80" height="8" rx="2" fill={`url(#${id})`} />
      <rect x="10" y="38" width="80" height="8" rx="2" fill={`url(#${id})`} />

      {/* Schaft */}
      <rect x="38" y="50" width="24" height="8" rx="2" fill={`url(#${id})`} />
      <rect x="38" y="60" width="24" height="8" rx="2" fill={`url(#${id})`} />
      <rect x="38" y="70" width="24" height="8" rx="2" fill={`url(#${id})`} />
    </svg>
  );
};

export const TifoWordmark = ({
  variant = "default",
  fontSize = 48,
}: {
  variant?: TifoLogoVariant;
  fontSize?: number;
}) => {
  const c = COLORS[variant];
  const id = `tifo_wmark_${variant}_${fontSize}`;
  const w = fontSize * 3;
  const h = fontSize * 1.2;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={c.primary} stopOpacity="1" />
            <stop offset="55%"  stopColor={c.primary} stopOpacity="0.65" />
            <stop offset="85%"  stopColor={c.primary} stopOpacity="0.3" />
            <stop offset="100%" stopColor={c.primary} stopOpacity="0.12" />
          </linearGradient>
        </defs>
        <text
          x={w / 2}
          y={h * 0.85}
          textAnchor="middle"
          fontFamily="'Unbounded', sans-serif"
          fontSize={fontSize}
          fontWeight="900"
          fill={`url(#${id})`}
          letterSpacing="-2"
        >
          TIFO
        </text>
      </svg>
      <span style={{
        fontFamily: "'Unbounded', sans-serif",
        fontSize: 9,
        color: c.sub,
        letterSpacing: 4,
        textAlign: "center",
      }}>
        {c.subText}
      </span>
    </div>
  );
};

export const TifoLogo = ({
  variant = "default",
  mode = "icon",
  size = 100,
  className,
}: TifoLogoProps) => {
  if (mode === "icon") {
    return <TifoIcon variant={variant} size={size} />;
  }
  if (mode === "wordmark") {
    return <TifoWordmark variant={variant} fontSize={size * 0.48} />;
  }
  // both: icon links, wordmark rechts
  return (
    <div className={className} style={{ display: "flex", alignItems: "center", gap: size * 0.16 }}>
      <TifoIcon variant={variant} size={size * 0.44} />
      <div>
        <TifoWordmark variant={variant} fontSize={size * 0.3} />
      </div>
    </div>
  );
};

export default TifoLogo;
