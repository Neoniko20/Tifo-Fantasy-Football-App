"use client";
import { useEffect, useRef, useState } from "react";
import {
  fetchDirectMessages,
  sendDirectMessage,
  markThreadRead,
  DirectMessage,
} from "@/lib/chat";
import { supabase } from "@/lib/supabase";

interface Props {
  threadId: string;
  myUserId: string;
  otherTeamName: string;
  onBack: () => void;
}

export default function DirectChatView({
  threadId,
  myUserId,
  otherTeamName,
  onBack,
}: Props) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const msgs = await fetchDirectMessages(threadId);
      setMessages(msgs);
      await markThreadRead(threadId);
      setError(null);
    } catch {
      setError("Nachrichten konnten nicht geladen werden.");
    }
  }

  useEffect(() => {
    load();

    const channel = supabase
      .channel(`direct-chat-${threadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "direct_messages",
          filter: `thread_id=eq.${threadId}`,
        },
        () => { load(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [threadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await sendDirectMessage(threadId, text);
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
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-2 border-b flex-shrink-0"
        style={{ borderColor: "var(--color-border)" }}
      >
        <button
          onClick={onBack}
          className="text-lg leading-none"
          style={{ color: "var(--color-muted)" }}
        >
          ←
        </button>
        <p
          className="text-sm font-black uppercase tracking-widest"
          style={{ color: "var(--color-text)" }}
        >
          {otherTeamName}
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {error ? (
          <p className="text-center text-sm mt-10" style={{ color: "var(--color-error, #ef4444)" }}>{error}</p>
        ) : messages.length === 0 ? (
          <p
            className="text-center text-sm mt-10"
            style={{ color: "var(--color-muted)" }}
          >
            Noch keine Nachrichten. Schreib als Erstes! 💬
          </p>
        ) : null}
        {messages.map((msg) => {
          const isOwn = msg.sender_id === myUserId;
          const time = new Date(msg.created_at).toLocaleTimeString("de-DE", {
            hour: "2-digit",
            minute: "2-digit",
          });
          return (
            <div
              key={msg.id}
              className={`flex mb-1 ${isOwn ? "justify-end" : "justify-start"}`}
            >
              <div className={`flex flex-col max-w-[75%] ${isOwn ? "items-end" : "items-start"}`}>
                <div
                  className={`px-3 py-2 rounded-2xl text-sm leading-snug break-words ${
                    isOwn ? "rounded-br-sm" : "rounded-bl-sm"
                  }`}
                  style={
                    isOwn
                      ? {
                          background: "var(--color-primary)",
                          color: "#000",
                        }
                      : {
                          background: "var(--bg-elevated)",
                          color: "var(--color-text)",
                        }
                  }
                >
                  {msg.content}
                </div>
                <span
                  className="text-[10px] mt-0.5"
                  style={{ color: "var(--color-muted)" }}
                >
                  {time}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        className="border-t p-3 flex gap-2 items-end"
        style={{ borderColor: "var(--color-border)" }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={(e) =>
            (e.currentTarget.style.borderColor = "var(--color-primary)")
          }
          onBlur={(e) =>
            (e.currentTarget.style.borderColor = "var(--color-border)")
          }
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
