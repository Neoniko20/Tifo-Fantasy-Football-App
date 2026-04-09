"use client";

import type { LeagueTransaction, PlayerStub } from "@/lib/league-transactions";
import { kindLabel, kindColor, formatDate, formatTime } from "@/lib/league-transactions";

const POS_COLOR: Record<string, string> = {
  GK: "#f5a623", DF: "#4a9eff", MF: "#00ce7d", FW: "#ff4d6d",
};

const TRADE_STATUS_COLOR: Record<string, string> = {
  pending: "#f5a623", accepted: "#00ce7d", rejected: "#ff4d6d", cancelled: "#5a4020",
};
const TRADE_STATUS_LABEL: Record<string, string> = {
  pending: "Offen", accepted: "✓", rejected: "×", cancelled: "↶",
};

function PlayerPill({ p, tone }: { p: PlayerStub | null | undefined; tone: "in" | "out" }) {
  if (!p) return null;
  const bg    = tone === "in" ? "#0a1a0a" : "#1a0808";
  const color = tone === "in" ? "#00ce7d" : "#ff4d6d";
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[7px] font-black px-1 py-0.5 rounded flex-shrink-0"
        style={{ background: bg, color }}>
        {tone === "in" ? "▲" : "▼"}
      </span>
      <span className="text-[11px] font-black truncate" style={{ color: "#c8b080" }}>
        {p.name}
      </span>
      <span className="text-[8px] font-black ml-auto flex-shrink-0"
        style={{ color: POS_COLOR[p.position] || "#5a4020" }}>
        {p.position}
      </span>
    </div>
  );
}

interface Props {
  tx: LeagueTransaction;
}

export function TransactionRow({ tx }: Props) {
  const accent = kindColor(tx.kind);

  return (
    <div className="rounded-2xl p-3"
      style={{ background: "#141008", border: `1px solid ${accent}20` }}>
      {/* Header row: kind badge + team(s) + timestamp */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded flex-shrink-0"
            style={{ background: accent + "20", color: accent }}>
            {kindLabel(tx.kind)}
          </span>
          {tx.kind === "trade" ? (
            <span className="text-[10px] font-black truncate" style={{ color: "#c8b080" }}>
              {tx.proposer.name} ↔ {tx.receiver.name}
            </span>
          ) : (
            <span className="text-[10px] font-black truncate" style={{ color: "#c8b080" }}>
              {tx.team.name}
            </span>
          )}
          {tx.kind === "trade" && (
            <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{
                background: TRADE_STATUS_COLOR[tx.status] + "20",
                color: TRADE_STATUS_COLOR[tx.status],
              }}>
              {TRADE_STATUS_LABEL[tx.status] || tx.status}
            </span>
          )}
        </div>
        <p className="text-[7px] font-black flex-shrink-0 ml-2" style={{ color: "#2a2010" }}>
          {formatDate(tx.created_at)} {formatTime(tx.created_at)}
          {tx.gameweek ? ` · GW${tx.gameweek}` : ""}
        </p>
      </div>

      {/* Body */}
      {tx.kind === "transfer" && (
        <div className="space-y-1">
          <PlayerPill p={tx.playerOut} tone="out" />
          <PlayerPill p={tx.playerIn}  tone="in" />
        </div>
      )}

      {tx.kind === "trade" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[7px] font-black uppercase mb-1" style={{ color: "#ff4d6d" }}>
              {tx.proposer.name} gibt
            </p>
            {tx.offerPlayers.map(p => <PlayerPill key={p.id} p={p} tone="out" />)}
          </div>
          <div>
            <p className="text-[7px] font-black uppercase mb-1" style={{ color: "#00ce7d" }}>
              {tx.receiver.name} gibt
            </p>
            {tx.requestPlayers.map(p => <PlayerPill key={p.id} p={p} tone="out" />)}
          </div>
        </div>
      )}

      {tx.kind === "waiver" && (
        <div className="space-y-1">
          <PlayerPill p={tx.playerOut} tone="out" />
          <PlayerPill p={tx.playerIn}  tone="in" />
          {typeof tx.bidAmount === "number" && tx.bidAmount > 0 && (
            <p className="text-[8px] font-black mt-1" style={{ color: "#5a4020" }}>
              Bid: <span style={{ color: "#f5a623" }}>{tx.bidAmount} Bucks</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
