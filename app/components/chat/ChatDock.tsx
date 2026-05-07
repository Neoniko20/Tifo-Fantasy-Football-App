// app/components/chat/ChatDock.tsx
"use client";
import { useEffect, useState } from "react";
import { fetchLeagueMessages, fetchLeagueUnreadCount, LeagueMessage } from "@/lib/chat";

interface Props {
  leagueId: string;
  onOpen: () => void;
}

export default function ChatDock({ leagueId, onOpen }: Props) {
  const [lastMessage, setLastMessage] = useState<LeagueMessage | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    fetchLeagueMessages(leagueId, 1).then(msgs => setLastMessage(msgs[0] ?? null));
    fetchLeagueUnreadCount(leagueId).then(setUnread);
  }, [leagueId]);

  function buildPreview() {
    if (!lastMessage) return "Liga-Chat öffnen";
    if (lastMessage.kind === "system") return `🤖 ${lastMessage.content}`;
    const teamName = lastMessage.team?.name ?? "?";
    return `${teamName}: ${lastMessage.content}`;
  }

  return (
    <button
      onClick={onOpen}
      className="fixed left-3 right-3 z-40 flex items-center gap-3 rounded-2xl px-4 py-2.5 active:scale-[0.98] transition-transform"
      style={{
        bottom: "calc(56px + env(safe-area-inset-bottom) + 8px)",
        background: "var(--bg-elevated)",
        border: "1px solid var(--color-border-subtle)",
        boxShadow: "0 0 16px var(--color-glow)",
      }}
    >
      {/* Icon */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-base"
        style={{ background: "var(--color-primary-soft)", border: "1px solid var(--color-border-subtle)" }}
      >
        💬
      </div>

      {/* Preview text */}
      <span className="flex-1 text-sm text-left truncate" style={{ color: "var(--color-text-secondary)" }}>
        {buildPreview()}
      </span>

      {/* Unread badge */}
      {unread > 0 && (
        <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: "var(--color-primary)", color: "#000" }}>
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}
