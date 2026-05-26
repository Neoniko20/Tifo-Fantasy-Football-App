"use client";

import type { PlayerCardViewModel } from "@/app/types/player";
import { getVisualTier } from "@/lib/players/visualTier";
import { PlayerImage } from "./PlayerImage";
import tsdbClubs from "@/lib/tsdb-clubs.json";

const clubColor = (slug?: string): string | undefined =>
  slug ? ((tsdbClubs as Record<string, any>)[slug]?.colour1 ?? undefined) : undefined;

const clubBadge = (slug?: string): string | undefined =>
  slug ? ((tsdbClubs as Record<string, any>)[slug]?.badge ?? undefined) : undefined;

const POS_COLOR: Record<string, string> = {
  TW: "var(--color-accent)",
  AB: "var(--color-info)",
  MF: "var(--color-success)",
  ST: "var(--color-error)",
};

const CARD_BG = "#090c09";
const GOLD    = "rgba(244,196,48,";

// ── Stat pill ────────────────────────────────────────────────

function StatPill({ label, value }: { label: string; value?: string }) {
  if (value === undefined) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
      <span style={{ fontSize: 10, fontWeight: 900, color: GOLD + "0.88)", lineHeight: 1 }}>
        {value}
      </span>
      <span style={{
        fontSize: 6, fontWeight: 700, color: "rgba(255,255,255,0.28)",
        letterSpacing: "0.05em", textTransform: "uppercase" as const, lineHeight: 1,
      }}>
        {label}
      </span>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────

export interface PlayerCardTransferProps {
  player:    PlayerCardViewModel | null;
  onClick?:  () => void;
  /** Highlight as watchlist/favorite — gold star + border */
  highlight?: boolean;
}

// ── Empty state ───────────────────────────────────────────────

function EmptyTransferCard() {
  return (
    <div
      style={{
        display: "flex", width: "100%", height: 76,
        background: CARD_BG,
        border: "1px dashed rgba(255,255,255,0.06)",
        borderRadius: 10, overflow: "hidden",
        alignItems: "center", justifyContent: "center",
      }}
    >
      <div style={{ width: 24, height: 24, borderRadius: "50%", border: "1px dashed rgba(255,255,255,0.08)" }} />
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────

function TransferCard({ vm, highlight, onClick }: {
  vm: PlayerCardViewModel; highlight?: boolean; onClick?: () => void;
}) {
  const tier     = getVisualTier(vm);
  const posColor = POS_COLOR[vm.positionLabel] ?? "var(--color-text)";
  const c1       = clubColor(vm.clubSlug);
  const badge    = clubBadge(vm.clubSlug);
  const isHero   = highlight || !!vm.isFavorite;

  const border = isHero
    ? `1.5px solid ${GOLD}0.65)`
    : "1px solid rgba(255,255,255,0.07)";

  const boxShadow = isHero
    ? `0 0 10px ${GOLD}0.14)`
    : undefined;

  return (
    <div
      onClick={onClick}
      style={{
        position: "relative", display: "flex", width: "100%", height: 76,
        background: CARD_BG, border, borderRadius: 10, overflow: "hidden",
        boxShadow, cursor: onClick ? "pointer" : undefined,
        transition: "border-color 0.15s, box-shadow 0.15s",
        flexShrink: 0,
      }}
    >
      {/* Fan texture — full card, very subtle */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: "url('/brand/fan-bg.png')",
        backgroundSize: "cover", backgroundPosition: "55% 30%",
        filter: "grayscale(1) contrast(1.2) brightness(0.55)",
        opacity: 0.12,
      }} />

      {/* ── Left: image zone (64px wide) ── */}
      <div style={{ position: "relative", width: 64, flexShrink: 0, overflow: "hidden" }}>
        <PlayerImage src={vm.imageUrl} tier={tier} fill rounded="none" rimColor={c1} />

        {/* Club color glow from top */}
        {c1 && (
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            background: `radial-gradient(ellipse 80% 55% at 60% -10%, ${c1} 0%, transparent 100%)`,
            mixBlendMode: "screen" as const, opacity: 0.22,
          }} />
        )}

        {/* Right edge fade — image blends into info zone */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "linear-gradient(to right, transparent 50%, rgba(9,12,9,0.92) 100%)",
        }} />

        {/* Bottom scrim */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "linear-gradient(to top, rgba(9,12,9,0.65) 0%, transparent 55%)",
        }} />
      </div>

      {/* ── Right: info zone ── */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "8px 10px 8px 8px", minWidth: 0,
      }}>

        {/* Row 1: name + position badge + favorite star */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
          <span style={{
            fontSize: 13, fontWeight: 900, color: "#fff",
            letterSpacing: "-0.01em", lineHeight: 1,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
          }}>
            {vm.name}
          </span>
          {isHero && (
            <span style={{ color: GOLD + "0.90)", fontSize: 10, flexShrink: 0, lineHeight: 1 }}>★</span>
          )}
          <span style={{
            fontSize: 7, fontWeight: 900, flexShrink: 0,
            background: "rgba(0,0,0,0.88)", color: posColor,
            border: `1px solid ${posColor}70`,
            borderRadius: 3, padding: "2px 5px", lineHeight: 1,
          }}>
            {vm.positionLabel}
          </span>
        </div>

        {/* Row 2: club badge + club name */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 7 }}>
          {badge && (
            <img
              src={badge} alt=""
              style={{ width: 12, height: 12, objectFit: "contain", opacity: 0.65, flexShrink: 0 }}
            />
          )}
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
            textTransform: "uppercase" as const,
            color: c1 ? `${c1}aa` : "rgba(255,255,255,0.32)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {vm.clubName ?? "–"}
          </span>
        </div>

        {/* Row 3: stats */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <StatPill
            label="Pts"
            value={vm.seasonPoints !== undefined ? vm.seasonPoints.toFixed(1) : undefined}
          />
          <StatPill
            label="Ø/GW"
            value={vm.avgPoints !== undefined ? vm.avgPoints.toFixed(1) : undefined}
          />
          <StatPill
            label="Own"
            value={vm.ownershipPercent !== undefined ? `${vm.ownershipPercent.toFixed(0)}%` : undefined}
          />
          <StatPill
            label="Form"
            value={vm.form !== undefined ? vm.form.toFixed(1) : undefined}
          />
        </div>
      </div>

      {/* Injury indicator — top-right corner */}
      {vm.isInjured && (
        <span style={{
          position: "absolute", top: 6, right: 6,
          width: 16, height: 16, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, background: "var(--color-error)", color: "#fff",
          boxShadow: "0 0 4px rgba(220,50,50,0.35)",
        }}>
          ✚
        </span>
      )}
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────

export function PlayerCardTransfer({ player, highlight, onClick }: PlayerCardTransferProps) {
  return player
    ? <TransferCard vm={player} highlight={highlight} onClick={onClick} />
    : <EmptyTransferCard />;
}
