"use client";
import { useState } from "react";
import LeagueChatView from "./LeagueChatView";

type Tab = "liga" | "direkt";

interface Props {
  leagueId: string;
  myTeamId: string | null;
  myUserId: string;
  onClose: () => void;
}

export default function ChatSheet({ leagueId, myTeamId, myUserId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("liga");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex flex-col justify-end"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-950 border-t border-zinc-800 rounded-t-2xl flex flex-col" style={{ height: "85dvh" }}>
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-zinc-700" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2">
          <h2 className="text-zinc-100 font-semibold text-base">Chat</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 text-sm px-2 py-1 rounded-lg active:bg-zinc-800"
          >
            Schließen
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex mx-4 mb-3 bg-zinc-900 rounded-xl p-1 gap-1">
          <button
            onClick={() => setTab("liga")}
            className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === "liga" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500"
            }`}
          >
            Liga
          </button>
          <button
            disabled
            className="flex-1 py-1.5 rounded-lg text-sm font-medium text-zinc-500 opacity-40 cursor-not-allowed"
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
        </div>
      </div>
    </div>
  );
}
