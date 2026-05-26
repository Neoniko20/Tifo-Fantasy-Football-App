"use client";

export type AnnouncedPick = {
  playerName: string;
  playerPhoto: string;
  position: string;
  teamName: string;
  isOwnPick: boolean;
};

type Props = {
  pick: AnnouncedPick | null;
  visible: boolean;
};

export function PickAnnouncement({ pick, visible }: Props) {
  if (!visible || !pick) return null;

  return (
    <>
      <style>{`
        @keyframes pickSlideIn {
          from { opacity: 0; transform: translate(-50%, calc(-50% - 16px)); }
          to   { opacity: 1; transform: translate(-50%, -50%); }
        }
      `}</style>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 200,
          background: "rgba(0,0,0,0.35)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 201,
          background: "var(--bg-card)",
          border: `2px solid ${pick.isOwnPick ? "var(--color-primary)" : "var(--color-border)"}`,
          borderRadius: 20,
          padding: "28px 36px",
          textAlign: "center",
          boxShadow: "0 12px 48px rgba(0,0,0,0.4)",
          animation: "pickSlideIn 0.2s ease-out",
          minWidth: 240,
          maxWidth: 320,
          pointerEvents: "none",
        }}
      >
        {pick.playerPhoto && (
          <img
            src={pick.playerPhoto}
            alt={pick.playerName}
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              objectFit: "cover",
              marginBottom: 14,
              border: `2px solid ${pick.isOwnPick ? "var(--color-primary)" : "var(--color-border)"}`,
            }}
          />
        )}
        <p
          className="font-black truncate"
          style={{
            fontSize: pick.isOwnPick ? 20 : 17,
            color: "var(--color-text)",
            marginBottom: 6,
          }}
        >
          {pick.playerName}
        </p>
        <p
          className="text-xs font-black uppercase tracking-widest truncate"
          style={{ color: "var(--color-muted)" }}
        >
          {pick.position} · {pick.teamName}
        </p>
        {pick.isOwnPick && (
          <p
            className="text-[10px] font-black uppercase tracking-widest mt-2"
            style={{ color: "var(--color-primary)" }}
          >
            Dein Pick ✓
          </p>
        )}
      </div>
    </>
  );
}
