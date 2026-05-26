"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/app/components/ui/Spinner";
import { EmptyState } from "@/app/components/ui/EmptyState";
import { BottomNav } from "@/app/components/BottomNav";

type WMLeagueCard = {
  leagueId:    string;
  leagueName:  string;
  leagueStatus: string;
  isOwner:     boolean;
  teamId:      string;
  teamName:    string;
  teamCount:   number;
  maxTeams:    number;
  gwNumber:    number | null;
  gwStatus:    string | null;
  gwPhase:     string | null;
};

const GW_STATUS_LABEL: Record<string, string> = {
  upcoming: "Bald",
  active:   "Läuft",
  finished: "Beendet",
};

const GW_STATUS_COLOR: Record<string, string> = {
  upcoming: "var(--color-muted)",
  active:   "var(--color-primary)",
  finished: "var(--color-success)",
};

const LEAGUE_STATUS_LABEL: Record<string, string> = {
  setup:   "Setup",
  draft:   "Draft",
  active:  "Aktiv",
  finished:"Beendet",
};

export default function WMRootPage() {
  const [user, setUser]       = useState<any>(null);
  const [cards, setCards]     = useState<WMLeagueCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadWMLeagues(data.user.id);
    });
  }, []);

  async function loadWMLeagues(userId: string) {
    // ── 1. Alle Teams des Users ──────────────────────────────────────
    const { data: teamRows } = await supabase
      .from("teams")
      .select("id, name, league_id")
      .eq("user_id", userId);

    if (!teamRows || teamRows.length === 0) { setLoading(false); return; }

    const leagueIds = teamRows.map(t => t.league_id);

    // ── 2. WM-Settings als primärer Diskriminator ────────────────────
    // wm_league_settings existiert ausschließlich für WM-Ligen.
    // Fallback gegenüber leagues.mode, falls mode-Migration noch nicht
    // auf allen Ligen-Rows gelaufen ist.
    const { data: settingsRows } = await supabase
      .from("wm_league_settings")
      .select("league_id, tournament_id")
      .in("league_id", leagueIds);

    if (!settingsRows || settingsRows.length === 0) { setLoading(false); return; }

    const wmLeagueIds = settingsRows.map(s => s.league_id);

    // ── 3. Liga-Metadaten laden ──────────────────────────────────────
    const { data: leagueRows } = await supabase
      .from("leagues")
      .select("id, name, status, owner_id, max_teams")
      .in("id", wmLeagueIds);

    if (!leagueRows || leagueRows.length === 0) { setLoading(false); return; }

    // ── 4. Team-Anzahl pro Liga ──────────────────────────────────────
    const { data: allTeams } = await supabase
      .from("teams")
      .select("league_id")
      .in("league_id", wmLeagueIds);

    const teamCountMap: Record<string, number> = {};
    for (const t of (allTeams || [])) {
      teamCountMap[t.league_id] = (teamCountMap[t.league_id] ?? 0) + 1;
    }

    // settingsRows already loaded above — reuse for tournament mapping

    const tournamentByLeague: Record<string, string> = {};
    const tournamentIds: string[] = [];
    for (const s of (settingsRows || [])) {
      if (s.tournament_id) {
        tournamentByLeague[s.league_id] = s.tournament_id;
        tournamentIds.push(s.tournament_id);
      }
    }

    // ── 5. Aktiver/nächster Gameweek pro Tournament ──────────────────
    const gwByTournament: Record<string, { gameweek: number; status: string; phase: string }> = {};
    if (tournamentIds.length > 0) {
      const { data: gwRows } = await supabase
        .from("wm_gameweeks")
        .select("tournament_id, gameweek, status, phase")
        .in("tournament_id", tournamentIds)
        .in("status", ["active", "upcoming"])
        .order("gameweek");

      for (const gw of (gwRows || [])) {
        // Aktiver GW hat Priorität über upcoming
        const existing = gwByTournament[gw.tournament_id];
        if (!existing || gw.status === "active") {
          gwByTournament[gw.tournament_id] = { gameweek: gw.gameweek, status: gw.status, phase: gw.phase };
        }
      }

      // Falls kein upcoming/active → letzten finished GW laden
      const missingTournaments = tournamentIds.filter(tid => !gwByTournament[tid]);
      if (missingTournaments.length > 0) {
        const { data: lastGWs } = await supabase
          .from("wm_gameweeks")
          .select("tournament_id, gameweek, status, phase")
          .in("tournament_id", missingTournaments)
          .eq("status", "finished")
          .order("gameweek", { ascending: false })
          .limit(missingTournaments.length);

        const seenFinished = new Set<string>();
        for (const gw of (lastGWs || [])) {
          if (!seenFinished.has(gw.tournament_id)) {
            seenFinished.add(gw.tournament_id);
            gwByTournament[gw.tournament_id] = { gameweek: gw.gameweek, status: gw.status, phase: gw.phase };
          }
        }
      }
    }

    // ── 6. Cards zusammenbauen ───────────────────────────────────────
    const result: WMLeagueCard[] = leagueRows.map(league => {
      const myTeam = teamRows.find(t => t.league_id === league.id);
      const tid = tournamentByLeague[league.id];
      const gw  = tid ? gwByTournament[tid] : undefined;

      return {
        leagueId:     league.id,
        leagueName:   league.name,
        leagueStatus: league.status,
        isOwner:      league.owner_id === userId,
        teamId:       myTeam?.id     ?? "",
        teamName:     myTeam?.name   ?? "Mein Team",
        teamCount:    teamCountMap[league.id] ?? 0,
        maxTeams:     league.max_teams,
        gwNumber:     gw?.gameweek   ?? null,
        gwStatus:     gw?.status     ?? null,
        gwPhase:      gw?.phase      ?? null,
      };
    });

    setCards(result);
    setLoading(false);
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <Spinner text="Lade WM-Ligen..." />
    </main>
  );

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "var(--bg-page)" }}>
      {/* Atmospheric glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-72 h-40 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "var(--color-primary)" }} />

      {/* Header */}
      <div className="w-full max-w-md mb-6">
        <div className="flex items-center justify-between mb-1">
          <button onClick={() => window.location.href = "/leagues"}
            className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            ← Ligen
          </button>
          {user && (
            <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
              style={{ background: "color-mix(in srgb, var(--color-primary) 10%, var(--bg-page))", border: "1px solid var(--color-primary)40", color: "var(--color-primary)" }}>
              🏆 WM 2026
            </span>
          )}
        </div>
        <h1 className="text-2xl font-black" style={{ color: "var(--color-text)" }}>Meine WM-Ligen</h1>
        <p className="text-[10px] mt-0.5" style={{ color: "var(--color-muted)" }}>Turnier · Fantasy · Draft</p>
      </div>

      {/* Liga-Karten */}
      {cards.length === 0 ? (
        <div className="w-full max-w-md">
          <EmptyState
            icon="🏆"
            title="Noch keine WM-Liga"
            description="Erstelle eine WM-Turnier-Liga oder tritt einer bestehenden bei."
          />
          <button onClick={() => window.location.href = "/leagues"}
            className="w-full mt-4 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest"
            style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
            Liga erstellen oder beitreten →
          </button>
        </div>
      ) : (
        <div className="w-full max-w-md space-y-4">
          {cards.map(card => (
            <WMLeagueCardItem key={card.leagueId} card={card} />
          ))}

          <button onClick={() => window.location.href = "/leagues"}
            className="w-full py-3 rounded-xl text-[9px] font-black uppercase tracking-widest"
            style={{ background: "var(--bg-card)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
            + Weitere Liga erstellen oder beitreten
          </button>
        </div>
      )}

      <BottomNav />
    </main>
  );
}

