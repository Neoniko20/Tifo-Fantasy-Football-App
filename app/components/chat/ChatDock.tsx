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
      className="fixed left-3 right-3 z-40 flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-2.5 shadow-lg active:scale-[0.98] transition-transform"
      style={{ bottom: "calc(56px + env(safe-area-inset-bottom) + 8px)" }}
    >
      {/* Icon */}
      <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 text-base">
        💬
      </div>

      {/* Preview text */}
      <span className="flex-1 text-sm text-zinc-400 text-left truncate">
        {buildPreview()}
      </span>

      {/* Unread badge */}
      {unread > 0 && (
        <span className="bg-yellow-500 text-black text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center shrink-0">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}
