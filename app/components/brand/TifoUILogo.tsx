"use client";

const SIZES = {
  sm: { icon: 22, font: 14, gap: 7 },
  md: { icon: 30, font: 19, gap: 9 },
  lg: { icon: 42, font: 26, gap: 12 },
};

function FabricT({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M12 13.5C21 12.5 35 12.2 52 13.8L50.5 24.5C36 23.3 23 23.5 10.5 25.2L12 13.5Z"
        fill="var(--color-primary, #F4C430)"
      />
      <path
        d="M17 26.5C28 25.7 39 25.8 48 27L47.2 30.2C36 29.1 26 29.2 17.5 30.1L17 26.5Z"
        fill="black"
        opacity="0.42"
      />
      <path
        d="M27 25.5C31.2 25.2 35.2 25.3 38.8 25.8L39.5 52C35.8 53.2 31.8 53.2 27.6 52L27 25.5Z"
        fill="var(--color-primary, #F4C430)"
      />
      <path
        d="M14 15L10 14.4M18 13L16.2 10.8M48 14L54 13.4M51 21L56 22.2M28 51L25 55M38 51L41 55"
        stroke="var(--color-primary, #F4C430)"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

/**
 * UI-Logo für TopNav, BottomNav, kleine App-Flächen.
 * variant "icon"     → nur das Stoff-T
 * variant "wordmark" → Stoff-T + TIFO Text
 *
 * NICHT als großes Hero-Element verwenden.
 */
export function TifoUILogo({
  variant = "wordmark",
  size = "md",
  className = "",
}: {
  variant?: "icon" | "wordmark";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const s = SIZES[size];

  if (variant === "icon") {
    return (
      <span className={className} aria-label="TIFO">
        <FabricT size={s.icon} />
      </span>
    );
  }

  return (
    <div
      className={className}
      style={{ display: "flex", alignItems: "center", gap: s.gap }}
      aria-label="TIFO"
    >
      <FabricT size={s.icon} />
      <span
        style={{
          fontFamily: "'Unbounded', sans-serif",
          fontWeight: 900,
          fontSize: s.font,
          color: "var(--color-primary, #F4C430)",
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

export default TifoUILogo;
