"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { UserBadge } from "@/app/components/UserBadge";
import { BottomNav } from "@/app/components/BottomNav";
import { TifoIcon } from "@/app/components/TifoLogo";
import { useToast } from "@/app/components/ToastProvider";

const LEAGUES = [
  { id: 0, name: "Alle Ligen", flag: "🌍" },
  { id: 78, name: "Bundesliga", flag: "🇩🇪" },
  { id: 39, name: "Premier League", flag: "🏴" },
  { id: 140, name: "La Liga", flag: "🇪🇸" },
  { id: 135, name: "Serie A", flag: "🇮🇹" },
  { id: 61, name: "Ligue 1", flag: "🇫🇷" },
];

const POS_COLOR: Record<string, string> = {
  GK: "#f5a623",
  DF: "#4a9eff",
  MF: "#00ce7d",
  FW: "#ff4d6d",
};

type PlayerStats = {
  goals?: { total?: number; assists?: number; saves?: number };
  games?: { minutes?: number; position?: string; clean_sheet?: boolean };
  passes?: { key?: number; accuracy?: number };
  shots?: { on?: number };
  dribbles?: { attempts?: number };
  tackles?: { total?: number; interceptions?: number };
  cards?: { yellow?: number; red?: number };
  team?: { name?: string; logo?: string };
};

type PlayerItem = {
  player: { id: number; name: string; photo: string; nationality: string; position?: string };
  statistics: PlayerStats | PlayerStats[];
  api_league_id?: number;
  team_name?: string;
};

function normalizePosition(pos: string): string {
  const p = (pos || "").toLowerCase();
  if (p.includes("attack") || p.includes("forward") || p.includes("striker") || p === "fw") return "FW";
  if (p.includes("mid") || p === "mf") return "MF";
  if (p.includes("defend") || p.includes("back") || p === "df") return "DF";
  if (p.includes("goal") || p.includes("keeper") || p === "gk") return "GK";
  return (pos || "").toUpperCase().slice(0, 2);
}

