"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/app/components/ToastProvider";
import { LEAGUE_META, ALL_LEAGUES, calcActiveLeagues } from "@/lib/league-meta";

const LIGA_PRESETS: Record<string, { label: string; start: string; count: number }> = {
  bundesliga: { label: "Bundesliga 26/27",     start: "2026-08-28", count: 34 },
  premier:    { label: "Premier League 26/27", start: "2026-08-22", count: 38 },
  seriea:     { label: "Serie A 26/27",         start: "2026-08-22", count: 38 },
  ligue1:     { label: "Ligue 1 26/27",         start: "2026-08-23", count: 38 },
  laliga:     { label: "La Liga 26/27",          start: "2026-08-14", count: 38 },
  custom:     { label: "Eigene Liga",            start: "", count: 34 },
};

function actionLabel(action: string): string {
  switch (action) {
    case "gw_started":         return "▶ Spieltag gestartet";
    case "gw_finished":        return "■ Spieltag beendet";
    case "gw_imported":        return "↓ Stats importiert";
    case "gw_recalculated":    return "↻ Neu berechnet";
    case "gw_import_failed":   return "❌ Import fehlgeschlagen";
    case "gw_status_changed":  return "⇄ Status geändert";
    case "cron_run":           return "⏰ Cron-Lauf";
    default:                   return action;
  }
}

async function logAdminAction(
  leagueId: string,
  userId: string,
  action: string,
  gameweek: number | null,
  metadata: Record<string, any> = {},
) {
  try {
    await supabase.from("liga_admin_audit_log").insert({
      league_id:   leagueId,
      actor_id:    userId,
      actor_label: "admin",
      action,
      gameweek,
      metadata,
    });
  } catch (e) {
    console.warn("audit log insert failed:", e);
  }
}

export interface GameweeksTabProps {
  leagueId: string;
  userId: string;
  onGWSelect?: (gwNum: number) => void;
  onGameweeksChange?: (gameweeks: any[]) => void;
}

