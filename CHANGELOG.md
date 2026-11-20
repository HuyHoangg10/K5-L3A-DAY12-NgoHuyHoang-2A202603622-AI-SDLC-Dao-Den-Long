# Changelog

Breaking changes (things that behave differently from the previous tag) are marked **BREAKING**.

## phase-3 (contract v1.2, Ticket-03)

- **BREAKING** Lanterns have fuel: 100 when lit, -1 per second, 0 = the lantern goes out (`lantern_out`). Snapshot lanterns gain `fuel`, `ever_lit`, `relit_count`; the player gains `capacity`. `game.contract.json` is v1.2 with the new tuning keys (`fuel_max`, `fuel_decay_per_s`, `fuel_per_mote`, `relight_cost`, `win_ratio`, `drain_per_s`, `low_fuel_threshold`, `capacity_max`).
- **BREAKING** Win rule: the night is won **at dawn** with at least `ceil(0.6 x lanterns)` lit (reason `dawn_survived`); lighting every lantern no longer ends the night (the reason `all_lit` is gone). Loss at dawn keeps the reason `dawn`.
- **BREAKING** Night length is 240 / 270 / 300 s (was 300 / 330 / 360). Full nights are 14,400 / 16,200 / 18,000 ticks.
- **BREAKING** Score: 5 per firefly put in (was 10); +100 the first time a lantern is lit, +40 when it is lit again; at dawn 50 + floor(fuel) per lit lantern and 50 per flame; **no time bonus**; a glow on a draining shade gives 15.
- **BREAKING** A lantern only has a safe zone while it has 30 fuel or more.
- **BREAKING** `lantern_lit` has `relight: true|false`. New events `refuel`, `fuel_drain`, `lantern_out`; new shade state `drain`.
- New: refuel (interact with a lit lantern that is not full), relight for 5 fireflies, shades walk to weak lanterns and drain them (scenario field `target_lantern_id` sends one by hand), capacity 10 + 2 per lighting up to 20 (scenario field `successful_lights`).
- The tag commit also contains early Phase 4 groundwork (soak, launcher, leaderboard rules, bench mode, settings screens); none of it changes a rule or the headless output.
- Tests: `tests/phase3.test.ts` and `tests/phase3b.test.ts` (42 tests, the second file added after the independent review) for every rule above; `tests/rules.test.ts` and `tests/io.test.ts` were updated for the new numbers. The scenarios `win` and `win_last_tick` were removed because the rule they tested no longer exists; 24 new scenarios were added.
- Live game: fuel bar per lantern in the HUD and above each lantern, blinking and a warning sign below 30, unlit lanterns hang deflated, a thin line from a draining shade to its lantern, refuel hint, capacity in the HUD.

## phase-2 (contract v1.1, Ticket-02)

- **BREAKING** All tuning numbers are now the lab's standard numbers (pickup radius 1.0, interact radius 2.0, lantern cost 10, pulse 3 fireflies / 5 m / 3 s, safe zone 6 m, night 1 300 s, ...). `game.contract.json` is v1.1 with the five new keys.
- **BREAKING** Movement has a 0.1 s start-up and stop (6 ticks), no longer instant.
- **BREAKING** Fireflies score 10 each when put into a lantern, not when picked up; a pulse scores 5 per shade (was 20); the win bonus formula is unchanged.
- **BREAKING** The island edge is no longer a wall: falling below Y = -10 costs a flame and all fireflies (`fall_enabled: true`).
- **BREAKING** Pulse hits by 3D distance from feet + 0.8 m and acts on the shades' positions of the tick, not of the previous snapshot; stun is 120 ticks, push 15 ticks.
- **BREAKING** Shade states are `spawning`, `wander`, `chase`, `recoil`, `stunned` (was `chase`, `stunned`); shades wander to the nearest unlit lantern until Mây is within 12 m.
- **BREAKING** Win/lose is decided at the end of every tick (no early exit right after the deposit); `player_hit` from a fall has a `lost` field (a shade hit has none).
- New: nights 2 and 3 (`--night 2|3`), dash, pause, bounce pads, Gió Lạc drifters, Bùa Gió charms, strong wind, chain of nights, menus, settings, sound, full HUD, standard palette.
- Tests: the Phase 1 test files (`rules`, `edges`, `drop`, `io`) and their scenarios were **replaced**, not skipped, because every number they asserted changed. They stay in git history at tag `phase-1`. The new files `tests/rules.test.ts`, `tests/maps.test.ts`, `tests/io.test.ts` assert the standard numbers.
- Controls: arrow keys and right mouse button move; Shift dashes; the default character glows with Q and lights lanterns with E.

## phase-1

First playable night, headless mode and contract v1.0.
