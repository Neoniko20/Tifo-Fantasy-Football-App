"use client";

function FabricT({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
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
 * Rounded-Square App-Icon mit Stoff-T.
 * Einsatz: PWA Preview, Loading-Screen, Splash.
 * glow=true → goldener Box-Shadow via --color-glow.
 */
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
      aria-label="TIFO"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "var(--bg-page, #0c0900)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        boxShadow: glow
          ? `0 0 ${Math.round(size * 0.28)}px var(--color-glow, rgba(244,196,48,0.45)),
             0 0 ${Math.round(size * 0.10)}px var(--color-glow, rgba(244,196,48,0.45))`
          : undefined,
      }}
    >
      <FabricT size={iconSize} />
    </div>
  );
}

export default TifoAppIcon;
