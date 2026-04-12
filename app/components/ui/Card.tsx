import { CSSProperties, ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** extra border color override — defaults to var(--color-border) */
  borderColor?: string;
  /** use 'sm' for rounded-xl p-3, 'md' (default) for rounded-2xl p-4 */
  size?: "sm" | "md";
  onClick?: () => void;
  href?: string;
};

export function Card({ children, className = "", style, borderColor, size = "md", onClick, href }: CardProps) {
  const base = size === "sm" ? "rounded-xl p-3" : "rounded-2xl p-4";
  const combined = `${base} ${className}`;
  const s: CSSProperties = {
    background: "var(--bg-card)",
    border: `1px solid ${borderColor ?? "var(--color-border)"}`,
    ...style,
  };

  if (href) {
    return <a href={href} className={combined} style={s}>{children}</a>;
  }
  if (onClick) {
    return <button onClick={onClick} className={`w-full text-left ${combined}`} style={s}>{children}</button>;
  }
  return <div className={combined} style={s}>{children}</div>;
}
