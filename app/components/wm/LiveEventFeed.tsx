"use client";
import React, { memo } from "react";
import type { LeagueMessage } from "@/lib/chat";

interface Props {
  messages: LeagueMessage[];
}

export const LiveEventFeed = memo(function LiveEventFeed({ messages }: Props) {
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Event Feed
        </p>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {messages.length === 0 && (
          <p className="px-4 py-4 text-[9px] text-center" style={{ color: "var(--color-muted)" }}>
            Noch keine Events in dieser GW
          </p>
        )}
        {messages.map(msg => {
          const isSimulator = (msg.metadata as any)?.source === "simulator";
          const icon = (msg.metadata as any)?.icon ?? "•";
          return (
            <div key={msg.id} className="px-4 py-2.5 flex items-start gap-2"
              style={{ borderBottom: "1px solid var(--color-border)" }}>
              <span className="text-sm flex-shrink-0">{icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[9px]" style={{ color: "var(--color-text)" }}>
                  {msg.content}
                </p>
                <p className="text-[7px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                  {new Date(msg.created_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                  {isSimulator && (
                    <span className="ml-1.5 px-1 rounded text-[6px] font-black uppercase"
                      style={{ background: "var(--bg-elevated)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                      SIM
                    </span>
                  )}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
