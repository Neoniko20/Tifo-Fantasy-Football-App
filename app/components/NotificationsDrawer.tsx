"use client";

import { useNotifications } from "./NotificationsProvider";
import { Spinner } from "@/app/components/ui/Spinner";
import { EmptyState } from "@/app/components/ui/EmptyState";

const KIND_ICON: Record<string, string> = {
  trade_proposed:  "↔",
  trade_accepted:  "✓",
  trade_rejected:  "×",
  trade_cancelled: "↶",
  lineup_reminder: "⏰",
  waiver_result:   "📋",
  matchup_won:     "🏆",
  dynasty_pick:    "⭐",
};

const KIND_COLOR: Record<string, string> = {
  trade_proposed:  "var(--color-info)",
  trade_accepted:  "var(--color-success)",
  trade_rejected:  "var(--color-error)",
  trade_cancelled: "var(--color-muted)",
  lineup_reminder: "var(--color-primary)",
  waiver_result:   "var(--color-success)",
  matchup_won:     "var(--color-primary)",
  dynasty_pick:    "var(--color-text)",
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NotificationsDrawer({ open, onClose }: Props) {
  const { notifications, loading, markAsRead, markAllAsRead, unreadCount } = useNotifications();

  if (!open) return null;

  const handleClick = async (id: string, link: string | null) => {
    await markAsRead(id);
    onClose();
    if (link) window.location.href = link;
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.6)" }}
        onClick={onClose} />

      {/* Drawer (right side on desktop, full-width sheet on mobile) */}
      <div className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-96 flex flex-col"
        style={{ background: "var(--bg-page)", borderLeft: "1px solid var(--color-border)" }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b"
          style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-sm font-black uppercase tracking-widest" style={{ color: "var(--color-primary)" }}>
            Benachrichtigungen
          </h2>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button onClick={markAllAsRead}
                className="text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded"
                style={{ background: "var(--bg-card)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                Alle lesen
              </button>
            )}
            <button onClick={onClose}
              className="text-lg font-black w-7 h-7 rounded flex items-center justify-center"
              style={{ background: "var(--bg-card)", color: "var(--color-muted)" }}>
              ×
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading && <Spinner />}
          {!loading && notifications.length === 0 && (
            <EmptyState icon="🔔" title="Keine Benachrichtigungen" />
          )}
          {notifications.map(n => {
            const color = KIND_COLOR[n.kind] || "var(--color-text)";
            const icon  = KIND_ICON[n.kind]  || "●";
            const isUnread = !n.read_at;
            return (
              <button key={n.id} onClick={() => handleClick(n.id, n.link)}
                className="w-full text-left p-3 flex items-start gap-3 transition-colors"
                style={{
                  background: isUnread ? "var(--bg-card)" : "transparent",
                  borderBottom: "1px solid var(--bg-elevated)",
                }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: color + "20", color, fontSize: 16 }}>
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black" style={{ color: isUnread ? "var(--color-primary)" : "var(--color-text)" }}>
                    {n.title}
                    {isUnread && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full align-middle"
                      style={{ background: "var(--color-error)" }} />}
                  </p>
                  {n.body && (
                    <p className="text-[10px] font-black mt-0.5" style={{ color: "var(--color-muted)" }}>
                      {n.body}
                    </p>
                  )}
                  <p className="text-[8px] font-black mt-1" style={{ color: "var(--color-border)" }}>
                    {new Date(n.created_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
