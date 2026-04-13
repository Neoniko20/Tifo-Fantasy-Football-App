"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { LeagueTopNav } from "@/app/components/LeagueTopNav";
import { BottomNav } from "@/app/components/BottomNav";
import { useToast } from "@/app/components/ToastProvider";
import { PlayerCard } from "@/app/components/PlayerCard";

const POS_COLOR: Record<string, string> = {
  GK: "var(--color-primary)", DF: "var(--color-info)", MF: "var(--color-success)", FW: "var(--color-error)",
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

  const [user, setUser]                   = useState<any>(null);
  const [league, setLeague]               = useState<any>(null);
  const [myTeam, setMyTeam]               = useState<any>(null);
  const [settings, setSettings]           = useState<any>(null);
  const [myPriority, setMyPriority]       = useState<number | null>(null);
  const [allPriorities, setAllPriorities] = useState<any[]>([]);
  const [waiverWire, setWaiverWire]       = useState<Player[]>([]);
  const [myClaims, setMyClaims]           = useState<any[]>([]);
  const [mySquad, setMySquad]             = useState<Player[]>([]);
  const [currentGW, setCurrentGW]         = useState(1);
  const [windowOpen, setWindowOpen]       = useState(false);
  const [search, setSearch]               = useState("");
  const [posFilter, setPosFilter]         = useState("ALL");
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [playerOut, setPlayerOut]         = useState<number | null>(null);
  const [bidAmount, setBidAmount]         = useState(0);
  const [submitting, setSubmitting]       = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = "/auth"; return; }
      setUser(data.user);
      loadAll(data.user.id);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll(userId: string) {
    const { data: lg } = await supabase
      .from("leagues").select("*").eq("id", leagueId).single();
    setLeague(lg);

    const { data: settingsData } = await supabase
      .from("liga_settings").select("*").eq("league_id", leagueId).maybeSingle();
    setSettings(settingsData);

    const { data: team } = await supabase
      .from("teams").select("*").eq("league_id", leagueId).eq("user_id", userId).single();
    setMyTeam(team);
    if (!team) return;

    const { data: gwData } = await supabase
      .from("liga_gameweeks")
      .select("gameweek, waiver_window_open, status")
      .eq("league_id", leagueId)
      .eq("status", "active")
      .maybeSingle();
    if (gwData) {
      setCurrentGW(gwData.gameweek);
      setWindowOpen(!!gwData.waiver_window_open);
    }

    const { data: priorities } = await supabase
      .from("waiver_priority")
      .select("*, teams(name)")
      .eq("league_id", leagueId)
      .order("priority");
    setAllPriorities(priorities || []);
    setMyPriority(((priorities || []).find((p: any) => p.team_id === team.id))?.priority || null);

    const { data: wire } = await supabase
      .from("waiver_wire")
      .select("player_id")
      .eq("league_id", leagueId)
      .eq("status", "available")
      .limit(500);
    if (wire && wire.length > 0) {
      const ids = wire.map((w: any) => w.player_id);
      const { data: playersData } = await supabase
        .from("players").select("*").in("id", ids).order("fpts", { ascending: false }).limit(200);
      setWaiverWire(playersData || []);
    } else {
      setWaiverWire([]);
    }

    const { data: picks } = await supabase
      .from("draft_picks")
      .select("player_id, players(*)")
      .eq("team_id", team.id);
    setMySquad((picks || []).map((p: any) => p.players).filter(Boolean));

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
    if (!windowOpen) { toast("Waiver-Fenster ist geschlossen", "error"); return; }

    const maxClaims = settings?.waiver_max_claims_per_gameweek || 3;
    if (settings?.waiver_claims_limit_enabled && myClaims.filter(c => c.status === "pending").length >= maxClaims) {
      toast(`Max. ${maxClaims} Claims pro GW erreicht`, "error");
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
      toast("Fehler: " + error.message, "error");
    } else {
      toast(`Claim für ${selectedPlayer.name} eingereicht!`, "success");
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
    <>
      <LeagueTopNav
        leagueId={leagueId}
        leagueName={league?.name}
        isOwner={league?.owner_id === user?.id}
        waiversEnabled={!!settings?.waiver_enabled}
      />
      <main className="flex min-h-screen flex-col items-center p-4 pt-24 pb-28"
        style={{ background: "var(--bg-page)" }}>
        <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ background: "var(--color-primary)" }} />

        {/* Waivers disabled state */}
        {!settings?.waiver_enabled && (
          <div className="text-center py-12">
            <p className="text-4xl mb-2">📋</p>
            <p className="text-sm font-black" style={{ color: "var(--color-muted)" }}>
              Waiver Wire ist für diese Liga noch nicht aktiviert
            </p>
            <p className="text-[9px] font-black mt-1" style={{ color: "var(--color-border)" }}>
              Der Liga-Admin kann die Funktion in den Einstellungen aktivieren
            </p>
          </div>
        )}

        {settings?.waiver_enabled && (
          <>
            {/* GW + window status header */}
            <div className="w-full max-w-md flex justify-between items-center mb-5">
              <p className="text-sm font-black" style={{ color: "var(--color-primary)" }}>Waiver Wire</p>
              <div className="text-right">
                <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-muted)" }}>GW {currentGW}</p>
                <p className="text-[9px] font-black" style={{ color: windowOpen ? "var(--color-success)" : "var(--color-error)" }}>
                  {windowOpen ? "Fenster offen" : "Fenster zu"}
                </p>
              </div>
            </div>

            {/* FAAB budget */}
            {settings?.waiver_budget_enabled && (
              <div className="w-full max-w-md mb-3 flex items-center justify-between px-3 py-2 rounded-xl"
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                  FAAB-Budget
                </span>
                <span className="font-black text-lg" style={{ color: "var(--color-primary)" }}>
                  {myTeam?.faab_budget ?? settings.waiver_budget_starting} Bucks
                </span>
              </div>
            )}

            {/* Status-Bar */}
            <div className="w-full max-w-md rounded-2xl p-4 mb-4 flex items-center justify-between"
              style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
              <div>
                <p className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: "var(--color-muted)" }}>
                  Meine Priority
                </p>
                <p className="text-2xl font-black" style={{ color: "var(--color-primary)" }}>
                  #{myPriority || "—"}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: "var(--color-muted)" }}>
                  Claims übrig
                </p>
                <p className="text-2xl font-black" style={{ color: "var(--color-text)" }}>
                  {claimsLeft}
                </p>
              </div>
              <div className="w-16" />
            </div>

            {/* Offene Claims */}
            {pendingClaims.length > 0 && (
              <div className="w-full max-w-md mb-4">
                <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>
                  Offene Claims ({pendingClaims.length})
                </p>
                <div className="space-y-2">
                  {pendingClaims.map((claim: any) => {
                    const playerIn = waiverWire.find(p => p.id === claim.player_in);
                    const playerOutObj = mySquad.find(p => p.id === claim.player_out);
                    return (
                      <div key={claim.id} className="flex items-center justify-between p-3 rounded-xl"
                        style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                        <div>
                          <p className="text-xs font-black" style={{ color: "var(--color-success)" }}>
                            + {playerIn?.name || `Spieler #${claim.player_in}`}
                          </p>
                          {playerOutObj && (
                            <p className="text-[9px]" style={{ color: "var(--color-error)" }}>
                              − {playerOutObj.name}
                            </p>
                          )}
                          {settings?.waiver_budget_enabled && (
                            <p className="text-[8px] font-black" style={{ color: "var(--color-muted)" }}>
                              Bid: {claim.bid_amount} Bucks
                            </p>
                          )}
                        </div>
                        <button onClick={() => cancelClaim(claim.id)}
                          className="px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase"
                          style={{ background: "color-mix(in srgb, var(--color-error) 15%, var(--bg-page))", color: "var(--color-error)" }}>
                          Zurückziehen
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Claim-Formular */}
            {selectedPlayer && (
              <div className="w-full max-w-md mb-4 rounded-2xl p-4"
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-primary)" }}>
                <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-primary)" }}>
                  Claim einreichen
                </p>
                <div className="flex items-center gap-3 mb-3">
                  <PlayerCard player={selectedPlayer} posColor={POS_COLOR[selectedPlayer.position] || "var(--color-border)"} size={40} />
                  <div>
                    <p className="font-black text-sm" style={{ color: "var(--color-text)" }}>{selectedPlayer.name}</p>
                    <p className="text-[9px]" style={{ color: "var(--color-muted)" }}>{selectedPlayer.team_name}</p>
                  </div>
                  <p className="ml-auto font-black text-lg" style={{ color: "var(--color-primary)" }}>
                    {selectedPlayer.fpts?.toFixed(0)}
                  </p>
                </div>

                <div className="mb-3">
                  <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>
                    Abgeben (optional)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => setPlayerOut(null)}
                      className="px-2.5 py-1.5 rounded-lg text-[9px] font-black"
                      style={{
                        background: playerOut === null ? "var(--color-primary)" : "var(--bg-page)",
                        color: playerOut === null ? "var(--bg-page)" : "var(--color-muted)",
                        border: "1px solid var(--color-border)",
                      }}>
                      Keinen
                    </button>
                    {mySquad.map(p => (
                      <button key={p.id} onClick={() => setPlayerOut(p.id)}
                        className="px-2.5 py-1.5 rounded-lg text-[9px] font-black"
                        style={{
                          background: playerOut === p.id ? "color-mix(in srgb, var(--color-error) 20%, var(--bg-page))" : "var(--bg-page)",
                          color: playerOut === p.id ? "var(--color-error)" : "var(--color-muted)",
                          border: `1px solid ${playerOut === p.id ? "var(--color-error)" : "var(--color-border)"}`,
                        }}>
                        {p.name.split(" ").pop()}
                      </button>
                    ))}
                  </div>
                </div>

                {settings?.waiver_budget_enabled && (
                  <div className="mb-3">
                    <label className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                      Bid: <span style={{ color: "var(--color-primary)" }}>{bidAmount} Bucks</span>
                    </label>
                    <input type="range" min="0" max={settings.waiver_budget_starting || 100}
                      value={bidAmount} onChange={e => setBidAmount(Number(e.target.value))}
                      className="w-full mt-1 accent-[var(--color-primary)]" />
                  </div>
                )}

                <div className="flex gap-2">
                  <button onClick={() => setSelectedPlayer(null)}
                    className="flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase"
                    style={{ background: "var(--color-border)", color: "var(--color-muted)" }}>
                    Abbrechen
                  </button>
                  <button onClick={submitClaim} disabled={submitting || !windowOpen}
                    className="flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase disabled:opacity-50"
                    style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
                    {submitting ? "..." : "Claim einreichen"}
                  </button>
                </div>
              </div>
            )}

            {/* Priority-Liste */}
            <div className="w-full max-w-md mb-4">
              <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>
                Waiver-Priorität
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {allPriorities.map((p: any) => (
                  <div key={p.team_id}
                    className="flex-shrink-0 px-3 py-2 rounded-xl text-center"
                    style={{
                      background: p.team_id === myTeam?.id ? "var(--bg-elevated)" : "var(--bg-card)",
                      border: `1px solid ${p.team_id === myTeam?.id ? "var(--color-primary)" : "var(--color-border)"}`,
                      minWidth: 72,
                    }}>
                    <p className="text-[9px] font-black" style={{ color: "var(--color-primary)" }}>#{p.priority}</p>
                    <p className="text-[8px] truncate" style={{ color: "var(--color-muted)" }}>{p.teams?.name || "—"}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Suche + Filter */}
            <div className="w-full max-w-md mb-3">
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Spieler suchen..."
                className="w-full p-3 rounded-xl text-sm focus:outline-none"
                style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
            </div>
            <div className="flex gap-1.5 w-full max-w-md mb-3">
              {(["ALL", "GK", "DF", "MF", "FW"] as const).map(pos => (
                <button key={pos} onClick={() => setPosFilter(pos)}
                  className="flex-1 py-1.5 rounded-lg text-[9px] font-black transition-all"
                  style={{
                    background: posFilter === pos ? (POS_COLOR[pos] || "var(--color-border)") : "var(--bg-card)",
                    color: posFilter === pos ? "var(--bg-page)" : "var(--color-muted)",
                    border: `1px solid ${posFilter === pos ? (POS_COLOR[pos] || "var(--color-primary)") : "var(--color-border)"}`,
                  }}>
                  {pos}
                </button>
              ))}
            </div>

            {/* Wire-Liste */}
            <div className="w-full max-w-md space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-border)" }}>
                {filteredWire.length} Spieler verfügbar
              </p>
              {filteredWire.slice(0, 50).map(player => {
                const posColor = POS_COLOR[player.position] || "var(--color-text)";
                const alreadyClaimed = pendingClaims.some((c: any) => c.player_in === player.id);
                return (
                  <div key={player.id}
                    onClick={() => !alreadyClaimed && setSelectedPlayer(player)}
                    className="flex items-center gap-3 p-3 rounded-2xl transition-all"
                    style={{
                      background: "var(--bg-card)",
                      border: `1px solid ${selectedPlayer?.id === player.id ? "var(--color-primary)" : alreadyClaimed ? "var(--color-border-subtle)" : "var(--color-border)"}`,
                      cursor: alreadyClaimed ? "default" : "pointer",
                      opacity: alreadyClaimed ? 0.6 : 1,
                    }}>
                    <PlayerCard player={player} posColor={posColor} size={40} />
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-sm truncate" style={{ color: "var(--color-text)" }}>{player.name}</p>
                      <p className="text-[9px] truncate" style={{ color: "var(--color-muted)" }}>{player.team_name}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-black text-base" style={{ color: "var(--color-primary)" }}>{player.fpts?.toFixed(0)}</p>
                      <span className="text-[7px] font-black px-1.5 py-0.5 rounded-sm"
                        style={{ background: posColor + "30", color: posColor }}>
                        {player.position}
                      </span>
                    </div>
                    {alreadyClaimed && (
                      <span className="text-[8px] font-black px-2 py-1 rounded-lg ml-1"
                        style={{ background: "var(--color-border-subtle)", color: "var(--color-primary)" }}>
                        Claimed
                      </span>
                    )}
                  </div>
                );
              })}
              {waiverWire.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-4xl mb-2">📋</p>
                  <p className="text-sm font-black" style={{ color: "var(--color-muted)" }}>Keine Spieler auf Waiver Wire</p>
                  <p className="text-xs mt-1" style={{ color: "var(--color-border)" }}>
                    Spieler erscheinen hier nach dem Draft
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </main>
      <BottomNav />
    </>
  );
}
