// lib/chat.ts
import { supabase } from "@/lib/supabase";

export type MessageKind = "text" | "system";

export interface LeagueMessage {
  id: string;
  league_id: string;
  sender_id: string | null;
  team_id: string | null;
  content: string;
  kind: MessageKind;
  metadata: Record<string, unknown>;
  created_at: string;
  team?: { name: string } | null;
}

export interface DirectThread {
  id: string;
  league_id: string;
  participant_a: string;
  participant_b: string;
  created_at: string;
}

export interface DirectThreadWithTeam extends DirectThread {
  otherUserId: string;
  otherTeamName: string;
}

export interface DirectMessage {
  id: string;
  thread_id: string;
  sender_id: string | null;
  content: string;
  created_at: string;
}

// ─── League Messages ──────────────────────────────────────────────────────────

export async function fetchLeagueMessages(
  leagueId: string,
  limit = 50
): Promise<LeagueMessage[]> {
  const { data, error } = await supabase
    .from("league_messages")
    .select("*, team:teams(name)")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).reverse() as LeagueMessage[];
}

export async function sendLeagueMessage(
  leagueId: string,
  teamId: string | null,
  content: string
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase.from("league_messages").insert({
    league_id: leagueId,
    sender_id: user.id,
    team_id: teamId,
    content: content.trim(),
    kind: "text" as const,
  });
  if (error) throw error;
}

// ─── Direct Threads ───────────────────────────────────────────────────────────

/**
 * Gets or creates a DM thread between the current user and otherUserId.
 * Always stores the smaller UUID as participant_a to maintain uniqueness.
 */
export async function getOrCreateDirectThread(
  leagueId: string,
  otherUserId: string
): Promise<DirectThread> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const [a, b] =
    user.id < otherUserId
      ? [user.id, otherUserId]
      : [otherUserId, user.id];

  const { data: existing } = await supabase
    .from("direct_threads")
    .select("*")
    .eq("league_id", leagueId)
    .eq("participant_a", a)
    .eq("participant_b", b)
    .maybeSingle();

  if (existing) return existing as DirectThread;

  const { data: created, error } = await supabase
    .from("direct_threads")
    .insert({ league_id: leagueId, participant_a: a, participant_b: b })
    .select()
    .single();
  if (error) throw error;
  return created as DirectThread;
}

export async function fetchDirectThreads(
  leagueId: string
): Promise<DirectThread[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("direct_threads")
    .select("*")
    .eq("league_id", leagueId)
    .or(`participant_a.eq.${user.id},participant_b.eq.${user.id}`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DirectThread[];
}

export async function fetchDirectThreadsWithTeams(
  leagueId: string
): Promise<DirectThreadWithTeam[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: threads, error: tErr } = await supabase
    .from("direct_threads")
    .select("*")
    .eq("league_id", leagueId)
    .or(`participant_a.eq.${user.id},participant_b.eq.${user.id}`)
    .order("created_at", { ascending: false });
  if (tErr) throw tErr;
  if (!threads || threads.length === 0) return [];

  const otherUserIds = threads.map((t: DirectThread) =>
    t.participant_a === user.id ? t.participant_b : t.participant_a
  );

  const { data: teams, error: teErr } = await supabase
    .from("teams")
    .select("user_id, name")
    .eq("league_id", leagueId)
    .in("user_id", otherUserIds);
  if (teErr) throw teErr;

  const teamMap: Record<string, string> = {};
  for (const team of teams ?? []) {
    teamMap[team.user_id] = team.name;
  }

  return threads.map((t: DirectThread) => {
    const otherUserId =
      t.participant_a === user.id ? t.participant_b : t.participant_a;
    return {
      ...t,
      otherUserId,
      otherTeamName: teamMap[otherUserId] ?? "Unbekannt",
    };
  });
}

export async function fetchDirectMessages(
  threadId: string,
  limit = 50
): Promise<DirectMessage[]> {
  const { data, error } = await supabase
    .from("direct_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).reverse() as DirectMessage[];
}

export async function sendDirectMessage(
  threadId: string,
  content: string
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase.from("direct_messages").insert({
    thread_id: threadId,
    sender_id: user.id,
    content: content.trim(),
  });
  if (error) throw error;
}

// ─── Read Watermarks ──────────────────────────────────────────────────────────

export async function markLeagueRead(leagueId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from("chat_reads").upsert(
    {
      user_id: user.id,
      league_id: leagueId,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "user_id,league_id" }
  );
  if (error) throw error;
}

export async function markThreadRead(threadId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from("chat_reads").upsert(
    {
      user_id: user.id,
      thread_id: threadId,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "user_id,thread_id" }
  );
  if (error) throw error;
}

export async function fetchLeagueUnreadCount(leagueId: string): Promise<number> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;

  const { data: readRow } = await supabase
    .from("chat_reads")
    .select("last_read_at")
    .eq("user_id", user.id)
    .eq("league_id", leagueId)
    .maybeSingle();

  const query = supabase
    .from("league_messages")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .neq("sender_id", user.id);

  const { count } = readRow
    ? await query.gt("created_at", readRow.last_read_at)
    : await query;
  return count ?? 0;
}

export async function fetchThreadUnreadCount(threadId: string): Promise<number> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;

  const { data: readRow } = await supabase
    .from("chat_reads")
    .select("last_read_at")
    .eq("user_id", user.id)
    .eq("thread_id", threadId)
    .maybeSingle();

  const query = supabase
    .from("direct_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .neq("sender_id", user.id);

  const { count } = readRow
    ? await query.gt("created_at", readRow.last_read_at)
    : await query;
  return count ?? 0;
}
