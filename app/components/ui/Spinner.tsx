type SpinnerProps = {
  text?: string;
  className?: string;
};

/**
 * Spinner — standardized loading state.
 * Replaces the scattered `animate-pulse` text loading patterns.
 *
 * Usage:
 *   <Spinner />
 *   <Spinner text="Lade Spieler..." />
 */
export function Spinner({ text = "Lade...", className = "" }: SpinnerProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 gap-3 ${className}`}>
      <div
        className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--color-border)", borderTopColor: "var(--color-primary)" }}
      />
      {text && (
        <p className="text-[9px] font-black uppercase tracking-widest animate-pulse"
          style={{ color: "var(--color-dim)" }}>
          {text}
        </p>
      )}
    </div>
  );
}
