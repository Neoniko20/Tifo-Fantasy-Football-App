"use client";
import { useEffect, useRef, useState } from "react";
import { LeagueMessage, fetchLeagueMessages, sendLeagueMessage, markLeagueRead } from "@/lib/chat";
import { supabase } from "@/lib/supabase";
import MessageBubble from "./MessageBubble";

interface Props {
  leagueId: string;
  myTeamId: string | null;
  myUserId: string;
}

export default function LeagueChatView({ leagueId, myTeamId, myUserId }: Props) {
  const [messages, setMessages] = useState<LeagueMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const msgs = await fetchLeagueMessages(leagueId);
      setMessages(msgs);
      await markLeagueRead(leagueId);
      setError(null);
    } catch {
      setError("Chat konnte nicht geladen werden.");
    }
  }

  useEffect(() => {
    load();

    const channel = supabase
      .channel(`league-chat-${leagueId}`)
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await sendLeagueMessage(leagueId, myTeamId, text);
      setInput("");
      await load();
    } catch {
      // send failure: keep input, user can retry
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {error ? (
          <p className="text-center text-sm mt-10" style={{ color: "var(--color-error, #ef4444)" }}>{error}</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm mt-10" style={{ color: "var(--color-muted)" }}>
            Noch keine Nachrichten. Startet den Chat! 🏆
          </p>
        ) : null}
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isOwn={msg.sender_id === myUserId}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t p-3 flex gap-2 items-end" style={{ borderColor: "var(--color-border)" }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={e => e.currentTarget.style.borderColor = "var(--color-primary)"}
          onBlur={e => e.currentTarget.style.borderColor = "var(--color-border)"}
          placeholder="Nachricht schreiben…"
          maxLength={1000}
          rows={1}
          className="flex-1 text-sm resize-none focus:outline-none"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text)",
            borderRadius: "0.75rem",
            padding: "0.5rem 0.75rem",
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="font-bold rounded-xl px-4 py-2 text-sm disabled:opacity-40 active:scale-95 transition-transform shrink-0"
          style={{ background: "var(--color-primary)", color: "#000" }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
