"use client";
import { useEffect, useRef, useState } from "react";
import { LeagueMessage, fetchLeagueMessages, sendLeagueMessage, markLeagueRead } from "@/lib/chat";
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
  const bottomRef = useRef<HTMLDivElement>(null);

  async function load() {
    const msgs = await fetchLeagueMessages(leagueId);
    setMessages(msgs);
    await markLeagueRead(leagueId);
  }

  useEffect(() => {
    load();
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
        {messages.length === 0 && (
          <p className="text-center text-zinc-500 text-sm mt-10">
            Noch keine Nachrichten. Startet den Chat! 🏆
          </p>
        )}
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isOwn={msg.sender_id === myUserId}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-zinc-800 p-3 flex gap-2 items-end">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nachricht schreiben…"
          maxLength={1000}
          rows={1}
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-yellow-500 resize-none"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="bg-yellow-500 text-black font-bold rounded-xl px-4 py-2 text-sm disabled:opacity-40 active:scale-95 transition-transform shrink-0"
        >
          ↑
        </button>
      </div>
    </div>
  );
}
