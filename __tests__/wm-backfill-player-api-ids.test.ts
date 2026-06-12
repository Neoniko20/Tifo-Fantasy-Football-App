import { describe, it, expect } from "vitest";
import { normalizePlayerName, matchPlayer } from "../scripts/wm-backfill-player-api-ids";
import type { ApiPlayer } from "../scripts/wm-backfill-player-api-ids";

// ── normalizePlayerName ───────────────────────────────────────────────────

describe("normalizePlayerName", () => {
  it("lowercases ASCII names", () => {
    expect(normalizePlayerName("Kylian Mbappe")).toBe("kylian mbappe");
  });

  it("entfernt Akzente (é→e, ü→u, ñ→n)", () => {
    expect(normalizePlayerName("Mbappé")).toBe("mbappe");
    expect(normalizePlayerName("Müller")).toBe("muller");
    expect(normalizePlayerName("Rodrigo")).toBe("rodrigo");
  });

  it("entfernt Sonderzeichen (Apostroph, Bindestrich)", () => {
    expect(normalizePlayerName("N'Golo Kanté")).toBe("ngolo kante");
    expect(normalizePlayerName("Trent Alexander-Arnold")).toBe("trent alexanderarnold");
  });

  it("kollabiert mehrfache Leerzeichen", () => {
    expect(normalizePlayerName("  John   Doe  ")).toBe("john doe");
  });

  it("leerer String bleibt leer", () => {
    expect(normalizePlayerName("")).toBe("");
  });

  it("bereits normalisierter Name bleibt unverändert", () => {
    expect(normalizePlayerName("lionel messi")).toBe("lionel messi");
  });
});

// ── matchPlayer ───────────────────────────────────────────────────────────

const makeApiPlayers = (entries: Array<{ id: number; name: string }>): ApiPlayer[] =>
  entries.map(e => ({ ...e, position: "Midfielder" }));

describe("matchPlayer", () => {
  it("exact match → type=exact mit korrekter apiId", () => {
    const api = makeApiPlayers([
      { id: 101, name: "Lionel Messi" },
      { id: 102, name: "Paulo Dybala" },
    ]);
    const result = matchPlayer("Lionel Messi", api);
    expect(result.type).toBe("exact");
    if (result.type === "exact") {
      expect(result.apiId).toBe(101);
      expect(result.apiName).toBe("Lionel Messi");
    }
  });

  it("exact match trotz Akzent-Unterschied (Mbappé vs Mbappe)", () => {
    const api = makeApiPlayers([{ id: 201, name: "Kylian Mbappé" }]);
    const result = matchPlayer("Kylian Mbappe", api);
    expect(result.type).toBe("exact");
    if (result.type === "exact") expect(result.apiId).toBe(201);
  });

  it("kein Match → type=missing", () => {
    const api = makeApiPlayers([{ id: 301, name: "Unknown Player" }]);
    const result = matchPlayer("Lionel Messi", api);
    expect(result.type).toBe("missing");
  });

  it("mehrere Treffer → type=ambiguous", () => {
    const api = makeApiPlayers([
      { id: 401, name: "John Smith" },
      { id: 402, name: "John Smith" }, // doppelter Name
    ]);
    const result = matchPlayer("John Smith", api);
    expect(result.type).toBe("ambiguous");
    if (result.type === "ambiguous") {
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates[0].id).toBe(401);
      expect(result.candidates[1].id).toBe(402);
    }
  });

  it("leere API-Liste → type=missing", () => {
    expect(matchPlayer("Lionel Messi", [])).toEqual({ type: "missing" });
  });

  it("case-insensitiver Match (lokaler Name anders geschrieben)", () => {
    const api = makeApiPlayers([{ id: 501, name: "CRISTIANO RONALDO" }]);
    const result = matchPlayer("Cristiano Ronaldo", api);
    expect(result.type).toBe("exact");
    if (result.type === "exact") expect(result.apiId).toBe(501);
  });

  it("ambiguous schreibt keinen der Candidates — Länge bleibt 2", () => {
    const api = makeApiPlayers([
      { id: 601, name: "Park Ji-Sung" },
      { id: 602, name: "Park Ji-Sung" },
    ]);
    const result = matchPlayer("Park Ji-Sung", api);
    // Beide werden als ambiguous erkannt — kein single winner
    expect(result.type).toBe("ambiguous");
  });
});
