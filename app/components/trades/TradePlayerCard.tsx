"use client";

// ── Types ─────────────────────────────────────────────────────

export interface TradePlayer {
  id:        number;
  name:      string;
  photo_url: string | null;
  position:  string;     // raw DB: GK | DF | MF | FW
  team_name: string | null;
  fpts:      number | null;
}

export interface TradePlayerCardProps {
  player:   TradePlayer;
  selected: boolean;
  onToggle: () => void;
  /** "offer" = left column (ich gebe), "request" = right column (ich bekomme) */
  side:     "offer" | "request";
}

// ── Constants ─────────────────────────────────────────────────

const POS_COLOR: Record<string, string> = {
  GK: "var(--color-primary)",
  DF: "var(--color-info)",
  MF: "var(--color-success)",
  FW: "var(--color-error)",
};

const POS_LABEL: Record<string, string> = {
  GK: "TW", DF: "AB", MF: "MF", FW: "ST",
};

const TEAL = "rgba(48,196,164,";

// ── Component ─────────────────────────────────────────────────

const SIDE_BG:     Record<string, [string, string]> = {
  offer:   ["rgba(220,50,50,0.11)",  "rgba(220,50,50,0.50)"],
  request: [`${TEAL}0.10)`,         `${TEAL}0.50)`],
};
const SIDE_NAME:   Record<string, string> = {
  offer:   "rgba(220,80,80,0.90)",
  request: `${TEAL}0.90)`,
};

export function TradePlayerCard({ player, selected, onToggle, side }: TradePlayerCardProps) {
  const posColor = POS_COLOR[player.position] ?? "var(--color-text)";
  const posLabel = POS_LABEL[player.position] ?? player.position;

  const [selBg, selBorder] = SIDE_BG[side] ?? SIDE_BG.request;

  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl text-left transition-all duration-[120ms] active:scale-[0.97]"
      style={{
        background:  selected ? selBg  : "var(--bg-page)",
        border:      `1px solid ${selected ? selBorder : "var(--color-border)"}`,
        boxShadow:   selected
          ? `0 0 0 1px ${selBorder}, 0 0 12px ${selBorder.replace("0.50)", "0.18)")}`
          : "none",
        transition: "background 120ms ease-out, border-color 120ms ease-out, box-shadow 120ms ease-out",
      }}
    >
      {/* Photo */}
      <div
        className="flex-shrink-0 w-9 h-9 rounded-lg overflow-hidden"
        style={{ background: "var(--bg-elevated)" }}
      >
        {player.photo_url ? (
          <img
            src={player.photo_url}
            alt={player.name}
            className="w-full h-full object-cover object-top"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-[7px] font-black"
            style={{ color: posColor }}
          >
            {posLabel}
          </div>
        )}
      </div>

      {/* Name + Club */}
      <div className="flex-1 min-w-0">
        <p
          className="text-[10px] font-black leading-tight truncate"
          style={{ color: selected ? SIDE_NAME[side] ?? `${TEAL}0.90)` : "var(--color-text)" }}
        >
          {player.name}
        </p>
        <p className="text-[7px] leading-tight truncate" style={{ color: "var(--color-muted)" }}>
          {player.team_name ?? "—"}
        </p>
      </div>

      {/* Position + Points */}
      <div className="flex-shrink-0 text-right pr-0.5">
        <p className="text-[9px] font-black leading-tight" style={{ color: posColor }}>
          {player.fpts != null ? player.fpts.toFixed(0) : "—"}
        </p>
        <p className="text-[7px] font-black leading-none uppercase" style={{ color: posColor }}>
          {posLabel}
        </p>
      </div>

      {/* Checkmark */}
      <div className="flex-shrink-0 w-3.5 text-center">
        <span
          className="text-[9px] font-black transition-opacity duration-150"
          style={{
            color: side === "offer" ? "rgba(220,80,80,0.90)" : `${TEAL}0.90)`,
            opacity: selected ? 1 : 0,
          }}
        >
          ✓
        </span>
      </div>
    </button>
  );
}
