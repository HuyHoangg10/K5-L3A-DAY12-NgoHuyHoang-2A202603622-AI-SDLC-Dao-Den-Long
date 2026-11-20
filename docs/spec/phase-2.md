# Phase 2 spec: Ticket-02 "Ba hòn đảo" (contract v1.1)

**Source and honesty note.** Transcribed by me from the lab board (tab Phase 2, "Feature + chuẩn hóa", priority Cao, tag `phase-2`, contract v1.1) by reading it on screen, section by section. Numbers and rules are copied as read; the wording is shortened and translated to English. A few passages were not read in full (the middle of the Test Contract list); where I had to fill a gap I say so in `docs/notes/assumptions.md` (ids P2-*). If this file and the board disagree, the board wins.

## Context
Night 1 works. Playtests showed that every build feels different, so the ticket has two jobs: (1) standardise the numbers so all builds feel the same, (2) grow the game to 3 nights with new features. Creative additions from Phase 1 stay, new characters and enemies (besides Ink Shades and Gió Lạc) are allowed, as long as the standard numbers, the standard maps and the Test Contract do not change and the additions do not change headless output (switch them off in headless).

## Part 1: standard numbers (replace every value you chose)
60 ticks/s. Units: metres, seconds. Y is up.

| group | constant | value |
|---|---|---|
| Movement | run speed | 6.0 m/s; reach full speed or stop in <= 0.1 s; full control in the air |
| | jump | 7.0 m/s up, gravity -20 m/s², only from the ground |
| Dash (new) | speed / time / cooldown | 14 m/s / 0.2 s / 1.5 s (from the start of the dash) |
| | direction | the way Mây is moving; if standing still, the way she faces. In the air a dash keeps its height. No invulnerability |
| Fireflies | capacity | 10 |
| | pickup | automatic when XZ distance <= 1.0 m and the height difference between Mây's feet and the ground point where the firefly is <= 1.5 m |
| | count | 20 at the start on 20 different points; cap 30; at ticks 240, 480, ... one more on an empty point if fewer than 30; no empty point = skip |
| Lantern | cost to light | 10 fireflies, several deposits allowed, the lantern remembers progress |
| | interaction | within 2.0 m; each press deposits `min(carried, missing)` into ONE lantern; only unlit lanterns count; nearest, ties to the smaller id |
| | safe zone | a **lit** lantern makes a circle of radius 6 m: shades outside are blocked at the rim. Shades inside when the lantern is just lit are pushed out to the rim within 30 ticks and do no damage meanwhile |
| Pulse (Tỏa Sáng) | cost / radius / cooldown | 3 fireflies / 5 m / 3 s |
| | effect | centre = Mây's feet + 0.8 m. Targets are fixed at the trigger tick (3D distance to the shade centre <= 5 m). Shade stunned 120 ticks; during the first 15 ticks it is pushed back 4 m in total horizontally (stops at obstacles; same position = push along +X). Pulse again refreshes stun and push. Nothing dies. With fewer than 3 fireflies it does not trigger |
| Ink Shade | speed | 4.0 m/s (night 3: 4.5 m/s) |
| | detect / give up | 12 m / 18 m |
| | touch | XZ distance <= 1.0 m and height difference <= 1.5 m. At most 1 flame lost per tick. The shade recoils 2 m over 60 ticks (`recoil`); a shade touching while Mây is invulnerable does nothing |
| | spawning | 2 at tick 300, then 1 every "spawn interval" (tick 300 + 480k in night 1); no valid point = skip. Ids S1, S2... in spawn order |
| When hit | consequence | -1 flame; drop `floor(carried / 2)` fireflies on a ring 1.5-2.5 m around Mây (they live 480 ticks, can be picked up from the next tick); invulnerable 90 ticks |
| Falling (Y < -10) | | happens exactly once, ignores invulnerability: -1 flame, all fireflies lost. Wait 60 ticks (no pickup, cannot be touched), then respawn at the start point, velocity 0, invulnerable 90 ticks. No flames left = lose at once, no respawn |
| Flames | | 3, refilled at the start of every night |
| Time | night 1 / 2 / 3 | 300 / 330 / 360 s |
| Win / lose | | after each tick: no flames -> always lose (`no_flames`); alive and all lanterns lit -> win (also on the very tick time runs out); time out otherwise -> lose (`dawn`) |

**Score (standard):** +10 per firefly deposited, +100 per lantern lit, +5 per shade hit by a pulse (each shade each time, also stunned ones); on a win: `+ floor(seconds left) * 2 + 50 * flames left`. Game total = sum of the nights won.

