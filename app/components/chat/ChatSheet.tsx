"use client";
import { useState } from "react";
import LeagueChatView from "./LeagueChatView";
import DirectThreadList from "./DirectThreadList";
import DirectChatView from "./DirectChatView";

type Tab = "liga" | "direkt";

interface Props {
  leagueId: string;
  myTeamId: string | null;
  myUserId: string;
  onClose: () => void;
  initialTab?: Tab;
  initialThreadId?: string;
  initialOtherTeamName?: string;
}

export default function ChatSheet({
  leagueId,
  myTeamId,
  myUserId,
  onClose,
  initialTab,
  initialThreadId,
  initialOtherTeamName,
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "liga");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialThreadId ?? null);
  const [activeOtherTeamName, setActiveOtherTeamName] = useState<string>(initialOtherTeamName ?? "");

  return (
    <div
      className="tifo-backdrop-in fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="tifo-sheet-in w-full max-w-[430px] rounded-t-3xl flex flex-col" style={{ background: "var(--bg-page)", maxHeight: "85dvh" }}>
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: "var(--color-border)" }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-1 pb-3 flex-shrink-0">
          <p className="text-sm font-black uppercase tracking-widest" style={{ color: "var(--color-text)" }}>Chat</p>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-xs"
            style={{ background: "var(--bg-elevated)", color: "var(--color-muted)" }}
          >
            ✕
          </button>
        </div>

        {/* Tab bar */}
        <div className="mx-4 mb-3 flex gap-1 p-1 rounded-xl" style={{ background: "var(--bg-elevated)" }}>
          <button
            onClick={() => setTab("liga")}
            className="flex-1 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider"
            style={tab === "liga" ? { background: "var(--bg-card)", color: "var(--color-primary)" } : { color: "var(--color-muted)" }}
          >
            Liga
          </button>
          <button
            onClick={() => setTab("direkt")}
            className="flex-1 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider"
            style={tab === "direkt" ? { background: "var(--bg-card)", color: "var(--color-primary)" } : { color: "var(--color-muted)" }}
          >
            Direkt
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === "liga" && (
            <LeagueChatView
              leagueId={leagueId}
              myTeamId={myTeamId}
              myUserId={myUserId}
            />
          )}
          {tab === "direkt" && activeThreadId && (
            <DirectChatView
              threadId={activeThreadId}
              myUserId={myUserId}
              otherTeamName={activeOtherTeamName}
              onBack={() => setActiveThreadId(null)}
            />
          )}
          {tab === "direkt" && !activeThreadId && (
            <DirectThreadList
              leagueId={leagueId}
              myUserId={myUserId}
              onSelectThread={(threadId, otherTeamName) => {
                setActiveThreadId(threadId);
                setActiveOtherTeamName(otherTeamName);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
