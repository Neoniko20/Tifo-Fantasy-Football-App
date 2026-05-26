"use client";

import React, { Suspense } from "react";
import { Spinner } from "@/app/components/ui/Spinner";
import { TradesView } from "@/app/components/trades/TradesView";

export default function TradesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = React.use(params);
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-page)" }}>
        <Spinner text="Lade Trades..." />
      </main>
    }>
      <TradesView leagueId={leagueId} />
    </Suspense>
  );
}
