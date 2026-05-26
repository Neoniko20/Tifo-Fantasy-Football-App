"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/app/components/ui/Spinner";

const STORAGE_KEY = "tifo_last_league_id";

export default function MyTeamRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    // Fast path: localStorage already has a league → go directly
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        router.replace(`/leagues/${stored}/lineup`);
        return;
      }
    } catch {
      // localStorage unavailable
    }

    // Slow path: first-time user → resolve from Supabase
    async function resolve() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/auth"); return; }

      // Fetch teams with league info to pick the most relevant one
      const { data: teams } = await supabase
        .from("teams")
        .select("league_id, total_points, created_at, leagues(status)")
        .eq("user_id", user.id)
        .not("league_id", "is", null);

      if (!teams || teams.length === 0) {
        router.replace("/leagues");
        return;
      }

      // Fetch active gameweeks to find leagues with live action
      const leagueIds = teams.map((t: any) => t.league_id);
      const { data: gameweeks } = await supabase
        .from("liga_gameweeks")
        .select("league_id, status")
        .in("league_id", leagueIds)
        .eq("status", "active");

      const activeLeagueIds = new Set((gameweeks || []).map((g: any) => g.league_id));

      // Sort: active gameweek first, then highest total_points
      const sorted = [...teams].sort((a: any, b: any) => {
        const aActive = activeLeagueIds.has(a.league_id) ? 1 : 0;
        const bActive = activeLeagueIds.has(b.league_id) ? 1 : 0;
        if (bActive !== aActive) return bActive - aActive;
        return (b.total_points ?? 0) - (a.total_points ?? 0);
      });

      const leagueId = sorted[0].league_id;
      try { localStorage.setItem(STORAGE_KEY, leagueId); } catch { /* ok */ }
      router.replace(`/leagues/${leagueId}/lineup`);
    }

    resolve();
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-page)]">
      <Spinner text="Lade Aufstellung..." />
    </main>
  );
}
