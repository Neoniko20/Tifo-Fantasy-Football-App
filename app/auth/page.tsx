"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { TifoLogo } from "@/app/components/TifoLogo";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else window.location.href = "/";
    } else {
      const { error } = await supabase.auth.signUp({
        email, password,
        options: { data: { username } },
      });
      if (error) setError(error.message);
      else setError("Check deine E-Mail zur Bestätigung!");
    }
    setLoading(false);
  }

  const inputCls = "w-full mt-1 p-3 rounded-xl text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)] transition-colors"

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4" style={{ background: "var(--bg-page)" }}>
      {/* Flutlicht-Glow oben */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-20 pointer-events-none"
        style={{ background: "var(--color-primary)" }} />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <TifoLogo mode="wordmark" size={100} />
        </div>

        {/* Card */}
        <div className="p-6 rounded-2xl" style={{ background: "var(--bg-card)", border: "1px solid var(--color-border)" }}>
          <h2 className="text-base font-black mb-1" style={{ color: "var(--color-text)" }}>
            {isLogin ? "Willkommen zurück" : "Account erstellen"}
          </h2>
          <p className="text-xs mb-5" style={{ color: "var(--color-muted)" }}>
            {isLogin ? "Login für deine Fantasy Liga" : "Starte deine Fantasy Liga"}
          </p>

          {!isLogin && (
            <div className="mb-3">
              <label className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                Username
              </label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                className={inputCls} placeholder="z.B. GoalMachine99"
                style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)" }} />
            </div>
          )}

          <div className="mb-3">
            <label className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              E-Mail
            </label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              className={inputCls} placeholder="deine@email.com"
              style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)" }} />
          </div>

          <div className="mb-5">
            <label className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              Passwort
            </label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              className={inputCls} placeholder="Min. 6 Zeichen"
              style={{ background: "var(--bg-page)", border: "1px solid var(--color-border)" }} />
          </div>

          {error && (
            <p className="mb-4 text-xs text-center font-bold" style={{ color: "var(--color-primary)" }}>{error}</p>
          )}

          <button onClick={handleSubmit} disabled={loading}
            className="w-full py-3 rounded-xl font-black text-xs uppercase tracking-widest disabled:opacity-50 transition-opacity"
            style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
            {loading ? "..." : isLogin ? "Einloggen" : "Registrieren"}
          </button>

          <p className="mt-4 text-center text-xs" style={{ color: "var(--color-muted)" }}>
            {isLogin ? "Noch kein Account?" : "Bereits registriert?"}{" "}
            <button onClick={() => { setIsLogin(!isLogin); setError(null); }}
              className="font-black" style={{ color: "var(--color-primary)" }}>
              {isLogin ? "Registrieren" : "Einloggen"}
            </button>
          </p>
        </div>
      </div>
    </main>
  );
}
