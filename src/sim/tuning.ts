// The single place for every game number. game.contract.json "tuning" must equal TUNING
// (tests/contract.test.ts checks it). Distances in metres, times in seconds.
// Phase 2 (contract v1.1): these are the lab's standard numbers (Ticket-02, part 1), not my own guesses.

export const TUNING = {
  player_speed: 6, // m/s
  carry_capacity: 10,
  lantern_cost: 10, // motes to light one lantern (several deposits allowed)
  lantern_count_night1: 5,
  pickup_radius: 1,
  interact_radius: 2,
  pulse_cost: 3,
  pulse_radius: 5,
  night1_duration_s: 300,
  flames: 3,
  invuln_s: 1.5,
  hit_drop_ratio: 0.5, // dropped = floor(carried * ratio)
  pulse_stun_s: 2,
  pulse_push_m: 4,
  pulse_cooldown_s: 3,
  safe_radius: 6,
  shade_speed: 4,
  shade_hit_radius: 1,
  fall_enabled: true,
  score: {
    per_mote: 10,
    per_lantern: 100,
    per_stun: 5,
    per_second_left: 2,
    per_flame_left: 50,
  },
  dash_speed: 14,
  dash_duration_s: 0.2,
  dash_cooldown_s: 1.5,
  night2_duration_s: 330,
  night3_duration_s: 360,
} as const;

// Other standard numbers of Ticket-02 and my own choices where the ticket is silent (see docs/notes/assumptions.md).
export const CONSTANTS = {
  tick_rate: 60,
  accel_s: 0.1, // time to reach full speed or stop
  jump_speed: 7,
  gravity: 20,
  step_height: 0.35, // a surface this much higher than the feet can be walked onto (ramps), more is a wall
  fall_y: -10,
  fall_wait_ticks: 60,
  respawn_invuln_ticks: 90,
  pickup_height: 1.5, // max feet-to-ground height difference for pickups and touches
  hit_height: 1.5,
  mote_ttl_ticks: 480,
  mote_cap: 30,
  mote_initial: 20,
  mote_spawn_every_ticks: 240,
  drop_ring_min: 1.5,
  drop_ring_max: 2.5,
  recoil_m: 2,
  recoil_ticks: 60,
  spawning_ticks: 60, // assumption: the ticket names the state but gives no length
  detect_m: 12,
  lose_m: 18,
  safe_push_ticks: 30,
  pulse_center_up: 0.8,
  pulse_push_ticks: 15,
  pulse_stun_ticks: 120,
  first_shade_tick: 300,
  shade_y: 1,
  shade_speed_night3: 4.5,
  dash_ticks: 12,
  dash_cooldown_ticks: 90,
  charm_ticks: 600,
  charm_respawn_ticks: 2700,
  charm_speed_mult: 1.2,
  drifter_first_tick: 1200,
  drifter_every_ticks: 1200,
  drifter_max: 2,
  drifter_idle_speed: 2,
  drifter_fast_speed: 7,
  drifter_trigger_carry: 5,
  drifter_trigger_m: 15,
  drifter_touch_m: 1.2,
  drifter_steal_max: 3,
  drifter_flee_ticks: 240,
  drifter_flee_after_pulse_ticks: 120,
  drifter_y: 2,
  wind_every_ticks: 1800,
  wind_ticks: 300,
  wind_warn_ticks: 120,
  wind_push: 2, // m/s
  eps: 1e-9,
} as const;

export const DT = 1 / CONSTANTS.tick_rate;
