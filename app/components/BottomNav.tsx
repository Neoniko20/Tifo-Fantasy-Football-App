"use client";

import { usePathname } from "next/navigation";
import { useNotifications } from "./NotificationsProvider";

const TABS = [
  { id: "liga",    label: "Liga",    href: "/leagues",
    Icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
        <path d="M4 22h16"/>
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
      </svg>
    ),
  },
  { id: "scores",  label: "Scores",  href: "/scores",
    Icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6"  y1="20" x2="6"  y2="14"/>
      </svg>
    ),
  },
  { id: "account", label: "Konto", href: "/account",
    Icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4"/>
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
      </svg>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();

  const { unreadCount } = useNotifications();

  const activeTab =
    pathname.startsWith("/leagues") || pathname.startsWith("/wm") ? "liga" :
    pathname.startsWith("/account") ? "account" :
    pathname.startsWith("/scores") ? "scores" : "scores";

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40"
      style={{ background: "#0c0900", borderTop: "1px solid #1a1208" }}>
      <div className="flex max-w-[480px] mx-auto">
        {TABS.map(({ id, label, href, Icon }) => {
          const isActive = activeTab === id;
          return (
            <a key={id} href={href}
              className="flex-1 flex flex-col items-center pt-2.5 pb-3 relative transition-all"
              style={{ opacity: isActive ? 1 : 0.7 }}>
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
                  style={{ background: "#f5a623" }} />
              )}
              <span className="relative" style={{ color: isActive ? "#f5a623" : "#9a7a50" }}>
                <Icon />
                {id === "liga" && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-3 h-3 px-0.5 rounded-full flex items-center justify-center text-[7px] font-black"
                    style={{ background: "#ff4d6d", color: "#0c0900" }}>
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </span>
              <span className="text-[8px] font-black tracking-widest mt-1"
                style={{ color: isActive ? "#f5a623" : "#9a7a50" }}>
                {label}
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
