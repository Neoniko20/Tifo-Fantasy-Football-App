"use client";

import React, {
  createContext, useCallback, useContext, useRef, useState,
} from "react";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  text: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (text: string, type?: ToastType) => void;
}

// ─────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

// ─────────────────────────────────────────────
// Colours
// ─────────────────────────────────────────────

const COLORS: Record<ToastType, { bg: string; border: string; color: string; icon: string }> = {
  success: { bg: "color-mix(in srgb, var(--color-success) 12%, var(--bg-page))", border: "var(--color-success)", color: "var(--color-success)", icon: "✓" },
  error:   { bg: "color-mix(in srgb, var(--color-error) 12%, var(--bg-page))", border: "var(--color-error)", color: "var(--color-error)", icon: "✕" },
  info:    { bg: "color-mix(in srgb, var(--color-primary) 12%, var(--bg-page))", border: "var(--color-primary)", color: "var(--color-primary)", icon: "i" },
};

// ─────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────

const AUTO_DISMISS_MS = 3_500;
const MAX_VISIBLE     = 5;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts]   = useState<Toast[]>([]);
  const counterRef            = useRef(0);
  const timersRef             = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: number) => {
    clearTimeout(timersRef.current[id]);
    delete timersRef.current[id];
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((text: string, type: ToastType = "info") => {
    const id = ++counterRef.current;
    setToasts(prev => {
      const next = [...prev, { id, text, type }];
      return next.slice(-MAX_VISIBLE);
    });
    timersRef.current[id] = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* ── Toast stack — bottom-center, above BottomNav ── */}
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          bottom: "calc(64px + env(safe-area-inset-bottom))",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "8px",
          pointerEvents: "none",
          width: "min(92vw, 420px)",
        }}
      >
        {toasts.map(t => {
          const c = COLORS[t.type];
          return (
            <div
              key={t.id}
              role="alert"
              style={{
                pointerEvents: "auto",
                width: "100%",
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                padding: "12px 14px",
                borderRadius: "12px",
                background: c.bg,
                border: `1px solid ${c.border}`,
                color: "var(--color-text)",
                fontSize: "13px",
                lineHeight: "1.4",
                boxShadow: `0 4px 20px rgba(0,0,0,0.6), 0 0 0 1px ${c.border}22`,
                animation: "tifo-toast-in 0.22s ease",
              }}
            >
              {/* Icon badge */}
              <span
                style={{
                  flexShrink: 0,
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  background: c.border + "22",
                  border: `1px solid ${c.border}`,
                  color: c.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "10px",
                  fontWeight: 700,
                  marginTop: "1px",
                }}
              >
                {c.icon}
              </span>

              {/* Message */}
              <span style={{ flex: 1, whiteSpace: "pre-wrap" }}>{t.text}</span>

              {/* Close */}
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Schließen"
                style={{
                  flexShrink: 0,
                  background: "none",
                  border: "none",
                  color: "var(--color-muted)",
                  cursor: "pointer",
                  fontSize: "14px",
                  padding: "0 2px",
                  lineHeight: 1,
                  marginTop: "1px",
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes tifo-toast-in {
          from { opacity: 0; transform: translateY(10px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
