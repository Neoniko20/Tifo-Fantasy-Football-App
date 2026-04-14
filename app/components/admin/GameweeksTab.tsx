"use client";

import React, { useState, useEffect, useCallback } from "react";
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

  return (
    <div className="w-full max-w-xl space-y-3">
      <p className="text-center text-sm font-black py-4" style={{ color: "var(--color-muted)" }}>
        Lädt…
      </p>
    </div>
  );
}
