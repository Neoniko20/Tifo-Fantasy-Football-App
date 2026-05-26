"use client";
import { LeagueMessage } from "@/lib/chat";

interface Props {
  message: LeagueMessage;
  isOwn: boolean;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function TeamAvatar({ name }: { name: string }) {
  const initials = name.trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-dim)" }}>
      {initials}
    </div>
  );
}

function renderContent(content: string) {
  return content.split(/(@\S+)/g).map((part, i) =>
    part.startsWith("@")
      ? <span key={i} className="font-semibold" style={{ color: "var(--color-primary)" }}>{part}</span>
      : <span key={i}>{part}</span>
  );
}

export default function MessageBubble({ message, isOwn }: Props) {
  if (message.kind === "system") {
    return (
      <div className="flex justify-center my-2">
        <span className="text-[11px] px-3 py-1 rounded-full" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-dim)" }}>
          {message.content}
        </span>
      </div>
    );
  }

  const teamName = message.team?.name ?? "Unbekannt";

  return (
    <div className={`flex gap-2 items-end mb-1 ${isOwn ? "flex-row-reverse" : "flex-row"}`}>
      {!isOwn && <TeamAvatar name={teamName} />}
      <div className={`flex flex-col max-w-[75%] ${isOwn ? "items-end" : "items-start"}`}>
        {!isOwn && (
          <span className="text-[10px] mb-0.5 px-1" style={{ color: "var(--color-muted)" }}>{teamName}</span>
        )}
        <div
          className={`px-3 py-2 rounded-2xl text-sm leading-snug break-words ${isOwn ? "rounded-br-sm" : "rounded-bl-sm"}`}
          style={isOwn ? { background: "var(--color-primary)", color: "#000" } : { background: "var(--bg-elevated)", color: "var(--color-text)" }}
        >
          {renderContent(message.content)}
        </div>
        <span className="text-[10px] mt-0.5 px-1" style={{ color: "var(--color-muted)" }}>
          {formatTime(message.created_at)}
        </span>
      </div>
    </div>
  );
}
