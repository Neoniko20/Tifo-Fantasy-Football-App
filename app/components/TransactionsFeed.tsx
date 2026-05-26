"use client";

import { useEffect, useState } from "react";
import { loadLeagueTransactions, type LeagueTransaction } from "@/lib/league-transactions";
import { TransactionRow } from "./TransactionRow";
import { Spinner } from "@/app/components/ui/Spinner";
import { EmptyState } from "@/app/components/ui/EmptyState";

interface Props {
  leagueId: string;
  onlyTeamId?: string;
  kindFilter?: ("transfer" | "trade" | "waiver")[];
  emptyLabel?: string;
  maxHeight?: string;
  compact?: boolean;
}

export function TransactionsFeed({ leagueId, onlyTeamId, kindFilter, emptyLabel, maxHeight, compact }: Props) {
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
    return <Spinner text="Lade…" />;
  }

  if (items.length === 0) {
    return (
      <EmptyState icon="📋" title={emptyLabel || "Noch keine Transaktionen"} />
    );
  }

  return (
    <div className={`w-full overflow-y-auto ${compact ? "space-y-1" : "space-y-2"}`} style={{ maxHeight }}>
      {items.map((tx, i) => <TransactionRow key={tx.id} tx={tx} compact={compact} index={i} />)}
    </div>
  );
}
