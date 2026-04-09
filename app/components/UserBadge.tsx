"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function UserBadge({ teamName }: { teamName?: string }) {
  const [user, setUser] = useState<any>(null);
  const [personalTeamName, setPersonalTeamName] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUser(data.user);
      if (!teamName) {
        const { data: team } = await supabase
          .from("teams").select("name").eq("user_id", data.user.id).is("league_id", null).maybeSingle();
        if (team) setPersonalTeamName(team.name);
      }
    });
  }, [teamName]);

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
          style={{ color: "#c8b080" }}>
          {displayName}
        </p>
        <p className="text-[8px] truncate max-w-[80px]"
          style={{ color: "#5a4020" }}>
          {user.email}
        </p>
      </div>

      {/* Avatar circle — Amber ring */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
        style={{ border: "2px solid #f5a623", background: "#141008" }}
      >
        {avatarUrl ? (
          <img src={avatarUrl} className="w-full h-full object-cover" alt="" />
        ) : (
          <span className="text-sm font-black" style={{ color: "#f5a623" }}>
            {initial}
          </span>
        )}
      </div>
    </button>
  );
}
