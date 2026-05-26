"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { PlayerCardTransfer } from "@/app/components/players/PlayerCardTransfer";
import { normalizeTransferPlayer } from "@/lib/players/normalizePlayer";
import { Spinner } from "@/app/components/ui/Spinner";

// ── Exported types ────────────────────────────────────────────

/** Raw player data passed to the parent's onPlayerClick handler */
export type MarketPlayerInfo = {
  id:        number;
  name:      string;
  photo_url: string | null;
  position:  string;       // raw DB format: GK | DF | MF | FW
  team_name: string | null;
  fpts:      number | null;
  goals:     number | null;
  assists:   number | null;
};

// ── Internal types ────────────────────────────────────────────

type PlayerEntry = {
  vm:             ReturnType<typeof normalizeTransferPlayer>;
  raw:            MarketPlayerInfo;
  status:         "available" | "mine" | "taken";
  ownerTeamName?: string;
  ownerTeamId?:   string;
};

type TransferListing = {
  id:              string;
  team_id:         string;
  player_id:       number;
  note:            string | null;
  created_at:      string;
  owner_team_name: string | null;
  player:          MarketPlayerInfo | null;
};

type ActionSheet = {
  player:        MarketPlayerInfo;
  status:        "mine" | "taken" | "available";
  ownerTeamName: string | undefined;
  ownerTeamId:   string | undefined;
};

type ViewMode     = "available" | "all" | "transferliste";
type StatusFilter = "alle" | "mine" | "other";
type PosFilter    = "Alle" | "ST" | "MF" | "AB" | "TW";
type SortValue    = "fpts" | "goals" | "assists" | "name" | "avg" | "lastgw" | "cs" | "age";

// ── Constants ─────────────────────────────────────────────────

const POS_TO_DB: Record<string, string> = { TW: "GK", AB: "DF", MF: "MF", ST: "FW" };
const POS_FILTERS: PosFilter[]          = ["Alle", "ST", "MF", "AB", "TW"];
const GOLD  = "rgba(244,196,48,";
const TEAL  = "rgba(48,196,164,";

const SORT_OPTIONS: {
  value:   SortValue;
  label:   string;
  dbCol:   string | null;
  asc:     boolean;
}[] = [
  { value: "fpts",    label: "Gesamtpunkte", dbCol: "fpts",    asc: false },
  { value: "goals",   label: "Tore",         dbCol: "goals",   asc: false },
  { value: "assists", label: "Assists",       dbCol: "assists", asc: false },
  { value: "name",    label: "Name",          dbCol: "name",    asc: true  },
  { value: "avg",     label: "Ø Punkte",      dbCol: null,      asc: false },
  { value: "lastgw",  label: "Letzter GW",    dbCol: null,      asc: false },
  { value: "cs",      label: "Clean Sheets",  dbCol: null,      asc: false },
  { value: "age",     label: "Alter",         dbCol: null,      asc: true  },
];

const POS_LABEL: Record<string, string> = { GK: "TW", DF: "AB", MF: "MF", FW: "ST" };

// ── Props ─────────────────────────────────────────────────────

export interface MarketTabProps {
  leagueId:       string;
  myTeamId?:      string | null;
  refreshKey?:    number;
  onPlayerClick?: (
    player:         MarketPlayerInfo,
    status:         "available" | "mine" | "taken",
    ownerTeamName?: string,
    ownerTeamId?:   string,
  ) => void;
}

// ── Auth helper ───────────────────────────────────────────────

async function getAuthHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

// ── Component ─────────────────────────────────────────────────

