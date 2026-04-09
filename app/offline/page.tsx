"use client";

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center"
      style={{ background: "#0c0900" }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "#f5a623" }} />
      <p className="text-5xl mb-6">📡</p>
      <h1 className="text-lg font-black mb-2" style={{ color: "#f5a623" }}>
        Keine Verbindung
      </h1>
      <p className="text-xs font-black max-w-xs mb-6" style={{ color: "#5a4020" }}>
        Tifo braucht eine aktive Internetverbindung, um deine Liga, Spieltage und Live-Scores zu laden.
      </p>
      <button onClick={() => (typeof window !== "undefined") && window.location.reload()}
        className="px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest"
        style={{ background: "#f5a623", color: "#0c0900" }}>
        Erneut versuchen
      </button>
    </main>
  );
}
