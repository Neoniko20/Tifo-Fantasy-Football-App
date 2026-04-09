"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { BottomNav } from "@/app/components/BottomNav";
import { TransactionsFeed } from "@/app/components/TransactionsFeed";

const POS_COLOR: Record<string, string> = {
  GK: "#f5a623",
  DF: "#4a9eff",
  MF: "#00ce7d",
  FW: "#ff4d6d",
};

type Player = {
  id: number;
  name: string;
  photo_url: string;
  position: string;
  team_name: string;
  fpts: number;
};

export default function TransfersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [user, setUser] = useState<any>(null);
  const [league, setLeague] = useState<any>(null);
  const [myTeam, setMyTeam] = useState<any>(null);
  const [mySquad, setMySquad] = useState<Player[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [takenPlayerIds, setTakenPlayerIds] = useState<Set<number>>(new Set());
  const [playerOut, setPlayerOut] = useState<Player | null>(null);
  const [playerIn, setPlayerIn] = useState<Player | null>(null);
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"meine" | "feed" | "verlauf">("meine");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
    });
  }, []);

  async function loadAll(userId: string) {
    const { data: leagueData } = await supabase
      .from("leagues").select("*").eq("id", leagueId).single();
    setLeague(leagueData);

    const { data: teamData } = await supabase
      .from("teams").select("*").eq("league_id", leagueId).eq("user_id", userId).single();
    setMyTeam(teamData);

    if (teamData) {
      // My squad via draft_picks
      const { data: picks } = await supabase
        .from("draft_picks")
        .select("player_id, players(id, name, photo_url, position, team_name, fpts)")
        .eq("team_id", teamData.id)
        .order("pick_number");
      setMySquad((picks || []).map((p: any) => p.players).filter(Boolean));

      // All taken player IDs in this league
      // Note: draft_picks has no league_id — filter via team_id of all teams in the league
      const { data: allTeams } = await supabase
        .from("teams").select("id").eq("league_id", leagueId);
      const allTeamIds = (allTeams || []).map((t: any) => t.id);
      const { data: allPicks } = await supabase
        .from("draft_picks")
        .select("player_id")
        .in("team_id", allTeamIds);
      const { data: allSquadRows } = await supabase
        .from("squad_players").select("player_id").in("team_id", allTeamIds);
      const takenIds = new Set([
        ...(allPicks || []).map((p: any) => p.player_id),
        ...(allSquadRows || []).map((p: any) => p.player_id),
      ]);
      setTakenPlayerIds(takenIds);

    }

    // Load free agents (search handled on demand)
    setLoading(false);
  }

  const searchPlayers = useCallback(async (q: string, pos: string) => {
    if (q.length < 2 && pos === "ALL") { setAllPlayers([]); return; }
    let query = supabase
      .from("players")
      .select("id, name, photo_url, position, team_name, fpts")
      .order("fpts", { ascending: false })
      .limit(30);
    if (q.length >= 2) query = query.ilike("name", `%${q}%`);
    if (pos !== "ALL") query = query.eq("position", pos);
    const { data } = await query;
    // Filter out taken players
    setAllPlayers((data || []).filter((p: any) => !takenPlayerIds.has(p.id)));
  }, [takenPlayerIds]);

  useEffect(() => {
    searchPlayers(search, posFilter);
  }, [search, posFilter, searchPlayers]);

  async function confirmTransfer() {
    if (!playerOut || !playerIn || !myTeam) return;
    setSaving(true);

    // Update draft_picks: swap player
    const { data: pickRow } = await supabase
      .from("draft_picks")
      .select("id, pick_number")
      .eq("team_id", myTeam.id)
      .eq("player_id", playerOut.id)
      .single();

    if (!pickRow) { setSaving(false); return; }

    // Replace the pick
    await supabase
      .from("draft_picks")
      .update({ player_id: playerIn.id })
      .eq("id", pickRow.id);

    // Log transfer
    await supabase.from("liga_transfers").insert({
      team_id: myTeam.id,
      league_id: leagueId,
      player_out_id: playerOut.id,
      player_in_id: playerIn.id,
    });

    setSaved(true);
    setSaving(false);
    setPlayerOut(null);
    setPlayerIn(null);
    setSearch("");
    await loadAll(user.id);
    setTimeout(() => setSaved(false), 3000);
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center text-[9px] font-black uppercase tracking-widest animate-pulse"
      style={{ background: "#0c0900", color: "#2a2010" }}>
      Lade...
    </main>
  );

  if (!myTeam) return (
    <main className="flex min-h-screen items-center justify-center text-sm"
      style={{ background: "#0c0900", color: "#5a4020" }}>
      Kein Team in dieser Liga.
    </main>
  );

  const freeAgents = allPlayers.filter(p => !mySquad.find(s => s.id === p.id));

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "#0c0900" }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "#f5a623" }} />

      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-center mb-6">
        <button onClick={() => window.location.href = `/leagues/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest"
          style={{ color: "#5a4020" }}>
          ← Liga
        </button>
        <h1 className="text-sm font-black uppercase tracking-widest" style={{ color: "#c8b080" }}>
          Transfers
        </h1>
        <div />
      </div>

      {/* Tabs */}
      <div className="w-full max-w-md flex gap-2 mb-4">
        {([
          { id: "meine",   label: "Meine Transfers" },
          { id: "feed",    label: "Aktivitäten" },
          { id: "verlauf", label: "Mein Verlauf" },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex-1 py-2 rounded-xl text-[8px] font-black uppercase tracking-widest transition-colors"
            style={{
              background: tab === t.id ? "#f5a623" : "#141008",
              color:      tab === t.id ? "#0c0900" : "#5a4020",
              border: `1px solid ${tab === t.id ? "#f5a623" : "#2a2010"}`,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "meine" && (
        <>
          {/* Transfer summary bar */}
          {(playerOut || playerIn) && (
            <div className="w-full max-w-md rounded-2xl p-4 mb-4"
              style={{ background: "#141008", border: "1px solid #f5a623" }}>
              <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "#5a4020" }}>
                Transfer-Vorschau
              </p>
              <div className="flex items-center gap-3">
                <div className="flex-1 text-center">
                  {playerOut ? (
                    <>
                      <span className="text-[8px] font-black uppercase" style={{ color: "#ff4d6d" }}>▼ Raus</span>
                      <p className="text-xs font-black mt-1" style={{ color: "#c8b080" }}>{playerOut.name}</p>
                      <p className="text-[8px]" style={{ color: "#5a4020" }}>{playerOut.position} · {playerOut.team_name}</p>
                    </>
                  ) : (
                    <p className="text-[9px]" style={{ color: "#2a2010" }}>Wähle Spieler raus</p>
                  )}
                </div>
                <span className="text-xl font-black" style={{ color: "#2a2010" }}>⇄</span>
                <div className="flex-1 text-center">
                  {playerIn ? (
                    <>
                      <span className="text-[8px] font-black uppercase" style={{ color: "#00ce7d" }}>▲ Rein</span>
                      <p className="text-xs font-black mt-1" style={{ color: "#c8b080" }}>{playerIn.name}</p>
                      <p className="text-[8px]" style={{ color: "#5a4020" }}>{playerIn.position} · {playerIn.team_name}</p>
                    </>
                  ) : (
                    <p className="text-[9px]" style={{ color: "#2a2010" }}>Wähle neuen Spieler</p>
                  )}
                </div>
              </div>
              {playerOut && playerIn && (
                <button onClick={confirmTransfer} disabled={saving}
                  className="w-full mt-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  style={{ background: saving ? "#2a2010" : "#f5a623", color: "#0c0900" }}>
                  {saving ? "Wird gespeichert..." : saved ? "✓ Transfer durchgeführt!" : "Transfer bestätigen"}
                </button>
              )}
            </div>
          )}

          {/* My Squad */}
          <div className="w-full max-w-md mb-4">
            <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "#2a2010" }}>
              Mein Kader · {mySquad.length} Spieler
            </p>
            <div className="space-y-1.5">
              {mySquad.map(p => (
                <button key={p.id} onClick={() => setPlayerOut(playerOut?.id === p.id ? null : p)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left"
                  style={{
                    background: playerOut?.id === p.id ? "#1a0808" : "#141008",
                    border: `1px solid ${playerOut?.id === p.id ? "#ff4d6d" : "#2a2010"}`,
                  }}>
                  <img src={p.photo_url || "/player-placeholder.png"} alt={p.name}
                    className="w-8 h-8 rounded-full object-cover"
                    style={{ border: `1px solid ${POS_COLOR[p.position] || "#2a2010"}` }} />
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-xs truncate" style={{ color: playerOut?.id === p.id ? "#ff4d6d" : "#c8b080" }}>
                      {p.name}
                    </p>
                    <p className="text-[8px] font-black uppercase" style={{ color: "#5a4020" }}>
                      {p.position} · {p.team_name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="font-black text-sm" style={{ color: "#c8b080" }}>{p.fpts?.toFixed(1)}</p>
                      <p className="text-[7px] uppercase" style={{ color: "#2a2010" }}>FPTS</p>
                    </div>
                    {playerOut?.id === p.id && (
                      <span className="text-[8px] font-black" style={{ color: "#ff4d6d" }}>▼</span>
                    )}
                    <button onClick={e => { e.stopPropagation(); window.location.href = `/leagues/${leagueId}/players/${p.id}`; }}
                      className="text-[8px] font-black px-1.5 py-1 rounded"
                      style={{ background: "#2a2010", color: "#5a4020" }}>↗</button>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Free Agent Search */}
          <div className="w-full max-w-md">
            <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "#2a2010" }}>
              Freie Spieler
            </p>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="Name suchen..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl text-xs font-black outline-none"
                style={{ background: "#141008", border: "1px solid #2a2010", color: "#c8b080" }}
              />
              <select value={posFilter} onChange={e => setPosFilter(e.target.value)}
                className="px-3 py-2 rounded-xl text-[9px] font-black uppercase outline-none"
                style={{ background: "#141008", border: "1px solid #2a2010", color: "#5a4020" }}>
                <option value="ALL">Alle</option>
                <option value="GK">TW</option>
                <option value="DF">ABW</option>
                <option value="MF">MF</option>
                <option value="FW">ST</option>
              </select>
            </div>

            {search.length < 2 && posFilter === "ALL" ? (
              <div className="text-center py-8" style={{ color: "#2a2010" }}>
                <p className="text-[9px] font-black uppercase tracking-widest">Name eingeben oder Position wählen</p>
              </div>
            ) : freeAgents.length === 0 ? (
              <div className="text-center py-8" style={{ color: "#2a2010" }}>
                <p className="text-[9px] font-black uppercase tracking-widest">Keine freien Spieler gefunden</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {freeAgents.map(p => (
                  <button key={p.id} onClick={() => setPlayerIn(playerIn?.id === p.id ? null : p)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left"
                    style={{
                      background: playerIn?.id === p.id ? "#0a1a0a" : "#141008",
                      border: `1px solid ${playerIn?.id === p.id ? "#00ce7d" : "#2a2010"}`,
                    }}>
                    <img src={p.photo_url || "/player-placeholder.png"} alt={p.name}
                      className="w-8 h-8 rounded-full object-cover"
                      style={{ border: `1px solid ${POS_COLOR[p.position] || "#2a2010"}` }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-xs truncate" style={{ color: playerIn?.id === p.id ? "#00ce7d" : "#c8b080" }}>
                        {p.name}
                      </p>
                      <p className="text-[8px] font-black uppercase" style={{ color: "#5a4020" }}>
                        {p.position} · {p.team_name}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="font-black text-sm" style={{ color: "#c8b080" }}>{p.fpts?.toFixed(1)}</p>
                        <p className="text-[7px] uppercase" style={{ color: "#2a2010" }}>FPTS</p>
                      </div>
                      {playerIn?.id === p.id && (
                        <span className="text-[8px] font-black" style={{ color: "#00ce7d" }}>▲</span>
                      )}
                      <button onClick={e => { e.stopPropagation(); window.location.href = `/leagues/${leagueId}/players/${p.id}`; }}
                        className="text-[8px] font-black px-1.5 py-1 rounded"
                        style={{ background: "#2a2010", color: "#5a4020" }}>↗</button>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "feed" && (
        <div className="w-full max-w-md">
          <TransactionsFeed key="feed-all" leagueId={leagueId} />
        </div>
      )}

      {tab === "verlauf" && myTeam && (
        <div className="w-full max-w-md">
          <TransactionsFeed key="feed-mine" leagueId={leagueId} onlyTeamId={myTeam.id}
            emptyLabel="Noch keine Transaktionen in deinem Team" />
        </div>
      )}

      <BottomNav />
    </main>
  );
}
