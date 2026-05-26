"use client";

import type { LineupPlayer } from "@/app/types/lineup";
import { normalizeLineupPlayer } from "@/lib/players/normalizePlayer";
import { PlayerCardLineup } from "@/app/components/players/PlayerCardLineup";

const POS_COLOR: Record<string, string> = {
  GK: "var(--color-primary)",
  DF: "var(--color-info)",
  MF: "var(--color-success)",
  FW: "var(--color-error)",
};

interface TaxiSectionProps {
  taxiSquad: LineupPlayer[];
  taxiSpotsTotal: number;
  taxiAgeLimit: number;
  selectingTaxi: boolean;
  draftPicks: LineupPlayer[];
  irPlayerIds: Set<number>;
  playerBorn: Map<number, string>;
  calcAge: (born: string) => number;
  onToggleSelecting: () => void;
  onPromoteFromTaxi: (player: LineupPlayer) => void;
  onMoveToTaxi: (player: LineupPlayer) => void;
}

export function TaxiSection({
  taxiSquad, taxiSpotsTotal, taxiAgeLimit,
  selectingTaxi, draftPicks, irPlayerIds, playerBorn, calcAge,
  onToggleSelecting, onPromoteFromTaxi, onMoveToTaxi,
}: TaxiSectionProps) {
  const taxiCandidates = draftPicks
    .filter(p => !irPlayerIds.has(p.id))
    .map(p => {
      const born = playerBorn.get(p.id);
      return { ...p, age: born ? calcAge(born) : null };
    })
    .filter(p => p.age === null || p.age <= taxiAgeLimit);

  return (
    <div className="w-full max-w-md mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span
            className="text-[8px] font-black px-2 py-0.5 rounded-full"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-text)", color: "var(--color-text)" }}
          >
            U{taxiAgeLimit}
          </span>
          <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            Taxi Squad · {taxiSquad.length}/{taxiSpotsTotal}
          </p>
        </div>
        {taxiSquad.length < taxiSpotsTotal && (
          <button
            onClick={onToggleSelecting}
            className="text-[8px] font-black px-2 py-1 rounded-lg transition-all"
            style={{
              background: selectingTaxi ? "var(--color-text)" : "var(--bg-elevated)",
              color: selectingTaxi ? "var(--bg-page)" : "var(--color-text)",
              border: "1px solid var(--color-text)",
            }}
          >
            {selectingTaxi ? "Abbrechen" : "+ Spieler"}
          </button>
        )}
      </div>

      {/* Slot cards — horizontal layout matching IR */}
      <div className="space-y-2">
        {taxiSquad.map((player) => {
          const born     = playerBorn.get(player.id);
          const ageLabel = born ? `${calcAge(born)}J` : `U${taxiAgeLimit}`;

          return (
            <div
              key={player.id}
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--color-border)",
              }}
            >
              <PlayerCardLineup
                variant="taxi"
                player={normalizeLineupPlayer(player, { slot: "taxi" })}
              />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-[11px] font-black truncate leading-tight" style={{ color: "var(--color-text)" }}>
                    {player.name.split(" ").pop()}
                  </p>
                  <span
                    className="flex-shrink-0 text-[7px] font-black px-1.5 py-0.5 rounded-full leading-none"
                    style={{
                      background: "var(--bg-page)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-primary)",
                    }}
                  >
                    {ageLabel}
                  </span>
                </div>
                <p className="text-[8px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                  {player.team_name} · {player.fpts?.toFixed(0)} pts
                </p>
              </div>

              <button
                onClick={() => onPromoteFromTaxi(player)}
                className="flex-shrink-0 text-[8px] font-black px-2.5 py-1.5 rounded-lg transition-all"
                style={{
                  background: "var(--bg-page)",
                  color: "var(--color-primary)",
                  border: "1px solid var(--color-border)",
                }}
              >
                ↑ Befördern
              </button>
            </div>
          );
        })}

        {/* Empty slots */}
        {Array.from({ length: Math.max(0, taxiSpotsTotal - taxiSquad.length) }).map((_, i) => (
          <div
            key={`empty-taxi-${i}`}
            className="flex items-center gap-3 p-3 rounded-xl"
            style={{
              background: "var(--bg-elevated)",
              border: "1px dashed var(--color-border)",
            }}
          >
            <PlayerCardLineup variant="taxi" player={null} />
            <p className="text-[8px] font-black" style={{ color: "var(--color-muted)" }}>
              Talent-Slot leer
            </p>
          </div>
        ))}
      </div>

      {/* Selector panel */}
      {selectingTaxi && (
        <div className="mt-3 space-y-1 max-h-48 overflow-y-auto">
          <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
            Spieler auf Taxi Squad setzen — max. U{taxiAgeLimit} (kann nicht aufgestellt werden)
          </p>
          {taxiCandidates.length === 0 ? (
            <p className="text-[8px] text-center py-3" style={{ color: "var(--color-muted)" }}>
              Keine U{taxiAgeLimit}-Spieler im Kader verfügbar
            </p>
          ) : (
            taxiCandidates.map(p => (
              <div
                key={p.id}
                onClick={() => onMoveToTaxi(p)}
                className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.borderColor = "var(--color-text)")}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.borderColor = "var(--color-border)")}
              >
                <img
                  src={p.photo_url}
                  className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                  style={{ border: `1px solid ${(POS_COLOR[p.position] ?? "var(--color-border)")}40` }}
                  alt=""
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black truncate" style={{ color: "var(--color-text)" }}>{p.name}</p>
                  <p className="text-[7px]" style={{ color: "var(--color-muted)" }}>{p.position} · {p.team_name}</p>
                </div>
                <span
                  className="text-[8px] font-black px-1.5 py-0.5 rounded-full"
                  style={{
                    background: "var(--bg-page)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-primary)",
                  }}
                >
                  {p.age !== null ? `${p.age}J` : `U${taxiAgeLimit}`}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
