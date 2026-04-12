"use client";

import { useEffect, useState } from "react";

// BeforeInstallPromptEvent is not in the standard TS DOM lib yet.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

const STORAGE_KEY = "tifo:install-prompt-dismissed-at";
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function InstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS]     = useState(false);

  useEffect(() => {
    // Detect iOS (Safari doesn't fire beforeinstallprompt → we need a manual hint)
    const ua = navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(ua);
    const standalone = (window.matchMedia("(display-mode: standalone)").matches)
                    || (navigator as any).standalone === true;
    if (standalone) return; // already installed, nothing to do

    const dismissedAt = Number(localStorage.getItem(STORAGE_KEY) || 0);
    const cooledDown  = Date.now() - dismissedAt > COOLDOWN_MS;

    if (ios && cooledDown) { setIsIOS(true); setVisible(true); return; }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
      if (cooledDown) setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    setVisible(false);
  }

  async function install() {
    if (!deferredEvent) return dismiss();
    await deferredEvent.prompt();
    const { outcome } = await deferredEvent.userChoice;
    if (outcome === "accepted") setVisible(false);
    else dismiss();
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm mx-auto px-4">
      <div className="rounded-2xl p-4 shadow-xl"
        style={{ background: "var(--bg-card)", border: "1px solid var(--color-primary)" }}>
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center"
            style={{ background: "var(--bg-page)", border: "1px solid var(--color-primary)" }}>
            <span className="text-2xl">⚡</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-xs" style={{ color: "var(--color-primary)" }}>
              Tifo auf den Homescreen
            </p>
            <p className="text-[9px] font-black mt-0.5" style={{ color: "var(--color-text)" }}>
              {isIOS
                ? "Tippe auf ⎙ Teilen → Zum Home-Bildschirm"
                : "Installiere Tifo als App — ein Tap auf dem Homescreen, kein Browser-Chrome."}
            </p>
            <div className="flex gap-2 mt-2">
              {!isIOS && (
                <button onClick={install}
                  className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest"
                  style={{ background: "var(--color-primary)", color: "var(--bg-page)" }}>
                  Installieren
                </button>
              )}
              <button onClick={dismiss}
                className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest"
                style={{ background: "var(--color-border)", color: "var(--color-muted)" }}>
                Später
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
