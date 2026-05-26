"use client";

import { useEffect, useState } from "react";
import {
  fetchDirectThreadsWithTeams,
  fetchThreadUnreadCount,
  DirectThreadWithTeam,
} from "@/lib/chat";

interface Props {
  leagueId: string;
  myUserId: string;
  onSelectThread: (threadId: string, otherTeamName: string) => void;
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return "Gerade";
  if (d.toDateString() === now.toDateString()) return "Heute";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default function DirectThreadList({
  leagueId,
  myUserId: _myUserId,
  onSelectThread,
}: Props) {
  const [threads, setThreads] = useState<DirectThreadWithTeam[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchDirectThreadsWithTeams(leagueId);
        if (cancelled) return;
        setThreads(data);
        const counts: Record<string, number> = {};
        await Promise.all(
          data.map(async (t) => {
            try {
              counts[t.id] = await fetchThreadUnreadCount(t.id);
            } catch { counts[t.id] = 0; }
          })
        );
        if (!cancelled) setUnreadCounts(counts);
      } catch {
        if (!cancelled) setError("Direktnachrichten konnten nicht geladen werden.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  if (error) {
    return (
      <div className="flex flex-col h-full items-center justify-center px-6 text-center">
        <span className="text-xs" style={{ color: "var(--color-muted)" }}>{error}</span>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-1 px-6 text-center">
        <span className="text-xs" style={{ color: "var(--color-muted)" }}>
          Noch keine Direktnachrichten.
        </span>
        <span className="text-xs" style={{ color: "var(--color-muted)" }}>
          Öffne das Profil eines Gegners und tippe auf 💬 Chat.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {threads.map((thread) => {
        const unread = unreadCounts[thread.id] ?? 0;
        const cappedUnread = Math.min(unread, 99);

        return (
          <button
            key={thread.id}
            className="w-full flex items-center gap-3 px-4 py-3"
            style={{ borderBottom: "1px solid var(--color-border)" }}
            onClick={() => onSelectThread(thread.id, thread.otherTeamName)}
          >
            {/* Avatar */}
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--color-border)",
                color: "var(--color-dim)",
              }}
            >
              {getInitials(thread.otherTeamName)}
            </div>

            {/* Text content */}
            <div className="flex-1 min-w-0 text-left">
              <div
                className="text-sm font-black truncate"
                style={{ color: "var(--color-text)" }}
              >
                {thread.otherTeamName}
              </div>
              <div
                className="text-[11px] truncate"
                style={{ color: "var(--color-muted)" }}
              >
                {"DM"}
                {" • "}
                {relativeDate(thread.created_at)}
              </div>
            </div>

            {/* Unread badge */}
            {unread > 0 && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                style={{
                  background: "var(--color-primary)",
                  color: "#000",
                }}
              >
                {cappedUnread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
