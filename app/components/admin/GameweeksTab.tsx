"use client";

import React, { useState, useEffect, useCallback } from "react"; // useCallback used in Task 4
import { supabase } from "@/lib/supabase";
import { useToast } from "@/app/components/ToastProvider";
import { LEAGUE_META, ALL_LEAGUES, calcActiveLeagues } from "@/lib/league-meta";
import tsdbLeagues from "@/lib/tsdb-leagues.json";

const LEAGUE_BADGES: Record<string, string> = {
  "78":  (tsdbLeagues as any)["78"]?.badge  || "",
  "39":  (tsdbLeagues as any)["39"]?.badge  || "",
  "135": (tsdbLeagues as any)["135"]?.badge || "",
  "61":  (tsdbLeagues as any)["61"]?.badge  || "",
  "140": (tsdbLeagues as any)["140"]?.badge || "",
};

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
}

export function GameweeksTab({ leagueId, userId, onGWSelect }: GameweeksTabProps) {
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
    await supabase.from("liga_gameweeks").update({ status }).eq("id", gwId);
    setGameweeks(prev => prev.map(g => g.id === gwId ? { ...g, status } : g));
    if (gwNum !== undefined) {
      const action =
        status === "active"   ? "gw_started"  :
        status === "finished" ? "gw_finished" : "gw_status_changed";
      await logAdminAction(leagueId, userId, action, gwNum, { new_status: status });
      if (status === "active" && onGWSelect) onGWSelect(gwNum);
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
    await supabase.from("liga_gameweeks").update({ [field]: updated }).eq("id", gwId);
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
    await supabase.from("liga_gameweeks").update({ waiver_window_open: open }).eq("id", gwId);
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

  return (
    <div className="w-full max-w-xl space-y-3">
      <p className="text-center text-sm font-black py-4" style={{ color: "var(--color-muted)" }}>
        Lädt…
      </p>
    </div>
  );
}
