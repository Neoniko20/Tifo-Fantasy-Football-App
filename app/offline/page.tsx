"use client";

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center"
      style={{ background: "var(--bg-page)" }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "var(--color-primary)" }} />
      <p className="text-5xl mb-6">📡</p>
      <h1 className="text-lg font-black mb-2" style={{ color: "var(--color-primary)" }}>
        Keine Verbindung
      </h1>
      <p className="text-xs font-black max-w-xs mb-6" style={{ color: "var(--color-muted)" }}>
        Tifo braucht eine aktive Internetverbindung, um deine Liga, Spieltage und Live-Scores zu laden.
      </p>
      <button onClick={() => (typeof window !== "undefined") && window.location.reload()}
        className="px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest"
        style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
        Erneut versuchen
      </button>
    </main>
  );
}
