"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { BottomNav } from "@/app/components/BottomNav";
import {
  createTradeProposal,
  createTradeResponse,
  createTradeCancelled,
  markLeagueKindAsRead,
} from "@/lib/notifications";
import { useToast } from "@/app/components/ToastProvider";

const POS_COLOR: Record<string, string> = {
  GK: "var(--color-primary)", DF: "var(--color-info)", MF: "var(--color-success)", FW: "var(--color-error)",
};

export default function TradesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [user, setUser]         = useState<any>(null);
  const [myTeam, setMyTeam]     = useState<any>(null);
  const [teams, setTeams]       = useState<any[]>([]);
  const [mySquad, setMySquad]   = useState<any[]>([]);
  const [allPlayers, setAllPlayers] = useState<Record<number, string>>({});
  const [trades, setTrades]     = useState<any[]>([]);
  const [tab, setTab]           = useState<"inbox" | "propose" | "sent">("inbox");

  // Trade-Formular
  const [targetTeamId, setTargetTeamId] = useState("");
  const [targetSquad, setTargetSquad]   = useState<any[]>([]);
  const [offerIds, setOfferIds]         = useState<number[]>([]);
  const [requestIds, setRequestIds]     = useState<number[]>([]);
  const [sending, setSending]           = useState(false);
  const [loading, setLoading]           = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
      markLeagueKindAsRead(data.user.id, leagueId, [
        "trade_proposed", "trade_accepted", "trade_rejected", "trade_cancelled",
      ]);
    });
  }, []);

  useEffect(() => {
    if (targetTeamId) loadTargetSquad(targetTeamId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTeamId]);

  async function loadAll(userId: string) {
    const { data: myT } = await supabase
      .from("teams").select("*").eq("league_id", leagueId).eq("user_id", userId).maybeSingle();
    setMyTeam(myT);

    const { data: teamsData } = await supabase
      .from("teams")
      .select("id, name, user_id, profiles(username)")
      .eq("league_id", leagueId);
    setTeams(teamsData || []);

    if (myT) {
      const squad = await loadSquad(myT.id);
      setMySquad(squad);
    }

    // Load all players across all teams for name lookups in trade history
    const { data: allPicks } = await supabase
      .from("draft_picks")
      .select("player_id, players(id, name)")
      .in("team_id", (teamsData || []).map((t: any) => t.id));
    const lookup: Record<number, string> = {};
    (allPicks || []).forEach((p: any) => {
      if (p.players) lookup[p.players.id] = p.players.name;
    });
    setAllPlayers(lookup);

    await loadTrades(userId);
    setLoading(false);
  }

  async function loadSquad(teamId: string) {
    const { data: picks } = await supabase
      .from("draft_picks")
      .select("player_id, players(id, name, photo_url, position, team_name, fpts)")
      .eq("team_id", teamId);
    return (picks || []).map((p: any) => p.players).filter(Boolean);
  }

  async function loadTargetSquad(teamId: string) {
    const squad = await loadSquad(teamId);
    setTargetSquad(squad);
  }

  async function loadTrades(userId: string) {
    const { data } = await supabase
      .from("liga_trades")
      .select(`
        *,
        proposer:proposer_team_id(name, user_id),
        receiver:receiver_team_id(name, user_id)
      `)
      .eq("league_id", leagueId)
      .order("created_at", { ascending: false });
    setTrades(data || []);
  }

  async function proposeTrade() {
    if (!myTeam || !targetTeamId || offerIds.length === 0 || requestIds.length === 0) return;
    setSending(true);
    const { data: tradeRow, error } = await supabase.from("liga_trades").insert({
      league_id: leagueId,
      proposer_team_id: myTeam.id,
      receiver_team_id: targetTeamId,
      offer_player_ids: offerIds,
      request_player_ids: requestIds,
      status: "pending",
    }).select("id").single();
    if (error) { toast("Fehler: " + error.message, "error"); setSending(false); return; }

    const receiverTeam = teams.find((t: any) => t.id === targetTeamId);
    if (tradeRow && receiverTeam?.user_id) {
      await createTradeProposal({
        tradeId:          tradeRow.id,
        leagueId,
        receiverUserId:   receiverTeam.user_id,
        proposerTeamName: myTeam.name,
      });
    }

    setOfferIds([]);
    setRequestIds([]);
    setTargetTeamId("");
    setTab("sent");
    await loadTrades(user.id);
    setSending(false);
  }

  async function respondTrade(tradeId: string, accept: boolean) {
    if (accept) {
      // Spieler tauschen
      const trade = trades.find(t => t.id === tradeId);
      if (!trade) return;

      // Offer-Spieler: vom proposer zum receiver
      for (const pid of (trade.offer_player_ids || [])) {
        await supabase.from("draft_picks")
          .update({ team_id: trade.receiver_team_id })
          .eq("team_id", trade.proposer_team_id)
          .eq("player_id", pid);
      }
      // Request-Spieler: vom receiver zum proposer
      for (const pid of (trade.request_player_ids || [])) {
        await supabase.from("draft_picks")
          .update({ team_id: trade.proposer_team_id })
          .eq("team_id", trade.receiver_team_id)
          .eq("player_id", pid);
      }
    }

    await supabase.from("liga_trades")
      .update({ status: accept ? "accepted" : "rejected", updated_at: new Date().toISOString() })
      .eq("id", tradeId);

    const trade = trades.find((t: any) => t.id === tradeId);
    const proposerUserId = trade?.proposer?.user_id;
    if (trade && proposerUserId && myTeam) {
      await createTradeResponse({
        tradeId,
        leagueId,
        proposerUserId,
        receiverTeamName: myTeam.name,
        accepted: accept,
      });
    }

    await loadTrades(user.id);
  }

  async function cancelTrade(tradeId: string) {
    await supabase.from("liga_trades")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", tradeId);

    const trade = trades.find((t: any) => t.id === tradeId);
    const receiverUserId = trade?.receiver?.user_id;
    if (trade && receiverUserId && myTeam) {
      await createTradeCancelled({
        tradeId,
        leagueId,
        receiverUserId,
        proposerTeamName: myTeam.name,
      });
    }

    await loadTrades(user.id);
  }

  function toggleId(list: number[], setList: (v: number[]) => void, id: number) {
    setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  }

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center text-[9px] font-black uppercase tracking-widest animate-pulse"
      style={{ background: "var(--bg-page)", color: "var(--color-border)" }}>Lade Trades...</main>
  );

  const inbox = trades.filter(t => t.receiver?.user_id === user?.id && t.status === "pending");
  const sent  = trades.filter(t => t.proposer?.user_id === user?.id);
  const otherTeams = teams.filter(t => t.id !== myTeam?.id);

  const getPlayerName = (id: number, squad?: any[]) =>
    squad?.find(p => p.id === id)?.name || allPlayers[id] || `#${id}`;

  const STATUS_COLORS: Record<string, string> = {
    pending: "var(--color-primary)", accepted: "var(--color-success)", rejected: "var(--color-error)", cancelled: "var(--color-border)",
  };
  const STATUS_LABELS: Record<string, string> = {
    pending: "Ausstehend", accepted: "Angenommen", rejected: "Abgelehnt", cancelled: "Zurückgezogen",
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "var(--bg-page)" }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "var(--color-info)" }} />

      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-center mb-5">
        <button onClick={() => window.location.href = `/leagues/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          ← Liga
        </button>
        <h1 className="text-sm font-black uppercase tracking-widest" style={{ color: "var(--color-text)" }}>Trades</h1>
        <div />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 w-full max-w-md mb-5 p-1 rounded-xl" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
        {([
          { id: "inbox",   label: `Eingang${inbox.length > 0 ? ` (${inbox.length})` : ""}` },
          { id: "propose", label: "Trade vorschlagen" },
          { id: "sent",    label: "Gesendet" },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex-1 py-2 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all"
            style={{
              background: tab === t.id ? "var(--color-primary)" : "transparent",
              color: tab === t.id ? "var(--bg-page)" : t.id === "inbox" && inbox.length > 0 ? "var(--color-primary)" : "var(--color-muted)",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* EINGANG */}
      {tab === "inbox" && (
        <div className="w-full max-w-md space-y-3">
          {inbox.length === 0 ? (
            <div className="text-center py-12" style={{ color: "var(--color-border)" }}>
              <p className="text-[9px] font-black uppercase tracking-widest">Keine offenen Trades</p>
            </div>
          ) : inbox.map(t => (
            <div key={t.id} className="rounded-2xl p-4 space-y-3"
              style={{ background: "var(--bg-card)", border: "1px solid var(--color-border-subtle)" }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-black" style={{ color: "var(--color-primary)" }}>
                  {t.proposer?.name} bietet an:
                </p>
                <span className="text-[8px]" style={{ color: "var(--color-border)" }}>
                  {new Date(t.created_at).toLocaleDateString("de-DE")}
                </span>
              </div>
              {/* Tausch-Visualisierung */}
              <div className="flex gap-3">
                <div className="flex-1 p-2 rounded-xl" style={{ background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))", border: "1px solid color-mix(in srgb, var(--color-success) 20%, var(--bg-page))" }}>
                  <p className="text-[7px] font-black uppercase mb-1.5" style={{ color: "var(--color-success)" }}>Du erhältst</p>
                  {(t.offer_player_ids || []).map((pid: number) => (
                    <p key={pid} className="text-[10px] font-black" style={{ color: "var(--color-text)" }}>
                      {getPlayerName(pid, targetSquad.length ? targetSquad : mySquad)}
                    </p>
                  ))}
                </div>
                <div className="flex items-center" style={{ color: "var(--color-border)" }}>⇄</div>
                <div className="flex-1 p-2 rounded-xl" style={{ background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))", border: "1px solid color-mix(in srgb, var(--color-error) 20%, var(--bg-page))" }}>
                  <p className="text-[7px] font-black uppercase mb-1.5" style={{ color: "var(--color-error)" }}>Du gibst ab</p>
                  {(t.request_player_ids || []).map((pid: number) => (
                    <p key={pid} className="text-[10px] font-black" style={{ color: "var(--color-text)" }}>
                      {getPlayerName(pid, mySquad)}
                    </p>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => respondTrade(t.id, false)}
                  className="flex-1 py-2.5 rounded-xl text-[9px] font-black uppercase"
                  style={{ background: "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))", border: "1px solid color-mix(in srgb, var(--color-error) 20%, var(--bg-page))", color: "var(--color-error)" }}>
                  Ablehnen
                </button>
                <button onClick={() => respondTrade(t.id, true)}
                  className="flex-1 py-2.5 rounded-xl text-[9px] font-black uppercase"
                  style={{ background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))", border: "1px solid var(--color-success)", color: "var(--color-success)" }}>
                  Annehmen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TRADE VORSCHLAGEN */}
      {tab === "propose" && (
        <div className="w-full max-w-md space-y-4">
          {/* Team auswählen */}
          <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-border)" }}>
              Mit welchem Team?
            </p>
            <div className="flex flex-wrap gap-2">
              {otherTeams.map(t => (
                <button key={t.id} onClick={() => setTargetTeamId(t.id)}
                  className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all"
                  style={{
                    background: targetTeamId === t.id ? "var(--bg-card)" : "var(--bg-page)",
                    border: `1px solid ${targetTeamId === t.id ? "var(--color-primary)" : "var(--color-border)"}`,
                    color: targetTeamId === t.id ? "var(--color-primary)" : "var(--color-muted)",
                  }}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          {targetTeamId && (
            <>
              {/* Meine Spieler (Angebot) */}
              <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-error)" }}>
                  Ich biete an ({offerIds.length})
                </p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {mySquad.map((p: any) => (
                    <button key={p.id} onClick={() => toggleId(offerIds, setOfferIds, p.id)}
                      className="w-full flex items-center gap-2 p-2.5 rounded-xl text-left transition-all"
                      style={{
                        background: offerIds.includes(p.id) ? "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))" : "var(--bg-page)",
                        border: `1px solid ${offerIds.includes(p.id) ? "var(--color-error)" : "var(--color-border)"}`,
                      }}>
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded"
                        style={{ background: POS_COLOR[p.position] + "20", color: POS_COLOR[p.position] }}>
                        {p.position}
                      </span>
                      <span className="flex-1 text-xs font-black" style={{ color: offerIds.includes(p.id) ? "var(--color-error)" : "var(--color-text)" }}>
                        {p.name}
                      </span>
                      <span className="text-[9px] font-black" style={{ color: "var(--color-muted)" }}>
                        {p.fpts?.toFixed(0)} pts
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Gegnerische Spieler (Anfrage) */}
              <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-success)" }}>
                  Ich möchte ({requestIds.length})
                </p>
                {targetSquad.length === 0 ? (
                  <p className="text-[9px] py-4 text-center font-black uppercase" style={{ color: "var(--color-border)" }}>
                    Kader wird geladen...
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {targetSquad.map((p: any) => (
                      <button key={p.id} onClick={() => toggleId(requestIds, setRequestIds, p.id)}
                        className="w-full flex items-center gap-2 p-2.5 rounded-xl text-left transition-all"
                        style={{
                          background: requestIds.includes(p.id) ? "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))" : "var(--bg-page)",
                          border: `1px solid ${requestIds.includes(p.id) ? "var(--color-success)" : "var(--color-border)"}`,
                        }}>
                        <span className="text-[8px] font-black px-1.5 py-0.5 rounded"
                          style={{ background: POS_COLOR[p.position] + "20", color: POS_COLOR[p.position] }}>
                          {p.position}
                        </span>
                        <span className="flex-1 text-xs font-black" style={{ color: requestIds.includes(p.id) ? "var(--color-success)" : "var(--color-text)" }}>
                          {p.name}
                        </span>
                        <span className="text-[9px] font-black" style={{ color: "var(--color-muted)" }}>
                          {p.fpts?.toFixed(0)} pts
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Preview + Senden */}
              {offerIds.length > 0 && requestIds.length > 0 && (
                <button onClick={proposeTrade} disabled={sending}
                  className="w-full py-4 rounded-xl text-sm font-black uppercase tracking-widest transition-all"
                  style={{ background: sending ? "var(--color-border)" : "var(--color-primary)", color: "var(--bg-page)" }}>
                  {sending ? "Wird gesendet..." : "Trade-Vorschlag senden"}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* GESENDET */}
      {tab === "sent" && (
        <div className="w-full max-w-md space-y-3">
          {sent.length === 0 ? (
            <div className="text-center py-12" style={{ color: "var(--color-border)" }}>
              <p className="text-[9px] font-black uppercase tracking-widest">Noch keine Trades gesendet</p>
            </div>
          ) : sent.map(t => (
            <div key={t.id} className="rounded-2xl p-4"
              style={{ background: "var(--bg-card)", border: `1px solid ${STATUS_COLORS[t.status] || "var(--color-border)"}30` }}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-black" style={{ color: "var(--color-text)" }}>
                  → {t.receiver?.name}
                </p>
                <span className="text-[8px] font-black px-2 py-0.5 rounded-full"
                  style={{ background: STATUS_COLORS[t.status] + "20", color: STATUS_COLORS[t.status] }}>
                  {STATUS_LABELS[t.status] || t.status}
                </span>
              </div>
              <div className="flex gap-3 mb-2">
                <div className="flex-1">
                  <p className="text-[7px] font-black uppercase mb-1" style={{ color: "var(--color-error)" }}>Ich biete</p>
                  {(t.offer_player_ids || []).map((pid: number) => (
                    <p key={pid} className="text-[10px] font-black" style={{ color: "var(--color-text)" }}>
                      {getPlayerName(pid)}
                    </p>
                  ))}
                </div>
                <div className="flex-1">
                  <p className="text-[7px] font-black uppercase mb-1" style={{ color: "var(--color-success)" }}>Ich möchte</p>
                  {(t.request_player_ids || []).map((pid: number) => (
                    <p key={pid} className="text-[10px] font-black" style={{ color: "var(--color-text)" }}>
                      {getPlayerName(pid)}
                    </p>
                  ))}
                </div>
              </div>
              {t.status === "pending" && (
                <button onClick={() => cancelTrade(t.id)}
                  className="text-[9px] font-black uppercase"
                  style={{ color: "var(--color-muted)" }}>
                  Zurückziehen
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <BottomNav />
    </main>
  );
}
