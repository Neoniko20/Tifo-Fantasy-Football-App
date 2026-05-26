/** Raw player shape as fetched by the lineup page from Supabase. */
export type LineupPlayer = {
  id:               number;
  name:             string;
  photo_url:        string;
  position:         string;
  team_name:        string;
  api_team_id?:     number;
  fpts:             number;
  goals?:           number;
  assists?:         number;
  minutes?:         number;
  shots_on?:        number;
  key_passes?:      number;
  tackles?:         number;
  interceptions?:   number;
  yellow_cards?:    number;
  red_cards?:       number;
  saves?:           number;
};

export type LineupIRSlot = {
  id:            string;
  player_id:     number;
  placed_at_gw:  number;
  min_return_gw: number;
  player?:       LineupPlayer;
};
