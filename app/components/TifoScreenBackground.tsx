import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  /** Disable the subtle grain overlay (e.g. for pages with dense imagery). */
  noGrain?: boolean;
};

const GRAIN_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>
      <filter id='n'>
        <feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>
        <feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0'/>
      </filter>
      <rect width='100%' height='100%' filter='url(#n)'/>
    </svg>`,
  );

export function TifoScreenBackground({ children, className, noGrain }: Props) {
  return (
    <div
      className={`relative isolate min-h-full w-full ${className ?? ""}`}
      style={{ backgroundColor: "var(--bg-page)" }}
    >
      {/* Stadium floodlight layer — themed radial gradients */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ backgroundImage: "var(--tifo-bg-image)" }}
      />

      {/* Grain / fabric texture overlay */}
      {!noGrain && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 mix-blend-overlay"
          style={{
            backgroundImage: `url("${GRAIN_SVG}")`,
            backgroundSize: "160px 160px",
            opacity: "var(--tifo-grain-opacity)",
          }}
        />
      )}

      {/* Content */}
      <div className="relative z-0">{children}</div>
    </div>
  );
}

export default TifoScreenBackground;
