"use client";

/**
 * AuthProvider — single source of truth for the current Supabase user.
 *
 * Calls getUser() exactly ONCE per page load (in the root layout), then
 * exposes the result via React context. All components should consume
 * useAuthUser() instead of calling supabase.auth.getUser() themselves —
 * this prevents concurrent Web Lock contention that causes the
 * "Lock stolen" runtime error when multiple components mount simultaneously.
 */

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthContextValue {
  /** The authenticated user, or null if not logged in / still loading. */
  user: User | null;
  /** True while the initial getUser() call is in flight. */
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({ user: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Single authoritative getUser() for the whole app tree.
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setLoading(false);
    });

    // Keep in sync after sign-in / sign-out / token refresh.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Returns the current auth user and loading state.
 * Must be used inside <AuthProvider>.
 */
export function useAuthUser(): AuthContextValue {
  return useContext(AuthContext);
}
