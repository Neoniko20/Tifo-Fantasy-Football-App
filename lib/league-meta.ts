// Reale Liga-Metadaten für Spieltag-Übersichten

export const LEAGUE_META: Record<string, { label: string; short: string; flag: string; color: string }> = {
  bundesliga: { label: "Bundesliga",     short: "BL", flag: "🇩🇪", color: "#d00000" },
  premier:    { label: "Premier League", short: "PL", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", color: "#3d195b" },
  seriea:     { label: "Serie A",        short: "SA", flag: "🇮🇹", color: "#0066cc" },
  ligue1:     { label: "Ligue 1",        short: "L1", flag: "🇫🇷", color: "#003f8a" },
  laliga:     { label: "La Liga",        short: "LL", flag: "🇪🇸", color: "#ee8700" },
};

export const ALL_LEAGUES = Object.keys(LEAGUE_META);

// ─── Bekannte spielfreie Perioden 2026/27 ────────────────────────────────────

// Länderspielpausen (alle Ligen betroffen)
export const INTL_BREAKS: { from: string; to: string; label: string }[] = [
  { from: "2026-09-04", to: "2026-09-14", label: "Länderspielpause Sept." },
  { from: "2026-10-09", to: "2026-10-19", label: "Länderspielpause Okt." },
  { from: "2026-11-13", to: "2026-11-23", label: "Länderspielpause Nov." },
  { from: "2027-03-22", to: "2027-04-01", label: "Länderspielpause März" },
];

// Liga-spezifische Pausen
export const LIGA_BREAKS: Record<string, { from: string; to: string; label: string }[]> = {
  bundesliga: [
    { from: "2026-12-20", to: "2027-01-17", label: "Winterpause" },
  ],
};

/**
 * Gibt zurück welche Ligen in einer Woche (startDate) spielen
 * und ob es sich um eine Länderspielpause handelt.
 */
export function calcActiveLeagues(startDateStr: string, endDateStr: string): {
  activeLeagues: string[];
  isIntlBreak: boolean;
  intlBreakLabel?: string;
} {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  // Länderspielpause?
  for (const brk of INTL_BREAKS) {
    const bFrom = new Date(brk.from);
    const bTo = new Date(brk.to);
    // Überlappung: Fenster startet vor Ende der Pause UND endet nach Start der Pause
    if (start <= bTo && end >= bFrom) {
      return { activeLeagues: [], isIntlBreak: true, intlBreakLabel: brk.label };
    }
  }

  // Liga-spezifische Pausen
  const active = ALL_LEAGUES.filter(leagueKey => {
    const leagueBreaks = LIGA_BREAKS[leagueKey] || [];
    for (const brk of leagueBreaks) {
      const bFrom = new Date(brk.from);
      const bTo = new Date(brk.to);
      if (start <= bTo && end >= bFrom) return false; // Pause → nicht aktiv
    }
    return true;
  });

  return { activeLeagues: active, isIntlBreak: false };
}
