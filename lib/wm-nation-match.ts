/**
 * TIFO — WM Nation Matching Utilities
 *
 * Reine Hilfsfunktionen für den Abgleich von wm_nations.name mit
 * players.team_name. Kein DB-Zugriff, vollständig testbar.
 *
 * Hintergrund:
 *   Der Draft lädt Spieler über `.in("team_name", nationNames)` —
 *   ein reiner String-Vergleich. Namensunterschiede zwischen
 *   wm_nations.name und players.team_name führen dazu, dass Spieler
 *   existieren, aber im Draft nicht erscheinen.
 */

export type NationMatchResult = {
  /** Nation ist in wm_nations UND hat mindestens 1 Spieler → Draft OK */
  matched: Array<{ nationName: string; playerCount: number }>;
  /** Nation ist in wm_nations, hat aber 0 passende Spieler → Namenskonflikt wahrscheinlich */
  unmatched: string[];
  /** team_name existiert in players, taucht aber in keiner wm_nation auf → verwaiste Spieler */
  orphanTeamNames: Array<{ teamName: string; playerCount: number }>;

  // Zusammenfassung
  totalNations: number;
  nationsWithPlayers: number;
  nationsWithoutPlayers: number;
  totalPlayersInPool: number;
  totalOrphanPlayers: number;
};

/**
 * Vergleicht eine Liste von Nation-Namen (wm_nations.name) mit einer Map
 * von Spieler-Teamnamen (players.team_name → Anzahl).
 *
 * @param nationNames   Array von wm_nations.name Werten
 * @param playerCounts  Map<teamName, anzahl> aus players-Tabelle
 */
export function crossMatchNations(
  nationNames: string[],
  playerCounts: Map<string, number>,
): NationMatchResult {
  const matched: NationMatchResult["matched"] = [];
  const unmatched: string[] = [];

  const usedTeamNames = new Set<string>();

  for (const name of nationNames) {
    const count = playerCounts.get(name) ?? 0;
    if (count > 0) {
      matched.push({ nationName: name, playerCount: count });
      usedTeamNames.add(name);
    } else {
      unmatched.push(name);
    }
  }

  // Verwaiste Spieler: team_name kommt nicht in nationNames vor
  const nationSet = new Set(nationNames);
  const orphanTeamNames: NationMatchResult["orphanTeamNames"] = [];
  for (const [teamName, count] of playerCounts.entries()) {
    if (!nationSet.has(teamName)) {
      orphanTeamNames.push({ teamName, playerCount: count });
    }
  }

  // Sortieren für übersichtliche Ausgabe
  matched.sort((a, b) => a.nationName.localeCompare(b.nationName));
  unmatched.sort();
  orphanTeamNames.sort((a, b) => b.playerCount - a.playerCount);

  const totalPlayersInPool = matched.reduce((s, m) => s + m.playerCount, 0);
  const totalOrphanPlayers = orphanTeamNames.reduce((s, o) => s + o.playerCount, 0);

  return {
    matched,
    unmatched,
    orphanTeamNames,
    totalNations: nationNames.length,
    nationsWithPlayers: matched.length,
    nationsWithoutPlayers: unmatched.length,
    totalPlayersInPool,
    totalOrphanPlayers,
  };
}

/**
 * Gibt Namenspaare zurück, bei denen eine nicht übereinstimmende Nation
 * einen möglichen Kandidaten unter den verwaisten Team-Namen hat.
 *
 * Nutzt einfache Heuristiken (Teilstring, normalisierter Vergleich).
 * Nur für den Bericht — keine automatischen Änderungen.
 */
export type NameHint = {
  nationName: string;
  candidateTeamName: string;
  reason: string;
};

export function suggestNameFixes(
  unmatched: string[],
  orphanTeamNames: Array<{ teamName: string; playerCount: number }>,
): NameHint[] {
  const hints: NameHint[] = [];
  const orphanNames = orphanTeamNames.map(o => o.teamName);

  for (const nation of unmatched) {
    const normNation = normalize(nation);

    for (const candidate of orphanNames) {
      const normCandidate = normalize(candidate);

      // Exakter normalisierter Match (z.B. "Türkiye" vs "Turkey")
      // — wird hier nicht erkannt, aber...

      // Teilstring in eine Richtung
      if (normCandidate.includes(normNation) || normNation.includes(normCandidate)) {
        hints.push({ nationName: nation, candidateTeamName: candidate, reason: "Teilstring-Match" });
        break;
      }

      // Wort-Überschneidung (mind. 1 gemeinsames Wort ≥ 4 Zeichen)
      const wordsNation    = normNation.split(/\s+/).filter(w => w.length >= 4);
      const wordsCandidate = normCandidate.split(/\s+/).filter(w => w.length >= 4);
      if (wordsNation.some(w => wordsCandidate.includes(w))) {
        hints.push({ nationName: nation, candidateTeamName: candidate, reason: "Gemeinsames Wort" });
        break;
      }
    }
  }

  return hints;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[àáâãäå]/g, "a")
    .replace(/[èéêë]/g, "e")
    .replace(/[ìíîï]/g, "i")
    .replace(/[òóôõöø]/g, "o")
    .replace(/[ùúûü]/g, "u")
    .replace(/[ýÿ]/g, "y")
    .replace(/[ñ]/g, "n")
    .replace(/[ç]/g, "c")
    .replace(/[ß]/g, "ss")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