export default function Home() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center text-[9px] font-black uppercase tracking-widest animate-pulse"
        style={{ background: "#0c0900", color: "#2a2010" }}>
        Laden...
      </main>
    }>
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");

  const [scorers, setScorers] = useState<PlayerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [caching, setCaching] = useState(false);
  const [cachingStatus, setCachingStatus] = useState("");
  const [sortBy, setSortBy] = useState("points");
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerItem | null>(null);
  const [positionFilter, setPositionFilter] = useState<"ALL" | "GK" | "DF" | "MF" | "FW">("ALL");
  const [search, setSearch] = useState("");
  const [activeLeague, setActiveLeague] = useState(0);
  const [activeTeam, setActiveTeam] = useState("");
  const [availableTeams, setAvailableTeams] = useState<string[]>([]);
  const [user, setUser] = useState<any>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [mySquad, setMySquad] = useState<PlayerItem[]>([]);
  const [captainId, setCaptainId] = useState<number | null>(null);
  const [savingPlayer, setSavingPlayer] = useState<number | null>(null);
  const { toast } = useToast();

  const activeTab = tabParam === "squad" ? "squad" : "home";

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadOrCreateTeam(data.user.id);
    });
  }, []);

  async function loadOrCreateTeam(userId: string) {
    let { data: team } = await supabase
      .from("teams").select("id").eq("user_id", userId).is("league_id", null).maybeSingle();
    if (!team) {
      const { data: newTeam } = await supabase
        .from("teams").insert({ user_id: userId, name: "Mein Team", league_id: null })
        .select("id").single();
      team = newTeam;
    }
    if (team) { setTeamId(team.id); loadSquad(team.id); }
  }

  async function loadSquad(tId: string) {
    const { data } = await supabase
      .from("squad_players").select("player_id, is_captain").eq("team_id", tId);
    if (!data || data.length === 0) return;
    const playerIds = data.map((d) => d.player_id);
    const captain = data.find((d) => d.is_captain);
    if (captain) setCaptainId(captain.player_id);
    sessionStorage.setItem("squadPlayerIds", JSON.stringify(playerIds));
  }

  async function cachePlayersFromApi() {
    setCaching(true);
    const headers = { "x-apisports-key": process.env.NEXT_PUBLIC_FOOTBALL_API_KEY || "" };
    const endpoints = ["topscorers", "topassists", "topredcards", "topyellowcards"];
    const leagueIds = [78, 39, 140, 135, 61];
    for (const leagueId of leagueIds) {
      for (const endpoint of endpoints) {
        setCachingStatus(`Lade ${endpoint} · Liga ${leagueId}...`);
        try {
          const res = await fetch(
            `https://v3.football.api-sports.io/players/${endpoint}?league=${leagueId}&season=2023`,
            { headers }
          );
          const data = await res.json();
          const players = data.response || [];
          for (const item of players) {
            const stats = Array.isArray(item.statistics) ? item.statistics[0] : item.statistics;
            const goals = stats?.goals?.total || 0;
            const assists = stats?.goals?.assists || 0;
            const minutes = stats?.games?.minutes || 0;
            const shotsOn = stats?.shots?.on || 0;
            const keyPasses = stats?.passes?.key || 0;
            const passAccuracy = stats?.passes?.accuracy || 0;
            const tackles = stats?.tackles?.total || 0;
            const interceptions = stats?.tackles?.interceptions || 0;
            const yellow = stats?.cards?.yellow || 0;
            const red = stats?.cards?.red || 0;
            const saves = stats?.goals?.saves || 0;
            const dribbles = stats?.dribbles?.attempts || 0;
            const position = normalizePosition(stats?.games?.position || "");
            let fpts = goals * 4 + assists * 3 + shotsOn * 0.5 + keyPasses * 0.8;
            fpts += tackles * 0.6 + interceptions * 0.6 + dribbles * 0.2;
            fpts -= yellow * 1 + red * 3;
            if (minutes >= 60) fpts += 1; else if (minutes > 0) fpts += 0.4;
            await supabase.from("players").upsert({
              id: item.player.id, name: item.player.name, position,
              nationality: item.player.nationality, photo_url: item.player.photo,
              team_name: stats?.team?.name || "", api_league_id: leagueId,
              api_team_id: stats?.team?.id || 0, goals, assists, minutes,
              shots_on: shotsOn, key_passes: keyPasses, pass_accuracy: passAccuracy,
              tackles, interceptions, yellow_cards: yellow, red_cards: red,
              saves, dribbles, fpts: Math.round(fpts * 10) / 10,
            }, { onConflict: "id" });
          }
        } catch (e) { console.error(`Fehler ${endpoint} Liga ${leagueId}:`, e); }
      }
    }
    setCaching(false);
    setCachingStatus("");
    await loadFromSupabase();
  }

  async function loadFromSupabase() {
    const { data: dbPlayers } = await supabase
      .from("players").select("*").order("fpts", { ascending: false });
    if (!dbPlayers || dbPlayers.length === 0) return;
    const converted = convertDbPlayers(dbPlayers);
    setScorers(converted);
    restoreSquadFromSession(converted);
  }

  function convertDbPlayers(dbPlayers: any[]): PlayerItem[] {
    return dbPlayers.map(p => ({
      player: {
        id: p.id, name: p.name, photo: p.photo_url,
        nationality: p.nationality, position: normalizePosition(p.position),
      },
      statistics: [{
        games: { position: normalizePosition(p.position), minutes: p.minutes || 0 },
        goals: { total: p.goals || 0, assists: p.assists || 0, saves: p.saves || 0 },
        passes: { key: p.key_passes || 0, accuracy: p.pass_accuracy || 0 },
        shots: { on: p.shots_on || 0 },
        dribbles: { attempts: p.dribbles || 0 },
        tackles: { total: p.tackles || 0, interceptions: p.interceptions || 0 },
        cards: { yellow: p.yellow_cards || 0, red: p.red_cards || 0 },
        team: { name: p.team_name, logo: "" },
      }],
      api_league_id: p.api_league_id,
      team_name: p.team_name,
    }));
  }

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const { data: dbPlayers } = await supabase
          .from("players").select("*").order("fpts", { ascending: false });
        if (dbPlayers && dbPlayers.length > 20 && (dbPlayers[0]?.fpts ?? 0) > 0) {
          const converted = convertDbPlayers(dbPlayers);
          setScorers(converted);
          restoreSquadFromSession(converted);
        } else {
          await cachePlayersFromApi();
        }
      } catch (e) { console.error("Fehler:", e); }
      setLoading(false);
    }
    fetchData();
  }, []);

  useEffect(() => {
    if (activeLeague === 0) { setAvailableTeams([]); setActiveTeam(""); return; }
    const teams = [...new Set(
      scorers.filter(p => p.api_league_id === activeLeague)
        .map(p => p.team_name || "").filter(Boolean)
    )].sort();
    setAvailableTeams(teams);
    setActiveTeam("");
  }, [activeLeague, scorers]);

  function restoreSquadFromSession(allPlayers: PlayerItem[]) {
    const stored = sessionStorage.getItem("squadPlayerIds");
    if (!stored) return;
    const ids: number[] = JSON.parse(stored);
    setMySquad(allPlayers.filter((p) => ids.includes(p.player.id)));
  }

  function calculateDetailedPoints(stats: PlayerStats | PlayerStats[], isCaptain = false) {
    if (!stats) return { season: 0, matchday: 0, bonus: 0, breakdown: {} as any };
    const s = Array.isArray(stats) ? stats[0] : stats;
    const goals = s.goals?.total || 0;
    const assists = s.goals?.assists || 0;
    const minutes = s.games?.minutes || 0;
    const shotsOn = s.shots?.on || 0;
    const keyPasses = s.passes?.key || 0;
    const passAccuracy = s.passes?.accuracy || 0;
    const dribbles = s.dribbles?.attempts || 0;
    const tackles = s.tackles?.total || 0;
    const interceptions = s.tackles?.interceptions || 0;
    const yellow = s.cards?.yellow || 0;
    const red = s.cards?.red || 0;
    const saves = s.goals?.saves || 0;
    const cleanSheets = s.games?.clean_sheet ? 1 : 0;
    const position = normalizePosition(s.games?.position || "");

    let p = 0;
    if (position === "GK") p += goals * 6;
    else if (position === "DF") p += goals * 6;
    else if (position === "MF") p += goals * 5;
    else p += goals * 4;

    p += assists * 3;

    if (position === "GK") { p += saves * 1.5; p += cleanSheets * 4; }
    else if (position === "DF") { p += cleanSheets * 4; }
    else if (position === "MF") { p += cleanSheets * 1; }

    p += shotsOn * 0.5;
    p += keyPasses * 0.8;
    p += (passAccuracy / 100) * 0.5;
    p += dribbles * 0.2;
    p += tackles * 0.6;
    p += interceptions * 0.6;
    p -= yellow * 1;
    p -= red * 3;
    if (minutes >= 60) p += 1; else if (minutes > 0) p += 0.4;

    const seasonTotal = Math.round(p * 10) / 10;
    const matchdayBase = Math.round((seasonTotal / 34) * 1.5 * 10) / 10;
    const bonus = isCaptain ? matchdayBase : 0;
    return {
      season: seasonTotal, matchday: matchdayBase + bonus, bonus,
      breakdown: { goals, assists, minutes, shotsOn, keyPasses, passAccuracy, dribbles, tackles, interceptions, saves, cleanSheets, yellow, red, position }
    };
  }

  async function toggleSquad(playerItem: PlayerItem) {
    if (!teamId) return;
    const exists = mySquad.some((p) => p.player.id === playerItem.player.id);
    setSavingPlayer(playerItem.player.id);
    if (exists) {
      await supabase.from("squad_players").delete().eq("team_id", teamId).eq("player_id", playerItem.player.id);
      setMySquad(mySquad.filter((p) => p.player.id !== playerItem.player.id));
      if (captainId === playerItem.player.id) setCaptainId(null);
    } else {
      if (mySquad.length >= 11) { toast("Roster ist voll (11)", "error"); setSavingPlayer(null); return; }
      const stats = Array.isArray(playerItem.statistics) ? playerItem.statistics[0] : playerItem.statistics;
      await supabase.from("players").upsert({
        id: playerItem.player.id, name: playerItem.player.name,
        position: normalizePosition(stats?.games?.position || playerItem.player.position || ""),
        nationality: playerItem.player.nationality,
        photo_url: playerItem.player.photo, team_name: stats?.team?.name || ""
      }, { onConflict: "id" });
      await supabase.from("squad_players").insert({
        team_id: teamId, player_id: playerItem.player.id, is_captain: false, is_on_bench: false
      });
      setMySquad([...mySquad, playerItem]);
    }
    setSavingPlayer(null);
  }

  async function handleSetCaptain(playerId: number) {
    if (!teamId) return;
    const newCaptainId = playerId === captainId ? null : playerId;
    await supabase.from("squad_players").update({ is_captain: false }).eq("team_id", teamId);
    if (newCaptainId) await supabase.from("squad_players").update({ is_captain: true })
      .eq("team_id", teamId).eq("player_id", newCaptainId);
    setCaptainId(newCaptainId);
  }

  const filteredPlayers = scorers.filter((p) => {
    const stats = Array.isArray(p.statistics) ? p.statistics[0] : p.statistics;
    const pos = normalizePosition(stats?.games?.position || p.player?.position || "");
    if (positionFilter !== "ALL" && pos !== positionFilter) return false;
    if (search && !p.player.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (activeLeague !== 0 && p.api_league_id !== activeLeague) return false;
    if (activeTeam && p.team_name !== activeTeam) return false;
    return true;
  });

  const sortedPlayers = [...filteredPlayers].sort((a, b) => {
    const aStats = Array.isArray(a.statistics) ? a.statistics[0] : a.statistics;
    const bStats = Array.isArray(b.statistics) ? b.statistics[0] : b.statistics;
    if (sortBy === "points") return calculateDetailedPoints(b.statistics).season - calculateDetailedPoints(a.statistics).season;
    if (sortBy === "goals") return (bStats?.goals?.total || 0) - (aStats?.goals?.total || 0);
    if (sortBy === "assists") return (bStats?.goals?.assists || 0) - (aStats?.goals?.assists || 0);
    if (sortBy === "position") return normalizePosition(aStats?.games?.position || "").localeCompare(normalizePosition(bStats?.games?.position || ""));
    return 0;
  });

  const totalSquadPoints = mySquad.reduce((sum, p) => {
    const isCap = p.player.id === captainId;
    const pts = calculateDetailedPoints(p.statistics, isCap);
    return sum + pts.season + pts.bonus;
  }, 0);

  /* ── SQUAD TAB ─────────────────────────────────────── */
  if (activeTab === "squad") {
    return (
      <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "#0c0900" }}>
        {/* Glow */}
        <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ background: "#f5a623" }} />

        <div className="w-full max-w-md flex justify-between items-center mb-6">
          <TifoIcon size={36} />
          <UserBadge />
        </div>

        {/* Hero FPTS */}
        <div className="w-full max-w-md rounded-2xl p-5 mb-6 relative overflow-hidden"
          style={{ background: "#141008", border: "1px solid #f5a623" }}>
          <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
            style={{ background: "#f5a623" }} />
          <p className="text-[9px] font-black uppercase tracking-[0.3em] mb-1" style={{ color: "#5a4020" }}>Tifo — Saison Total</p>
          <p className="text-4xl font-black tracking-tighter" style={{ color: "#f5a623" }}>
            {totalSquadPoints.toFixed(1)}
            <span className="text-xs font-bold ml-2" style={{ color: "#5a4020" }}>FPTS</span>
          </p>
          <p className="text-xs mt-1 font-black" style={{ color: "#5a4020" }}>
            {mySquad.length} / 11 Spieler
            {captainId && " · Kapitän gesetzt"}
          </p>
        </div>

        {mySquad.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-4xl mb-3">👥</p>
            <p className="text-sm font-black" style={{ color: "#5a4020" }}>Kein Kader aufgestellt</p>
            <p className="text-xs mt-1" style={{ color: "#2a2010" }}>Gehe zu HOME und füge Spieler hinzu</p>
          </div>
        ) : (
          <div className="w-full max-w-md space-y-2.5">
            {mySquad.map((item) => {
              const isCap = item.player.id === captainId;
              const pts = calculateDetailedPoints(item.statistics, isCap);
              const stats = Array.isArray(item.statistics) ? item.statistics[0] : item.statistics;
              const pos = normalizePosition(stats?.games?.position || item.player?.position || "");
              const posColor = POS_COLOR[pos] || "#c8b080";
              return (
                <div key={item.player.id}
                  className="flex items-center justify-between p-3 rounded-2xl"
                  style={{ background: "#141008", border: `1px solid ${isCap ? "#f5a623" : "#2a2010"}` }}>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <img src={item.player.photo} className="w-11 h-11 rounded-full"
                        style={{ border: `2px solid ${isCap ? "#f5a623" : "#2a2010"}` }} alt="" />
                      <span className="absolute -bottom-1 -right-1 text-[8px] font-black px-1 rounded-full"
                        style={{ background: posColor, color: "#0c0900" }}>{pos}</span>
                    </div>
                    <div>
                      <p className="font-black text-sm" style={{ color: isCap ? "#f5a623" : "#c8b080" }}>
                        {isCap && <span className="mr-1">©</span>}{item.player.name}
                      </p>
                      <p className="text-[9px] font-black uppercase tracking-widest mt-0.5" style={{ color: "#5a4020" }}>
                        {item.team_name}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end gap-1.5">
                    <p className="text-lg font-black" style={{ color: "#f5a623" }}>{pts.season.toFixed(1)}</p>
                    <div className="flex gap-1">
                      <button onClick={() => handleSetCaptain(item.player.id)}
                        className="px-2 py-1 text-[9px] font-black rounded-lg uppercase transition-colors"
                        style={{ background: isCap ? "#f5a623" : "#2a2010", color: isCap ? "#0c0900" : "#5a4020" }}>
                        Cap
                      </button>
                      <button onClick={() => toggleSquad(item)}
                        className="px-2 py-1 text-[9px] font-black rounded-lg uppercase"
                        style={{ background: "#2a2010", color: "#5a4020" }}>
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <BottomNav />
      </main>
    );
  }

  /* ── HOME TAB ──────────────────────────────────────── */
  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "#0c0900" }}>
      {/* Ambient glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "#f5a623" }} />

      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-center mb-5">
        <TifoIcon size={36} />
        <div className="flex items-center gap-3">
          <button
            onClick={async () => { await supabase.auth.signOut(); window.location.href = "/auth"; }}
            className="text-[9px] font-black uppercase tracking-widest transition-colors"
            style={{ color: "#5a4020" }}>
            Logout
          </button>
          <UserBadge />
        </div>
      </div>

      {/* Hero card */}
      <div className="w-full max-w-md rounded-2xl p-5 mb-5 relative overflow-hidden"
        style={{ background: "#141008", border: "1px solid #f5a623" }}>
        <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ background: "#f5a623" }} />
        <p className="text-[9px] font-black uppercase tracking-[0.3em] mb-1" style={{ color: "#5a4020" }}>Mein Kader · Saison Total</p>
        <div className="flex justify-between items-end">
          <p className="text-4xl font-black tracking-tighter" style={{ color: "#f5a623" }}>
            {totalSquadPoints.toFixed(1)}
            <span className="text-xs font-bold ml-2" style={{ color: "#5a4020" }}>FPTS</span>
          </p>
          <p className="text-xs font-black pb-1" style={{ color: "#5a4020" }}>
            {mySquad.length}<span style={{ color: "#2a2010" }}> / 11</span>
          </p>
        </div>
      </div>

      {/* Caching status */}
      {caching && (
        <div className="w-full max-w-md mb-4 p-3 rounded-xl text-center"
          style={{ background: "#141008", border: "1px solid #2a2010" }}>
          <p className="text-[9px] font-black uppercase tracking-widest animate-pulse" style={{ color: "#f5a623" }}>
            {cachingStatus || "Lade Spieler..."}
          </p>
        </div>
      )}

      {/* League filter pills */}
      <div className="flex gap-2 mb-3 overflow-x-auto w-full max-w-md pb-1 no-scrollbar">
        {LEAGUES.map((l) => (
          <button key={l.id} onClick={() => setActiveLeague(l.id)}
            className="flex-shrink-0 px-3 py-1.5 rounded-full text-[9px] font-black uppercase transition-all"
            style={{
              background: activeLeague === l.id ? "#f5a623" : "#141008",
              color: activeLeague === l.id ? "#0c0900" : "#5a4020",
              border: `1px solid ${activeLeague === l.id ? "#f5a623" : "#2a2010"}`,
            }}>
            {l.flag} {l.name}
          </button>
        ))}
      </div>

      {/* Team filter pills */}
      {activeLeague !== 0 && availableTeams.length > 0 && (
        <div className="flex gap-2 mb-3 overflow-x-auto w-full max-w-md pb-1 no-scrollbar">
          <button onClick={() => setActiveTeam("")}
            className="flex-shrink-0 px-3 py-1.5 rounded-full text-[9px] font-black uppercase transition-all"
            style={{
              background: activeTeam === "" ? "#2a2010" : "#141008",
              color: activeTeam === "" ? "#c8b080" : "#5a4020",
              border: "1px solid #2a2010",
            }}>
            Alle
          </button>
          {availableTeams.map((team) => (
            <button key={team} onClick={() => setActiveTeam(team === activeTeam ? "" : team)}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-[9px] font-black uppercase whitespace-nowrap transition-all"
              style={{
                background: activeTeam === team ? "#2a2010" : "#141008",
                color: activeTeam === team ? "#c8b080" : "#5a4020",
                border: "1px solid #2a2010",
              }}>
              {team}
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="w-full max-w-md mb-3">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Spieler suchen..."
          className="w-full p-3 rounded-xl text-sm focus:outline-none transition-colors"
          style={{ background: "#141008", border: "1px solid #2a2010", color: "#c8b080" }} />
      </div>

      {/* Sort + Position filter */}
      <div className="flex gap-2 w-full max-w-md mb-4">
        <div className="flex-1 flex p-1 rounded-xl gap-0.5" style={{ background: "#141008", border: "1px solid #2a2010" }}>
          {[{ id: "points", label: "FPTS" }, { id: "goals", label: "Tore" }, { id: "assists", label: "Ast" }, { id: "position", label: "Pos" }].map((f) => (
            <button key={f.id} onClick={() => setSortBy(f.id)}
              className="flex-1 py-1.5 text-[9px] font-black rounded-lg transition-colors uppercase"
              style={{
                background: sortBy === f.id ? "#2a2010" : "transparent",
                color: sortBy === f.id ? "#f5a623" : "#5a4020",
              }}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex p-1 rounded-xl gap-0.5" style={{ background: "#141008", border: "1px solid #2a2010" }}>
          {(["ALL", "GK", "DF", "MF", "FW"] as const).map((p) => (
            <button key={p} onClick={() => setPositionFilter(p)}
              className="px-2 py-1.5 text-[9px] font-black rounded-lg transition-colors"
              style={{
                background: positionFilter === p ? (POS_COLOR[p] || "#2a2010") : "transparent",
                color: positionFilter === p ? "#0c0900" : "#5a4020",
              }}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Count line */}
      <div className="w-full max-w-md mb-2">
        <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#2a2010" }}>
          {filteredPlayers.length} Spieler
          {activeLeague !== 0 && ` · ${LEAGUES.find(l => l.id === activeLeague)?.name}`}
          {activeTeam && ` · ${activeTeam}`}
        </p>
      </div>

      {/* Player list */}
      <div className="w-full max-w-md space-y-2">
        {loading ? (
          <div className="text-center py-20 animate-pulse text-[9px] font-black uppercase tracking-widest"
            style={{ color: "#2a2010" }}>Lade Datenbank...</div>
        ) : filteredPlayers.length === 0 ? (
          <div className="text-center py-20 text-sm" style={{ color: "#5a4020" }}>Keine Spieler gefunden.</div>
        ) : (
          sortedPlayers.slice(0, 50).map((item) => {
            const stats = Array.isArray(item.statistics) ? item.statistics[0] : item.statistics;
            const isCap = item.player.id === captainId;
            const pts = calculateDetailedPoints(item.statistics, isCap);
            const isInSquad = mySquad.some((p) => p.player.id === item.player.id);
            const isSaving = savingPlayer === item.player.id;
            const pos = normalizePosition(stats?.games?.position || item.player?.position || "");
            const posColor = POS_COLOR[pos] || "#c8b080";
            return (
              <div key={item.player.id}
                className="flex items-center justify-between p-3 rounded-2xl transition-all"
                style={{
                  background: "#141008",
                  border: `1px solid ${isCap ? "#f5a623" : isInSquad ? "#3a2a10" : "#2a2010"}`,
                }}>
                {/* Left: photo + info */}
                <div className="flex items-center gap-3 flex-1 min-w-0" onClick={() => setSelectedPlayer(item)}>
                  <div className="relative flex-shrink-0">
                    <img src={item.player.photo} className="w-11 h-11 rounded-full"
                      style={{ border: `2px solid ${isCap ? "#f5a623" : "#2a2010"}` }} alt="" />
                    <span className="absolute -bottom-1 -right-1 text-[7px] font-black px-1 rounded-full leading-4"
                      style={{ background: posColor, color: "#0c0900" }}>{pos}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-black text-sm truncate" style={{ color: isCap ? "#f5a623" : "#c8b080" }}>
                      {isCap && "© "}{item.player.name}
                    </p>
                    <p className="text-[9px] font-black uppercase tracking-widest truncate mt-0.5" style={{ color: "#5a4020" }}>
                      {item.team_name || stats?.team?.name}
                    </p>
                    <div className="flex gap-2 mt-1.5 text-[10px]" style={{ color: "#5a4020" }}>
                      <span>G <span style={{ color: "#c8b080" }}>{pts.breakdown.goals}</span></span>
                      <span>A <span style={{ color: "#c8b080" }}>{pts.breakdown.assists}</span></span>
                      <span>KP <span style={{ color: "#c8b080" }}>{pts.breakdown.keyPasses}</span></span>
                      <span>S <span style={{ color: "#c8b080" }}>{pts.breakdown.shotsOn}</span></span>
                    </div>
                  </div>
                </div>
                {/* Right: pts + buttons */}
                <div className="flex flex-col items-end gap-1.5 ml-2 flex-shrink-0">
                  <p className="text-lg font-black leading-none" style={{ color: "#f5a623" }}>
                    {pts.season.toFixed(1)}
                  </p>
                  <div className="flex gap-1">
                    <button onClick={() => toggleSquad(item)} disabled={isSaving}
                      className="px-2 py-1 text-[9px] font-black rounded-lg uppercase disabled:opacity-50 transition-colors"
                      style={{
                        background: isInSquad ? "#3a1010" : "#2a2010",
                        color: isInSquad ? "#ff4d6d" : "#5a4020",
                      }}>
                      {isSaving ? "…" : isInSquad ? "−" : "+"}
                    </button>
                    <button onClick={() => handleSetCaptain(item.player.id)}
                      className="px-2 py-1 text-[9px] font-black rounded-lg uppercase transition-colors"
                      style={{
                        background: isCap ? "#f5a623" : "#2a2010",
                        color: isCap ? "#0c0900" : "#5a4020",
                      }}>
                      C
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Player detail modal */}
      {selectedPlayer && (
        <div className="fixed inset-0 flex items-end md:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", zIndex: 50 }}
          onClick={() => setSelectedPlayer(null)}>
          <div className="w-full max-w-sm rounded-2xl p-5"
            style={{ background: "#141008", border: "1px solid #2a2010" }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <img src={selectedPlayer.player.photo} className="w-14 h-14 rounded-full"
                style={{ border: "2px solid #2a2010" }} alt="" />
              <div className="flex-1 min-w-0">
                <p className="font-black text-base truncate" style={{ color: "#c8b080" }}>{selectedPlayer.player.name}</p>
                <p className="text-[9px] font-black uppercase tracking-widest mt-0.5" style={{ color: "#5a4020" }}>
                  {selectedPlayer.team_name}
                </p>
              </div>
              <button onClick={() => setSelectedPlayer(null)}
                className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
                ✕
              </button>
            </div>

            {/* Stats grid */}
            {(() => {
              const pts = calculateDetailedPoints(selectedPlayer.statistics);
              const b = pts.breakdown;
              const posLabel = b.position === "GK" ? "TW" : b.position === "DF" ? "VER" : b.position === "MF" ? "MF" : "ST";
              const goalPts = b.position === "GK" || b.position === "DF" ? 6 : b.position === "MF" ? 5 : 4;
              const posColor = POS_COLOR[b.position] || "#c8b080";
              return (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
                      style={{ background: posColor, color: "#0c0900" }}>{posLabel}</span>
                    <span className="text-[9px] font-black" style={{ color: "#5a4020" }}>{goalPts} Pkt/Tor</span>
                    <span className="ml-auto text-2xl font-black" style={{ color: "#f5a623" }}>{pts.season.toFixed(1)}</span>
                    <span className="text-[9px] font-black" style={{ color: "#5a4020" }}>FPTS</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      ["Tore / Assists", `${b.goals} / ${b.assists}`],
                      ["Minuten", b.minutes],
                      ["Shots on", b.shotsOn],
                      ["Key Passes", b.keyPasses],
                      ["Passquote", `${b.passAccuracy}%`],
                      ["Dribbles", b.dribbles],
                      ["Tackles / Int", `${b.tackles} / ${b.interceptions}`],
                      ["Karten", `Y: ${b.yellow} · R: ${b.red}`],
                      ["Saves", b.saves],
                      ["Clean Sheets", b.cleanSheets],
                    ].map(([label, val]) => (
                      <div key={label as string} className="p-2 rounded-xl"
                        style={{ background: "#0c0900", border: "1px solid #2a2010" }}>
                        <p className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: "#5a4020" }}>{label}</p>
                        <p className="font-black" style={{ color: "#c8b080" }}>{val}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button onClick={() => { toggleSquad(selectedPlayer); setSelectedPlayer(null); }}
                      className="flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
                      style={{ background: mySquad.some(p => p.player.id === selectedPlayer.player.id) ? "#3a1010" : "#2a2010",
                               color: mySquad.some(p => p.player.id === selectedPlayer.player.id) ? "#ff4d6d" : "#c8b080" }}>
                      {mySquad.some(p => p.player.id === selectedPlayer.player.id) ? "Entfernen" : "Hinzufügen"}
                    </button>
                    <button onClick={() => { handleSetCaptain(selectedPlayer.player.id); setSelectedPlayer(null); }}
                      className="flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest"
                      style={{ background: "#f5a623", color: "#0c0900" }}>
                      Kapitän
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
