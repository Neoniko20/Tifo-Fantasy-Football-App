"use client";

import { useEffect, useState } from "react";
import { loadLeagueTransactions, type LeagueTransaction } from "@/lib/league-transactions";
import { TransactionRow } from "./TransactionRow";

interface Props {
  leagueId: string;
  onlyTeamId?: string;   // when set → "meine Aktivitäten"
  kindFilter?: ("transfer" | "trade" | "waiver")[];
  emptyLabel?: string;
  maxHeight?: string;    // e.g. "60vh"
}

export function TransactionsFeed({ leagueId, onlyTeamId, kindFilter, emptyLabel, maxHeight }: Props) {
  const [items, setItems]     = useState<LeagueTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const all = await loadLeagueTransactions(leagueId, { onlyTeamId });
      if (!alive) return;
      setItems(kindFilter ? all.filter(x => kindFilter.includes(x.kind)) : all);
      setLoading(false);
    })();
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, onlyTeamId, kindFilter?.join(",")]);

  if (loading) {
    return (
      <p className="text-center text-[9px] font-black uppercase tracking-widest py-8 animate-pulse"
        style={{ color: "var(--color-border)" }}>
        Lade…
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-16" style={{ color: "var(--color-border)" }}>
        <p className="text-3xl mb-3">📋</p>
        <p className="text-[9px] font-black uppercase tracking-widest">
          {emptyLabel || "Noch keine Transaktionen"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 w-full overflow-y-auto" style={{ maxHeight }}>
      {items.map(tx => <TransactionRow key={tx.id} tx={tx} />)}
    </div>
  );
}
