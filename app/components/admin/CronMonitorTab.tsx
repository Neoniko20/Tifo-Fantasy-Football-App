"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

type AuditEntry = {
  id: string;
  action: string;
  gameweek: number | null;
  metadata: any;
  created_at: string;
};

const ACTION_META: Record<string, { label: string; color: string; icon: string }> = {
  gw_started:       { label: "GW gestartet",   color: "var(--color-primary)", icon: "▶" },
  gw_imported:      { label: "GW importiert",  color: "var(--color-success)", icon: "✓" },
  gw_import_failed: { label: "Import fehlgeschlagen", color: "var(--color-error)", icon: "✗" },
  cron_run:         { label: "Cron-Lauf",       color: "var(--color-muted)",   icon: "⟳" },
  gw_finished:      { label: "GW beendet",      color: "var(--color-success)", icon: "■" },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `vor ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return `vor ${days} Tag${days > 1 ? "en" : ""}`;
}

type Props = { leagueId: string };

export function CronMonitorTab({ leagueId }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("liga_admin_audit_log")
        .select("id, action, gameweek, metadata, created_at")
        .eq("league_id", leagueId)
        .eq("actor_label", "cron")
        .order("created_at", { ascending: false })
        .limit(50);
      setEntries(data || []);
      setLoading(false);
    }
    load();
  }, [leagueId]);

  // Summary stats
  const last7days = entries.filter(
    (e) => Date.now() - new Date(e.created_at).getTime() < 7 * 24 * 3600 * 1000
  );
  const imports    = last7days.filter((e) => e.action === "gw_imported");
  const failures   = last7days.filter((e) => e.action === "gw_import_failed");
  const lastRun    = entries.find((e) => e.action === "cron_run");
  const successRate = imports.length + failures.length > 0
    ? Math.round((imports.length / (imports.length + failures.length)) * 100)
    : null;

  if (loading) {
    return <p className="text-[9px] text-center mt-8" style={{ color: "var(--color-muted)" }}>Lade…</p>;
  }

  return (
    <div className="w-full max-w-xl space-y-4">

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        {[
          {
            label: "Letzter Cron-Lauf",
            value: lastRun ? relativeTime(lastRun.created_at) : "—",
            color: "var(--color-text)",
          },
          {
            label: "Imports (7 Tage)",
            value: imports.length.toString(),
            color: imports.length > 0 ? "var(--color-success)" : "var(--color-muted)",
          },
          {
            label: "Erfolgsrate",
            value: successRate !== null ? `${successRate}%` : "—",
            color: successRate === 100 ? "var(--color-success)" : successRate !== null && successRate < 80 ? "var(--color-error)" : "var(--color-text)",
          },
        ].map((card) => (
          <div key={card.label} className="flex flex-col items-center p-3 rounded-xl"
            style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
            <p className="text-base font-black" style={{ color: card.color }}>{card.value}</p>
            <p className="text-[7px] font-black uppercase tracking-widest mt-0.5 text-center"
              style={{ color: "var(--color-muted)" }}>{card.label}</p>
          </div>
        ))}
      </div>

      {/* Event log */}
      <div>
        <p className="text-[8px] font-black uppercase tracking-widest mb-2 px-1"
          style={{ color: "var(--color-muted)" }}>
          Cron-Verlauf ({entries.length})
        </p>

        {entries.length === 0 ? (
          <p className="text-[9px] text-center py-8" style={{ color: "var(--color-muted)" }}>
            Noch keine Cron-Einträge für diese Liga.
          </p>
        ) : (
          <div className="space-y-1.5">
            {entries.map((entry) => {
              const meta = ACTION_META[entry.action] ?? {
                label: entry.action, color: "var(--color-muted)", icon: "·",
              };
              return (
                <div key={entry.id} className="flex items-start gap-3 p-3 rounded-xl"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
                  <span className="text-[10px] font-black flex-shrink-0 mt-0.5 w-4 text-center"
                    style={{ color: meta.color }}>
                    {meta.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[9px] font-black" style={{ color: meta.color }}>
                        {meta.label}
                        {entry.gameweek != null && (
                          <span className="ml-1 text-[8px]" style={{ color: "var(--color-muted)" }}>
                            GW{entry.gameweek}
                          </span>
                        )}
                      </p>
                      <p className="text-[7px] flex-shrink-0" style={{ color: "var(--color-muted)" }}>
                        {relativeTime(entry.created_at)}
                      </p>
                    </div>
                    {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                      <p className="text-[7px] mt-0.5 truncate" style={{ color: "var(--color-muted)" }}>
                        {Object.entries(entry.metadata)
                          .filter(([k]) => !["auto_start"].includes(k))
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
