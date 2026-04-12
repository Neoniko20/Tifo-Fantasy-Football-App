import { CSSProperties, ReactNode } from "react";

type BadgeProps = {
  children: ReactNode;
  color?: string;      // text/border color — defaults to var(--color-muted)
  bg?: string;         // background — defaults to transparent
  className?: string;
  style?: CSSProperties;
  dot?: boolean;       // show a leading colored dot
};

/** Tifo label badge: text-[8px] font-black uppercase tracking-widest */
export function Badge({ children, color, bg, className = "", style, dot }: BadgeProps) {
  const c = color ?? "var(--color-muted)";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest ${className}`}
      style={{ color: c, background: bg, ...style }}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c }} />}
      {children}
    </span>
  );
}
