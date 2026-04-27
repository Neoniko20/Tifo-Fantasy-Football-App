"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { BottomNav } from "@/app/components/BottomNav";
import { TransactionsFeed } from "@/app/components/TransactionsFeed";
import { PlayerCard } from "@/app/components/PlayerCard";
import { Spinner } from "@/app/components/ui/Spinner";
import { useToast } from "@/app/components/ToastProvider";

const POS_COLOR: Record<string, string> = {
  GK: "var(--color-primary)",
  DF: "var(--color-info)",
  MF: "var(--color-success)",
  FW: "var(--color-error)",
};

const POS_LABEL: Record<string, string> = {
  GK: "TW", DF: "ABW", MF: "MF", FW: "ST",
};

type Player = {
  id: number;
  name: string;
  photo_url: string;
  position: string;
  team_name: string;
  api_team_id?: number | null;
  fpts: number;
};

export default function TransfersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);
  const { toast } = useToast();

  const [user, setUser]                         = useState<any>(null);
  const [league, setLeague]                     = useState<any>(null);
  const [settings, setSettings]                 = useState<any>(null);
  const [myTeam, setMyTeam]                     = useState<any>(null);
  const [mySquad, setMySquad]                   = useState<Player[]>([]);
  const [allPlayers, setAllPlayers]             = useState<Player[]>([]);
  const [takenPlayerIds, setTakenPlayerIds]     = useState<Set<number>>(new Set());
  const [transfersUsedThisWeek, setTransfersUsedThisWeek] = useState(0);
  const [playerOut, setPlayerOut]               = useState<Player | null>(null);
  const [playerIn, setPlayerIn]                 = useState<Player | null>(null);
  const [search, setSearch]                     = useState("");
  const [posFilter, setPosFilter]               = useState("ALL");
  const [saving, setSaving]                     = useState(false);
  const [loading, setLoading]                   = useState(true);
  const [tab, setTab]                           = useState<"meine" | "feed" | "verlauf">("meine");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll(userId: string) {
    const { data: leagueData } = await supabase
      .from("leagues").select("*").eq("id", leagueId).single();
    setLeague(leagueData);

    const { data: settingsData } = await supabase
      .from("liga_settings").select("*").eq("league_id", leagueId).maybeSingle();
    setSettings(settingsData);

    const { data: teamData } = await supabase
      .from("teams").select("*").eq("league_id", leagueId).eq("user_id", userId).single();
    setMyTeam(teamData);

    if (teamData) {
      // Load squad from squad_players (source of truth)
      const { data: sqRows } = await supabase
        .from("squad_players")
        .select("player_id, players(id, name, photo_url, position, team_name, api_team_id, fpts)")
        .eq("team_id", teamData.id);
      let squadPlayers: Player[] = (sqRows || []).map((r: any) => r.players).filter(Boolean);

      // Fallback: draft_picks for leagues that haven't had waivers yet
      if (squadPlayers.length === 0) {
        const { data: picks } = await supabase
          .from("draft_picks")
          .select("player_id, players(id, name, photo_url, position, team_name, api_team_id, fpts)")
          .eq("team_id", teamData.id)
          .order("pick_number");
        squadPlayers = (picks || []).map((r: any) => r.players).filter(Boolean);
      }
      setMySquad(squadPlayers);

      // Taken player IDs: all squad_players in this league
      const { data: allTeams } = await supabase
        .from("teams").select("id").eq("league_id", leagueId);
      const allTeamIds = (allTeams || []).map((t: any) => t.id);
      const { data: allSquadRows } = await supabase
        .from("squad_players").select("player_id").in("team_id", allTeamIds);
      setTakenPlayerIds(new Set((allSquadRows || []).map((r: any) => r.player_id)));

      // Count transfers used this week
      const weekStart = getWeekStart();
      const { count } = await supabase
        .from("liga_transfers")
        .select("id", { count: "exact", head: true })
        .eq("league_id", leagueId)
        .eq("team_id", teamData.id)
        .gte("created_at", weekStart);
      setTransfersUsedThisWeek(count ?? 0);
    }

    setLoading(false);
  }

  function getWeekStart(): string {
    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const monday = new Date(now.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday.toISOString();
  }

  const searchPlayers = useCallback(async (q: string, pos: string) => {
    if (q.length < 2 && pos === "ALL") { setAllPlayers([]); return; }
    let query = supabase
      .from("players")
      .select("id, name, photo_url, position, team_name, api_team_id, fpts")
      .order("fpts", { ascending: false })
      .limit(30);
    if (q.length >= 2) query = query.ilike("name", `%${q}%`);
    if (pos !== "ALL") query = query.eq("position", pos);
    const { data } = await query;
    setAllPlayers((data || []).filter((p: any) => !takenPlayerIds.has(p.id)));
  }, [takenPlayerIds]);

  useEffect(() => {
    searchPlayers(search, posFilter);
  }, [search, posFilter, searchPlayers]);

  async function confirmTransfer() {
    if (!playerOut || !playerIn || !myTeam) return;

    // Transfer limit check
    const limit = settings?.max_transfers_per_week;
    if (limit != null && transfersUsedThisWeek >= limit) {
      toast(`Transfer-Limit erreicht (${limit}/Woche)`, "error");
      return;
    }

    setSaving(true);
    try {
      // Squad_players path (primary)
      const { data: sqRow } = await supabase
        .from("squad_players")
        .select("id")
        .eq("team_id", myTeam.id)
        .eq("player_id", playerOut.id)
        .maybeSingle();

      if (sqRow) {
        await supabase.from("squad_players").delete().eq("id", sqRow.id);
        await supabase.from("squad_players").insert({ team_id: myTeam.id, player_id: playerIn.id });
      } else {
        // Fallback: draft_picks
        const { data: pickRow } = await supabase
          .from("draft_picks")
          .select("id")
          .eq("team_id", myTeam.id)
          .eq("player_id", playerOut.id)
          .maybeSingle();
        if (!pickRow) throw new Error("Spieler nicht im Kader gefunden");
        await supabase.from("draft_picks").update({ player_id: playerIn.id }).eq("id", pickRow.id);
      }

      // Log transfer
      await supabase.from("liga_transfers").insert({
        team_id:       myTeam.id,
        league_id:     leagueId,
        player_out_id: playerOut.id,
        player_in_id:  playerIn.id,
      });

      toast(`✓ ${playerIn.name} geholt, ${playerOut.name} abgegeben`, "success");
      setPlayerOut(null);
      setPlayerIn(null);
      setSearch("");
      await loadAll(user.id);
    } catch (e: any) {
      toast("Fehler: " + e.message, "error");
    }
    setSaving(false);
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <Spinner />
    </main>
  );

  if (!myTeam) return (
    <main className="flex min-h-screen items-center justify-center text-sm"
      style={{ background: "var(--bg-page)", color: "var(--color-muted)" }}>
      Kein Team in dieser Liga.
    </main>
  );

  const freeAgents = allPlayers.filter(p => !mySquad.find(s => s.id === p.id));
  const limit      = settings?.max_transfers_per_week ?? null;
  const remaining  = limit != null ? Math.max(0, limit - transfersUsedThisWeek) : null;
  const positionMismatch = !!(playerOut && playerIn && playerOut.position !== playerIn.position);

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
        <p className="text-sm font-black uppercase tracking-widest" style={{ color: "var(--color-text)" }}>
          Transfers
        </p>
        <div style={{ width: 40 }} />
      </div>

      {/* Transfer-Limit-Badge + Waiver-Hinweis */}
      <div className="w-full max-w-md flex items-center gap-2 mb-4 flex-wrap">
        {limit != null && (
          <span className="px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest"
            style={{
              background: remaining === 0
                ? "color-mix(in srgb, var(--color-error) 12%, var(--bg-page))"
                : "color-mix(in srgb, var(--color-success) 12%, var(--bg-page))",
              color:  remaining === 0 ? "var(--color-error)" : "var(--color-success)",
              border: `1px solid ${remaining === 0 ? "var(--color-error)" : "var(--color-success)"}`,
            }}>
            {remaining === 0 ? "Limit erreicht" : `${remaining} Transfer${remaining === 1 ? "" : "s"} übrig`}
          </span>
        )}
        {settings?.waiver_enabled && (
          <button
            onClick={() => window.location.href = `/leagues/${leagueId}/waiver`}
            className="px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest"
            style={{ background: "color-mix(in srgb, var(--color-primary) 10%, var(--bg-page))", color: "var(--color-primary)", border: "1px solid var(--color-primary)" }}>
            Waiver Wire aktiv →
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="w-full max-w-md flex gap-1 mb-4 p-1 rounded-xl"
        style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
        {([
          { id: "meine",   label: "Transfer" },
          { id: "feed",    label: "Aktivitäten" },
          { id: "verlauf", label: "Mein Verlauf" },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex-1 py-2 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all"
            style={{
              background: tab === t.id ? "var(--color-primary)" : "transparent",
              color:      tab === t.id ? "var(--bg-page)"       : "var(--color-muted)",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: Transfer ── */}
      {tab === "meine" && (
        <>
          {/* Transfer-Vorschau */}
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
                      <div className="flex justify-center my-1">
                        <PlayerCard player={playerOut} posColor={POS_COLOR[playerOut.position] || "var(--color-border)"} size={36} />
                      </div>
                      <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>{playerOut.name}</p>
                      <p className="text-[8px]" style={{ color: "var(--color-muted)" }}>
                        {POS_LABEL[playerOut.position] || playerOut.position} · {playerOut.team_name}
                      </p>
                    </>
                  ) : (
                    <p className="text-[9px] py-4" style={{ color: "var(--color-border)" }}>Spieler auswählen</p>
                  )}
                </div>
                <div className="flex flex-col items-center gap-1">
                  <span className="text-xl font-black" style={{ color: "var(--color-border)" }}>⇄</span>
                  {positionMismatch && (
                    <span className="text-[7px] font-black px-1.5 py-0.5 rounded"
                      style={{ background: "color-mix(in srgb, var(--color-error) 12%, var(--bg-page))", color: "var(--color-error)", border: "1px solid var(--color-error)" }}>
                      ⚠ Pos
                    </span>
                  )}
                </div>
                <div className="flex-1 text-center">
                  {playerIn ? (
                    <>
                      <span className="text-[8px] font-black uppercase" style={{ color: "var(--color-success)" }}>▲ Rein</span>
                      <div className="flex justify-center my-1">
                        <PlayerCard player={playerIn} posColor={POS_COLOR[playerIn.position] || "var(--color-border)"} size={36} />
                      </div>
                      <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>{playerIn.name}</p>
                      <p className="text-[8px]" style={{ color: "var(--color-muted)" }}>
                        {POS_LABEL[playerIn.position] || playerIn.position} · {playerIn.team_name}
                      </p>
                    </>
                  ) : (
                    <p className="text-[9px] py-4" style={{ color: "var(--color-border)" }}>Neuen Spieler wählen</p>
                  )}
                </div>
              </div>
              {positionMismatch && (
                <p className="text-[8px] font-black text-center mt-2" style={{ color: "var(--color-error)" }}>
                  ⚠ Positionsunterschied — Transfer trotzdem möglich
                </p>
              )}
              {playerOut && playerIn && (
                <button onClick={confirmTransfer} disabled={saving || remaining === 0}
                  className="w-full mt-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40"
                  style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
                  {saving ? "Wird gespeichert…" : "Transfer bestätigen"}
                </button>
              )}
            </div>
          )}

          {/* Mein Kader */}
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
                  <PlayerCard player={p} posColor={POS_COLOR[p.position] || "var(--color-border)"} size={32} />
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-xs truncate"
                      style={{ color: playerOut?.id === p.id ? "var(--color-error)" : "var(--color-text)" }}>
                      {p.name}
                    </p>
                    <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                      {POS_LABEL[p.position] || p.position} · {p.team_name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="font-black text-sm" style={{ color: "var(--color-text)" }}>{p.fpts?.toFixed(1)}</p>
                      <p className="text-[7px] uppercase" style={{ color: "var(--color-border)" }}>FPTS</p>
                    </div>
                    {playerOut?.id === p.id
                      ? <span className="text-[8px] font-black" style={{ color: "var(--color-error)" }}>▼</span>
                      : <span className="text-[8px]" style={{ color: "var(--color-border)" }}>○</span>
                    }
                    <button
                      onClick={e => { e.stopPropagation(); window.location.href = `/leagues/${leagueId}/players/${p.id}`; }}
                      className="text-[8px] font-black px-1.5 py-1 rounded"
                      style={{ background: "var(--bg-elevated)", color: "var(--color-muted)" }}>
                      ↗
                    </button>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Freie Spieler */}
          <div className="w-full max-w-md">
            <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-border)" }}>
              Freie Spieler
            </p>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="Name suchen…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl text-xs font-black outline-none"
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
              />
              <select value={posFilter} onChange={e => { setPosFilter(e.target.value); }}
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
                    <PlayerCard player={p} posColor={POS_COLOR[p.position] || "var(--color-border)"} size={32} />
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-xs truncate"
                        style={{ color: playerIn?.id === p.id ? "var(--color-success)" : "var(--color-text)" }}>
                        {p.name}
                      </p>
                      <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                        {POS_LABEL[p.position] || p.position} · {p.team_name}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="font-black text-sm" style={{ color: "var(--color-text)" }}>{p.fpts?.toFixed(1)}</p>
                        <p className="text-[7px] uppercase" style={{ color: "var(--color-border)" }}>FPTS</p>
                      </div>
                      {playerIn?.id === p.id
                        ? <span className="text-[8px] font-black" style={{ color: "var(--color-success)" }}>▲</span>
                        : <span className="text-[8px]" style={{ color: "var(--color-border)" }}>+</span>
                      }
                      <button
                        onClick={e => { e.stopPropagation(); window.location.href = `/leagues/${leagueId}/players/${p.id}`; }}
                        className="text-[8px] font-black px-1.5 py-1 rounded"
                        style={{ background: "var(--bg-elevated)", color: "var(--color-muted)" }}>
                        ↗
                      </button>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── TAB: Aktivitäten ── */}
      {tab === "feed" && (
        <div className="w-full max-w-md">
          <TransactionsFeed key="feed-all" leagueId={leagueId} />
        </div>
      )}

      {/* ── TAB: Mein Verlauf ── */}
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
