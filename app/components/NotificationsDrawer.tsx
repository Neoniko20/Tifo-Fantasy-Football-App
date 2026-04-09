"use client";

import { useNotifications } from "./NotificationsProvider";

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
  trade_proposed:  "#4a9eff",
  trade_accepted:  "#00ce7d",
  trade_rejected:  "#ff4d6d",
  trade_cancelled: "#5a4020",
  lineup_reminder: "#f5a623",
  waiver_result:   "#00ce7d",
  matchup_won:     "#f5a623",
  dynasty_pick:    "#c8b080",
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
        style={{ background: "#0c0900", borderLeft: "1px solid #2a2010" }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b"
          style={{ borderColor: "#2a2010" }}>
          <h2 className="text-sm font-black uppercase tracking-widest" style={{ color: "#f5a623" }}>
            Benachrichtigungen
          </h2>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button onClick={markAllAsRead}
                className="text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded"
                style={{ background: "#141008", color: "#5a4020", border: "1px solid #2a2010" }}>
                Alle lesen
              </button>
            )}
            <button onClick={onClose}
              className="text-lg font-black w-7 h-7 rounded flex items-center justify-center"
              style={{ background: "#141008", color: "#5a4020" }}>
              ×
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <p className="text-center py-8 text-[9px] font-black uppercase tracking-widest animate-pulse"
              style={{ color: "#2a2010" }}>Lade...</p>
          )}
          {!loading && notifications.length === 0 && (
            <div className="text-center py-16 px-4">
              <p className="text-4xl mb-3">🔔</p>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#2a2010" }}>
                Keine Benachrichtigungen
              </p>
            </div>
          )}
          {notifications.map(n => {
            const color = KIND_COLOR[n.kind] || "#c8b080";
            const icon  = KIND_ICON[n.kind]  || "●";
            const isUnread = !n.read_at;
            return (
              <button key={n.id} onClick={() => handleClick(n.id, n.link)}
                className="w-full text-left p-3 flex items-start gap-3 transition-colors"
                style={{
                  background: isUnread ? "#141008" : "transparent",
                  borderBottom: "1px solid #1a1208",
                }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: color + "20", color, fontSize: 16 }}>
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black" style={{ color: isUnread ? "#f5a623" : "#c8b080" }}>
                    {n.title}
                    {isUnread && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full align-middle"
                      style={{ background: "#ff4d6d" }} />}
                  </p>
                  {n.body && (
                    <p className="text-[10px] font-black mt-0.5" style={{ color: "#5a4020" }}>
                      {n.body}
                    </p>
                  )}
                  <p className="text-[8px] font-black mt-1" style={{ color: "#2a2010" }}>
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
