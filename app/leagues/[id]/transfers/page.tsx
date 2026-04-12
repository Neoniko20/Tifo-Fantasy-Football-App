"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { BottomNav } from "@/app/components/BottomNav";
import { TransactionsFeed } from "@/app/components/TransactionsFeed";

const POS_COLOR: Record<string, string> = {
  GK: "var(--color-primary)",
  DF: "var(--color-info)",
  MF: "var(--color-success)",
  FW: "var(--color-error)",
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
      style={{ background: "var(--bg-page)", color: "var(--color-border)" }}>
      Lade...
    </main>
  );

  if (!myTeam) return (
    <main className="flex min-h-screen items-center justify-center text-sm"
      style={{ background: "var(--bg-page)", color: "var(--color-muted)" }}>
      Kein Team in dieser Liga.
    </main>
  );

  const freeAgents = allPlayers.filter(p => !mySquad.find(s => s.id === p.id));

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "var(--bg-page)" }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "var(--color-primary)" }} />

      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-center mb-6">
        <button onClick={() => window.location.href = `/leagues/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest"
          style={{ color: "var(--color-muted)" }}>
          ← Liga
        </button>
        <h1 className="text-sm font-black uppercase tracking-widest" style={{ color: "var(--color-text)" }}>
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
              background: tab === t.id ? "var(--color-primary)" : "var(--bg-card)",
              color:      tab === t.id ? "var(--bg-page)" : "var(--color-muted)",
              border: `1px solid ${tab === t.id ? "var(--color-primary)" : "var(--color-border)"}`,
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
              style={{ background: "var(--bg-card)", border: "1px solid var(--color-primary)" }}>
              <p className="text-[8px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
                Transfer-Vorschau
              </p>
              <div className="flex items-center gap-3">
                <div className="flex-1 text-center">
                  {playerOut ? (
                    <>
                      <span className="text-[8px] font-black uppercase" style={{ color: "var(--color-error)" }}>▼ Raus</span>
                      <p className="text-xs font-black mt-1" style={{ color: "var(--color-text)" }}>{playerOut.name}</p>
                      <p className="text-[8px]" style={{ color: "var(--color-muted)" }}>{playerOut.position} · {playerOut.team_name}</p>
                    </>
                  ) : (
                    <p className="text-[9px]" style={{ color: "var(--color-border)" }}>Wähle Spieler raus</p>
                  )}
                </div>
                <span className="text-xl font-black" style={{ color: "var(--color-border)" }}>⇄</span>
                <div className="flex-1 text-center">
                  {playerIn ? (
                    <>
                      <span className="text-[8px] font-black uppercase" style={{ color: "var(--color-success)" }}>▲ Rein</span>
                      <p className="text-xs font-black mt-1" style={{ color: "var(--color-text)" }}>{playerIn.name}</p>
                      <p className="text-[8px]" style={{ color: "var(--color-muted)" }}>{playerIn.position} · {playerIn.team_name}</p>
                    </>
                  ) : (
                    <p className="text-[9px]" style={{ color: "var(--color-border)" }}>Wähle neuen Spieler</p>
                  )}
                </div>
              </div>
              {playerOut && playerIn && (
                <button onClick={confirmTransfer} disabled={saving}
                  className="w-full mt-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  style={{ background: saving ? "var(--color-border)" : "var(--color-primary)", color: "var(--bg-page)" }}>
                  {saving ? "Wird gespeichert..." : saved ? "✓ Transfer durchgeführt!" : "Transfer bestätigen"}
                </button>
              )}
            </div>
          )}

          {/* My Squad */}
          <div className="w-full max-w-md mb-4">
            <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-border)" }}>
              Mein Kader · {mySquad.length} Spieler
            </p>
            <div className="space-y-1.5">
              {mySquad.map(p => (
                <button key={p.id} onClick={() => setPlayerOut(playerOut?.id === p.id ? null : p)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left"
                  style={{
                    background: playerOut?.id === p.id ? "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))" : "var(--bg-card)",
                    border: `1px solid ${playerOut?.id === p.id ? "var(--color-error)" : "var(--color-border)"}`,
                  }}>
                  <img src={p.photo_url || "/player-placeholder.png"} alt={p.name}
                    className="w-8 h-8 rounded-full object-cover"
                    style={{ border: `1px solid ${POS_COLOR[p.position] || "var(--color-border)"}` }} />
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-xs truncate" style={{ color: playerOut?.id === p.id ? "var(--color-error)" : "var(--color-text)" }}>
                      {p.name}
                    </p>
                    <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                      {p.position} · {p.team_name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="font-black text-sm" style={{ color: "var(--color-text)" }}>{p.fpts?.toFixed(1)}</p>
                      <p className="text-[7px] uppercase" style={{ color: "var(--color-border)" }}>FPTS</p>
                    </div>
                    {playerOut?.id === p.id && (
                      <span className="text-[8px] font-black" style={{ color: "var(--color-error)" }}>▼</span>
                    )}
                    <button onClick={e => { e.stopPropagation(); window.location.href = `/leagues/${leagueId}/players/${p.id}`; }}
                      className="text-[8px] font-black px-1.5 py-1 rounded"
                      style={{ background: "var(--color-border)", color: "var(--color-muted)" }}>↗</button>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Free Agent Search */}
          <div className="w-full max-w-md">
            <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-border)" }}>
              Freie Spieler
            </p>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="Name suchen..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl text-xs font-black outline-none"
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
              />
              <select value={posFilter} onChange={e => setPosFilter(e.target.value)}
                className="px-3 py-2 rounded-xl text-[9px] font-black uppercase outline-none"
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}>
                <option value="ALL">Alle</option>
                <option value="GK">TW</option>
                <option value="DF">ABW</option>
                <option value="MF">MF</option>
                <option value="FW">ST</option>
              </select>
            </div>

            {search.length < 2 && posFilter === "ALL" ? (
              <div className="text-center py-8" style={{ color: "var(--color-border)" }}>
                <p className="text-[9px] font-black uppercase tracking-widest">Name eingeben oder Position wählen</p>
              </div>
            ) : freeAgents.length === 0 ? (
              <div className="text-center py-8" style={{ color: "var(--color-border)" }}>
                <p className="text-[9px] font-black uppercase tracking-widest">Keine freien Spieler gefunden</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {freeAgents.map(p => (
                  <button key={p.id} onClick={() => setPlayerIn(playerIn?.id === p.id ? null : p)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left"
                    style={{
                      background: playerIn?.id === p.id ? "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))" : "var(--bg-card)",
                      border: `1px solid ${playerIn?.id === p.id ? "var(--color-success)" : "var(--color-border)"}`,
                    }}>
                    <img src={p.photo_url || "/player-placeholder.png"} alt={p.name}
                      className="w-8 h-8 rounded-full object-cover"
                      style={{ border: `1px solid ${POS_COLOR[p.position] || "var(--color-border)"}` }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-xs truncate" style={{ color: playerIn?.id === p.id ? "var(--color-success)" : "var(--color-text)" }}>
                        {p.name}
                      </p>
                      <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                        {p.position} · {p.team_name}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="font-black text-sm" style={{ color: "var(--color-text)" }}>{p.fpts?.toFixed(1)}</p>
                        <p className="text-[7px] uppercase" style={{ color: "var(--color-border)" }}>FPTS</p>
                      </div>
                      {playerIn?.id === p.id && (
                        <span className="text-[8px] font-black" style={{ color: "var(--color-success)" }}>▲</span>
                      )}
                      <button onClick={e => { e.stopPropagation(); window.location.href = `/leagues/${leagueId}/players/${p.id}`; }}
                        className="text-[8px] font-black px-1.5 py-1 rounded"
                        style={{ background: "var(--color-border)", color: "var(--color-muted)" }}>↗</button>
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
