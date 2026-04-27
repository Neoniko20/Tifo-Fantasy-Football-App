"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useNotifications } from "./NotificationsProvider";

const STORAGE_KEY = "tifo_last_league_id";

function extractLeagueId(pathname: string): string | null {
  const m = pathname.match(/\/leagues\/([^/]+)/);
  return m ? m[1] : null;
}

// ── Icons ────────────────────────────────────────────────────────────────────

const HomeIcon = ({ active }: { active: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.15 : 0} />
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);

const MyTeamIcon = ({ active }: { active: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.9 : 0}>
    <path d="M12 2C9 2 7 3 6 4L3 7l2 2 1-1v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8l1 1 2-2-3-3c-1-1-3-2-6-2z"/>
  </svg>
);

const MatchdayIcon = ({ active }: { active: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.12 : 0}/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
    <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>
  </svg>
);

const LeaguesIcon = ({ active }: { active: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
    <path d="M4 22h16"/>
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.15 : 0}/>
  </svg>
);

const ProfileIcon = ({ active }: { active: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.15 : 0}/>
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
  </svg>
);

// ── Component ─────────────────────────────────────────────────────────────────

export function BottomNav() {
  const pathname = usePathname();
  const { unreadCount } = useNotifications();

  // Read persisted leagueId from localStorage (client-side only)
  const [storedLeagueId, setStoredLeagueId] = useState<string | null>(null);

  // Persist leagueId from URL → localStorage whenever we're on a league page
  useEffect(() => {
    try {
      const fromUrl = extractLeagueId(pathname);
      if (fromUrl) {
        localStorage.setItem(STORAGE_KEY, fromUrl);
        setStoredLeagueId(fromUrl);
      } else {
        const stored = localStorage.getItem(STORAGE_KEY);
        setStoredLeagueId(stored);
      }
    } catch {
      // localStorage unavailable (e.g. SSR guard)
    }
  }, [pathname]);

  // Resolve the best leagueId: current URL wins, then stored, then null
  const leagueId = extractLeagueId(pathname) ?? storedLeagueId;

  const myTeamHref  = leagueId ? `/leagues/${leagueId}/lineup` : "/leagues";
  const leaguesHref = leagueId ? `/leagues/${leagueId}`         : "/leagues";

  // Active tab detection
  const activeTab =
    pathname === "/"                                                   ? "home"     :
    pathname.includes("/lineup")                                       ? "myteam"   :
    pathname.startsWith("/scores")                                     ? "matchday" :
    pathname.startsWith("/leagues") && !pathname.includes("/lineup")   ? "leagues"  :
    pathname.startsWith("/wm")                                         ? "leagues"  :
    pathname.startsWith("/account")                                    ? "profile"  :
    "home";

  const TABS = [
    { id: "home",     label: "Home",     href: "/",           Icon: HomeIcon },
    { id: "myteam",   label: "My Team",  href: myTeamHref,    Icon: MyTeamIcon },
    { id: "matchday", label: "Matchday", href: "/scores",      Icon: MatchdayIcon },
    {
      id: "leagues",
      label: "Leagues",
      href: leaguesHref,
      Icon: LeaguesIcon,
      badge: unreadCount > 0 ? unreadCount : undefined,
    },
    { id: "profile",  label: "Profile",  href: "/account",    Icon: ProfileIcon },
  ] as const;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40"
      style={{
        background: "var(--bg-page)",
        borderTop: "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)",
        // Ensure BottomNav is always above page content
        boxShadow: "0 -4px 24px color-mix(in srgb, #000 40%, transparent)",
      }}
    >
      <div className="flex max-w-[480px] mx-auto" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {TABS.map(({ id, label, href, Icon, badge }) => {
          const isActive = activeTab === id;
          return (
            <a
              key={id}
              href={href}
              className="flex-1 flex flex-col items-center pt-2.5 pb-3 relative"
              style={{ WebkitTapHighlightColor: "transparent" }}
            >
              {/* Active indicator — top border line */}
              <span
                className="absolute top-0 left-1/2 -translate-x-1/2 rounded-full transition-all duration-200"
                style={{
                  width: isActive ? 24 : 0,
                  height: 2,
                  background: "var(--color-primary)",
                  opacity: isActive ? 1 : 0,
                }}
              />

              {/* Icon */}
              <span
                className="relative transition-all duration-150"
                style={{
                  color: isActive ? "var(--color-primary)" : "var(--color-muted)",
                  transform: isActive ? "scale(1.08) translateY(-1px)" : "scale(1)",
                }}
              >
                <Icon active={isActive} />
                {/* Notification badge */}
                {badge !== undefined && (
                  <span
                    className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] px-[3px] rounded-full flex items-center justify-center text-[7px] font-black"
                    style={{ background: "var(--color-error)", color: "#fff" }}
                  >
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </span>

              {/* Label */}
              <span
                className="text-[8px] font-black tracking-widest mt-1 uppercase"
                style={{ color: isActive ? "var(--color-primary)" : "var(--color-muted)" }}
              >
                {label}
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
