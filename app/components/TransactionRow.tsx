"use client";

import type { LeagueTransaction, PlayerStub } from "@/lib/league-transactions";
import { kindLabel, kindColor, formatDate, formatTime } from "@/lib/league-transactions";

const POS_COLOR: Record<string, string> = {
  GK: "var(--color-primary)", DF: "var(--color-info)", MF: "var(--color-success)", FW: "var(--color-error)",
};

const TRADE_STATUS_COLOR: Record<string, string> = {
  pending: "var(--color-primary)", accepted: "var(--color-success)", rejected: "var(--color-error)", cancelled: "var(--color-muted)",
};
const TRADE_STATUS_LABEL: Record<string, string> = {
  pending: "Offen", accepted: "✓", rejected: "×", cancelled: "↶",
};

function PlayerPill({ p, tone }: { p: PlayerStub | null | undefined; tone: "in" | "out" }) {
  if (!p) return null;
  const bg    = tone === "in" ? "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))" : "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))";
  const color = tone === "in" ? "var(--color-success)" : "var(--color-error)";
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[7px] font-black px-1 py-0.5 rounded flex-shrink-0"
        style={{ background: bg, color }}>
        {tone === "in" ? "▲" : "▼"}
      </span>
      <span className="text-[11px] font-black truncate" style={{ color: "var(--color-text)" }}>
        {p.name}
      </span>
      <span className="text-[8px] font-black ml-auto flex-shrink-0"
        style={{ color: POS_COLOR[p.position] || "var(--color-muted)" }}>
        {p.position}
      </span>
    </div>
  );
}

interface Props {
  tx: LeagueTransaction;
  compact?: boolean;
  index?: number;
}

export function TransactionRow({ tx, compact, index = 0 }: Props) {
  const accent = kindColor(tx.kind);

  return (
    <div
      className={`tifo-fade-up ${compact ? "rounded-xl p-2" : "rounded-2xl p-3"}`}
      style={{
        background: "var(--bg-card)",
        border: `1px solid ${accent}${compact ? "14" : "20"}`,
        opacity: compact ? 0.82 : 1,
        animationDelay: `${index * 40}ms`,
      }}
    >
      {/* Header row: kind badge + team(s) + timestamp */}
      <div className={`flex items-center justify-between ${compact ? "mb-1" : "mb-2"}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`font-black uppercase tracking-widest rounded flex-shrink-0 ${compact ? "text-[7px] px-1 py-0.5" : "text-[8px] px-1.5 py-0.5"}`}
            style={{ background: accent + "20", color: accent }}
          >
            {kindLabel(tx.kind)}
          </span>
          {tx.kind === "trade" ? (
            <span className={`font-black truncate ${compact ? "text-[9px]" : "text-[10px]"}`} style={{ color: compact ? "var(--color-muted)" : "var(--color-text)" }}>
              {tx.proposer.name} ↔ {tx.receiver.name}
            </span>
          ) : (
            <span className={`font-black truncate ${compact ? "text-[9px]" : "text-[10px]"}`} style={{ color: compact ? "var(--color-muted)" : "var(--color-text)" }}>
              {tx.team.name}
            </span>
          )}
          {tx.kind === "trade" && (
            <span className="text-[7px] font-black px-1 py-0.5 rounded-full flex-shrink-0"
              style={{
                background: TRADE_STATUS_COLOR[tx.status] + "20",
                color: TRADE_STATUS_COLOR[tx.status],
              }}>
              {TRADE_STATUS_LABEL[tx.status] || tx.status}
            </span>
          )}
        </div>
        <p className="text-[7px] font-black flex-shrink-0 ml-2" style={{ color: "var(--color-border)" }}>
          {formatDate(tx.created_at)}{!compact && ` ${formatTime(tx.created_at)}`}
          {tx.gameweek ? ` · GW${tx.gameweek}` : ""}
        </p>
      </div>

      {/* Body */}
      {tx.kind === "transfer" && (
        <div className={compact ? "space-y-0.5" : "space-y-1"}>
          <PlayerPill p={tx.playerOut} tone="out" />
          <PlayerPill p={tx.playerIn}  tone="in" />
        </div>
      )}

      {tx.kind === "trade" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[7px] font-black uppercase mb-1" style={{ color: "var(--color-error)" }}>
              {tx.proposer.name} gibt
            </p>
            {tx.offerPlayers.map(p => <PlayerPill key={p.id} p={p} tone="out" />)}
          </div>
          <div>
            <p className="text-[7px] font-black uppercase mb-1" style={{ color: "var(--color-success)" }}>
              {tx.receiver.name} gibt
            </p>
            {tx.requestPlayers.map(p => <PlayerPill key={p.id} p={p} tone="out" />)}
          </div>
        </div>
      )}

      {tx.kind === "waiver" && (
        <div className={compact ? "space-y-0.5" : "space-y-1"}>
          <PlayerPill p={tx.playerOut} tone="out" />
          <PlayerPill p={tx.playerIn}  tone="in" />
          {typeof tx.bidAmount === "number" && tx.bidAmount > 0 && (
            <p className="text-[8px] font-black mt-1" style={{ color: "var(--color-muted)" }}>
              Bid: <span style={{ color: "var(--color-primary)" }}>{tx.bidAmount} Bucks</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
