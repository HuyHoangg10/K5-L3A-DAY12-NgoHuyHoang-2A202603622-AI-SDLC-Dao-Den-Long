# Changelog

Breaking changes (things that behave differently from the previous tag) are marked **BREAKING**.

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
