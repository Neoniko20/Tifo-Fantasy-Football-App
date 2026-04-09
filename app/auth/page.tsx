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

  const inputCls = "w-full mt-1 p-3 rounded-xl text-sm text-[#c8b080] focus:outline-none focus:border-[#f5a623] transition-colors"

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4" style={{ background: "#0c0900" }}>
      {/* Flutlicht-Glow oben */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-20 pointer-events-none"
        style={{ background: "#f5a623" }} />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <TifoLogo mode="wordmark" size={100} />
        </div>

        {/* Card */}
        <div className="p-6 rounded-2xl" style={{ background: "#141008", border: "1px solid #2a2010" }}>
          <h2 className="text-base font-black mb-1" style={{ color: "#c8b080" }}>
            {isLogin ? "Willkommen zurück" : "Account erstellen"}
          </h2>
          <p className="text-xs mb-5" style={{ color: "#5a4020" }}>
            {isLogin ? "Login für deine Fantasy Liga" : "Starte deine Fantasy Liga"}
          </p>

          {!isLogin && (
            <div className="mb-3">
              <label className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
                Username
              </label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                className={inputCls} placeholder="z.B. GoalMachine99"
                style={{ background: "#0c0900", border: "1px solid #2a2010" }} />
            </div>
          )}

          <div className="mb-3">
            <label className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
              E-Mail
            </label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              className={inputCls} placeholder="deine@email.com"
              style={{ background: "#0c0900", border: "1px solid #2a2010" }} />
          </div>

          <div className="mb-5">
            <label className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#5a4020" }}>
              Passwort
            </label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              className={inputCls} placeholder="Min. 6 Zeichen"
              style={{ background: "#0c0900", border: "1px solid #2a2010" }} />
          </div>

          {error && (
            <p className="mb-4 text-xs text-center font-bold" style={{ color: "#f5a623" }}>{error}</p>
          )}

          <button onClick={handleSubmit} disabled={loading}
            className="w-full py-3 rounded-xl font-black text-xs uppercase tracking-widest disabled:opacity-50 transition-opacity"
            style={{ background: "#f5a623", color: "#0c0900" }}>
            {loading ? "..." : isLogin ? "Einloggen" : "Registrieren"}
          </button>

          <p className="mt-4 text-center text-xs" style={{ color: "#5a4020" }}>
            {isLogin ? "Noch kein Account?" : "Bereits registriert?"}{" "}
            <button onClick={() => { setIsLogin(!isLogin); setError(null); }}
              className="font-black" style={{ color: "#f5a623" }}>
              {isLogin ? "Registrieren" : "Einloggen"}
            </button>
          </p>
        </div>
      </div>
    </main>
  );
}