// ── Liga-Karte ─────────────────────────────────────────────────────────────────

function WMLeagueCardItem({ card }: { card: WMLeagueCard }) {
  const gwColor   = card.gwStatus ? GW_STATUS_COLOR[card.gwStatus]   ?? "var(--color-muted)" : "var(--color-border)";
  const gwLabel   = card.gwStatus ? GW_STATUS_LABEL[card.gwStatus]   ?? card.gwStatus         : null;
  const lstLabel  = LEAGUE_STATUS_LABEL[card.leagueStatus] ?? card.leagueStatus;
  const isDraft   = card.leagueStatus === "draft" || card.leagueStatus === "setup";
  const isActive  = card.leagueStatus === "active";

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>

      {/* Top accent bar */}
      <div className="h-0.5 w-full" style={{ background: `linear-gradient(90deg, var(--color-primary), transparent)` }} />

      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-black text-base truncate" style={{ color: "var(--color-text)" }}>{card.leagueName}</h3>
            <p className="text-[9px] mt-0.5 truncate" style={{ color: "var(--color-muted)" }}>
              {card.teamName}
              {card.isOwner && <span style={{ color: "var(--color-primary)" }}> · Owner</span>}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 ml-3 flex-shrink-0">
            <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full"
              style={{
                background: isActive
                  ? "color-mix(in srgb, var(--color-primary) 12%, var(--bg-page))"
                  : "var(--bg-page)",
                border: `1px solid ${isActive ? "var(--color-primary)" : "var(--color-border)"}`,
                color: isActive ? "var(--color-primary)" : "var(--color-muted)",
              }}>
              {lstLabel}
            </span>
            <span className="text-[8px]" style={{ color: "var(--color-border)" }}>
              {card.teamCount}/{card.maxTeams} Teams
            </span>
          </div>
        </div>

        {/* GW Status pill */}
        {card.gwNumber !== null && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl"
            style={{ background: "var(--bg-page)", border: `1px solid ${gwColor}20` }}>
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: gwColor }} />
            <p className="text-[9px] font-black" style={{ color: "var(--color-text)" }}>
              GW {card.gwNumber}
            </p>
            {gwLabel && (
              <span className="text-[8px] font-black px-1.5 py-0.5 rounded-sm"
                style={{ background: `${gwColor}18`, color: gwColor }}>
                {gwLabel}
              </span>
            )}
            {card.gwPhase && (
              <span className="text-[8px] ml-auto" style={{ color: "var(--color-border)" }}>
                {card.gwPhase}
              </span>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => window.location.href = `/wm/${card.leagueId}`}
            className="col-span-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
            Öffnen →
          </button>

          {isDraft && (
            <button
              onClick={() => window.location.href = `/wm/${card.leagueId}/draft`}
              className="py-2 rounded-xl text-[9px] font-black uppercase tracking-wider"
              style={{ background: "color-mix(in srgb, var(--color-primary) 12%, var(--bg-page))", color: "var(--color-primary)", border: "1px solid var(--color-primary)30" }}>
              Draft
            </button>
          )}

          {isActive && (
            <button
              onClick={() => window.location.href = `/wm/${card.leagueId}/lineup`}
              className="py-2 rounded-xl text-[9px] font-black uppercase tracking-wider"
              style={{ background: "color-mix(in srgb, var(--color-success) 12%, var(--bg-page))", color: "var(--color-success)", border: "1px solid var(--color-success)30" }}>
              Lineup
            </button>
          )}

          {isActive && (
            <button
              onClick={() => window.location.href = `/wm/${card.leagueId}/waiver`}
              className="py-2 rounded-xl text-[9px] font-black uppercase tracking-wider"
              style={{ background: "color-mix(in srgb, var(--color-info) 12%, var(--bg-page))", color: "var(--color-info)", border: "1px solid var(--color-info)30" }}>
              Waiver
            </button>
          )}

          {!isDraft && !isActive && (
            <>
              <button
                onClick={() => window.location.href = `/wm/${card.leagueId}/lineup`}
                className="py-2 rounded-xl text-[9px] font-black uppercase tracking-wider"
                style={{ background: "var(--bg-page)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                Lineup
              </button>
              <button
                onClick={() => window.location.href = `/wm/${card.leagueId}/waiver`}
                className="py-2 rounded-xl text-[9px] font-black uppercase tracking-wider"
                style={{ background: "var(--bg-page)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                Waiver
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
