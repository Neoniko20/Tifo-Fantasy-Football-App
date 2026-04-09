"use client";

import { usePathname } from "next/navigation";

interface Props {
  leagueId: string;
  leagueName?: string;
  leagueStatus?: string;
  isOwner?: boolean;
}

export function LeagueTopNav({ leagueId, leagueName, leagueStatus, isOwner }: Props) {
  const pathname = usePathname();

  const isDraft = leagueStatus === "drafting";

  const TABS = [
    {
      id: "spieltag",
      label: isDraft ? "Draft" : "Spieltag",
      href: isDraft
        ? `/leagues/${leagueId}/draft`
        : `/leagues/${leagueId}`,
      active:
        pathname === `/leagues/${leagueId}` ||
        pathname === `/leagues/${leagueId}/draft`,
    },
    {
      id: "team",
      label: "Team",
      href: `/leagues/${leagueId}/lineup`,
      active: pathname.startsWith(`/leagues/${leagueId}/lineup`),
    },
    {
      id: "spieler",
      label: "Spieler",
      href: `/leagues/${leagueId}/players`,
      active:
        pathname.startsWith(`/leagues/${leagueId}/players`) &&
        !pathname.match(/\/players\/\d+/), // not the player detail page
    },
    {
      id: "liga",
      label: "Liga",
      href: `/leagues/${leagueId}/liga`,
      active: pathname.startsWith(`/leagues/${leagueId}/liga`),
    },
  ];

  return (
    <div className="fixed top-0 left-0 right-0 z-50"
      style={{ background: "#0c0900", borderBottom: "1px solid #1a1208" }}>
      <div className="max-w-[480px] mx-auto">
        {/* Sub-header: League name + Admin link */}
        <div className="flex items-center justify-between px-4 pt-2 pb-0">
          <a href="/leagues"
            className="text-[8px] font-black uppercase tracking-widest flex items-center gap-1"
            style={{ color: "#3a2a10" }}>
            ‹ Ligen
          </a>
          <p className="text-[9px] font-black uppercase tracking-widest truncate mx-2"
            style={{ color: "#5a4020" }}>
            {leagueName || "…"}
          </p>
          {isOwner ? (
            <a href={`/leagues/${leagueId}/admin`}
              className="text-[8px] font-black uppercase tracking-widest"
              style={{ color: "#3a2a10" }}>
              Admin
            </a>
          ) : <div style={{ minWidth: 36 }} />}
        </div>

        {/* Tab row */}
        <div className="flex">
          {TABS.map(tab => (
            <a key={tab.id} href={tab.href}
              className="flex-1 py-2.5 text-center text-[10px] font-black uppercase tracking-widest transition-all"
              style={{
                color: tab.active ? "#f5a623" : "#5a4020",
                borderBottom: `2px solid ${tab.active ? "#f5a623" : "transparent"}`,
              }}>
              {tab.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