**Tick order (mandatory):** 1. read input (handle `pause` first; if just paused, stop the step here). 2. decrement counters: time, cooldowns, invulnerability, stun, charm, TTL of dropped fireflies, charm respawn. 3. move Mây (jump, dash, bounce pads, wind), then check falling. 4. pick up fireflies and charms. 5. interact with lanterns. 6. update safe zones. 7. pulse. 8. move shades and drifters. 9. touches: drifters steal first, then shades hit (by increasing id). 10. spawns by schedule (new entities interact from the next tick). 11. win/lose. 12. write snapshot if due. While paused: `tick` still counts, but `sim_tick`, time, cooldowns, spawns and TTL stand still; the snapshot says `state: "paused"`.

## Part 2: standard maps
Angles are measured from +X, counter-clockwise seen from above, in the XZ plane (a point at radius r and angle a is `(r cos a, y, r sin a)`).

**Night 1 - Đảo Bến.** Round island centred at (0,0,0), radius 40 m; outside is a sea of clouds (falling). Start (0,0,0) facing +Z. Lanterns L1 (0,0,25), L2 (23.8,0,7.7), L3 (14.7,0,-20.2), L4 (-14.7,0,-20.2), L5 (-23.8,0,7.7). Firefly points: 8 on r 12 (every 45°) and 16 on r 33 (every 22.5°). Shade spawn on 12 points of r 37 (15°, 45°, ...), at least 15 m from Mây; first 2 at second 5, then every 8 s, max 6.

**Night 2 - Đảo Cau (new).** Two round islands of radius 28, centres A (0,0,0) and B (70,0,0), joined by a **bamboo bridge** x in [26,44], z in [-2,2] without rails. **Bounce pads**: discs of radius 1 at (20,0,18) and (50,0,-18): when Mây's feet touch one she is launched with Y velocity 14 m/s and horizontal 24 m/s toward the centre of the other island; the launch velocity is kept until landing (move keys do not override it; dashing is still possible); the flight lasts about 1.4 s and ends on the other island. Firefly points per island: 4 on r 10 (0°, 90°, 180°, 270°) and 8 on r 22 (every 45°). Shade spawn on 8 points of r 26 per island (22.5°, 67.5°, ...). Lanterns L1..L6: (0,0,20), (17,0,-10), (-17,0,-10), (70,0,20), (87,0,-10), (53,0,-10). Shades spawn every 7 s, max 8.

**Night 3 - Đảo Chuông (new).** Round island radius 45 with **3 floors**: floor 0 (Y = 0) the whole island; floor 1 (Y = 3) a ring of radii 12-24 on the half where z > 0; floor 2 (Y = 6) a disc of radius 8 in the centre. Floor edges are vertical walls (cannot be climbed; stepping off drops to the floor below). Two straight **ramps** 3 m wide along the radius at 30° and 150°: foot at r 30 (Y = 0), top at r 24 (Y = 3). A **bounce pad** of radius 1 at (0,3,13): Y velocity 12, horizontal 8 m/s toward -Z, kept until landing, lands on floor 2. A **bell tower** 8 m high at the centre of floor 2, cylinder of radius 2, cannot be climbed. Firefly points (30): floor 0: 18 on r 34 (every 20° from 0°); floor 1: 8 on r 18 (20°, 40°, ..., 160°); floor 2: 4 on r 5 (45°, 135°, 225°, 315°). Shade spawn on 16 points of r 43 (every 22.5°). Lanterns L1..L7: (0,6,6), (18,3,10), (-18,3,10), (35,0,-10), (-35,0,-10), (20,0,-35), (-20,0,-35). **Strong wind:** every 30 s a gust of 5 s in a random direction pushes Mây 2 m/s; a warning 2 s before (flying leaves and sound). Shades spawn every 6 s, max 10.

