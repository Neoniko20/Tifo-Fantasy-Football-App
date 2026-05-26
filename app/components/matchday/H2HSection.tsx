"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { liveStateOf } from "@/lib/fixture-status";
import { H2HMatchupView } from "./H2HMatchupView";
import type { H2HMatchup, H2HPlayer } from "./H2HMatchupView";
import { Spinner } from "@/app/components/ui/Spinner";

interface Props {
  leagueId: string;
}

type FixtureMap = Record<number, { short: string; kickoff: string }>;

// ─── Demo data ────────────────────────────────────────────────────────────────
// Shown when real data has 0 players on both sides (GW not started / no lineup set)
// 3-4-3 vs 4-4-2 to verify formation-independent rendering

const D1 = "2026-05-04T18:45:00.000Z";
const D2 = "2026-05-04T20:30:00.000Z";

const DEMO_MATCHUP: H2HMatchup = {
  homeTeam: { id: "demo-home", name: "FC Turbo" },
  awayTeam: { id: "demo-away", name: "Die Adler" },
  homePoints: 74.0,
  awayPoints: 51.0,
  projectedHomePoints: 84.0,
  projectedAwayPoints: 65.0,
  // 3-4-3 — GK → DEF × 3 → MID × 4 → FWD × 3
  homePlayers: [
    { id: "d1",  name: "M. ter Stegen",  position: "GK",  teamName: "", points: 6,  isCaptain: false, status: "finished" },
    { id: "d2",  name: "A. Rüdiger",     position: "DEF", teamName: "", points: 8,  isCaptain: false, status: "finished" },
    { id: "d3",  name: "W. Saliba",      position: "DEF", teamName: "", points: 4,  isCaptain: false, status: "live" },
    { id: "d4",  name: "N. Süle",        position: "DEF", teamName: "", points: 6,  isCaptain: false, status: "finished" },
    { id: "d5",  name: "J. Bellingham",  position: "MID", teamName: "", points: 12, isCaptain: true,  status: "finished" },
    { id: "d6",  name: "J. Brandt",      position: "MID", teamName: "", points: 8,  isCaptain: false, isViceCaptain: true, status: "live" },
    { id: "d7",  name: "K. De Bruyne",   position: "MID", teamName: "", points: 0,  isCaptain: false, status: "upcoming", kickoff: D1 },
    { id: "d8",  name: "T. Müller",      position: "MID", teamName: "", points: 7,  isCaptain: false, status: "finished" },
    { id: "d9",  name: "H. Kane",        position: "FWD", teamName: "", points: 6,  isCaptain: false, status: "live" },
    { id: "d10", name: "L. Wirtz",       position: "FWD", teamName: "", points: 0,  isCaptain: false, status: "upcoming", kickoff: D1 },
    { id: "d11", name: "R. Lukaku",      position: "FWD", teamName: "", points: 5,  isCaptain: false, status: "finished" },
  ],
  homeBench: [
    { id: "db1", name: "R. Lewandowski", position: "FWD", teamName: "", points: 3, isCaptain: false, status: "finished" },
    { id: "db2", name: "M. Acerbi",      position: "DEF", teamName: "", points: 0, isCaptain: false, status: "upcoming", kickoff: D2 },
  ],
  // 4-4-2 — GK → DEF × 4 → MID × 4 → FWD × 2
  awayPlayers: [
    { id: "d12", name: "M. Flekken",         position: "GK",  teamName: "", points: 4, isCaptain: false, status: "finished" },
    { id: "d13", name: "J. Timber",          position: "DEF", teamName: "", points: 9, isCaptain: false, status: "finished" },
    { id: "d14", name: "T. Alexander-Arnold",position: "DEF", teamName: "", points: 7, isCaptain: false, status: "finished" },
    { id: "d15", name: "K. Hakverdi",        position: "DEF", teamName: "", points: 3, isCaptain: false, status: "live" },
    { id: "d16", name: "T. Hernández",       position: "DEF", teamName: "", points: 0, isCaptain: false, status: "upcoming", kickoff: D1 },
    { id: "d17", name: "B. Fernandes",       position: "MID", teamName: "", points: 7, isCaptain: false, isViceCaptain: true, status: "live" },
    { id: "d18", name: "L. Musiala",         position: "MID", teamName: "", points: 0, isCaptain: false, status: "upcoming", kickoff: D1 },
    { id: "d19", name: "J. Ramsey",          position: "MID", teamName: "", points: 5, isCaptain: false, status: "finished" },
    { id: "d20", name: "P. Dybala",          position: "MID", teamName: "", points: 0, isCaptain: false, status: "upcoming", kickoff: D2 },
    { id: "d21", name: "O. Giroud",          position: "FWD", teamName: "", points: 8, isCaptain: true,  status: "finished" },
    { id: "d22", name: "M. Depay",           position: "FWD", teamName: "", points: 0, isCaptain: false, status: "upcoming", kickoff: D2 },
  ],
  awayBench: [
    { id: "db3", name: "A. Kramarić",   position: "FWD", teamName: "", points: 2, isCaptain: false, status: "finished" },
    { id: "db4", name: "M. Ødegaard",   position: "MID", teamName: "", points: 0, isCaptain: false, status: "upcoming", kickoff: D2 },
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toStatus(fixtureShort: string | null | undefined): H2HPlayer["status"] {
  const s = liveStateOf(fixtureShort);
  return s === "abnormal" ? "finished" : s;
}

async function loadRoster(
  teamId: string,
  leagueId: string,
  gameweek: number,
  fixtureMap: FixtureMap,
): Promise<H2HPlayer[]> {
  const { data: lineup } = await supabase
    .from("liga_lineups")
    .select("starting_xi, captain_id, vice_captain_id")
    .eq("team_id", teamId)
    .eq("gameweek", gameweek)
    .maybeSingle();

  const playerIds: number[] = lineup?.starting_xi ?? [];
  const captainId: number | null = lineup?.captain_id ?? null;
  const viceCaptainId: number | null = lineup?.vice_captain_id ?? null;
  if (playerIds.length === 0) return [];

  const idOrder = new Map(playerIds.map((id, i) => [id, i]));

  const [{ data: players }, { data: pts }] = await Promise.all([
    supabase.from("players").select("id, name, position, api_team_id").in("id", playerIds),
    supabase
      .from("liga_gameweek_points")
      .select("player_id, points, minutes")
      .eq("league_id", leagueId)
      .eq("gameweek", gameweek)
      .in("player_id", playerIds),
  ]);

  const ptsMap     = new Map((pts ?? []).map((p: any) => [p.player_id, Number(p.points ?? 0)]));
  const minutesMap = new Map((pts ?? []).map((p: any) => [p.player_id, Number(p.minutes ?? 0)]));

  return (players ?? [])
    .sort((a: any, b: any) => (idOrder.get(a.id) ?? 99) - (idOrder.get(b.id) ?? 99))
    .map((p: any): H2HPlayer => {
      const fix    = p.api_team_id != null ? fixtureMap[p.api_team_id] : undefined;
      const status = toStatus(fix?.short);
      return {
        id: p.id,
        name: p.name,
        position: p.position,
        teamName: "",
        points:  ptsMap.get(p.id) ?? 0,
        minutes: minutesMap.get(p.id) ?? 0,
        isCaptain:     p.id === captainId,
        isViceCaptain: p.id === viceCaptainId,
        status,
        kickoff: status === "upcoming" ? fix?.kickoff : undefined,
      };
    });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function H2HSection({ leagueId }: Props) {
  const [matchup, setMatchup] = useState<H2HMatchup | null>(null);
  const [isDemo, setIsDemo]   = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) { useDemoFallback(); return; }

        const { data: gwRows } = await supabase
          .from("liga_gameweeks")
          .select("gameweek, status")
          .eq("league_id", leagueId)
          .order("gameweek", { ascending: true });

        const active =
          (gwRows ?? []).find((g: any) => g.status === "active") ??
          (gwRows ?? []).find((g: any) => g.status === "finished") ??
          (gwRows ?? [])[0];

        if (!active || cancelled) { useDemoFallback(); return; }
        const gw: number = active.gameweek;

        const { data: matchups } = await supabase
          .from("liga_matchups")
          .select("id, home_team_id, away_team_id, home:home_team_id(name, user_id), away:away_team_id(name, user_id)")
          .eq("league_id", leagueId)
          .eq("gameweek", gw);

        const mu = (matchups ?? []).find(
          (m: any) => m.home?.user_id === user.id || m.away?.user_id === user.id
        );

        if (!mu || cancelled) { useDemoFallback(); return; }

        // Fixture map
        const fixtureMap: FixtureMap = {};
        try {
          const res  = await fetch(`/api/fixtures?leagueId=${leagueId}&gameweek=${gw}`, { cache: "no-store" });
          const json = await res.json();
          for (const f of (json?.fixtures ?? [])) {
            const short   = f?.fixture?.status?.short ?? "NS";
            const kickoff = f?.fixture?.date ?? "";
            const hId = f?.teams?.home?.id;
            const aId = f?.teams?.away?.id;
            if (hId) fixtureMap[hId] = { short, kickoff };
            if (aId) fixtureMap[aId] = { short, kickoff };
          }
        } catch { /* optional */ }

        if (cancelled) return;

        const [homePlayers, awayPlayers, { data: ligaSettings }] = await Promise.all([
          loadRoster(mu.home_team_id, leagueId, gw, fixtureMap),
          loadRoster(mu.away_team_id, leagueId, gw, fixtureMap),
          supabase.from("liga_settings").select("scoring_rules").eq("league_id", leagueId).maybeSingle(),
        ]);

        if (cancelled) return;

        const sr = (ligaSettings?.scoring_rules as any) ?? {};
        const captainMultiplier: number  = sr.captain_multiplier       ?? 2;
        const viceMode: "backup" | "bonus" = sr.vice_mode              ?? "backup";
        const viceCaptainMultiplier: number = sr.vice_captain_multiplier ?? 1;

        const sumTeam = (ps: H2HPlayer[]) => {
          const capMinutes = ps.find(p => p.isCaptain)?.minutes ?? 90;
          return ps.reduce((s, p) => {
            if (p.isCaptain) return s + p.points * captainMultiplier;
            if (p.isViceCaptain) {
              if (viceMode === "bonus") return s + p.points * viceCaptainMultiplier;
              if (capMinutes === 0)     return s + p.points * captainMultiplier;
            }
            return s + p.points;
          }, 0);
        };
        // keep old name for the non-vice simple sum (used below)
        const sum = sumTeam;

        const homePoints = sum(homePlayers);
        const awayPoints = sum(awayPlayers);

        // Show demo when:
        // - neither team has a lineup, OR
        // - opponent has no lineup (bot/empty), OR
        // - both teams have 0 pts (GW not yet started)
        const noUsefulData =
          (homePlayers.length === 0 && awayPlayers.length === 0) ||
          awayPlayers.length === 0 ||
          (homePoints === 0 && awayPoints === 0);

        if (noUsefulData) {
          useDemoFallback();
          return;
        }

        setMatchup({
          homeTeam: { id: mu.home_team_id, name: (mu as any).home?.name ?? "Home" },
          awayTeam: { id: mu.away_team_id, name: (mu as any).away?.name ?? "Away" },
          homePlayers,
          awayPlayers,
          homePoints,
          awayPoints,
          captainMultiplier,
          viceMode,
          viceCaptainMultiplier,
        });
        setIsDemo(false);
      } catch {
        if (!cancelled) useDemoFallback();
      } finally {
        if (!cancelled) setLoading(false);
      }

      function useDemoFallback() {
        if (!cancelled) {
          setMatchup(DEMO_MATCHUP);
          setIsDemo(true);
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [leagueId]);

  if (loading) return (
    <div className="flex justify-center items-center py-10">
      <Spinner text="Lade Duell..." />
    </div>
  );

  if (!matchup) return null;

  return <H2HMatchupView matchup={matchup} isDemoMode={isDemo} />;
}
