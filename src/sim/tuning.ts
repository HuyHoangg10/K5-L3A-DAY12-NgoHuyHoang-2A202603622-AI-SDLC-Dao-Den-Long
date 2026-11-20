// The single place for every game number. game.contract.json "tuning" must equal TUNING
// (tests/contract.test.ts checks it). Distances in metres, times in seconds.

export const TUNING = {
  player_speed: 6, // m/s
  carry_capacity: 10, // max motes carried
  lantern_cost: 5, // motes needed to light one lantern
  lantern_count_night1: 5,
  pickup_radius: 1.5,
  interact_radius: 3,
  pulse_cost: 2, // motes spent per pulse
  pulse_radius: 8,
  night1_duration_s: 240,
  flames: 3,
  invuln_s: 1.5,
  hit_drop_ratio: 0.5, // dropped = floor(carried * ratio)
  pulse_stun_s: 3,
  pulse_push_m: 4,
  pulse_cooldown_s: 2,
  safe_radius: 4, // shades cannot enter this circle around any lantern
  shade_speed: 4, // m/s, slower than the player
  shade_hit_radius: 1,
  fall_enabled: false, // island edge is a wall, no falling
  score: {
    per_mote: 10,
    per_lantern: 100,
    per_stun: 20,
    per_second_left: 2,
    per_flame_left: 50,
  },
} as const;

// Internal constants that are not part of the contract.
export const CONSTANTS = {
  tick_rate: 60,
  island_radius: 50,
  lantern_ring_radius: 25,
  jump_speed: 8,
  gravity: 24,
  random_mote_count: 30,
  mote_min_player_dist: 4,
  shade_first_spawn_s: 5,
  shade_spawn_interval_s: 6,
  shade_max: 6,
  shade_spawn_radius: 48,
  shade_y: 1,
  drop_ring_extra: 1.5, // dropped motes land at pickup_radius + this from the player
  eps: 1e-9,
} as const;

export const DT = 1 / CONSTANTS.tick_rate;
