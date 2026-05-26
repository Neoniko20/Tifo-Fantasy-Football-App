// app/components/chat/ChatDock.tsx
"use client";
import { useEffect, useState } from "react";
import { fetchLeagueMessages, fetchLeagueUnreadCount, LeagueMessage } from "@/lib/chat";
import { supabase } from "@/lib/supabase";

interface Props {
  leagueId: string;
  onOpen: () => void;
}

export default function ChatDock({ leagueId, onOpen }: Props) {
  const [lastMessage, setLastMessage] = useState<LeagueMessage | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const msgs = await fetchLeagueMessages(leagueId, 1);
        setLastMessage(msgs[0] ?? null);
      } catch { /* keep default */ }
      try {
        const count = await fetchLeagueUnreadCount(leagueId);
        setUnread(count);
      } catch { /* keep default */ }
    }

    load();

    const channel = supabase
      .channel(`dock-${leagueId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "league_messages",
          filter: `league_id=eq.${leagueId}`,
        },
        () => { load(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [leagueId]);

  function buildPreview() {
    if (!lastMessage) return "Liga-Chat öffnen";
    if (lastMessage.kind === "system") return `🤖 ${lastMessage.content}`;
    const teamName = lastMessage.team?.name ?? "?";
    return `${teamName}: ${lastMessage.content}`;
  }

  return (
    <div
      className="fixed inset-x-0 z-40 flex justify-center pointer-events-none"
      style={{ bottom: "calc(56px + env(safe-area-inset-bottom) + 8px)" }}
    >
      <div className="w-full max-w-[430px] px-3 pointer-events-none">
    <button
      onClick={onOpen}
      className="w-full pointer-events-auto flex items-center gap-3 rounded-2xl px-4 py-2.5 active:scale-[0.98] transition-transform"
      style={{
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
      </div>
    </div>
  );
}
