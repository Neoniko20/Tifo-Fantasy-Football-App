"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { BottomNav } from "@/app/components/BottomNav";
import { Spinner } from "@/app/components/ui/Spinner";
import { EmptyState } from "@/app/components/ui/EmptyState";
import {
  createTradeProposal,
  createTradeResponse,
  createTradeCancelled,
  markLeagueKindAsRead,
} from "@/lib/notifications";
import { useToast } from "@/app/components/ToastProvider";
import { TradePlayerCard, type TradePlayer } from "./TradePlayerCard";
import { TradeProposalSheet } from "./TradeProposalSheet";
import { TradeInboxCard, TradeSentCard } from "./TradeInboxCard";

// ── Constants ─────────────────────────────────────────────────

const POS_FILTERS = ["Alle", "TW", "AB", "MF", "ST"] as const;
type PosFilter = (typeof POS_FILTERS)[number];

const POS_TO_DB: Record<string, string> = { TW: "GK", AB: "DF", MF: "MF", ST: "FW" };

const STATUS_COLORS: Record<string, string> = {
  pending:   "var(--color-primary)",
  accepted:  "var(--color-success)",
  rejected:  "var(--color-error)",
  cancelled: "var(--color-border)",
};
const STATUS_LABELS: Record<string, string> = {
  pending:   "Ausstehend",
  accepted:  "Angenommen",
  rejected:  "Abgelehnt",
  cancelled: "Zurückgezogen",
};

// ── Sub-components ────────────────────────────────────────────

function PosFilterRow({ value, onChange }: { value: PosFilter; onChange: (v: PosFilter) => void }) {
  return (
    <div className="flex gap-0.5">
      {POS_FILTERS.map(f => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className="flex-1 py-0.5 rounded text-[7px] font-black uppercase leading-none"
          style={{
            background: value === f ? "var(--color-primary)" : "var(--bg-elevated)",
            color:      value === f ? "var(--bg-page)"       : "var(--color-muted)",
            border:     `1px solid ${value === f ? "var(--color-primary)" : "var(--color-border)"}`,
          }}
        >
          {f}
        </button>
      ))}
    </div>
  );
}

const POS_LABEL_MAP: Record<string, string> = { GK: "TW", DF: "AB", MF: "MF", FW: "ST" };

function squadStats(squad: TradePlayer[]) {
  if (squad.length === 0) return null;
  const posMap: Record<string, number> = {};
  for (const p of squad) {
    posMap[p.position] = (posMap[p.position] ?? 0) + (p.fpts ?? 0);
  }
  const entries = Object.entries(posMap).sort((a, b) => b[1] - a[1]);
  return {
    size:     squad.length,
    strongest: POS_LABEL_MAP[entries[0]?.[0]] ?? entries[0]?.[0] ?? "—",
    weakest:   POS_LABEL_MAP[entries[entries.length - 1]?.[0]] ?? entries[entries.length - 1]?.[0] ?? "—",
  };
}