export function MarketTab({ leagueId, myTeamId, refreshKey, onPlayerClick }: MarketTabProps) {
  const [search,           setSearch]           = useState("");
  const [posFilter,        setPosFilter]        = useState<PosFilter>("Alle");
  const [viewMode,         setViewMode]         = useState<ViewMode>("available");
  const [statusFilter,     setStatusFilter]     = useState<StatusFilter>("alle");
  const [sortBy,           setSortBy]           = useState<SortValue>("fpts");
  const [players,          setPlayers]          = useState<PlayerEntry[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [fetching,         setFetching]         = useState(false);
  const [initKey,          setInitKey]          = useState(0);

  // Transferliste state
  const [listings,         setListings]         = useState<TransferListing[]>([]);
  const [listingsFetching, setListingsFetching] = useState(false);
  const [listingsError,    setListingsError]    = useState<string | null>(null);
  const [myListedIds,      setMyListedIds]      = useState<Set<number>>(new Set());

  // Action sheet + toast
  const [actionSheet,      setActionSheet]      = useState<ActionSheet | null>(null);
  const [actionLoading,    setActionLoading]    = useState(false);
  const [toastMsg,         setToastMsg]         = useState<string | null>(null);

  // Refs
  const takenSet  = useRef(new Set<number>());
  const mineSet   = useRef(new Set<number>());
  const ownerMap  = useRef(new Map<number, string>());
  const teamNames = useRef(new Map<string, string>());
  const wmMode    = useRef<{ nationNames: string[]; hasTestPlayers: boolean } | null>(null);

  // ── One-time: load taken IDs + team names ─────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const { data: teams } = await supabase
        .from("teams").select("id, name").eq("league_id", leagueId);

      const teamIds = (teams ?? []).map((t: any) => t.id as string);
      const tNames  = new Map<string, string>(
        (teams ?? []).map((t: any) => [t.id as string, t.name as string])
      );

      const tSet = new Set<number>();
      const mSet = new Set<number>();
      const oMap = new Map<number, string>();

      if (teamIds.length > 0) {
        const [picks, squad] = await Promise.all([
          supabase.from("draft_picks").select("player_id, team_id").in("team_id", teamIds),
          supabase.from("squad_players").select("player_id, team_id").in("team_id", teamIds),
        ]);
        for (const r of (picks.data ?? [])) {
          tSet.add(r.player_id);
          if (!oMap.has(r.player_id)) oMap.set(r.player_id, r.team_id);
          if (myTeamId && r.team_id === myTeamId) mSet.add(r.player_id);
        }
        for (const r of (squad.data ?? [])) {
          tSet.add(r.player_id);
          if (!oMap.has(r.player_id)) oMap.set(r.player_id, r.team_id);
          if (myTeamId && r.team_id === myTeamId) mSet.add(r.player_id);
        }
      }

      // WM-Modus: Nationen + Testspieler-Guard + wm_squad_players für Ownership
      const { data: wmSettings } = await supabase
        .from("wm_league_settings")
        .select("tournament_id")
        .eq("league_id", leagueId)
        .maybeSingle();

      if (wmSettings?.tournament_id) {
        const [nationsRes, testCheckRes] = await Promise.all([
          supabase.from("wm_nations").select("name").eq("tournament_id", wmSettings.tournament_id),
          supabase.from("players").select("id").gte("id", 90001).lte("id", 90120).limit(1),
        ]);
        const nationNames = (nationsRes.data ?? []).map((n: any) => n.name as string);
        wmMode.current = {
          nationNames,
          hasTestPlayers: (testCheckRes.data?.length ?? 0) > 0,
        };

        // Ownership aus wm_squad_players (ergänzt squad_players, falls Backfill fehlt)
        if (teamIds.length > 0) {
          const { data: wmSquad } = await supabase
            .from("wm_squad_players")
            .select("player_id, team_id")
            .in("team_id", teamIds);
          for (const r of (wmSquad ?? [])) {
            tSet.add(r.player_id);
            if (!oMap.has(r.player_id)) oMap.set(r.player_id, r.team_id);
            if (myTeamId && r.team_id === myTeamId) mSet.add(r.player_id);
          }
        }
      } else {
        wmMode.current = null;
      }

      if (!cancelled) {
        takenSet.current  = tSet;
        mineSet.current   = mSet;
        ownerMap.current  = oMap;
        teamNames.current = tNames;
        setLoading(false);
        setInitKey(k => k + 1);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [leagueId, myTeamId, refreshKey]);

  // ── Fetch all active listings (used for Transferliste view + myListedIds) ──

  const fetchListings = useCallback(async () => {
    setListingsFetching(true);
    setListingsError(null);
    try {
      const headers = await getAuthHeader();
      const res  = await fetch(`/api/leagues/${leagueId}/transfer-listings`, { headers });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Fehler beim Laden");
      const all = json.listings as TransferListing[];
      setListings(all);
      // Derive my listed IDs from the full set
      if (myTeamId) {
        setMyListedIds(new Set(all.filter(l => l.team_id === myTeamId).map(l => l.player_id)));
      }
    } catch {
      setListingsError("Transferliste konnte nicht geladen werden");
    } finally {
      setListingsFetching(false);
    }
  }, [leagueId, myTeamId]);

  // Lightweight refresh of just myListedIds (without touching full listings state)
  const refreshMyListedIds = useCallback(async () => {
    if (!myTeamId) return;
    try {
      const headers = await getAuthHeader();
      const res  = await fetch(`/api/leagues/${leagueId}/transfer-listings`, { headers });
      const json = await res.json();
      if (!json.ok) return;
      const all = json.listings as TransferListing[];
      setMyListedIds(new Set(all.filter(l => l.team_id === myTeamId).map(l => l.player_id)));
      // Also update listings if we're in that view (avoid stale list)
      if (viewMode === "transferliste") setListings(all);
    } catch {
      // silently fail — table may not exist yet
    }
  }, [leagueId, myTeamId, viewMode]);

  // ── Player fetch ─────────────────────────────────────────────
  const fetchPlayers = useCallback(async (
    q: string, pos: PosFilter, mode: ViewMode, status: StatusFilter, sort: SortValue,
  ) => {
    setFetching(true);

    const sortOpt = SORT_OPTIONS.find(s => s.value === sort) ?? SORT_OPTIONS[0];
    const dbCol   = (sortOpt.dbCol ?? "fpts") as string;

    if (mode === "all" && status === "mine") {
      const mineIds = Array.from(mineSet.current);
      if (mineIds.length === 0) { setPlayers([]); setFetching(false); return; }
      let q2 = supabase
        .from("players")
        .select("id, name, photo_url, position, team_name, api_team_id, fpts, goals, assists")
        .in("id", mineIds)
        .order(dbCol, { ascending: sortOpt.asc, nullsFirst: false });
      if (q.length >= 2) q2 = q2.ilike("name", `%${q}%`);
      if (pos !== "Alle")  q2 = q2.eq("position", POS_TO_DB[pos]);
      const { data } = await q2;
      build(data as MarketPlayerInfo[] ?? []);
      return;
    }

    let query = supabase
      .from("players")
      .select("id, name, photo_url, position, team_name, api_team_id, fpts, goals, assists")
      .order(dbCol, { ascending: sortOpt.asc, nullsFirst: false })
      .limit(80);

    if (q.length >= 2) query = query.ilike("name", `%${q}%`);
    if (pos !== "Alle")  query = query.eq("position", POS_TO_DB[pos]);

    // WM-Filter: nur Spieler passender Nationen, im Testbetrieb nur IDs 90001–90200
    if (wmMode.current) {
      const { nationNames, hasTestPlayers } = wmMode.current;
      if (hasTestPlayers) {
        query = query.gte("id", 90001).lte("id", 90200).in("team_name", nationNames);
      } else {
        query = query.in("team_name", nationNames);
      }
    }

    if (mode === "available") {
      const excluded = Array.from(takenSet.current);
      if (excluded.length > 0) query = query.not("id", "in", `(${excluded.join(",")})`);
    }

    const { data } = await query;
    let rows = (data ?? []) as MarketPlayerInfo[];

    if (mode === "all" && status === "other") {
      rows = rows.filter(p => takenSet.current.has(p.id) && !mineSet.current.has(p.id));
    }

    build(rows);

    function build(rows: MarketPlayerInfo[]) {
      setPlayers(rows.map(p => {
        const isMine  = mineSet.current.has(p.id);
        const isTaken = takenSet.current.has(p.id);
        const st: PlayerEntry["status"] = isMine ? "mine" : isTaken ? "taken" : "available";
        const ownerTeamId   = ownerMap.current.get(p.id);
        const ownerTeamName = ownerTeamId ? teamNames.current.get(ownerTeamId) : undefined;
        return {
          vm: normalizeTransferPlayer({
            id:          p.id,
            name:        p.name,
            photo_url:   p.photo_url,
            position:    p.position,
            team_name:   p.team_name ?? undefined,
            api_team_id: (p as any).api_team_id,
            fpts:        p.fpts ?? undefined,
          }),
          raw: p,
          status: st,
          ownerTeamName,
          ownerTeamId,
        };
      }));
      setFetching(false);
    }
  }, []);

  // ── Effects ───────────────────────────────────────────────────

  // Re-fetch players on filter change
  useEffect(() => {
    if (loading) return;
    if (viewMode === "transferliste") return;
    const delay = search.length > 0 ? 280 : 0;
    const t = setTimeout(
      () => fetchPlayers(search, posFilter, viewMode, statusFilter, sortBy),
      delay,
    );
    return () => clearTimeout(t);
  }, [loading, initKey, search, posFilter, viewMode, statusFilter, sortBy, fetchPlayers]);

  // Fetch listings + myListedIds when switching to transferliste view
  useEffect(() => {
    if (viewMode === "transferliste") fetchListings();
  }, [viewMode, refreshKey, fetchListings]);

  // Load/refresh myListedIds on mount and whenever parent triggers refreshKey
  useEffect(() => {
    if (!loading && myTeamId) refreshMyListedIds();
  }, [loading, myTeamId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset status sub-filter when switching away from "all"
  useEffect(() => {
    if (viewMode !== "all") setStatusFilter("alle");
  }, [viewMode]);

  // ── Toast helper ──────────────────────────────────────────────

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2800);
  }

  // ── Listing action (POST / PATCH) ─────────────────────────────

  async function handleListingAction() {
    if (!actionSheet || !myTeamId) return;
    const { player } = actionSheet;
    const isListed   = myListedIds.has(player.id);
    setActionLoading(true);

    try {
      const headers = await getAuthHeader();

      if (isListed) {
        await fetch(`/api/leagues/${leagueId}/transfer-listings`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ playerId: player.id }),
        });
        showToast("Spieler von Transferliste entfernt");
      } else {
        await fetch(`/api/leagues/${leagueId}/transfer-listings`, {
          method: "POST",
          headers,
          body: JSON.stringify({ playerId: player.id }),
        });
        showToast("Spieler auf Transferliste gesetzt");
      }
    } finally {
      setActionLoading(false);
      setActionSheet(null);
      await refreshMyListedIds();
    }
  }

  // ── Render helpers ────────────────────────────────────────────

  function openActionSheet(player: MarketPlayerInfo, status: ActionSheet["status"], ownerTeamName?: string, ownerTeamId?: string) {
    setActionSheet({ player, status, ownerTeamName, ownerTeamId });
  }

  function handlePlayerCardClick(
    player:        MarketPlayerInfo,
    status:        "available" | "mine" | "taken",
    ownerTeamName: string | undefined,
    ownerTeamId:   string | undefined,
  ) {
    // Intercept own players — show action sheet with listing option
    if (status === "mine" && myTeamId) {
      openActionSheet(player, "mine", ownerTeamName, ownerTeamId);
    } else {
      onPlayerClick?.(player, status, ownerTeamName, ownerTeamId);
    }
  }

  // ── Early return while loading ────────────────────────────────

  if (loading) {
    return <div className="flex justify-center py-12"><Spinner /></div>;
  }

  // ── Derived state ─────────────────────────────────────────────

  const filteredListings = listings.filter(l => {
    const p = l.player;
    if (!p) return false;
    if (search.length >= 2 && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (posFilter !== "Alle" && p.position !== POS_TO_DB[posFilter]) return false;
    return true;
  });

  const isTransferView = viewMode === "transferliste";
  const showEmpty      = !fetching && !isTransferView && players.length === 0;
  const showListEmpty  = !listingsFetching && isTransferView && filteredListings.length === 0;

  return (
    <div className="w-full max-w-md flex flex-col gap-3">

      {/* ── Primary toggle: Verfügbar | Alle | Transferliste ─── */}
      <div className="flex rounded-xl overflow-hidden"
        style={{ border: "1px solid var(--color-border)", background: "var(--bg-elevated)" }}>
        {(["available", "all", "transferliste"] as ViewMode[]).map(m => {
          const label  = m === "available" ? "Verfügbar" : m === "all" ? "Alle Spieler" : "Transferliste";
          const active = viewMode === m;
          return (
            <button key={m} onClick={() => setViewMode(m)}
              className="flex-1 py-2 text-[9px] font-black uppercase tracking-widest transition-all"
              style={{
                background: active ? (m === "transferliste" ? `${TEAL}0.85)` : "var(--color-primary)") : "transparent",
                color:      active ? "var(--bg-page)" : "var(--color-muted)",
              }}>
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Search ───────────────────────────────────────────── */}
      <div className="relative">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Spieler suchen…"
          className="w-full rounded-xl px-4 py-2.5 text-sm"
          style={{
            background: "var(--bg-elevated)",
            border:     "1px solid var(--color-border)",
            color:      "var(--color-text)",
            outline:    "none",
          }}
        />
        {search && (
          <button onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
            style={{ color: "var(--color-muted)" }}>
            ✕
          </button>
        )}
      </div>

      {/* ── Position filter ───────────────────────────────────── */}
      <div className="flex gap-1">
        {POS_FILTERS.map(f => (
          <button key={f} onClick={() => setPosFilter(f)}
            className="flex-1 rounded-md py-1 text-[8px] font-black uppercase leading-none"
            style={{
              background: posFilter === f ? "var(--color-primary)" : "var(--bg-elevated)",
              color:      posFilter === f ? "var(--bg-page)"       : "var(--color-muted)",
              border:     `1px solid ${posFilter === f ? "var(--color-primary)" : "var(--color-border)"}`,
            }}>
            {f}
          </button>
        ))}
      </div>

      {/* ── Sort + status sub-filter — hidden in Transferliste ── */}
      {!isTransferView && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortValue)}
              className="w-full appearance-none rounded-lg px-3 py-1.5 text-[8px] font-black uppercase pr-6"
              style={{
                background: "var(--bg-elevated)",
                border:     "1px solid var(--color-border)",
                color:      "var(--color-muted)",
                outline:    "none",
              }}>
              {SORT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value} disabled={!opt.dbCol}>
                  {opt.label}{!opt.dbCol ? " –" : ""}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[8px]"
              style={{ color: "var(--color-muted)" }}>▾</span>
          </div>

          {viewMode === "all" && (
            <div className="flex gap-1 flex-shrink-0">
              {([
                { v: "alle",  l: "Alle"   },
                { v: "mine",  l: "Mein"   },
                { v: "other", l: "Belegt" },
              ] as { v: StatusFilter; l: string }[]).map(({ v, l }) => (
                <button key={v} onClick={() => setStatusFilter(v)}
                  className="rounded-md px-2 py-1 text-[7px] font-black uppercase leading-none whitespace-nowrap"
                  style={{
                    background: statusFilter === v ? "var(--color-primary)" : "var(--bg-elevated)",
                    color:      statusFilter === v ? "var(--bg-page)"       : "var(--color-muted)",
                    border:     `1px solid ${statusFilter === v ? "var(--color-primary)" : "var(--color-border)"}`,
                  }}>
                  {l}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Liga / Verein placeholder — hidden in Transferliste ── */}
      {!isTransferView && (
        <div className="flex gap-2 opacity-30 pointer-events-none">
          <button className="flex-1 rounded-lg py-1 text-[7px] font-black uppercase"
            style={{ background: "var(--bg-elevated)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
            Liga (bald)
          </button>
          <button className="flex-1 rounded-lg py-1 text-[7px] font-black uppercase"
            style={{ background: "var(--bg-elevated)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
            Verein (bald)
          </button>
        </div>
      )}

      {/* ── Transferliste view ────────────────────────────────── */}
      {isTransferView && (
        listingsFetching ? (
          <div className="flex justify-center py-8"><Spinner /></div>

        ) : listingsError ? (
          <div className="rounded-xl p-5 text-center"
            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <p className="text-[9px] font-black uppercase tracking-widest"
              style={{ color: "var(--color-error)" }}>
              {listingsError}
            </p>
          </div>

        ) : showListEmpty ? (
          <div className="rounded-xl p-6 text-center flex flex-col gap-2"
            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <p className="text-[10px] font-black uppercase tracking-widest"
              style={{ color: "var(--color-muted)" }}>
              Keine Spieler angeboten
            </p>
            <p className="text-[8px]" style={{ color: "var(--color-muted)", opacity: 0.6 }}>
              Tippe auf einen deiner Spieler im Markt, um ihn anzubieten.
            </p>
          </div>

        ) : (
          <div className="flex flex-col gap-2 pb-8">
            {filteredListings.map(listing => {
              if (!listing.player) return null;
              const p      = listing.player;
              const isMine = listing.team_id === myTeamId;
              const status: "mine" | "taken" = isMine ? "mine" : "taken";

              const vm = normalizeTransferPlayer({
                id:          p.id,
                name:        p.name,
                photo_url:   p.photo_url,
                position:    p.position,
                team_name:   p.team_name ?? undefined,
                api_team_id: undefined,
                fpts:        p.fpts ?? undefined,
              });

              return (
                <div key={listing.id}>
                  <div className="relative">
                    <PlayerCardTransfer
                      player={vm}
                      highlight={isMine}
                      onClick={() => handlePlayerCardClick(p, status, listing.owner_team_name ?? undefined, listing.team_id)}
                    />

                    {/* Transferliste badge top-right */}
                    <div className="absolute top-2 right-3 pointer-events-none flex flex-col items-end gap-1">
                      <span className="text-[6px] font-black uppercase px-1.5 py-0.5 rounded"
                        style={{
                          background: `${TEAL}0.12)`,
                          color:      `${TEAL}0.80)`,
                          border:     `1px solid ${TEAL}0.25)`,
                        }}>
                        {isMine ? "Angeboten" : "Transferliste"}
                      </span>
                      {!isMine && listing.owner_team_name && (
                        <span className="text-[6px] font-black uppercase"
                          style={{ color: "rgba(255,255,255,0.35)" }}>
                          {listing.owner_team_name}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Note bubble */}
                  {listing.note && (
                    <div className="mx-2 mb-1 px-2.5 py-1 rounded-b-lg -mt-1"
                      style={{
                        background: "var(--bg-elevated)",
                        border:     "1px solid var(--color-border)",
                        borderTop:  "none",
                      }}>
                      <p className="text-[7px]" style={{ color: "var(--color-muted)" }}>
                        💬 {listing.note}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Player list (Verfügbar / Alle) ─────────────────────── */}
      {!isTransferView && (
        fetching ? (
          <div className="flex justify-center py-8"><Spinner /></div>

        ) : showEmpty ? (
          <div className="rounded-xl p-5 text-center"
            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <p className="text-[9px] font-black uppercase tracking-widest"
              style={{ color: "var(--color-muted)" }}>
              Keine Spieler gefunden
            </p>
          </div>

        ) : (
          <div className="flex flex-col gap-2 pb-8">
            {players.map(({ vm, raw, status, ownerTeamName, ownerTeamId }) => {
              const isListed = status === "mine" && myListedIds.has(raw.id);
              return (
                <div key={vm.id} className="relative">
                  <PlayerCardTransfer
                    player={vm}
                    highlight={status === "mine"}
                    onClick={() => handlePlayerCardClick(raw, status, ownerTeamName, ownerTeamId)}
                  />

                  {/* Mine player badges (bottom-right) */}
                  {status === "mine" && (
                    <div className="absolute bottom-2 right-3 pointer-events-none flex flex-col items-end gap-1">
                      {isListed ? (
                        <span className="text-[6px] font-black uppercase px-1.5 py-0.5 rounded"
                          style={{
                            background: `${TEAL}0.12)`,
                            color:      `${TEAL}0.80)`,
                            border:     `1px solid ${TEAL}0.25)`,
                          }}>
                          Angeboten
                        </span>
                      ) : (
                        <span className="text-[6px] font-black uppercase px-1.5 py-0.5 rounded"
                          style={{
                            background: `${GOLD}0.10)`,
                            color:      `${GOLD}0.68)`,
                            border:     `1px solid ${GOLD}0.20)`,
                          }}>
                          Mein Kader
                        </span>
                      )}
                    </div>
                  )}

                  {/* "Belegt" overlay */}
                  {status === "taken" && (
                    <div className="absolute inset-0 rounded-[10px] pointer-events-none flex items-center justify-end pr-3"
                      style={{ background: "rgba(9,12,9,0.50)" }}>
                      <div className="flex flex-col items-end gap-0.5">
                        {ownerTeamName && (
                          <span className="text-[6px] font-black uppercase"
                            style={{ color: "rgba(255,255,255,0.22)" }}>
                            {ownerTeamName}
                          </span>
                        )}
                        <span className="text-[7px] font-black uppercase px-2 py-0.5 rounded"
                          style={{
                            background: "rgba(0,0,0,0.75)",
                            color:      "rgba(255,255,255,0.28)",
                            border:     "1px solid rgba(255,255,255,0.06)",
                          }}>
                          Belegt
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Action Sheet (mine player clicked) ───────────────── */}
      {actionSheet && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onClick={() => setActionSheet(null)}>
          <div
            className="w-full rounded-t-2xl flex flex-col"
            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}
            onClick={e => e.stopPropagation()}>

            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-9 h-1 rounded-full" style={{ background: "var(--color-border)" }} />
            </div>

            {/* Player info */}
            <div className="px-5 pt-2 pb-4 flex items-center gap-3"
              style={{ borderBottom: "1px solid var(--color-border)" }}>
              <div className="flex flex-col flex-1 min-w-0">
                <p className="text-xs font-black truncate" style={{ color: "var(--color-text)" }}>
                  {actionSheet.player.name}
                </p>
                <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                  {POS_LABEL[actionSheet.player.position] ?? actionSheet.player.position}
                  {actionSheet.player.team_name ? ` · ${actionSheet.player.team_name}` : ""}
                </p>
              </div>
              {actionSheet.player.fpts != null && (
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-black" style={{ color: "var(--color-primary)" }}>
                    {actionSheet.player.fpts.toFixed(0)}
                  </p>
                  <p className="text-[7px] font-black uppercase" style={{ color: "var(--color-muted)" }}>PTS</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 px-4 py-4">

              {/* Listing toggle */}
              <button
                disabled={actionLoading}
                onClick={handleListingAction}
                className="w-full rounded-xl py-3 text-xs font-black uppercase tracking-wider transition-all"
                style={{
                  background: myListedIds.has(actionSheet.player.id)
                    ? "rgba(220,60,60,0.12)"
                    : `${TEAL}0.15)`,
                  color: myListedIds.has(actionSheet.player.id)
                    ? "var(--color-error)"
                    : `${TEAL}0.90)`,
                  border: `1px solid ${myListedIds.has(actionSheet.player.id)
                    ? "rgba(220,60,60,0.25)"
                    : `${TEAL}0.30)`}`,
                  opacity: actionLoading ? 0.5 : 1,
                }}>
                {actionLoading
                  ? "Bitte warten…"
                  : myListedIds.has(actionSheet.player.id)
                    ? "Von Transferliste entfernen"
                    : "Auf Transferliste setzen"}
              </button>

              {/* Open profile */}
              {onPlayerClick && (
                <button
                  onClick={() => {
                    const { player, status, ownerTeamName, ownerTeamId } = actionSheet;
                    setActionSheet(null);
                    onPlayerClick(player, status, ownerTeamName, ownerTeamId);
                  }}
                  className="w-full rounded-xl py-3 text-xs font-black uppercase tracking-wider"
                  style={{
                    background: "var(--bg-elevated)",
                    color:      "var(--color-muted)",
                    border:     "1px solid var(--color-border)",
                  }}>
                  Spielerprofil öffnen
                </button>
              )}

              {/* Cancel */}
              <button
                onClick={() => setActionSheet(null)}
                className="w-full py-2.5 text-[9px] font-black uppercase tracking-wider"
                style={{ color: "var(--color-muted)" }}>
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ────────────────────────────────────────────── */}
      {toastMsg && (
        <div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider whitespace-nowrap"
          style={{
            background: "var(--bg-card)",
            border:     `1px solid ${TEAL}0.35)`,
            color:      `${TEAL}0.90)`,
            boxShadow:  `0 4px 24px ${TEAL}0.15)`,
          }}>
          {toastMsg}
        </div>
      )}
    </div>
  );
}
