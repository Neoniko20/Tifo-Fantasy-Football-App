-- F-37b: Lineup Lock Modus konfigurierbar
-- Run in Supabase SQL Editor

ALTER TABLE liga_settings
  ADD COLUMN IF NOT EXISTS lineup_lock_mode TEXT DEFAULT 'locked';

COMMENT ON COLUMN liga_settings.lineup_lock_mode IS
  'locked   = Aufstellung gesperrt bei GW-Start, Auto-Sub nach Bankreihenfolge
   pre_sub  = Wie locked, aber UI zeigt explizit: Bankreihenfolge = Auto-Sub Priorität
   live_swap = Spieler können während des Spieltags noch nicht gespielte Spieler tauschen';
