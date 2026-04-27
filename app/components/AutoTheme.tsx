"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";

const LIGA_THEME_KEY = "tifo-liga-theme";

// Liga themes — user selects between these manually
const LIGA_THEMES = new Set(["amber", "flutlicht"]);

// Route-prefix → forced theme
const ROUTE_THEMES: { prefix: string; theme: string }[] = [
  { prefix: "/wm", theme: "tournament" },
];

export function AutoTheme() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const match = ROUTE_THEMES.find(r => pathname?.startsWith(r.prefix));

    if (match) {
      // Save current liga theme before overriding
      if (theme && LIGA_THEMES.has(theme)) {
        localStorage.setItem(LIGA_THEME_KEY, theme);
      }
      if (theme !== match.theme) setTheme(match.theme);
    } else {
      // Leaving a forced-theme route → restore liga preference
      if (theme && !LIGA_THEMES.has(theme)) {
        const saved = localStorage.getItem(LIGA_THEME_KEY) ?? "amber";
        setTheme(saved);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
