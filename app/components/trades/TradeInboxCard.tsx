"use client";

// ── Constants ─────────────────────────────────────────────────

const TEAL_FULL  = "rgba(48,196,164,";
const RED_FULL   = "rgba(220,50,50,";

const STATUS_COLORS: Record<string, string> = {
  pending:   "var(--color-primary)",
  accepted:  "var(--color-success)",
  rejected:  "var(--color-error)",
  cancelled: "var(--color-border)",
};
const STATUS_LABELS: Record<string, string> = {
  pending:   "Offen",
  accepted:  "Angenommen",
  rejected:  "Abgelehnt",
  cancelled: "Zurückgezogen",
};

// ── Player Chip ───────────────────────────────────────────────

function PlayerChip({ name, fpts, isGive }: { name: string; fpts: number | null; isGive: boolean }) {
  const c = isGive ? RED_FULL : TEAL_FULL;
  return (
    <div
      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg"
      style={{ background: `${c}0.09)`, border: `1px solid ${c}0.22)` }}
    >
      <span className="text-[9px] font-black truncate max-w-[60px]" style={{ color: `${c}0.88)` }}>
        {name.split(" ").slice(-1)[0]}
      </span>
      {fpts != null && (
        <span className="text-[7px] font-black" style={{ color: `${c}0.52)` }}>
          {fpts.toFixed(0)}
        </span>
      )}
    </div>
  );
}

// ── Trade Inbox Card (incoming) ───────────────────────────────

export interface TradeInboxCardProps {
  trade:         any;
  getPlayerName: (id: number) => string;
  getPlayerFpts: (id: number) => number | null;
  onAccept:      (id: string) => void;
  onReject:      (id: string) => void;
  onCounter:     (trade: any) => void;
}

export function TradeInboxCard({
  trade, getPlayerName, getPlayerFpts, onAccept, onReject, onCounter,
}: TradeInboxCardProps) {
  const receiveFpts = (trade.offer_player_ids   || []).reduce((s: number, id: number) => s + (getPlayerFpts(id) ?? 0), 0);
  const giveFpts    = (trade.request_player_ids || []).reduce((s: number, id: number) => s + (getPlayerFpts(id) ?? 0), 0);
  const diff        = receiveFpts - giveFpts;
  const hasFpts     = receiveFpts > 0 || giveFpts > 0;
  const diffColor   = diff > 5 ? "var(--color-success)" : diff < -5 ? "var(--color-error)" : "var(--color-muted)";
  const diffLabel   = diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);

  const dateStr = new Date(trade.created_at).toLocaleDateString("de-DE", { day: "2-digit", month: "short" });

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid var(--color-border-subtle)" }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
            style={{ background: "var(--color-primary)" }} />
          <p className="text-[11px] font-black" style={{ color: "var(--color-text)" }}>
            {trade.proposer?.name}
          </p>
          <span className="text-[7px] font-black px-1.5 py-0.5 rounded-full"
            style={{ background: "color-mix(in srgb, var(--color-primary) 14%, var(--bg-page))", color: "var(--color-primary)" }}>
            Offen
          </span>
        </div>
        <span className="text-[7px]" style={{ color: "var(--color-border)" }}>{dateStr}</span>
      </div>

      {/* Players + FPTS */}
      <div className="grid grid-cols-2 gap-2 px-4 pb-3">

        {/* Ich erhalte */}
        <div>
          <p className="text-[7px] font-black uppercase tracking-widest mb-1.5"
            style={{ color: `${TEAL_FULL}0.80)` }}>
            Ich erhalte
          </p>
          <div className="flex flex-wrap gap-1 mb-2">
            {(trade.offer_player_ids || []).map((pid: number) => (
              <PlayerChip key={pid} name={getPlayerName(pid)} fpts={getPlayerFpts(pid)} isGive={false} />
            ))}
          </div>
          {hasFpts && (
            <p className="text-[9px] font-black" style={{ color: `${TEAL_FULL}0.80)` }}>
              {receiveFpts.toFixed(1)} FPTS
            </p>
          )}
        </div>

        {/* Ich gebe */}
        <div>
          <p className="text-[7px] font-black uppercase tracking-widest mb-1.5"
            style={{ color: "var(--color-error)" }}>
            Ich gebe
          </p>
          <div className="flex flex-wrap gap-1 mb-2">
            {(trade.request_player_ids || []).map((pid: number) => (
              <PlayerChip key={pid} name={getPlayerName(pid)} fpts={getPlayerFpts(pid)} isGive />
            ))}
          </div>
          {hasFpts && (
            <div className="flex items-center gap-2">
              <p className="text-[9px] font-black" style={{ color: "var(--color-error)" }}>
                {giveFpts.toFixed(1)} FPTS
              </p>
              <span className="text-[8px] font-black" style={{ color: diffColor }}>
                {diffLabel}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop: "1px solid var(--bg-elevated)" }} />

      {/* Actions */}
      <div className="grid grid-cols-3">
        <button
          onClick={() => onReject(trade.id)}
          className="py-3 text-[8px] font-black uppercase tracking-wider transition-all active:scale-[0.97] active:opacity-70"
          style={{ color: "var(--color-error)", borderRight: "1px solid var(--bg-elevated)" }}
        >
          Ablehnen
        </button>
        <button
          onClick={() => onCounter(trade)}
          className="py-3 text-[8px] font-black uppercase tracking-wider transition-all active:scale-[0.97] active:opacity-70"
          style={{ color: "var(--color-info)", borderRight: "1px solid var(--bg-elevated)" }}
        >
          Counter
        </button>
        <button
          onClick={() => onAccept(trade.id)}
          className="py-3 text-[8px] font-black uppercase tracking-wider transition-all active:scale-[0.97]"
          style={{
            background: "color-mix(in srgb, var(--color-success) 14%, var(--bg-page))",
            color: "var(--color-success)",
          }}
        >
          Annehmen ✓
        </button>
      </div>
    </div>
  );
}