## Part 3: new features
1. **Gió Lạc (drifters)**, nights 2 and 3: a fast grey-green ribbon (7 m/s), at most 2, spawning at ticks 1200, 2400, ... on a random mist point, ids D1, D2... States `idle` (drifts slowly, 2 m/s) -> `chase` -> `flee` -> `removed`. idle -> chase when Mây carries >= 5 fireflies and is within 15 m (checked every tick; when the condition is lost it goes back to idle). Touch (XZ <= 1.2 m): steals `min(3, carried)` fireflies, becomes `flee` (flies away from Mây at 7 m/s for 240 ticks, then disappears with what it took). Each drifter steals only once. A pulse that hits a drifter in `chase` makes it `flee` without stealing; a pulse that hits a `flee` drifter that carries loot makes it drop everything on the spot (as dropped fireflies) and it disappears after 120 ticks. It does not cost a flame; lantern safe zones do not stop it; Mây's invulnerability does not stop the theft.
2. **Bùa Gió (wind charm)**: a red card with a gold rim, ids C1, C2, picked like a firefly. Effect 600 ticks (picking again refreshes): run 7.2 m/s and the dash has no cooldown (a new press is still needed; a press during a dash is ignored; the dash is still 14 m/s for 12 ticks). It reappears 2700 ticks after being picked. Positions: night 2 (35,0,0); night 3 (30,0,25) and (-30,0,25).
3. **Chain of 3 nights**: main menu -> night intro (island name, a line from Ông Đăng) -> play -> result -> next night. Winning night 3 shows the **Dawn** screen with the total score. Losing lets you play that night again.
4. **Pause** (Esc/P): the logic stops completely. Resume / Restart night / Settings / Back to menu.
5. **Settings**: volume and mouse sensitivity, saved between sessions.
6. **Sound**: night music and effects for: pickup, lighting, pulse, being hit, jump, dash, win, lose, shade spawn, a countdown in the last 10 s.
7. **Full HUD**: flames (top left); `mm:ss` clock (top centre, red and blinking at <= 30 s); lanterns `k/n` and score (top right); 10-cell firefly bar (bottom centre); dash and pulse cooldown icons (bottom right); the hint "E - Put light in the lantern (x/10)" near a lantern; an arrow to the nearest unlit lantern when it is off screen.
8. **Standard palette** (max 10% error per RGB channel, for the listed parts; other colours are free): night sky / fog `#0E1430` / `#1B2350`; grass / sand / wood / cloud sea `#2F5D50` / `#C9B48A` / `#6B4A2F` / `#12384A`; lit lantern / core / unlit `#FFB347` / `#FFE9B0` / `#5B5F6E`; firefly core / glow `#FFF6C2` / `#FFE58A`; shade body / rim / stunned `#120A1A` / `#7A3CFF` / `#3A3450`; Mây's shirt / scarf and the charm `#E8E2D0` / `#C8102E`; gold rim and score / drifter `#F2C14E` / `#8FA3B8`; danger UI / UI text `#FF5A5F` / `#F5F1E6`. Ambient light grows with progress: `0.15 + 0.55 * (lit lanterns / total lanterns)`.

## Part 4: Test Contract v1.1 (changes against v1.0)
- `contract_version: "1.1"`; `tuning` must match the standard numbers of part 1 and add `dash_speed`, `dash_duration_s`, `dash_cooldown_s`, `night2_duration_s`, `night3_duration_s`.
- `--night` accepts 1, 2, 3.
- Snapshot gains `night`, `wind {active, dir_deg}`; `player` gains `vel`, `grounded`, `invuln`, `dash_cd_s`, `pulse_cd_s`, `charm_s`.
- Snapshot gains mandatory arrays: `motes` (`id`, `pos`, `kind` = `random`/`dropped`, `ttl_s`), `drifters` (`id`, `pos`, `state`, `stolen`), `charms` (`id`, `available`, `respawn_s`).
- Scenario gains `player.{invuln_ticks, dash_cd_ticks, pulse_cd_ticks, charm_ticks}`, `shades[].{state, state_ticks_left}`, `drifters`, `charms`, flags `random_drifters`, `wind_enabled`. The `drifters` and `charms` arrays replace the default lists.
- Input gains `dash` and `pause` (both fire on a false -> true change).
- New events: `dash {}`, `charm_picked {charm_id, charm_ticks}`, `drifter_steal {drifter_id, amount, carried}`, `drifter_drop {drifter_id, amount}`, `night_start {night}`, `paused {}`, `resumed {}`. `player_hit` gains a `lost` field when it comes from a fall.
- From v1.1 shade states use exactly these names: `spawning`, `wander`, `chase`, `recoil`, `stunned`.
- A full night (at most 21,600 ticks) must run headless in 30 s or less.

## Definition of done
- Evidence that the game meets the phase's requirements (any format).
- Every hidden Phase 1 test still passes with the standard numbers (regression).
- Your own spec document (any name and place) has acceptance criteria for each item of part 3.
- The agent guidance file (AGENTS.md or similar) and the skills are updated for the new scope (git history must show it).
- At least 1 headless scenario for each new feature.
- The normal (windowed) build averages at least 30 FPS at 1280x720.
