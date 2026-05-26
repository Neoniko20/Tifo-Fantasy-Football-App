"use client";

type Props = {
  currentTeamName: string | null;
  isMyTurn: boolean;
  timeLeft: number;
  secondsPerPick: number;
  pickNumber: number;
  totalPicks: number;
  isConnected: boolean;
};

export function OnTheClock({
  currentTeamName,
  isMyTurn,
  timeLeft,
  secondsPerPick,
  pickNumber,
  totalPicks,
  isConnected,
}: Props) {
  const noLimit = secondsPerPick === 0;
  const timerDisplay = noLimit ? "∞" : `${timeLeft}s`;
  const timerColor = noLimit
    ? "var(--color-primary)"
    : timeLeft > 30
    ? "var(--color-success)"
    : timeLeft > 10
    ? "var(--color-primary)"
    : "var(--color-error)";

  return (
    <div
      className="md:hidden"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "var(--bg-page)",
        borderBottom: "1px solid var(--color-border)",
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {isMyTurn ? (
          <p
            className="font-black text-sm truncate"
            style={{ color: "var(--color-primary)" }}
          >
            Du bist dran 🏆
          </p>
        ) : (
          <p
            className="font-black text-sm truncate"
            style={{ color: "var(--color-text)" }}
          >
            {currentTeamName ?? "—"} pickt...
          </p>
        )}
        <p
          className="text-[9px] font-black uppercase tracking-widest"
          style={{ color: "var(--color-muted)" }}
        >
          Pick {pickNumber + 1} / {totalPicks}
        </p>
      </div>

      <div
        className="font-black text-2xl leading-none flex-shrink-0"
        style={{
          color: timerColor,
          animation:
            !noLimit && timeLeft <= 10 && timeLeft > 0
              ? "pulse 1s ease-in-out infinite"
              : undefined,
        }}
      >
        {timerDisplay}
      </div>

      {!isConnected && (
        <div
          className="text-[8px] font-black flex-shrink-0"
          style={{ color: "var(--color-error)" }}
        >
          ⏳
        </div>
      )}
    </div>
  );
}
