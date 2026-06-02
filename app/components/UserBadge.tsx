"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthUser } from "@/lib/auth-context";

export function UserBadge({ teamName }: { teamName?: string }) {
  const { user } = useAuthUser(); // reads from AuthProvider — no extra getUser() call
  const [personalTeamName, setPersonalTeamName] = useState("");

  useEffect(() => {
    if (!user || teamName) return;
    supabase
      .from("teams").select("name").eq("user_id", user.id).is("league_id", null).maybeSingle()
      .then(({ data: team }) => { if (team) setPersonalTeamName(team.name); });
  }, [user, teamName]);

  if (!user) return null;

  const displayName = teamName || personalTeamName || "Mein Team";
  const initial = (user.email || "?")[0].toUpperCase();
  const avatarUrl = user.user_metadata?.avatar_url;

  return (
    <button
      onClick={() => window.location.href = "/"}
      className="flex items-center gap-2 transition-opacity hover:opacity-80"
    >
      <div className="text-right">
        <p className="text-[9px] font-black uppercase tracking-widest leading-tight"
          style={{ color: "var(--color-text)" }}>
          {displayName}
        </p>
        <p className="text-[8px] truncate max-w-[80px]"
          style={{ color: "var(--color-muted)" }}>
          {user.email}
        </p>
      </div>

      {/* Avatar circle — Amber ring */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
        style={{ border: "2px solid var(--color-primary)", background: "var(--bg-card)" }}
      >
        {avatarUrl ? (
          <img src={avatarUrl} className="w-full h-full object-cover" alt="" />
        ) : (
          <span className="text-sm font-black" style={{ color: "var(--color-primary)" }}>
            {initial}
          </span>
        )}
      </div>
    </button>
  );
}
