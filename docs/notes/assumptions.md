# Assumptions

One table per phase. "Checked by" points to a test (tests/…) or an evidence requirement (R..) in `docs/evidence/requirements.json`. All numbers are in `src/sim/tuning.ts` and mirrored in `game.contract.json`.

## Phase 1

| id | unclear point in the spec | assumption | effect | checked by |
|---|---|---|---|---|
| A-1 | What is `lantern_cost`? | Number of motes (light) that must be put into a lantern. 5. A lantern is lit when `deposited >= lantern_cost`. | 25 motes light the island; 30 exist at the start. | R14, rules.test.ts "lanterns" |
| A-2 | `carry_capacity` | 10. Pickup stops while `carried == 10`. Free to carry two lanterns' worth. | Player can top up two lanterns in one trip. | R13 |
| A-3 | Where does the light for a pulse come from? | From carried motes: `pulse_cost` = 2. With fewer than 2 carried, pulse does nothing (no event, no cooldown, no cost). | Pulse is a real trade-off against lighting lanterns. | R16, "needs pulse_cost motes" |
| A-4 | Partial deposit? | Yes. Interact moves `min(carried, cost - deposited)` into the nearest unlit lantern within `interact_radius`. `deposit.amount` = moved, `deposit.deposited` = new total in the lantern. | Several trips are possible. | R14 |
| A-5 | How many motes drop when hit, and where? | `dropped = floor(carried * 0.5)`, they land on the ground on a ring 3 m (pickup_radius + 1.5) around the player, evenly spaced, so they are not picked up again at once. `player_hit.dropped` = that number. | Odd counts lose slightly less. | drop.test.ts, R15 |
| A-6 | How do shades appear and chase? | With `random_shades` on: none at tick 0, first one after 5 s, then one every 6 s, max 6, on a ring of radius 48 at a seeded random angle (`shade_spawned`). They walk straight at the player at `shade_speed` 4 m/s (player 6 m/s). States: `chase`, `stunned`. | Difficulty rises over the night. | R21, R16 |
| A-7 | When does the game end? | Won as soon as all 5 lanterns are lit (checked right after the interaction, the rest of that tick is skipped). Lost when flames reach 0 (`no_flames`) or when `time_left_s` reaches 0 (`dawn`). If both would happen, win is checked first. Nothing runs after `game_over`; the CLI stops and writes `end`. | | R18-R20 |
| A-8 | Falling off the island (`fall_enabled`, `by: "fall"`) | Not in the game: `fall_enabled: false`. The island edge (radius 50 m) is a wall. `player_hit` with `by: "fall"` is never written. | Simpler; explained in README. | "island edge is a wall" |
| A-9 | Score | `per_mote` 10 on pickup, `per_lantern` 100 when a lantern is lit, `per_stun` 20 for each shade a pulse stuns, and only on a win: `per_second_left` 2 × floor(time left) + `per_flame_left` 50 × flames left. No penalties. | | R13, R14, R16, R18 |
| A-10 | Does `safe_radius` apply to lit lanterns only? | To all 5 lanterns, lit or not, so the player can always deposit safely. A shade that would enter is pushed back to the rim of the circle (also right after a pulse push). | Standing closer than 3 m (safe_radius - shade_hit_radius) to a lantern is safe; at exactly 3 m a shade on the rim can still touch. | R17 |
| A-11 | Is pickup automatic? | Yes, a mote is picked when within `pickup_radius` (distance <= r, XZ plane). `interact` is only for lanterns. | | R13 |
| A-12 | Timer precision | Stun (180 ticks), invulnerability (90) and cooldown (120) are whole ticks. Pulse at step k: shade stands still on steps k+1..k+180. Hit at step k: no new hit on steps k+1..k+90. Next pulse allowed at step k+120. The pulse runs before shades move in the same step, so it sees the positions of the previous snapshot; a pulse at tick k+1 therefore moves a shade exactly `pulse_push_m` from where snapshot k had it. | Exact, testable numbers. | R15, R16 |
| A-13 | Pulse details | Hits every shade within `pulse_radius` (even already stunned ones), pushes it `pulse_push_m` straight away from the player, scores `per_stun` for each. Pulse with no shade in range still pays and writes `stunned_ids: []`. Stunned shades cannot hit. A pulse in the same tick as a touch prevents that hit. | | R16 |
| A-14 | Scenario edge cases | Unknown lantern id: ignored (always exactly L1..L5). `lit: true` without `deposited` sets `deposited = lantern_cost`. `time_left_s` replaces the night duration. Shades without `id` get `S1…` (skipping used ids), motes get `M1…`. | | R09 |
| A-15 | `move` values outside [-1, 1] | Not rejected; the vector is normalised when longer than 1. Wrong types are rejected (exit 2). | | R04, io.test.ts |
| A-16 | Exit codes | 0 ok; 2 for unreadable file, invalid JSON, wrong shape, non-increasing ticks; 1 for usage errors (missing `--out`, bad number, unknown option, `--night` other than 1). No output file is written on error. | | R07, R08 |
| A-17 | Starting motes | 30 at seeded positions inside 45 m of the centre, at least 4 m from the start and more than safe_radius + 1 from lanterns. No mote spawns later. | Enough for 5 lanterns (25) plus drops. | R21 |
| A-18 | Lantern positions | Ring of radius 25 m around the centre, L1 at (0,0,25), 72° apart. | Example scenario in the spec uses L1 at (0,0,25). | R12 |
| A-19 | Heights | Distances are XZ only. Shade centre is at y = 1. Jump: 8 m/s up, gravity 24 m/s², about 1.3 m high, lasts 40 ticks; jumping does not avoid shades. | | R05 |
| A-20 | Snapshots | Includes the recommended `motes` array. No extra snapshot at the end of a game; the `end` line carries the final state and score. The event lines of a tick come before the snapshot of that tick. | | R10 |
| A-21 | `time_left_s` at the end | Never below 0. Dawn is declared in the step where `duration - steps/60 <= 0`. | | R20 |
| A-22 | Pickup when several motes are in range | All of them are taken in the same tick (one `mote_picked` event each, `carried` going up by 1) until `carry_capacity` is reached. | | tests/edges.test.ts |
| A-23 | Scenario `player.pos` outside the island or above ground | Outside the 50 m wall the player is pulled back onto the circle on the first step. Above ground (y > 0) the player falls with gravity. | Only matters for odd scenarios. | not tested, noted as a risk |
