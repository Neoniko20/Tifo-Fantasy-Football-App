import { describe, it, expect, vi } from "vitest";
import { normalizePlayerName, matchPlayer, paginatedSelect } from "../scripts/wm-backfill-player-api-ids";
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

// ── paginatedSelect ───────────────────────────────────────────────────────

describe("paginatedSelect", () => {
  it("lädt eine einzelne Page (weniger als PAGE_SIZE)", async () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const query = vi.fn().mockResolvedValueOnce({ data: rows, error: null });

    const result = await paginatedSelect(query);

    expect(result).toEqual(rows);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(0, 1000);
  });

  it("lädt mehrere Pages und kombiniert Ergebnisse", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const page2 = [{ id: 1000 }, { id: 1001 }];

    const query = vi.fn()
      .mockResolvedValueOnce({ data: page1, error: null })
      .mockResolvedValueOnce({ data: page2, error: null });

    const result = await paginatedSelect(query);

    expect(result).toHaveLength(1002);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(1, 0, 1000);
    expect(query).toHaveBeenNthCalledWith(2, 1000, 1000);
  });

  it("stoppt wenn letzte Page genau PAGE_SIZE enthält aber nächste leer ist", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: i }));

    const query = vi.fn()
      .mockResolvedValueOnce({ data: page1, error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const result = await paginatedSelect(query);

    expect(result).toHaveLength(1000);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("lädt drei Pages und akkumuliert Offsets korrekt", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const page2 = Array.from({ length: 1000 }, (_, i) => ({ id: 1000 + i }));
    const page3 = [{ id: 2000 }, { id: 2001 }, { id: 2002 }];

    const query = vi.fn()
      .mockResolvedValueOnce({ data: page1, error: null })
      .mockResolvedValueOnce({ data: page2, error: null })
      .mockResolvedValueOnce({ data: page3, error: null });

    const result = await paginatedSelect(query);

    expect(result).toHaveLength(2003);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenNthCalledWith(1, 0, 1000);
    expect(query).toHaveBeenNthCalledWith(2, 1000, 1000);
    expect(query).toHaveBeenNthCalledWith(3, 2000, 1000);
  });

  it("leere erste Seite → leeres Array", async () => {
    const query = vi.fn().mockResolvedValueOnce({ data: [], error: null });

    const result = await paginatedSelect(query);

    expect(result).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("null data → leeres Array", async () => {
    const query = vi.fn().mockResolvedValueOnce({ data: null, error: null });

    const result = await paginatedSelect(query);

    expect(result).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("wirft Fehler bei DB-Error", async () => {
    const query = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "DB connection lost" } });

    await expect(paginatedSelect(query)).rejects.toThrow("DB connection lost");
  });
});