function ColumnHeader({
  label, teamName, count, color, squad,
}: { label: string; teamName: string; count: number; color: string; squad: TradePlayer[] }) {
  const stats = squadStats(squad);
  return (
    <div className="mb-1.5">
      <p className="text-[7px] font-black uppercase tracking-widest" style={{ color }}>
        {label} {count > 0 ? `(${count})` : ""}
      </p>
      <p className="text-[9px] font-black truncate" style={{ color: "var(--color-text)" }}>
        {teamName}
      </p>
      {stats && (
        <div className="flex gap-1.5 mt-0.5 flex-wrap">
          <span className="text-[6px] font-black uppercase px-1.5 py-0.5 rounded" style={{ background: "var(--bg-elevated)", color: "var(--color-muted)" }}>
            {stats.size} Spieler
          </span>
          <span className="text-[6px] font-black uppercase px-1.5 py-0.5 rounded" style={{ background: "var(--bg-elevated)", color: "var(--color-success)" }}>
            ↑ {stats.strongest}
          </span>
          <span className="text-[6px] font-black uppercase px-1.5 py-0.5 rounded" style={{ background: "var(--bg-elevated)", color: "var(--color-error)" }}>
            ↓ {stats.weakest}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────

export interface TradesViewProps {
  leagueId: string;
  /** When true: no header, no BottomNav, no min-h-screen wrapper */
  embedded?: boolean;
}

// ── Component ─────────────────────────────────────────────────

export function TradesView({ leagueId, embedded = false }: TradesViewProps) {
  const searchParams = useSearchParams();
  const { toast }    = useToast();

  // ── Core state ──────────────────────────────────────────────
  const [user, setUser]             = useState<any>(null);
  const [myTeam, setMyTeam]         = useState<any>(null);
  const [teams, setTeams]           = useState<any[]>([]);
  const [mySquad, setMySquad]       = useState<TradePlayer[]>([]);
  const [allPlayers, setAllPlayers] = useState<Record<number, string>>({});
  const [allFpts,    setAllFpts]    = useState<Record<number, number | null>>({});
  const [trades, setTrades]         = useState<any[]>([]);
  const [tab, setTab]               = useState<"inbox" | "propose" | "sent">("inbox");

  // ── Trade builder state ─────────────────────────────────────
  const [targetTeamId, setTargetTeamId] = useState("");
  const [targetSquad,  setTargetSquad]  = useState<TradePlayer[]>([]);
  const [offerIds,     setOfferIds]     = useState<number[]>([]);
  const [requestIds,   setRequestIds]   = useState<number[]>([]);
  const [myPosFilter,  setMyPosFilter]  = useState<PosFilter>("Alle");
  const [opponentPos,  setOpponentPos]  = useState<PosFilter>("Alle");
  const [sending,      setSending]      = useState(false);
  const [loading,      setLoading]      = useState(true);

  // ── Data loading ─────────────────────────────────────────────

  const loadSquad = useCallback(async (teamId: string): Promise<TradePlayer[]> => {
    const { data: sqRows } = await supabase
      .from("squad_players")
      .select("player_id, players(id, name, photo_url, position, team_name, fpts)")
      .eq("team_id", teamId);
    if (sqRows && sqRows.length > 0) {
      return sqRows.map((r: any) => r.players).filter(Boolean) as TradePlayer[];
    }
    const { data: picks } = await supabase
      .from("draft_picks")
      .select("player_id, players(id, name, photo_url, position, team_name, fpts)")
      .eq("team_id", teamId);
    return (picks || []).map((r: any) => r.players).filter(Boolean) as TradePlayer[];
  }, []);

  const loadTrades = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("liga_trades")
      .select(`*, proposer:proposer_team_id(name, user_id), receiver:receiver_team_id(name, user_id)`)
      .eq("league_id", leagueId)
      .order("created_at", { ascending: false });
    setTrades(data || []);
  }, [leagueId]);

  const loadAll = useCallback(async (userId: string) => {
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

    const teamIds = (teamsData || []).map((t: any) => t.id);
    const [{ data: allPicks }, { data: allSquad }] = await Promise.all([
      supabase.from("draft_picks").select("player_id, players(id, name, fpts)").in("team_id", teamIds),
      supabase.from("squad_players").select("player_id, players(id, name, fpts)").in("team_id", teamIds),
    ]);
    const lookup: Record<number, string> = {};
    const fptsLookup: Record<number, number | null> = {};
    for (const p of [...(allPicks || []), ...(allSquad || [])]) {
      if ((p as any).players) {
        lookup[(p as any).players.id]     = (p as any).players.name;
        fptsLookup[(p as any).players.id] = (p as any).players.fpts ?? null;
      }
    }
    setAllPlayers(lookup);
    setAllFpts(fptsLookup);

    await loadTrades(userId);
    setLoading(false);
  }, [leagueId, loadSquad, loadTrades]);

  // ── Mount ────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
      markLeagueKindAsRead(data.user.id, leagueId, [
        "trade_proposed", "trade_accepted", "trade_rejected", "trade_cancelled",
      ]);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Query params — pre-fill from Transferliste / Profil ─────
  useEffect(() => {
    if (loading) return;
    const paramReceiver = searchParams.get("receiverTeamId");
    const paramRequest  = searchParams.get("requestPlayerId");
    if (paramReceiver || paramRequest) {
      setTab("propose");
      if (paramReceiver) setTargetTeamId(paramReceiver);
      if (paramRequest)  setRequestIds([Number(paramRequest)]);
    }
  }, [loading, searchParams]);

  // ── Load target squad when team changes ─────────────────────
  useEffect(() => {
    if (!targetTeamId) { setTargetSquad([]); return; }
    setOpponentPos("Alle");
    loadSquad(targetTeamId).then(setTargetSquad);
  }, [targetTeamId, loadSquad]);

  // ── Trade actions ────────────────────────────────────────────

  async function proposeTrade() {
    if (!myTeam || !targetTeamId || offerIds.length === 0 || requestIds.length === 0) return;
    setSending(true);

    const myIds     = new Set(mySquad.map(p => p.id));
    const targetIds = new Set(targetSquad.map(p => p.id));
    const badOffer  = offerIds.filter(id => !myIds.has(id));
    const badReq    = requestIds.filter(id => !targetIds.has(id));
    if (badOffer.length > 0 || badReq.length > 0) {
      toast("Spieler nicht mehr im Kader. Bitte überprüfe die Auswahl.", "error");
      setSending(false);
      return;
    }

    const { data: tradeRow, error } = await supabase.from("liga_trades").insert({
      league_id:          leagueId,
      proposer_team_id:   myTeam.id,
      receiver_team_id:   targetTeamId,
      offer_player_ids:   offerIds,
      request_player_ids: requestIds,
      status:             "pending",
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
    toast("Trade-Angebot gesendet!", "success");
  }

  async function postSystemMessage(leagueId: string, content: string, metadata: Record<string, unknown> = {}) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      await fetch(`/api/leagues/${leagueId}/system-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ content, metadata }),
      });
    } catch {
      // Non-critical — swallow silently
    }
  }

  async function movePlayer(playerId: number, fromTeamId: string, toTeamId: string) {
    const { data: sqRow } = await supabase
      .from("squad_players").select("id")
      .eq("team_id", fromTeamId).eq("player_id", playerId).maybeSingle();
    if (sqRow) {
      await supabase.from("squad_players").update({ team_id: toTeamId }).eq("id", sqRow.id);
      return;
    }
    await supabase.from("draft_picks")
      .update({ team_id: toTeamId })
      .eq("team_id", fromTeamId)
      .eq("player_id", playerId);
  }

  async function respondTrade(tradeId: string, accept: boolean) {
    if (accept) {
      const trade = trades.find(t => t.id === tradeId);
      if (!trade) return;
      for (const pid of (trade.offer_player_ids || []))   await movePlayer(pid, trade.proposer_team_id, trade.receiver_team_id);
      for (const pid of (trade.request_player_ids || [])) await movePlayer(pid, trade.receiver_team_id, trade.proposer_team_id);
    }
    await supabase.from("liga_trades")
      .update({ status: accept ? "accepted" : "rejected", updated_at: new Date().toISOString() })
      .eq("id", tradeId);
    const trade = trades.find((t: any) => t.id === tradeId);
    if (accept) {
      const proposerName = trade?.proposer?.name ?? "Team";
      const receiverName = myTeam?.name ?? "Team";
      postSystemMessage(leagueId, `🤝 Trade abgeschlossen: ${proposerName} ↔ ${receiverName}`, {
        event: "trade_accepted",
        trade_id: tradeId,
      });
    }
    const proposerUserId = trade?.proposer?.user_id;
    if (trade && proposerUserId && myTeam) {
      await createTradeResponse({ tradeId, leagueId, proposerUserId, receiverTeamName: myTeam.name, accepted: accept });
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
      await createTradeCancelled({ tradeId, leagueId, receiverUserId, proposerTeamName: myTeam.name });
    }
    await loadTrades(user.id);
  }

  async function startCounterOffer(trade: any) {
    await supabase.from("liga_trades")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", trade.id);
    const proposerUserId = trade.proposer?.user_id;
    if (proposerUserId && myTeam) {
      await createTradeCancelled({ tradeId: trade.id, leagueId, receiverUserId: proposerUserId, proposerTeamName: myTeam.name });
    }
    setTargetTeamId(trade.proposer_team_id);
    setOfferIds(trade.request_player_ids || []);
    setRequestIds(trade.offer_player_ids || []);
    setTab("propose");
    await loadTrades(user.id);
    toast("Gegenangebot vorbereitet — passe die Spieler an und sende ab.", "success");
  }

  // ── Toggle helpers ───────────────────────────────────────────

  function toggleOffer(id: number) {
    if (!mySquad.find(p => p.id === id)) return;
    setOfferIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function toggleRequest(id: number) {
    if (!targetSquad.find(p => p.id === id)) return;
    setRequestIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  // ── Loading ──────────────────────────────────────────────────

  if (loading) {
    return embedded ? (
      <div className="flex justify-center py-12">
        <Spinner text="Lade Trades..." />
      </div>
    ) : (
      <main className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-page)" }}>
        <Spinner text="Lade Trades..." />
      </main>
    );
  }

  // ── Derived ──────────────────────────────────────────────────

  const inbox      = trades.filter(t => t.receiver?.user_id === user?.id && t.status === "pending");
  const sent       = trades.filter(t => t.proposer?.user_id === user?.id);
  const otherTeams = teams.filter(t => t.id !== myTeam?.id);

  const sortByFpts = (a: TradePlayer, b: TradePlayer) =>
    (b.fpts ?? -1) - (a.fpts ?? -1) || a.name.localeCompare(b.name);

  const mySquadFiltered = (myPosFilter === "Alle"
    ? mySquad
    : mySquad.filter(p => p.position === POS_TO_DB[myPosFilter])
  ).slice().sort(sortByFpts);

  const targetSquadFiltered = (opponentPos === "Alle"
    ? targetSquad
    : targetSquad.filter(p => p.position === POS_TO_DB[opponentPos])
  ).slice().sort(sortByFpts);

  const offerPlayers   = mySquad.filter(p => offerIds.includes(p.id));
  const requestPlayers = targetSquad.filter(p => requestIds.includes(p.id));

  const targetTeamName = teams.find(t => t.id === targetTeamId)?.name ?? "";

  const getPlayerName = (id: number) => allPlayers[id] || `#${id}`;
  const getPlayerFpts = (id: number) => allFpts[id] ?? null;

  const showSheet = tab === "propose" && targetTeamId !== "";

  // ── Inner UI (shared between embedded and standalone) ────────

  const innerUI = (
    <>
      {/* Tab bar */}
      <div
        className="flex gap-1 w-full max-w-md mb-5 p-1 rounded-xl"
        style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}
      >
        {([
          { id: "inbox",   label: `Eingang${inbox.length > 0 ? ` (${inbox.length})` : ""}` },
          { id: "propose", label: "Trade Builder" },
          { id: "sent",    label: "Gesendet" },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex-1 py-2 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all"
            style={{
              background: tab === t.id ? "var(--color-primary)" : "transparent",
              color: tab === t.id
                ? "var(--bg-page)"
                : t.id === "inbox" && inbox.length > 0
                  ? "var(--color-primary)"
                  : "var(--color-muted)",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── INBOX ───────────────────────────────────────────── */}
      {tab === "inbox" && (
        <div className="w-full max-w-md space-y-3">
          {inbox.length === 0 ? (
            <div className="rounded-2xl py-10 flex flex-col items-center gap-3"
              style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
              <p className="text-2xl">⇄</p>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                Keine offenen Trades
              </p>
              <button
                onClick={() => setTab("propose")}
                className="px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest"
                style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}
              >
                Trade erstellen
              </button>
            </div>
          ) : inbox.map(t => (
            <TradeInboxCard
              key={t.id}
              trade={t}
              getPlayerName={getPlayerName}
              getPlayerFpts={getPlayerFpts}
              onAccept={id => respondTrade(id, true)}
              onReject={id => respondTrade(id, false)}
              onCounter={startCounterOffer}
            />
          ))}
        </div>
      )}

      {/* ── TRADE BUILDER ───────────────────────────────────── */}
      {tab === "propose" && (
        <div className="w-full max-w-md flex flex-col gap-3" style={{ paddingBottom: showSheet ? "240px" : "0" }}>
          {/* Team selector */}
          <div className="rounded-xl p-3" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <p className="text-[8px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>
              Mit welchem Manager?
            </p>
            <div className="flex flex-wrap gap-1.5">
              {otherTeams.map(t => (
                <button key={t.id} onClick={() => setTargetTeamId(t.id === targetTeamId ? "" : t.id)}
                  className="px-3 py-1.5 rounded-xl text-[9px] font-black transition-all"
                  style={{
                    background: targetTeamId === t.id ? "var(--bg-card)" : "var(--bg-page)",
                    border: `1px solid ${targetTeamId === t.id ? "var(--color-primary)" : "var(--color-border)"}`,
                    color:  targetTeamId === t.id ? "var(--color-primary)" : "var(--color-muted)",
                  }}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          {/* Two-column builder */}
          {targetTeamId ? (
            <div className="grid grid-cols-2 gap-2">
              {/* Left: Mein Kader */}
              <div className="flex flex-col gap-1.5">
                <ColumnHeader label="Ich gebe" teamName={myTeam?.name ?? "Mein Team"} count={offerIds.length} color="var(--color-error)" squad={mySquad} />
                <PosFilterRow value={myPosFilter} onChange={setMyPosFilter} />
                <div className="flex flex-col gap-1">
                  {mySquadFiltered.length === 0 ? (
                    <p className="text-[8px] text-center py-4" style={{ color: "var(--color-muted)" }}>Keine Spieler</p>
                  ) : mySquadFiltered.map(p => (
                    <TradePlayerCard key={p.id} player={p} selected={offerIds.includes(p.id)} onToggle={() => toggleOffer(p.id)} side="offer" />
                  ))}
                </div>
              </div>
              {/* Right: Gegner */}
              <div className="flex flex-col gap-1.5">
                <ColumnHeader label="Ich bekomme" teamName={targetTeamName} count={requestIds.length} color="rgba(48,196,164,0.85)" squad={targetSquad} />
                <PosFilterRow value={opponentPos} onChange={setOpponentPos} />
                <div className="flex flex-col gap-1">
                  {targetSquad.length === 0 ? (
                    <div className="flex justify-center py-6"><Spinner /></div>
                  ) : targetSquadFiltered.length === 0 ? (
                    <p className="text-[8px] text-center py-4" style={{ color: "var(--color-muted)" }}>Keine Spieler</p>
                  ) : targetSquadFiltered.map(p => (
                    <TradePlayerCard key={p.id} player={p} selected={requestIds.includes(p.id)} onToggle={() => toggleRequest(p.id)} side="request" />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl py-10 text-center" style={{ border: "1px dashed var(--color-border)" }}>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                Team auswählen um zu starten
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── GESENDET ────────────────────────────────────────── */}
      {tab === "sent" && (
        <div className="w-full max-w-md space-y-3">
          {sent.length === 0 ? (
            <EmptyState title="Noch keine Trades gesendet" />
          ) : sent.map(t => (
            <TradeSentCard
              key={t.id}
              trade={t}
              getPlayerName={getPlayerName}
              getPlayerFpts={getPlayerFpts}
              onCancel={cancelTrade}
            />
          ))}
        </div>
      )}

      {/* Trade Proposal Sheet */}
      {showSheet && (
        <TradeProposalSheet
          offerPlayers={offerPlayers}
          requestPlayers={requestPlayers}
          onRemoveOffer={id => setOfferIds(prev => prev.filter(x => x !== id))}
          onRemoveRequest={id => setRequestIds(prev => prev.filter(x => x !== id))}
          onSend={proposeTrade}
          sending={sending}
        />
      )}
    </>
  );

  // ── Embedded: plain div, no header, no BottomNav ─────────────
  if (embedded) {
    return (
      <div className="flex flex-col items-center w-full pt-3 pb-4">
        {innerUI}
      </div>
    );
  }

  // ── Standalone: full page layout ─────────────────────────────
  return (
    <main
      className="flex min-h-screen flex-col items-center p-4 pb-28"
      style={{ background: "var(--bg-page)" }}
    >
      {/* Ambient glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "var(--color-info)" }} />

      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-center mb-5">
        <button
          onClick={() => window.location.href = `/leagues/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest"
          style={{ color: "var(--color-muted)" }}
        >
          ← Liga
        </button>
        <h1 className="text-sm font-black uppercase tracking-widest" style={{ color: "var(--color-text)" }}>
          Trades
        </h1>
        <div />
      </div>

      {innerUI}

      <BottomNav />
    </main>
  );
}
