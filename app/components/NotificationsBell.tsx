"use client";

import { useState } from "react";
import { useNotifications } from "./NotificationsProvider";
import { NotificationsDrawer } from "./NotificationsDrawer";

export function NotificationsBell() {
  const { unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="relative w-7 h-7 rounded flex items-center justify-center"
        style={{ background: "#141008", border: "1px solid #2a2010" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke={unreadCount > 0 ? "#f5a623" : "#5a4020"} strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-3.5 h-3.5 px-0.5 rounded-full flex items-center justify-center text-[7px] font-black"
            style={{ background: "#ff4d6d", color: "#0c0900" }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      <NotificationsDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