export function GameweeksTab({ leagueId, userId, onGWSelect, onGameweeksChange }: GameweeksTabProps) {
  const { toast } = useToast();

  // GW list + form state
  const [gameweeks, setGameweeks] = useState<any[]>([]);
  const [newGWNum, setNewGWNum] = useState(1);
  const [newGWLabel, setNewGWLabel] = useState("");
  const [newGWStart, setNewGWStart] = useState("");
  const [newGWEnd, setNewGWEnd] = useState("");

  // Auto-generate state
  const [autoGenLeague, setAutoGenLeague] = useState("bundesliga");
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [autoStart, setAutoStart] = useState(LIGA_PRESETS.bundesliga.start);
  const [autoCount, setAutoCount] = useState(LIGA_PRESETS.bundesliga.count);

  // Import / process state
  const [importing, setImporting] = useState<number | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [processingWaivers, setProcessingWaivers] = useState(false);

  // Derived data for stepper chips
  const [importedGWs, setImportedGWs] = useState<Set<number>>(new Set());
  const [processedGWs, setProcessedGWs] = useState<Set<number>>(new Set());
  const [waiverEnabled, setWaiverEnabled] = useState(false);

  // Audit log
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [auditLogVisible, setAuditLogVisible] = useState(false);

  // Inline league picker: which GW is expanded
  const [expandedLeaguePicker, setExpandedLeaguePicker] = useState<string | null>(null);

  // Bulk import state
  const [bulkExpanded, setBulkExpanded] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<Record<number, "pending" | "running" | "done" | "error">>({});
  const [bulkRunning, setBulkRunning] = useState(false);

  useEffect(() => {
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => {
    onGameweeksChange?.(gameweeks);
  }, [gameweeks, onGameweeksChange]);

  // Close league picker on outside click
  useEffect(() => {
    if (!expandedLeaguePicker) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-gw-card]")) {
        setExpandedLeaguePicker(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expandedLeaguePicker]);

  async function loadData() {
    // Load gameweeks
    const { data: gwData } = await supabase
      .from("liga_gameweeks")
      .select("*").eq("league_id", leagueId).order("gameweek");
    const gws = gwData || [];
    setGameweeks(gws);
    if (gws.length > 0) setNewGWNum(gws.length + 1);

    // Notify parent of active GW
    const active = gws.find((g: any) => g.status === "active");
    if (active && onGWSelect) onGWSelect(active.gameweek);

    // Load import status: which GWs have liga_gameweek_points entries?
    const { data: importedData } = await supabase
      .from("liga_gameweek_points")
      .select("gameweek")
      .eq("league_id", leagueId);
    const imported = new Set<number>((importedData || []).map((r: any) => r.gameweek));
    setImportedGWs(imported);

    // Pre-select unimported GWs for bulk import
    const unimported = gws
      .filter((g: any) => !imported.has(g.gameweek))
      .map((g: any) => g.gameweek);
    setBulkSelected(new Set(unimported));

    // Load processed GWs: has any approved/rejected claim for this GW?
    const { data: processedData } = await supabase
      .from("waiver_claims")
      .select("gameweek")
      .eq("league_id", leagueId)
      .in("status", ["approved", "rejected"]);
    const processed = new Set<number>((processedData || []).map((r: any) => r.gameweek));
    setProcessedGWs(processed);

    // Load waiver_enabled from liga_settings
    const { data: ls } = await supabase
      .from("liga_settings")
      .select("waiver_enabled")
      .eq("league_id", leagueId)
      .maybeSingle();
    setWaiverEnabled(ls?.waiver_enabled ?? false);

    loadAuditLog();
  }

  async function loadAuditLog() {
    const { data } = await supabase
      .from("liga_admin_audit_log")
      .select("*")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: false })
      .limit(20);
    setAuditLog(data || []);
  }

  async function createGameweek() {
    if (!newGWLabel.trim()) { toast("Label eingeben", "error"); return; }
    const { error } = await supabase.from("liga_gameweeks").insert({
      league_id: leagueId,
      gameweek: newGWNum,
      label: newGWLabel.trim(),
      start_date: newGWStart || null,
      end_date: newGWEnd || null,
      status: "upcoming",
    });
    if (error) { toast("Fehler: " + error.message, "error"); return; }
    const { data } = await supabase.from("liga_gameweeks").select("*").eq("league_id", leagueId).order("gameweek");
    setGameweeks(data || []);
    setNewGWNum(prev => prev + 1);
    setNewGWLabel("");
    setNewGWStart("");
    setNewGWEnd("");
  }

  async function autoGenerateGameweeks() {
    if (!autoStart) { toast("Startdatum eingeben", "error"); return; }
    if (gameweeks.length > 0) {
      if (!confirm(`Es gibt bereits ${gameweeks.length} Spieltage. Trotzdem generieren?`)) return;
    }
    setAutoGenerating(true);
    const start = new Date(autoStart);
    const rows = [];
    for (let i = 0; i < autoCount; i++) {
      const gwStart = new Date(start);
      gwStart.setDate(start.getDate() + i * 7);
      const gwEnd = new Date(gwStart);
      gwEnd.setDate(gwStart.getDate() + 6);
      const startStr = gwStart.toISOString().split("T")[0];
      const endStr   = gwEnd.toISOString().split("T")[0];
      const { activeLeagues, isIntlBreak, intlBreakLabel } = calcActiveLeagues(startStr, endStr);
      rows.push({
        league_id: leagueId,
        gameweek: i + 1,
        label: isIntlBreak ? `ST ${i + 1} – ${intlBreakLabel}` : `Spieltag ${i + 1}`,
        start_date: startStr,
        end_date: endStr,
        status: "upcoming",
        active_leagues: isIntlBreak ? [] : activeLeagues,
        double_gw_leagues: [],
        notes: isIntlBreak ? intlBreakLabel : null,
      });
    }
    const { error } = await supabase.from("liga_gameweeks").upsert(rows, { onConflict: "league_id,gameweek" });
    if (error) { toast("Fehler: " + error.message, "error"); setAutoGenerating(false); return; }
    const { data } = await supabase.from("liga_gameweeks").select("*").eq("league_id", leagueId).order("gameweek");
    setGameweeks(data || []);
    setNewGWNum((data?.length || 0) + 1);
    setAutoGenerating(false);
  }

  async function updateGWStatus(gwId: string, status: string, gwNum?: number) {
    const { error } = await supabase.from("liga_gameweeks").update({ status }).eq("id", gwId);
    if (error) { toast("Fehler: " + error.message, "error"); return; }
    setGameweeks(prev => prev.map(g => g.id === gwId ? { ...g, status } : g));
    if (gwNum !== undefined) {
      const action =
        status === "active"   ? "gw_started"  :
        status === "finished" ? "gw_finished" : "gw_status_changed";
      await logAdminAction(leagueId, userId, action, gwNum, { new_status: status });
      if (status === "active" && onGWSelect) onGWSelect(gwNum);
    }
    // Auto-generate H2H pairings when a GW is started
    if (status === 'active' && gwNum !== undefined) {
      const { data: { session: s } } = await supabase.auth.getSession();
      fetch('/api/h2h-pairings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${s?.access_token ?? ''}`,
        },
        body: JSON.stringify({ leagueId, gameweek: gwNum }),
      }).catch((e) => console.warn('[h2h-pairings]', e));
    }

    // Fire-and-forget push notification for GW status changes
    if (status === 'active' || status === 'finished') {
      const event = status === 'active' ? 'gw_started' : 'gw_finished';
      const title = status === 'active'
        ? `▶ Spieltag ${gwNum ?? ''} gestartet`
        : `■ Spieltag ${gwNum ?? ''} beendet`;
      const body = status === 'active'
        ? 'Die Spieltag-Wertung läuft!'
        : 'Der Spieltag ist abgeschlossen.';

      const { data: { session } } = await supabase.auth.getSession();
      fetch('/api/notifications/push-dispatch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          event,
          gwId,
          payload: { title, body, link: '/' },
        }),
      }).catch((err) => console.warn('[push-dispatch] GW push failed:', err));
    }
    loadAuditLog();
  }

  async function toggleLeague(gwId: string, leagueKey: string, field: "active_leagues" | "double_gw_leagues") {
    const gw = gameweeks.find(g => g.id === gwId);
    if (!gw) return;
    const current: string[] = gw[field] || [];
    const updated = current.includes(leagueKey)
      ? current.filter((l: string) => l !== leagueKey)
      : [...current, leagueKey];
    const { error } = await supabase.from("liga_gameweeks").update({ [field]: updated }).eq("id", gwId);
    if (error) { toast("Fehler: " + error.message, "error"); return; }
    setGameweeks(prev => prev.map(g => g.id === gwId ? { ...g, [field]: updated } : g));
  }

  async function importGWStats(gwNum: number, recalc: boolean = false) {
    setImporting(gwNum);
    setImportResult(null);
    try {
      const res = await fetch("/api/import-gw-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId, gameweek: gwNum }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Fehler");
      setImportResult(json.message || "Importiert!");
      // Mark as imported
      setImportedGWs(prev => new Set([...prev, gwNum]));
      await logAdminAction(
        leagueId, userId,
        recalc ? "gw_recalculated" : "gw_imported",
        gwNum,
        { api_calls_used: json.apiCallsUsed, players_imported: json.playersImported },
      );
      loadAuditLog();
    } catch (e: any) {
      setImportResult("Fehler: " + e.message);
      await logAdminAction(leagueId, userId, "gw_import_failed", gwNum, { error: e.message });
    }
    setImporting(null);
  }

  async function toggleWaiverWindow(gwId: string, open: boolean) {
    const { error } = await supabase.from("liga_gameweeks").update({ waiver_window_open: open }).eq("id", gwId);
    if (error) { toast("Fehler: " + error.message, "error"); return; }
    setGameweeks(prev => prev.map(g => g.id === gwId ? { ...g, waiver_window_open: open } : g));
  }

  async function processWaivers(gwNum?: number) {
    if (processingWaivers) return;
    setProcessingWaivers(true);
    try {
      const res = await fetch("/api/process-waivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId, gameweek: gwNum }),
      });
      const json = await res.json();
      if (json.ok) {
        toast(`✅ Waivers verarbeitet: ${json.approved} genehmigt, ${json.rejected} abgelehnt`, "success");
        // Mark this GW as processed
        if (gwNum !== undefined) {
          setProcessedGWs(prev => new Set([...prev, gwNum]));
        }
        // Refresh gameweeks to reflect closed window
        const { data: gwData } = await supabase
          .from("liga_gameweeks").select("*").eq("league_id", leagueId).order("gameweek");
        setGameweeks(gwData || []);
      } else {
        toast(`Fehler: ${json.error}`, "error");
      }
    } catch (e: any) {
      toast(`Fehler: ${e.message}`, "error");
    }
    setProcessingWaivers(false);
  }

  async function runBulkImport() {
    if (bulkRunning || bulkSelected.size === 0) return;
    setBulkRunning(true);

    // Build ordered list (ascending GW number)
    const toImport = [...bulkSelected].sort((a, b) => a - b);

    // Clear previous run's progress, then initialize new
    setBulkProgress({});
    const initialProgress: Record<number, "pending" | "running" | "done" | "error"> = {};
    for (const gwNum of toImport) initialProgress[gwNum] = "pending";
    setBulkProgress(initialProgress);

    for (const gwNum of toImport) {
      setBulkProgress(prev => ({ ...prev, [gwNum]: "running" }));
      try {
        const res = await fetch("/api/import-gw-stats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leagueId, gameweek: gwNum }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Fehler");
        setBulkProgress(prev => ({ ...prev, [gwNum]: "done" }));
        setImportedGWs(prev => new Set([...prev, gwNum]));
        await logAdminAction(leagueId, userId, "gw_imported", gwNum, {
          api_calls_used: json.apiCallsUsed,
          players_imported: json.playersImported,
        });
      } catch (e: any) {
        setBulkProgress(prev => ({ ...prev, [gwNum]: "error" }));
        await logAdminAction(leagueId, userId, "gw_import_failed", gwNum, { error: e.message });
      }
    }

    setBulkRunning(false);
    loadAuditLog();
    // Refresh import status
    const { data: importedData } = await supabase
      .from("liga_gameweek_points")
      .select("gameweek")
      .eq("league_id", leagueId);
    const refreshed = new Set<number>((importedData || []).map((r: any) => r.gameweek));
    setImportedGWs(refreshed);
    // Reset selection to only remaining unimported GWs
    setBulkSelected(new Set([...gameweeks.map((g: any) => g.gameweek)].filter(n => !refreshed.has(n))));
  }

  return (
    <div className="w-full max-w-xl space-y-3">

      {/* Auto-Generieren */}
      <div className="rounded-xl p-4" style={{ background: "var(--bg-page)", border: "1px solid var(--color-border-subtle)" }}>
        <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-primary)" }}>
          Auto-Generieren
        </p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="col-span-2">
            <p className="text-[8px] font-black uppercase mb-1" style={{ color: "var(--color-dim)" }}>Liga / Wettbewerb</p>
            <select value={autoGenLeague}
              onChange={e => {
                const key = e.target.value;
                setAutoGenLeague(key);
                if (LIGA_PRESETS[key].start) setAutoStart(LIGA_PRESETS[key].start);
                setAutoCount(LIGA_PRESETS[key].count);
              }}
              className="w-full p-2 rounded-lg text-sm font-black focus:outline-none"
              style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}>
              {Object.entries(LIGA_PRESETS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-[8px] font-black uppercase mb-1" style={{ color: "var(--color-dim)" }}>Saisonstart</p>
            <input type="date" value={autoStart} onChange={e => setAutoStart(e.target.value)}
              className="w-full p-2 rounded-lg text-sm focus:outline-none"
              style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
          </div>
          <div>
            <p className="text-[8px] font-black uppercase mb-1" style={{ color: "var(--color-dim)" }}>Anzahl Spieltage</p>
            <input type="number" value={autoCount} min={1} max={50} onChange={e => setAutoCount(Number(e.target.value))}
              className="w-full p-2 rounded-lg text-sm font-black focus:outline-none"
              style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
          </div>
        </div>
        <p className="text-[8px] mb-3" style={{ color: "var(--color-muted)" }}>
          Generiert {autoCount} Spieltage à 7 Tage ab {autoStart || "?"}
        </p>
        <button onClick={autoGenerateGameweeks} disabled={autoGenerating}
          className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
          style={{ background: autoGenerating ? "var(--color-border)" : "var(--color-border-subtle)", color: autoGenerating ? "var(--color-muted)" : "var(--color-primary)", border: "1px solid var(--color-primary)" }}>
          {autoGenerating ? "Generiere..." : `Alle ${autoCount} Spieltage generieren`}
        </button>
      </div>

      {/* Neuer GW */}
      <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
        <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
          Neuer Spieltag
        </p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <p className="text-[8px] font-black uppercase mb-1" style={{ color: "var(--color-dim)" }}>Nummer</p>
            <input type="number" value={newGWNum} onChange={e => setNewGWNum(Number(e.target.value))}
              className="w-full p-2 rounded-lg text-sm font-black focus:outline-none"
              style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
          </div>
          <div>
            <p className="text-[8px] font-black uppercase mb-1" style={{ color: "var(--color-dim)" }}>Label</p>
            <input type="text" value={newGWLabel} onChange={e => setNewGWLabel(e.target.value)}
              placeholder="z.B. Spieltag 1"
              className="w-full p-2 rounded-lg text-sm focus:outline-none"
              style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
          </div>
          <div>
            <p className="text-[8px] font-black uppercase mb-1" style={{ color: "var(--color-dim)" }}>Start</p>
            <input type="date" value={newGWStart} onChange={e => setNewGWStart(e.target.value)}
              className="w-full p-2 rounded-lg text-sm focus:outline-none"
              style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
          </div>
          <div>
            <p className="text-[8px] font-black uppercase mb-1" style={{ color: "var(--color-dim)" }}>Ende</p>
            <input type="date" value={newGWEnd} onChange={e => setNewGWEnd(e.target.value)}
              className="w-full p-2 rounded-lg text-sm focus:outline-none"
              style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-text)" }} />
          </div>
        </div>
        <button onClick={createGameweek}
          className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest"
          style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
          Spieltag {newGWNum} anlegen
        </button>
      </div>

      {/* Bulk Import ("Aufholen") */}
      {(() => {
        const unimportedGWs = gameweeks.filter(g => !importedGWs.has(g.gameweek));
        const allImported = unimportedGWs.length === 0 && gameweeks.length > 0;

        if (allImported) {
          return (
            <div className="rounded-xl px-4 py-3 flex items-center gap-2"
              style={{ background: "color-mix(in srgb, var(--color-success) 8%, var(--bg-page))", border: "1px solid var(--color-success)" }}>
              <span className="text-[8px] font-black" style={{ color: "var(--color-success)" }}>
                ✅ Alle GWs aktuell
              </span>
            </div>
          );
        }

        if (gameweeks.length === 0) return null;

        return (
          <div className="rounded-xl overflow-hidden"
            style={{ border: "1px solid var(--color-border)" }}>

            {/* Collapsible header */}
            <button
              onClick={() => setBulkExpanded(v => !v)}
              className="w-full px-4 py-3 flex items-center justify-between"
              style={{ background: "var(--bg-card)" }}>
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--color-primary)" }}>
                ▶ Vergangene GWs nachholen
              </span>
              <span className="text-[8px] font-black"
                style={{ background: "var(--color-primary)", color: "var(--bg-page)", borderRadius: "999px", padding: "1px 6px" }}>
                {unimportedGWs.length} GWs ohne Import
              </span>
            </button>

            {bulkExpanded && (
              <div className="px-4 pb-4" style={{ background: "var(--bg-card)" }}>

                {/* Select all toggle */}
                <div className="flex items-center justify-between py-2 mb-1"
                  style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <label className="flex items-center gap-2 cursor-pointer text-[8px] font-black uppercase"
                    style={{ color: "var(--color-muted)" }}>
                    <input type="checkbox"
                      checked={bulkSelected.size === gameweeks.length}
                      disabled={bulkRunning}
                      onChange={e => {
                        if (e.target.checked) {
                          setBulkSelected(new Set(gameweeks.map((g: any) => g.gameweek)));
                        } else {
                          setBulkSelected(new Set());
                        }
                      }}
                    />
                    Alle / Keine
                  </label>
                </div>

                {/* GW checkboxes */}
                <div className="space-y-1 mt-2 max-h-64 overflow-y-auto">
                  {gameweeks.map(gw => {
                    const isAlreadyImported = importedGWs.has(gw.gameweek);
                    const isChecked = bulkSelected.has(gw.gameweek);
                    const progress = bulkProgress[gw.gameweek];
                    return (
                      <label key={gw.gameweek}
                        className="flex items-center justify-between gap-2 py-1.5 cursor-pointer"
                        style={{ opacity: isAlreadyImported && !isChecked ? 0.5 : 1 }}>
                        <div className="flex items-center gap-2">
                          <input type="checkbox"
                            checked={isChecked}
                            disabled={bulkRunning}
                            onChange={e => {
                              setBulkSelected(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(gw.gameweek);
                                else next.delete(gw.gameweek);
                                return next;
                              });
                            }}
                          />
                          <span className="text-[9px] font-black" style={{ color: "var(--color-text)" }}>
                            GW{gw.gameweek} · {gw.label}
                          </span>
                          {gw.start_date && (
                            <span className="text-[7px]" style={{ color: "var(--color-muted)" }}>
                              ({gw.start_date})
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {isAlreadyImported && !progress && (
                            <span className="text-[7px] font-black" style={{ color: "var(--color-muted)" }}>
                              bereits importiert ↺ neu?
                            </span>
                          )}
                          {!isAlreadyImported && !progress && (
                            <span className="text-[7px] font-black" style={{ color: "var(--color-error)" }}>
                              kein Import
                            </span>
                          )}
                          {progress === "running" && (
                            <span className="text-[7px] font-black" style={{ color: "var(--color-primary)" }}>
                              ⏳ läuft...
                            </span>
                          )}
                          {progress === "done" && (
                            <span className="text-[7px] font-black" style={{ color: "var(--color-success)" }}>
                              ✓ importiert
                            </span>
                          )}
                          {progress === "error" && (
                            <span className="text-[7px] font-black" style={{ color: "var(--color-error)" }}>
                              ✗ Fehler
                            </span>
                          )}
                          {progress === "pending" && (
                            <span className="text-[7px] font-black" style={{ color: "var(--color-muted)" }}>
                              ○ ausstehend
                            </span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Action button */}
                {!bulkRunning && (
                  <button
                    onClick={runBulkImport}
                    disabled={bulkSelected.size === 0}
                    className="w-full mt-3 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-30"
                    style={{
                      background: "var(--color-primary)",
                      color: "var(--bg-page)",
                    }}>
                    Ausgewählte importieren ({bulkSelected.size})
                  </button>
                )}
                {bulkRunning && (
                  <div className="mt-3 py-2 text-center text-[9px] font-black"
                    style={{ color: "var(--color-primary)" }}>
                    ⏳ Import läuft — bitte nicht schließen...
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Quick Action Panel */}
      {gameweeks.length > 0 && (() => {
        const activeGW = gameweeks.find(g => g.status === "active");
        const nextGW = [...gameweeks].filter(g => g.status === "upcoming").sort((a, b) => a.gameweek - b.gameweek)[0];
        const upcomingCount = gameweeks.filter(g => g.status === "upcoming").length;
        const finishedCount = gameweeks.filter(g => g.status === "finished").length;

        return (
          <div className="rounded-xl p-4"
            style={{
              background: activeGW
                ? "color-mix(in srgb, var(--color-primary) 8%, var(--bg-page))"
                : "var(--bg-card)",
              border: `1px solid ${activeGW ? "var(--color-primary)" : "var(--color-border)"}`,
            }}>
            <p className="text-[9px] font-black uppercase tracking-widest mb-3"
              style={{ color: activeGW ? "var(--color-primary)" : "var(--color-muted)" }}>
              {activeGW ? "● Laufender Spieltag" : "Spieltag-Steuerung"}
            </p>

            <div className="flex gap-2 mb-3">
              <span className="px-2 py-1 rounded-lg text-[8px] font-black"
                style={{ background: activeGW ? "color-mix(in srgb, var(--color-primary) 15%, var(--bg-page))" : "var(--bg-elevated)", color: activeGW ? "var(--color-primary)" : "var(--color-muted)", border: `1px solid ${activeGW ? "var(--color-primary)" : "var(--color-border)"}` }}>
                ● Aktiv: {activeGW ? 1 : 0}
              </span>
              <span className="px-2 py-1 rounded-lg text-[8px] font-black"
                style={{ background: "var(--bg-elevated)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                ◌ Bald: {upcomingCount}
              </span>
              <span className="px-2 py-1 rounded-lg text-[8px] font-black"
                style={{ background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))", color: "var(--color-success)", border: "1px solid var(--color-success)" }}>
                ✓ Fertig: {finishedCount}
              </span>
            </div>

            {activeGW && (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black text-sm truncate" style={{ color: "var(--color-text)" }}>
                    GW{activeGW.gameweek} · {activeGW.label}
                  </p>
                  {activeGW.start_date && (
                    <p className="text-[8px] font-black mt-0.5" style={{ color: "var(--color-muted)" }}>
                      {activeGW.start_date} → {activeGW.end_date || "?"}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => updateGWStatus(activeGW.id, "finished", activeGW.gameweek)}
                  className="flex-shrink-0 px-4 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest"
                  style={{ background: "var(--color-error)", color: "white" }}>
                  ■ GW Beenden
                </button>
              </div>
            )}

            {!activeGW && nextGW && (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black text-sm truncate" style={{ color: "var(--color-text)" }}>
                    GW{nextGW.gameweek} · {nextGW.label}
                  </p>
                  {nextGW.start_date && (
                    <p className="text-[8px] font-black mt-0.5" style={{ color: "var(--color-muted)" }}>
                      {nextGW.start_date} → {nextGW.end_date || "?"}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => updateGWStatus(nextGW.id, "active", nextGW.gameweek)}
                  className="flex-shrink-0 px-4 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest"
                  style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
                  ▶ GW Starten
                </button>
              </div>
            )}

            {!activeGW && !nextGW && gameweeks.every(g => g.status === "finished") && (
              <p className="text-[9px] font-black" style={{ color: "var(--color-muted)" }}>
                Alle Spieltage abgeschlossen.
              </p>
            )}
          </div>
        );
      })()}

      {/* GW list */}
      {gameweeks.map(gw => {
        const activeLgs: string[] = gw.active_leagues || [];
        const doubleLgs: string[] = gw.double_gw_leagues || [];
        const isBreak = activeLgs.length === 0 && !gw.notes?.includes("Winterpause");
        const isImported = importedGWs.has(gw.gameweek);
        const isProcessed = processedGWs.has(gw.gameweek);
        const leaguePickerOpen = expandedLeaguePicker === gw.id;

        // Chip done conditions
        const ligaDone = activeLgs.length >= 1;
        const importDone = isImported;
        const waiverDone = waiverEnabled && !gw.waiver_window_open && gw.status !== "upcoming";
        const processDone = isProcessed;
        const finishDone = gw.status === "finished";

        return (
          <div key={gw.id} className="rounded-xl overflow-hidden" data-gw-card=""
            style={{ border: `1px solid ${gw.status === "active" ? "var(--color-primary)" : "var(--color-border)"}` }}>

            {/* Top: identity + status toggles */}
            <div className="p-3 flex items-start justify-between gap-2"
              style={{ background: "var(--bg-card)" }}>
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm truncate" style={{ color: "var(--color-text)" }}>
                  <span style={{ color: "var(--color-primary)" }}>GW{gw.gameweek}</span>
                  {" · "}
                  {gw.label}
                </p>
                {gw.start_date && (
                  <p className="text-[8px] font-black uppercase mt-0.5" style={{ color: "var(--color-muted)" }}>
                    {gw.start_date} → {gw.end_date || "?"}
                  </p>
                )}
                {gw.notes && (
                  <p className="text-[8px] font-black mt-0.5" style={{ color: "var(--color-primary)" }}>
                    ⚠ {gw.notes}
                  </p>
                )}
              </div>
              {/* Status badge + contextual action */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="px-2 py-0.5 rounded-lg text-[7px] font-black uppercase"
                  style={{
                    background: gw.status === "active"
                      ? "color-mix(in srgb, var(--color-primary) 15%, var(--bg-page))"
                      : gw.status === "finished"
                      ? "color-mix(in srgb, var(--color-success) 15%, var(--bg-page))"
                      : "var(--bg-elevated)",
                    color: gw.status === "active" ? "var(--color-primary)" : gw.status === "finished" ? "var(--color-success)" : "var(--color-muted)",
                    border: `1px solid ${gw.status === "active" ? "var(--color-primary)" : gw.status === "finished" ? "var(--color-success)" : "var(--color-border)"}`,
                  }}>
                  {gw.status === "active" ? "● Aktiv" : gw.status === "finished" ? "✓ Fertig" : "◌ Bald"}
                </span>
                {gw.status === "upcoming" && (
                  <button
                    onClick={() => updateGWStatus(gw.id, "active", gw.gameweek)}
                    className="px-2 py-1 rounded-lg text-[7px] font-black uppercase transition-all"
                    style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
                    ▶ Start
                  </button>
                )}
                {gw.status === "active" && (
                  <button
                    onClick={() => updateGWStatus(gw.id, "finished", gw.gameweek)}
                    className="px-2 py-1 rounded-lg text-[7px] font-black uppercase transition-all"
                    style={{ background: "var(--color-error)", color: "white" }}>
                    ■ Stop
                  </button>
                )}
                {gw.status === "finished" && (
                  <button
                    onClick={() => updateGWStatus(gw.id, "upcoming", gw.gameweek)}
                    className="px-1.5 py-1 rounded-lg text-[7px] font-black transition-all"
                    style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}
                    title="Status zurücksetzen">
                    ↺
                  </button>
                )}
              </div>
            </div>

            {/* Bottom: 5-step chips */}
            <div className="px-3 pb-3 pt-2 flex flex-wrap gap-1.5"
              style={{ background: "var(--bg-card)" }}>

              {/* Step 1: Ligen */}
              <button
                onClick={() => setExpandedLeaguePicker(leaguePickerOpen ? null : gw.id)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[8px] font-black transition-all"
                style={{
                  background: ligaDone ? "color-mix(in srgb, var(--color-success) 15%, var(--bg-page))" : "var(--bg-page)",
                  border: `1px solid ${ligaDone ? "var(--color-success)" : "var(--color-border)"}`,
                  color: ligaDone ? "var(--color-success)" : "var(--color-muted)",
                }}>
                {ligaDone ? "✓" : "⚽"} {activeLgs.length} Ligen
              </button>

              {/* Step 2: Import */}
              <button
                onClick={() => !importDone && importGWStats(gw.gameweek, false)}
                disabled={importing === gw.gameweek}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[8px] font-black transition-all disabled:opacity-60"
                style={{
                  background: importDone ? "color-mix(in srgb, var(--color-success) 15%, var(--bg-page))" : "var(--bg-page)",
                  border: `1px solid ${importing === gw.gameweek ? "var(--color-border)" : importDone ? "var(--color-success)" : "var(--color-border)"}`,
                  color: importing === gw.gameweek ? "var(--color-muted)" : importDone ? "var(--color-success)" : "var(--color-muted)",
                }}>
                {importing === gw.gameweek ? "⏳" : importDone ? "✓" : "📥"} Import
              </button>

              {/* Step 3: Waiver (only if waiver_enabled) */}
              {waiverEnabled && (
                <button
                  onClick={() => toggleWaiverWindow(gw.id, !gw.waiver_window_open)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[8px] font-black transition-all"
                  style={{
                    background: waiverDone ? "color-mix(in srgb, var(--color-success) 15%, var(--bg-page))" : gw.waiver_window_open ? "color-mix(in srgb, var(--color-primary) 15%, var(--bg-page))" : "var(--bg-page)",
                    border: `1px solid ${waiverDone ? "var(--color-success)" : gw.waiver_window_open ? "var(--color-primary)" : "var(--color-border)"}`,
                    color: waiverDone ? "var(--color-success)" : gw.waiver_window_open ? "var(--color-primary)" : "var(--color-muted)",
                  }}>
                  {waiverDone ? "✓" : gw.waiver_window_open ? "🔓" : "🔒"} Waiver
                </button>
              )}

              {/* Step 4: Verarbeiten (only if waiver_enabled) */}
              {waiverEnabled && (
                <button
                  onClick={() => !processDone && processWaivers(gw.gameweek)}
                  disabled={processingWaivers}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[8px] font-black transition-all disabled:opacity-60"
                  style={{
                    background: processDone ? "color-mix(in srgb, var(--color-success) 15%, var(--bg-page))" : "var(--bg-page)",
                    border: `1px solid ${processingWaivers ? "var(--color-border)" : processDone ? "var(--color-success)" : "var(--color-border)"}`,
                    color: processingWaivers ? "var(--color-muted)" : processDone ? "var(--color-success)" : "var(--color-muted)",
                  }}>
                  {processingWaivers ? "⏳" : processDone ? "✓" : "▶"} Verarbeiten
                </button>
              )}

              {/* Step 5: Fertig */}
              <button
                onClick={() => !finishDone && updateGWStatus(gw.id, "finished", gw.gameweek)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[8px] font-black transition-all"
                style={{
                  background: finishDone ? "color-mix(in srgb, var(--color-success) 15%, var(--bg-page))" : "var(--bg-page)",
                  border: `1px solid ${finishDone ? "var(--color-success)" : "var(--color-border)"}`,
                  color: finishDone ? "var(--color-success)" : "var(--color-muted)",
                }}>
                {finishDone ? "✓" : "✅"} Fertig
              </button>

              {/* Import re-run (always available for finished GWs) */}
              {importDone && (
                <button
                  onClick={() => importGWStats(gw.gameweek, true)}
                  disabled={importing === gw.gameweek}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[8px] font-black transition-all disabled:opacity-60"
                  style={{
                    background: "var(--bg-page)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-border)",
                  }}>
                  ↻ Neu
                </button>
              )}
            </div>

            {/* Inline league picker — expands below chips */}
            {leaguePickerOpen && (
              <div className="px-3 pb-3" style={{ background: "var(--bg-card)", borderTop: "1px solid var(--color-border)" }}>
                <p className="text-[7px] font-black uppercase tracking-widest mb-1.5 mt-2" style={{ color: "var(--color-dim)" }}>
                  Spielende Ligen
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_LEAGUES.map(key => {
                    const meta = LEAGUE_META[key];
                    const active = activeLgs.includes(key);
                    const isDouble = doubleLgs.includes(key);
                    return (
                      <div key={key} className="flex items-center gap-0.5">
                        <button onClick={() => toggleLeague(gw.id, key, "active_leagues")}
                          className="px-2 py-1 rounded-lg text-[8px] font-black transition-all"
                          style={{
                            background: active ? "var(--bg-elevated)" : "var(--bg-page)",
                            border: `1px solid ${active ? "var(--color-primary)" : "var(--color-border)"}`,
                            color: active ? "var(--color-primary)" : "var(--color-border)",
                          }}>
                          {meta.flag} {meta.short}
                        </button>
                        {active && (
                          <button onClick={() => toggleLeague(gw.id, key, "double_gw_leagues")}
                            title="Doppelspieltag"
                            className="px-1.5 py-1 rounded-lg text-[8px] font-black transition-all"
                            style={{
                              background: isDouble ? "color-mix(in srgb, var(--color-primary) 10%, var(--bg-page))" : "var(--bg-page)",
                              border: `1px solid ${isDouble ? "var(--color-primary)" : "var(--color-border)"}`,
                              color: isDouble ? "var(--color-primary)" : "var(--color-border)",
                            }}>
                            ×2
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {isBreak && (
                  <p className="text-[8px] mt-1.5 font-black" style={{ color: "var(--color-muted)" }}>
                    Länderspielpause — keine Liga-Spiele
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {gameweeks.length === 0 && (
        <p className="text-center text-sm font-black py-8" style={{ color: "var(--color-border)" }}>
          Noch keine Spieltage
        </p>
      )}

      {/* AUDIT LOG (collapsible) */}
      <div className="rounded-xl p-4" style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)" }}>
        <button
          onClick={() => setAuditLogVisible(v => !v)}
          className="w-full flex items-center justify-between text-[9px] font-black uppercase tracking-widest"
          style={{ color: "var(--color-dim)" }}>
          <span>📜 Admin-Verlauf ({auditLog.length})</span>
          <span>{auditLogVisible ? "▲" : "▼"}</span>
        </button>
        {auditLogVisible && (
          <div className="mt-3 space-y-1.5">
            {auditLog.length === 0 && (
              <p className="text-[8px] font-black uppercase" style={{ color: "var(--color-muted)" }}>
                Noch keine Einträge
              </p>
            )}
            {auditLog.map(entry => (
              <div key={entry.id}
                className="flex items-start justify-between gap-2 py-1 border-b"
                style={{ borderColor: "var(--bg-elevated)" }}>
                <div className="flex-1">
                  <p className="text-[9px] font-black" style={{ color: "var(--color-text)" }}>
                    {actionLabel(entry.action)}{entry.gameweek ? ` · GW${entry.gameweek}` : ""}
                  </p>
                  {entry.metadata?.players_imported !== undefined && (
                    <p className="text-[7px]" style={{ color: "var(--color-muted)" }}>
                      {entry.metadata.players_imported} Spieler · {entry.metadata.api_calls_used} API-Calls
                    </p>
                  )}
                  {entry.metadata?.error && (
                    <p className="text-[7px]" style={{ color: "var(--color-error)" }}>
                      {entry.metadata.error}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[7px] font-black uppercase"
                    style={{ color: entry.actor_label === "cron" ? "var(--color-success)" : "var(--color-primary)" }}>
                    {entry.actor_label}
                  </span>
                  <span className="text-[7px]" style={{ color: "var(--color-muted)" }}>
                    {new Date(entry.created_at).toLocaleString("de-DE", {
                      day: "2-digit", month: "2-digit",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {importResult && (
        <div className="rounded-xl p-4 text-center"
          style={{
            background: importResult.startsWith("Fehler") ? "color-mix(in srgb, var(--color-error) 10%, var(--bg-page))" : "color-mix(in srgb, var(--color-success) 10%, var(--bg-page))",
            border: `1px solid ${importResult.startsWith("Fehler") ? "var(--color-error)" : "var(--color-success)"}`,
          }}>
          <p className="text-sm font-black"
            style={{ color: importResult.startsWith("Fehler") ? "var(--color-error)" : "var(--color-success)" }}>
            {importResult}
          </p>
        </div>
      )}
    </div>
  );
}
