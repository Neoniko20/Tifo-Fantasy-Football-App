"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getOrCreateDirectThread } from "@/lib/chat";
import ChatDock from "./ChatDock";
import ChatSheet from "./ChatSheet";

interface LeagueChatContextType {
  openDM: (otherUserId: string, teamName: string) => Promise<void>;
}

const LeagueChatContext = createContext<LeagueChatContextType>({
  openDM: async () => {},
});

export function useLeagueChatContext() {
  return useContext(LeagueChatContext);
}

interface Props {
  leagueId: string;
}

export default function LeagueChatProvider({ leagueId }: Props) {
  const [userId, setUserId]       = useState<string | null>(null);
  const [myTeamId, setMyTeamId]   = useState<string | null>(null);
  const [chatOpen, setChatOpen]   = useState(false);
  const [dmThreadId, setDmThreadId]           = useState<string | null>(null);
  const [dmOtherTeamName, setDmOtherTeamName] = useState<string>("");

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data: team } = await supabase
        .from("teams")
        .select("id")
        .eq("league_id", leagueId)
        .eq("user_id", user.id)
        .maybeSingle();
      setMyTeamId(team?.id ?? null);
    }
    init();
  }, [leagueId]);

  async function openDM(otherUserId: string, teamName: string) {
    try {
      const thread = await getOrCreateDirectThread(leagueId, otherUserId);
      setDmThreadId(thread.id);
      setDmOtherTeamName(teamName);
      setChatOpen(true);
    } catch (err) {
      console.warn("[LeagueChatProvider] openDM failed:", err);
    }
  }

  return (
    <LeagueChatContext.Provider value={{ openDM }}>
      {userId && myTeamId && (
        <>
          <ChatDock leagueId={leagueId} onOpen={() => setChatOpen(true)} />
          {chatOpen && (
            <ChatSheet
              leagueId={leagueId}
              myTeamId={myTeamId}
              myUserId={userId}
              onClose={() => { setChatOpen(false); setDmThreadId(null); setDmOtherTeamName(""); }}
              initialTab={dmThreadId ? "direkt" : "liga"}
              initialThreadId={dmThreadId ?? undefined}
              initialOtherTeamName={dmOtherTeamName || undefined}
            />
          )}
        </>
      )}
    </LeagueChatContext.Provider>
  );
}
