import { ReactNode } from "react";

type EmptyStateProps = {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

/**
 * EmptyState — standardized empty list / no-data placeholder.
 *
 * Usage:
 *   <EmptyState icon="🏆" title="Noch keine Ligen"
 *     description="Erstelle deine erste Liga oder tritt einer bei."
 *     action={<button onClick={...}>Liga erstellen</button>} />
 */
export function EmptyState({ icon, title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-16 px-4 ${className}`}>
      {icon && <p className="text-4xl mb-3">{icon}</p>}
      <p className="text-sm font-black mb-1" style={{ color: "var(--color-muted)" }}>{title}</p>
      {description && (
        <p className="text-xs mb-5 max-w-xs" style={{ color: "var(--color-dim)" }}>{description}</p>
      )}
      {action}
    </div>
  );
}
