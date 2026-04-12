"use client";

import { ThemeProvider as NextThemeProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider
      attribute="data-theme"
      defaultTheme="amber"
      themes={["amber", "flutlicht", "tournament", "ucl"]}
      enableSystem={false}
      disableTransitionOnChange={false}
    >
      {children}
    </NextThemeProvider>
  );
}
