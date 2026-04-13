import { CSSProperties, ReactNode } from "react";

type StatRowProps = {
  label: string;
  value: ReactNode;
  /** Optional secondary value or sub-label on the right */
  sub?: ReactNode;
  /** Highlight the value with this color */
  valueColor?: string;
  className?: string;
  style?: CSSProperties;
  /** Add a top border separator */
  divider?: boolean;
};

/**
 * StatRow — a label/value pair used in standings, player stats, and settings.
 *
 * Usage:
 *   <StatRow label="Punkte" value={42} valueColor="var(--color-primary)" />
 *   <StatRow label="Status" value="Aktiv" divider />
 */
export function StatRow({ label, value, sub, valueColor, className = "", style, divider }: StatRowProps) {
  return (
    <div
      className={`flex items-center justify-between py-2 ${className}`}
      style={{
        borderTop: divider ? "1px solid var(--color-border)" : undefined,
        ...style,
      }}
    >
      <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
        {label}
      </span>
      <div className="flex items-center gap-2">
        {sub && (
          <span className="text-[8px]" style={{ color: "var(--color-dim)" }}>{sub}</span>
        )}
        <span className="text-xs font-black" style={{ color: valueColor ?? "var(--color-text)" }}>
          {value}
        </span>
      </div>
    </div>
  );
}
