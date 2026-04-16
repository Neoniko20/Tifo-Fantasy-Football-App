import { supabase } from "@/lib/supabase";

export type NotificationKind =
  | "trade_proposed"
  | "trade_accepted"
  | "trade_rejected"
  | "trade_cancelled"
  | "lineup_reminder"
  | "waiver_result"
  | "matchup_won"
  | "dynasty_pick";

export interface NotificationRow {
  id: string;
  user_id: string;
  actor_id: string | null;
  league_id: string | null;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

interface CreateArgs {
  userId: string;           // recipient
  leagueId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

async function insertNotification(args: CreateArgs): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const actorId = auth.user?.id ?? null;

  // Don't notify yourself.
  if (actorId && actorId === args.userId) return;

  const { error } = await supabase.from("notifications").insert({
    user_id:   args.userId,
    actor_id:  actorId,
    league_id: args.leagueId,
    kind:      args.kind,
    title:     args.title,
    body:      args.body  ?? null,
    link:      args.link  ?? null,
    metadata:  args.metadata ?? {},
  });
  if (error) console.warn("[notifications] insert failed:", error.message);

  // Fire-and-forget push for trade results
  if (args.kind === "trade_accepted" || args.kind === "trade_rejected") {
    const pushEvent = args.kind;
    supabase.auth.getSession().then(({ data: sessionData }) => {
      const token = sessionData.session?.access_token ?? '';
      return fetch("/api/notifications/push-dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          event:    pushEvent,
          userId:   args.userId,
          leagueId: args.leagueId,
          payload: {
            title: args.title,
            body:  args.body ?? "",
            link:  args.link ?? `/leagues/${args.leagueId}/trades`,
          },
        }),
      });
    }).catch((err) => console.warn("[push-dispatch] trade push failed:", err));
  }
}

// ───────────────────────────────────────────────────────────
// Trade-specific helpers
// ───────────────────────────────────────────────────────────

export async function createTradeProposal(args: {
  tradeId: string;
  leagueId: string;
  receiverUserId: string;
  proposerTeamName: string;
}) {
  return insertNotification({
    userId:   args.receiverUserId,
    leagueId: args.leagueId,
    kind:     "trade_proposed",
    title:    "Neuer Trade-Vorschlag",
    body:     `${args.proposerTeamName} hat dir einen Trade vorgeschlagen.`,
    link:     `/leagues/${args.leagueId}/trades`,
    metadata: { trade_id: args.tradeId },
  });
}

export async function createTradeResponse(args: {
  tradeId: string;
  leagueId: string;
  proposerUserId: string;
  receiverTeamName: string;
  accepted: boolean;
}) {
  return insertNotification({
    userId:   args.proposerUserId,
    leagueId: args.leagueId,
    kind:     args.accepted ? "trade_accepted" : "trade_rejected",
    title:    args.accepted ? "Trade angenommen" : "Trade abgelehnt",
    body:     args.accepted
      ? `${args.receiverTeamName} hat deinen Trade-Vorschlag angenommen.`
      : `${args.receiverTeamName} hat deinen Trade-Vorschlag abgelehnt.`,
    link:     `/leagues/${args.leagueId}/trades`,
    metadata: { trade_id: args.tradeId },
  });
}

export async function createTradeCancelled(args: {
  tradeId: string;
  leagueId: string;
  receiverUserId: string;
  proposerTeamName: string;
}) {
  return insertNotification({
    userId:   args.receiverUserId,
    leagueId: args.leagueId,
    kind:     "trade_cancelled",
    title:    "Trade zurückgezogen",
    body:     `${args.proposerTeamName} hat den Trade-Vorschlag zurückgezogen.`,
    link:     `/leagues/${args.leagueId}/trades`,
    metadata: { trade_id: args.tradeId },
  });
}

// ───────────────────────────────────────────────────────────
// Generic helper for future extensions
// ───────────────────────────────────────────────────────────

export async function createGeneric(args: CreateArgs) {
  return insertNotification(args);
}

// ───────────────────────────────────────────────────────────
// Read helpers
// ───────────────────────────────────────────────────────────

export async function markAsRead(notificationId: string): Promise<void> {
  await supabase.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("id", notificationId);
}

export async function markAllAsRead(userId: string): Promise<void> {
  await supabase.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("user_id", userId).is("read_at", null);
}

export async function markLeagueKindAsRead(userId: string, leagueId: string, kinds: NotificationKind[]): Promise<void> {
  await supabase.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("user_id", userId).eq("league_id", leagueId).is("read_at", null).in("kind", kinds);
}