// ── Trade Sent Card ───────────────────────────────────────────

export interface TradeSentCardProps {
  trade:         any;
  getPlayerName: (id: number) => string;
  getPlayerFpts: (id: number) => number | null;
  onCancel:      (id: string) => void;
}

export function TradeSentCard({
  trade, getPlayerName, getPlayerFpts, onCancel,
}: TradeSentCardProps) {
  const offerFpts   = (trade.offer_player_ids   || []).reduce((s: number, id: number) => s + (getPlayerFpts(id) ?? 0), 0);
  const requestFpts = (trade.request_player_ids || []).reduce((s: number, id: number) => s + (getPlayerFpts(id) ?? 0), 0);
  const hasFpts     = offerFpts > 0 || requestFpts > 0;

  const statusColor = STATUS_COLORS[trade.status] || "var(--color-border)";
  const statusLabel = STATUS_LABELS[trade.status] || trade.status;
  const dateStr     = new Date(trade.created_at).toLocaleDateString("de-DE", { day: "2-digit", month: "short" });

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: `1px solid ${statusColor}22` }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <p className="text-[11px] font-black" style={{ color: "var(--color-text)" }}>
          → {trade.receiver?.name}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[7px]" style={{ color: "var(--color-border)" }}>{dateStr}</span>
          <span className="text-[7px] font-black px-1.5 py-0.5 rounded-full"
            style={{ background: `${statusColor}18`, color: statusColor }}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Players */}
      <div className="grid grid-cols-2 gap-2 px-4 pb-3">
        <div>
          <p className="text-[7px] font-black uppercase tracking-widest mb-1.5"
            style={{ color: "var(--color-error)" }}>
            Ich biete
          </p>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {(trade.offer_player_ids || []).map((pid: number) => (
              <PlayerChip key={pid} name={getPlayerName(pid)} fpts={getPlayerFpts(pid)} isGive />
            ))}
          </div>
          {hasFpts && (
            <p className="text-[8px] font-black" style={{ color: "var(--color-error)" }}>
              {offerFpts.toFixed(1)} FPTS
            </p>
          )}
        </div>
        <div>
          <p className="text-[7px] font-black uppercase tracking-widest mb-1.5"
            style={{ color: `${TEAL_FULL}0.80)` }}>
            Ich möchte
          </p>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {(trade.request_player_ids || []).map((pid: number) => (
              <PlayerChip key={pid} name={getPlayerName(pid)} fpts={getPlayerFpts(pid)} isGive={false} />
            ))}
          </div>
          {hasFpts && (
            <p className="text-[8px] font-black" style={{ color: `${TEAL_FULL}0.80)` }}>
              {requestFpts.toFixed(1)} FPTS
            </p>
          )}
        </div>
      </div>

      {/* Cancel */}
      {trade.status === "pending" && (
        <>
          <div style={{ borderTop: "1px solid var(--bg-elevated)" }} />
          <div className="px-4 py-2.5">
            <button
              onClick={() => onCancel(trade.id)}
              className="text-[8px] font-black uppercase tracking-wider transition-opacity active:opacity-50"
              style={{ color: "var(--color-muted)" }}
            >
              Zurückziehen
            </button>
          </div>
        </>
      )}
    </div>
  );
}
