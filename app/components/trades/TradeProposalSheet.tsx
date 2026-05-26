"use client";

import { useState, useEffect } from "react";
import type { TradePlayer } from "./TradePlayerCard";

// ── Constants ─────────────────────────────────────────────────

const TEAL = "rgba(48,196,164,";

// ── Props ─────────────────────────────────────────────────────

export interface TradeProposalSheetProps {
  offerPlayers:    TradePlayer[];
  requestPlayers:  TradePlayer[];
  onRemoveOffer:   (id: number) => void;
  onRemoveRequest: (id: number) => void;
  onSend:          () => void;
  sending:         boolean;
}

// ── Component ─────────────────────────────────────────────────

export function TradeProposalSheet({
  offerPlayers,
  requestPlayers,
  onRemoveOffer,
  onRemoveRequest,
  onSend,
  sending,
}: TradeProposalSheetProps) {
  const canSend     = offerPlayers.length > 0 && requestPlayers.length > 0 && !sending;
  const offerFpts   = offerPlayers.reduce((s, p)  => s + (p.fpts ?? 0), 0);
  const requestFpts = requestPlayers.reduce((s, p) => s + (p.fpts ?? 0), 0);

  // Slide-up on mount
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className="fixed z-50 flex flex-col w-full max-w-[430px] rounded-t-2xl"
      style={{
        bottom:      "calc(64px + env(safe-area-inset-bottom, 0px))",
        left:        "50%",
        background:  "var(--bg-card)",
        borderTop:   "1px solid var(--color-border)",
        boxShadow:   "0 -8px 40px rgba(0,0,0,0.60)",
        transform:   visible
          ? "translateX(-50%) translateY(0)"
          : "translateX(-50%) translateY(100%)",
        transition:  "transform 300ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
    >
      {/* Drag handle */}
      <div className="flex justify-center pt-2 pb-1">
        <div className="w-8 h-0.5 rounded-full" style={{ background: "var(--color-border)" }} />
      </div>

      {/* Trade summary — two columns */}
      <div className="grid grid-cols-2 gap-3 px-4 py-1">

        {/* Left: Ich gebe */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: "var(--color-error)" }}>
              Ich gebe ({offerPlayers.length})
            </p>
            {offerPlayers.length > 0 && (
              <p className="text-[7px] font-black" style={{ color: "var(--color-muted)" }}>
                {offerFpts.toFixed(1)} FPTS
              </p>
            )}
          </div>
          {offerPlayers.length === 0 ? (
            <p className="text-[8px]" style={{ color: "var(--color-muted)", opacity: 0.45 }}>
              Links wählen ↑
            </p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {offerPlayers.map(p => (
                <button
                  key={p.id}
                  onClick={() => onRemoveOffer(p.id)}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg text-[7px] font-black leading-tight"
                  style={{
                    background: "rgba(220,50,50,0.10)",
                    border:     "1px solid rgba(220,50,50,0.22)",
                    color:      "var(--color-error)",
                  }}
                >
                  <span className="truncate max-w-[56px]">{p.name.split(" ").slice(-1)[0]}</span>
                  <span className="opacity-60 ml-0.5">✕</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Ich bekomme */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: `${TEAL}0.85)` }}>
              Ich bekomme ({requestPlayers.length})
            </p>
            {requestPlayers.length > 0 && (
              <p className="text-[7px] font-black" style={{ color: "var(--color-muted)" }}>
                {requestFpts.toFixed(1)} FPTS
              </p>
            )}
          </div>
          {requestPlayers.length === 0 ? (
            <p className="text-[8px]" style={{ color: "var(--color-muted)", opacity: 0.45 }}>
              Rechts wählen ↑
            </p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {requestPlayers.map(p => (
                <button
                  key={p.id}
                  onClick={() => onRemoveRequest(p.id)}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg text-[7px] font-black leading-tight"
                  style={{
                    background: `${TEAL}0.09)`,
                    border:     `1px solid ${TEAL}0.22)`,
                    color:      `${TEAL}0.85)`,
                  }}
                >
                  <span className="truncate max-w-[56px]">{p.name.split(" ").slice(-1)[0]}</span>
                  <span className="opacity-60 ml-0.5">✕</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* CTA */}
      <div className="px-4 pt-1.5 pb-2.5">
        <button
          onClick={onSend}
          disabled={!canSend}
          className="w-full py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all active:scale-[0.98] disabled:cursor-not-allowed"
          style={{
            background: canSend ? "var(--color-primary)" : "var(--bg-elevated)",
            color:      canSend ? "var(--bg-page)"       : "var(--color-border)",
            opacity:    canSend ? 1 : 0.5,
            boxShadow:  canSend ? "0 2px 16px rgba(48,196,164,0.25)" : "none",
          }}
        >
          {sending ? "Wird gesendet…" : "Trade-Angebot senden"}
        </button>
      </div>
    </div>
  );
}
