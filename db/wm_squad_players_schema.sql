-- ═══════════════════════════════════════════════════════════════════
-- WM SQUAD PLAYERS — isolierte Kader-Tabelle für WM-Ligen
--
-- Ersetzt squad_players für den WM-Modus vollständig.
-- draft_picks bleibt als Draft-Board-Log erhalten.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS wm_squad_players (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Liga & Turnier — Isolation vom Liga-Modus
  league_id     UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  tournament_id UUID REFERENCES wm_tournaments(id),

  -- Team & Spieler
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id     INT  NOT NULL REFERENCES players(id),

  -- Draft-Kontext (NULL wenn via Waiver/Transfer erworben)
  draft_round   INT,
  draft_pick    INT,

  -- Erwerbsweg
  acquired_via  VARCHAR DEFAULT 'draft'
                CHECK (acquired_via IN ('draft', 'waiver', 'trade', 'free_agent')),

  created_at    TIMESTAMP DEFAULT now(),

  -- Ein Spieler darf pro WM-Liga nur einmal im Kader sein
  CONSTRAINT wm_squad_players_league_player_unique UNIQUE (league_id, player_id),

  -- Ein Team darf denselben Spieler nicht doppelt haben
  CONSTRAINT wm_squad_players_team_player_unique   UNIQUE (team_id, player_id)
);

-- ── Indexe ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS wm_squad_players_team_idx
  ON wm_squad_players (team_id);

CREATE INDEX IF NOT EXISTS wm_squad_players_player_idx
  ON wm_squad_players (player_id);

CREATE INDEX IF NOT EXISTS wm_squad_players_league_idx
  ON wm_squad_players (league_id);

CREATE INDEX IF NOT EXISTS wm_squad_players_tournament_idx
  ON wm_squad_players (tournament_id);

-- ── Row Level Security ───────────────────────────────────────────────
ALTER TABLE wm_squad_players ENABLE ROW LEVEL SECURITY;

-- Alle Liga-Mitglieder und der Owner können Kader lesen
CREATE POLICY "Read wm_squad_players"
  ON wm_squad_players FOR SELECT TO authenticated
  USING (
    league_id IN (
      SELECT league_id FROM teams WHERE user_id = auth.uid()
      UNION
      SELECT id FROM leagues WHERE owner_id = auth.uid()
    )
  );

-- Team-Owner kann eigenen Kader schreiben
-- Liga-Owner kann für Bot-Teams schreiben (draft automation)
CREATE POLICY "Write wm_squad_players"
  ON wm_squad_players FOR INSERT TO authenticated
  WITH CHECK (
    team_id IN (SELECT id FROM teams WHERE user_id = auth.uid())
    OR league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid())
  );

-- Löschen (Waivers / Trades): Team-Owner oder Liga-Owner
CREATE POLICY "Delete wm_squad_players"
  ON wm_squad_players FOR DELETE TO authenticated
  USING (
    team_id IN (SELECT id FROM teams WHERE user_id = auth.uid())
    OR league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid())
  );
