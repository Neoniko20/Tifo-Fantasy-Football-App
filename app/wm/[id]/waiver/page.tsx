"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { WaiverClaim } from "@/lib/wm-types";

const POS_COLOR: Record<string, string> = {
  GK: "#f5a623", DF: "#4a9eff", MF: "#00ce7d", FW: "#ff4d6d",
};

type Player = {
  id: number;
  name: string;
  photo_url: string;
  position: string;
  team_name: string;
  fpts: number;
};

export default function WaiverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);

  const [user, setUser] = useState<any>(null);
  const [myTeam, setMyTeam] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [myPriority, setMyPriority] = useState<number | null>(null);
  const [allPriorities, setAllPriorities] = useState<any[]>([]);
  const [waiverWire, setWaiverWire] = useState<Player[]>([]);
  const [myClaims, setMyClaims] = useState<WaiverClaim[]>([]);
  const [mySquad, setMySquad] = useState<Player[]>([]);
  const [currentGW, setCurrentGW] = useState(4);
  const [windowOpen, setWindowOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [playerOut, setPlayerOut] = useState<number | null>(null);
  const [bidAmount, setBidAmount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
    });
  }, []);

  async function loadAll(userId: string) {
    // Settings
    const { data: settingsData } = await supabase
      .from("wm_league_settings").select("*").eq("league_id", leagueId).maybeSingle();
    setSettings(settingsData);

    // Mein Team
    const { data: team } = await supabase
      .from("teams").select("*").eq("league_id", leagueId).eq("user_id", userId).single();
    setMyTeam(team);

    if (!team) return;

    // Aktueller Gameweek
    const { data: gwData } = await supabase
      .from("wm_gameweeks")
      .select("*")
      .eq("tournament_id", settingsData?.tournament_id)
      .eq("status", "active")
      .maybeSingle();
    if (gwData) {
      setCurrentGW(gwData.gameweek);
      setWindowOpen(gwData.waiver_window_open);
    }

    // Waiver Priority
    const { data: priorities } = await supabase
      .from("waiver_priority")
      .select("*, teams(name)")
      .eq("league_id", leagueId)
      .order("priority");
    setAllPriorities(priorities || []);
    const myP = (priorities || []).find((p: any) => p.team_id === team.id);
    setMyPriority(myP?.priority || null);

    // Waiver Wire (verfügbare Spieler)
    const { data: wire } = await supabase
      .from("waiver_wire")
      .select("player_id")
      .eq("league_id", leagueId)
      .eq("status", "available");

    if (wire && wire.length > 0) {
      const ids = wire.map((w: any) => w.player_id);
      const { data: playersData } = await supabase
        .from("players").select("*").in("id", ids).order("fpts", { ascending: false });
      setWaiverWire(playersData || []);
    }

    // Mein Kader
    const { data: squad } = await supabase
      .from("squad_players").select("player_id").eq("team_id", team.id);
    if (squad && squad.length > 0) {
      const ids = squad.map((s: any) => s.player_id);
      const { data: squadPlayers } = await supabase
        .from("players").select("*").in("id", ids);
      setMySquad(squadPlayers || []);
    }

    // Meine Claims
    const { data: claims } = await supabase
      .from("waiver_claims")
      .select("*")
      .eq("league_id", leagueId)
      .eq("team_id", team.id)
      .eq("gameweek", gwData?.gameweek || currentGW)
      .order("created_at");
    setMyClaims(claims || []);
  }

  async function submitClaim() {
    if (!selectedPlayer || !myTeam) return;
    if (!windowOpen) { setMessage({ text: "Waiver-Fenster ist geschlossen", ok: false }); return; }

    const maxClaims = settings?.waiver_max_claims_per_gameweek || 3;
    if (settings?.waiver_claims_limit_enabled && myClaims.filter(c => c.status === "pending").length >= maxClaims) {
      setMessage({ text: `Max. ${maxClaims} Claims pro GW erreicht`, ok: false });
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.from("waiver_claims").insert({
      league_id: leagueId,
      team_id: myTeam.id,
      player_in: selectedPlayer.id,
      player_out: playerOut || null,
      gameweek: currentGW,
      priority: myPriority || 999,
      bid_amount: settings?.waiver_budget_enabled ? bidAmount : 0,
      status: "pending",
    });

    setSubmitting(false);
    if (error) {
      setMessage({ text: "Fehler: " + error.message, ok: false });
    } else {
      setMessage({ text: `Claim für ${selectedPlayer.name} eingereicht!`, ok: true });
      setSelectedPlayer(null);
      setPlayerOut(null);
      setBidAmount(0);
      loadAll(user.id);
    }
  }

  async function cancelClaim(claimId: string) {
    await supabase.from("waiver_claims").delete().eq("id", claimId);
    loadAll(user.id);
  }

  const filteredWire = waiverWire.filter(p => {
    if (posFilter !== "ALL" && p.position !== posFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const pendingClaims = myClaims.filter(c => c.status === "pending");
  const maxClaims = settings?.waiver_max_claims_per_gameweek || 3;
  const claimsLeft = settings?.waiver_claims_limit_enabled
    ? maxClaims - pendingClaims.length
    : "∞";

  return (
    <main className="flex min-h-screen flex-col items-center p-4 pb-28" style={{ background: "#0c0900" }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "#f5a623" }} />

      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-center mb-5">
        <button onClick={() => window.location.href = `/wm/${leagueId}`}
          className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
          ← WM
        </button>
        <p className="text-sm font-black" style={{ color: "#f5a623" }}>Waiver Wire</p>
        <div className="text-right">
          <p className="text-[8px] font-black uppercase" style={{ color: "#5a4020" }}>GW {currentGW}</p>
          <p className="text-[9px] font-black" style={{ color: windowOpen ? "#00ce7d" : "#ff4d6d" }}>
            {windowOpen ? "Fenster offen" : "Fenster zu"}
          </p>
        </div>
      </div>

      {/* Status-Bar */}
      <div className="w-full max-w-md rounded-2xl p-4 mb-4 flex items-center justify-between"
        style={{ background: "#141008", border: "1px solid #2a2010" }}>
        <div>
          <p className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: "#5a4020" }}>
            Meine Priority
          </p>
          <p className="text-2xl font-black" style={{ color: "#f5a623" }}>
            #{myPriority || "—"}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: "#5a4020" }}>
            Claims übrig
          </p>
          <p className="text-2xl font-black" style={{ color: "#c8b080" }}>
            {claimsLeft}
          </p>
        </div>
        <div className="text-right">
          {settings?.waiver_budget_enabled && (
            <>
              <p className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: "#5a4020" }}>Budget</p>
              <p className="text-xl font-black" style={{ color: "#c8b080" }}>
                {settings.waiver_budget_starting} Bucks
              </p>
            </>
          )}
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className="w-full max-w-md mb-3 p-3 rounded-xl text-xs font-black text-center"
          style={{
            background: message.ok ? "#1a1a08" : "#1a0808",
            border: `1px solid ${message.ok ? "#f5a623" : "#ff4d6d"}`,
            color: message.ok ? "#f5a623" : "#ff4d6d",
          }}>
          {message.text}
        </div>
      )}

      {/* Offene Claims */}
      {pendingClaims.length > 0 && (
        <div className="w-full max-w-md mb-4">
          <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "#5a4020" }}>
            Offene Claims ({pendingClaims.length})
          </p>
          <div className="space-y-2">
            {pendingClaims.map((claim: any) => {
              const playerIn = waiverWire.find(p => p.id === claim.player_in);
              const playerOutObj = mySquad.find(p => p.id === claim.player_out);
              return (
                <div key={claim.id} className="flex items-center justify-between p-3 rounded-xl"
                  style={{ background: "#141008", border: "1px solid #2a2010" }}>
                  <div>
                    <p className="text-xs font-black" style={{ color: "#00ce7d" }}>
                      + {playerIn?.name || `Spieler #${claim.player_in}`}
                    </p>
                    {playerOutObj && (
                      <p className="text-[9px]" style={{ color: "#ff4d6d" }}>
                        − {playerOutObj.name}
                      </p>
                    )}
                    {settings?.waiver_budget_enabled && (
                      <p className="text-[8px] font-black" style={{ color: "#5a4020" }}>
                        Bid: {claim.bid_amount} Bucks
                      </p>
                    )}
                  </div>
                  <button onClick={() => cancelClaim(claim.id)}
                    className="px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase"
                    style={{ background: "#2a1010", color: "#ff4d6d" }}>
                    Zurückziehen
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Claim-Formular (wenn Spieler ausgewählt) */}
      {selectedPlayer && (
        <div className="w-full max-w-md mb-4 rounded-2xl p-4"
          style={{ background: "#141008", border: "1px solid #f5a623" }}>
          <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "#f5a623" }}>
            Claim einreichen
          </p>
          <div className="flex items-center gap-3 mb-3">
            <img src={selectedPlayer.photo_url} className="w-10 h-10 rounded-full"
              style={{ border: `2px solid ${POS_COLOR[selectedPlayer.position]}` }} alt="" />
            <div>
              <p className="font-black text-sm" style={{ color: "#c8b080" }}>{selectedPlayer.name}</p>
              <p className="text-[9px]" style={{ color: "#5a4020" }}>{selectedPlayer.team_name}</p>
            </div>
            <p className="ml-auto font-black text-lg" style={{ color: "#f5a623" }}>
              {selectedPlayer.fpts?.toFixed(0)}
            </p>
          </div>

          {/* Wer fliegt raus? */}
          <div className="mb-3">
            <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "#5a4020" }}>
              Abgeben (optional)
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setPlayerOut(null)}
                className="px-2.5 py-1.5 rounded-lg text-[9px] font-black"
                style={{
                  background: playerOut === null ? "#f5a623" : "#0c0900",
                  color: playerOut === null ? "#0c0900" : "#5a4020",
                  border: "1px solid #2a2010",
                }}>
                Keinen
              </button>
              {mySquad.map(p => (
                <button key={p.id} onClick={() => setPlayerOut(p.id)}
                  className="px-2.5 py-1.5 rounded-lg text-[9px] font-black"
                  style={{
                    background: playerOut === p.id ? "#3a1010" : "#0c0900",
                    color: playerOut === p.id ? "#ff4d6d" : "#5a4020",
                    border: `1px solid ${playerOut === p.id ? "#ff4d6d" : "#2a2010"}`,
                  }}>
                  {p.name.split(" ").pop()}
                </button>
              ))}
            </div>
          </div>

          {/* FAAB Bid */}
          {settings?.waiver_budget_enabled && (
            <div className="mb-3">
              <label className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
                Bid: <span style={{ color: "#f5a623" }}>{bidAmount} Bucks</span>
              </label>
              <input type="range" min="0" max={settings.waiver_budget_starting || 100}
                value={bidAmount} onChange={e => setBidAmount(Number(e.target.value))}
                className="w-full mt-1 accent-[#f5a623]" />
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => setSelectedPlayer(null)}
              className="flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase"
              style={{ background: "#2a2010", color: "#5a4020" }}>
              Abbrechen
            </button>
            <button onClick={submitClaim} disabled={submitting || !windowOpen}
              className="flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase disabled:opacity-50"
              style={{ background: "#f5a623", color: "#0c0900" }}>
              {submitting ? "..." : "Claim einreichen"}
            </button>
          </div>
        </div>
      )}

      {/* Priority-Liste */}
      <div className="w-full max-w-md mb-4">
        <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "#5a4020" }}>
          Waiver-Priorität
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {allPriorities.map((p: any) => (
            <div key={p.team_id}
              className="flex-shrink-0 px-3 py-2 rounded-xl text-center"
              style={{
                background: p.team_id === myTeam?.id ? "#1a1208" : "#141008",
                border: `1px solid ${p.team_id === myTeam?.id ? "#f5a623" : "#2a2010"}`,
                minWidth: 72,
              }}>
              <p className="text-[9px] font-black" style={{ color: "#f5a623" }}>#{p.priority}</p>
              <p className="text-[8px] truncate" style={{ color: "#5a4020" }}>{p.teams?.name || "—"}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Spieler-Suche */}
      <div className="w-full max-w-md mb-3">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Spieler suchen..."
          className="w-full p-3 rounded-xl text-sm focus:outline-none"
          style={{ background: "#141008", border: "1px solid #2a2010", color: "#c8b080" }} />
      </div>

      {/* Positions-Filter */}
      <div className="flex gap-1.5 w-full max-w-md mb-3">
        {(["ALL", "GK", "DF", "MF", "FW"] as const).map(pos => (
          <button key={pos} onClick={() => setPosFilter(pos)}
            className="flex-1 py-1.5 rounded-lg text-[9px] font-black transition-all"
            style={{
              background: posFilter === pos ? (POS_COLOR[pos] || "#2a2010") : "#141008",
              color: posFilter === pos ? "#0c0900" : "#5a4020",
              border: `1px solid ${posFilter === pos ? (POS_COLOR[pos] || "#f5a623") : "#2a2010"}`,
            }}>
            {pos}
          </button>
        ))}
      </div>

      {/* Waiver Wire Liste */}
      <div className="w-full max-w-md space-y-2">
        <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#2a2010" }}>
          {filteredWire.length} Spieler verfügbar
        </p>
        {filteredWire.slice(0, 50).map(player => {
          const posColor = POS_COLOR[player.position] || "#c8b080";
          const alreadyClaimed = pendingClaims.some((c: any) => c.player_in === player.id);
          return (
            <div key={player.id}
              onClick={() => !alreadyClaimed && setSelectedPlayer(player)}
              className="flex items-center gap-3 p-3 rounded-2xl transition-all"
              style={{
                background: "#141008",
                border: `1px solid ${selectedPlayer?.id === player.id ? "#f5a623" : alreadyClaimed ? "#3a2a10" : "#2a2010"}`,
                cursor: alreadyClaimed ? "default" : "pointer",
                opacity: alreadyClaimed ? 0.6 : 1,
              }}>
              <img src={player.photo_url} className="w-10 h-10 rounded-full flex-shrink-0"
                style={{ border: `2px solid ${posColor}` }} alt="" />
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm truncate" style={{ color: "#c8b080" }}>{player.name}</p>
                <p className="text-[9px] truncate" style={{ color: "#5a4020" }}>{player.team_name}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-black text-base" style={{ color: "#f5a623" }}>{player.fpts?.toFixed(0)}</p>
                <span className="text-[7px] font-black px-1.5 py-0.5 rounded-sm"
                  style={{ background: posColor + "30", color: posColor }}>
                  {player.position}
                </span>
              </div>
              {alreadyClaimed && (
                <span className="text-[8px] font-black px-2 py-1 rounded-lg ml-1"
                  style={{ background: "#3a2a10", color: "#f5a623" }}>
                  Claimed
                </span>
              )}
            </div>
          );
        })}
        {waiverWire.length === 0 && (
          <div className="text-center py-12">
            <p className="text-4xl mb-2">📋</p>
            <p className="text-sm font-black" style={{ color: "#5a4020" }}>Keine Spieler auf Waiver Wire</p>
            <p className="text-xs mt-1" style={{ color: "#2a2010" }}>
              Spieler erscheinen hier nach dem Draft
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
