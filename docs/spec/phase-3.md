# Phase 3 spec: Ticket-03 Change Request "Đèn cạn dầu" (contract v1.2)

**Source and honesty note.** Transcribed by me from the lab board (tab Phase 3: "Change Request, thay đổi luật cốt lõi", priority "Rất cao", tag `phase-3`, contract v1.2) by reading it on screen. Wording shortened and translated; numbers copied as read. Items marked [THAY THẾ] / **[REPLACE]** replace an earlier rule. If this file and the board disagree, the board wins. Gap-fillers I had to add are in `docs/notes/assumptions.md` (ids P3-*).

## Why the change
Playtests show strong players light every lantern within 2 minutes and the night ends with no tension. Decision: **a lit lantern can go out**, and the goal changes from "light everything" to "keep the island lit until dawn". This ticket replaces some existing rules; you must record the design decision (a short ADR) and update your tests. Creative additions are kept, as long as the rules, numbers and the Test Contract below do not change and headless output stays the same; any addition that conflicts with the new rules must be adapted.

## 1. Lantern fuel - [REPLACE] "a lit lantern accepts no more fireflies"
| rule | value |
|---|---|
| max fuel | 100 |
| when just lit (first time or relit) | `fuel = 100` |
| decay while lit | 1.0 unit/s (1/60 per tick) |
| refuel | Interact at a lit lantern: `used = min(carried, ceil((100 - fuel) / 10))`, `fuel = min(100, fuel + 10 * used)`, minus `used` fireflies. A full lantern (`used = 0`) cannot be chosen when interacting, emits no event, gives no score |
| which lantern | only "acceptable" lanterns (unlit, or lit but not full); the nearest; ties to the smaller id |
| precision | keep fuel in units of 1/60 so there is no float error; round only when writing output |
| out of fuel (`fuel <= 0`) | the lantern goes **off**, `deposited = 0`, event `lantern_out`, ambient light drops accordingly. The lantern remembers `ever_lit = true` |
| relight | a lantern that was ever lit needs only **5** fireflies; one never lit still needs 10 |
| display | a fuel bar on lit lanterns; when `fuel < 30` the lantern and its bar blink slowly (1 Hz) |

## 2. Shades drain fuel - [REPLACE] "shades never enter the safe zone"
- A lantern with `fuel < 30` **loses its safe zone** (at exactly 30 it still has it).
- Only a shade in `wander` picks a weak lantern: it goes to the nearest **lit** lantern with `fuel < 30` (ties to the smaller id); if there is none, to the nearest unlit lantern as before. A shade already in `chase` keeps its target.
- Within 2 m (XZ) of that lantern it switches to the new state `drain`: stands still and drains **5 fuel/s** continuously (5/60 per tick). Several shades add up. The lantern still decays 1/s on its own.
- From `drain`: to `chase` if Mây comes within 6 m; to `stunned` if hit by a pulse; to `wander` if the lantern goes out, if its fuel is raised to >= 30, or if the distance is > 2 m. When a stun ends the shade goes to `wander`.
- When a lantern is refuelled to >= 30 while shades are within 6 m, they are pushed out to the rim within at most 30 ticks and do no damage meanwhile (as when a lantern is first lit).

## 3. New win rule - [REPLACE] "win as soon as all lanterns are lit"
| rule | new value |
|---|---|
| night length 1 / 2 / 3 | 240 / 270 / 300 s |
| win | Mây is still alive when time runs out (dawn) **and** the number of lit lanterns at the last tick is >= `ceil(0.6 * total)`: night 1 needs 3 of 5, night 2 needs 4 of 6, night 3 needs 5 of 7 |
| no early win | lighting all lanterns does **not** end the night |
| lose | no flames (immediately, also on the last tick) **or** time ran out with fewer lit lanterns than the threshold |
| reasons | win: `dawn_survived`; lose: `dawn` or `no_flames` |
| tick order | as Ticket-02, plus: fuel is subtracted in step 2 (decay and drain); right after step 2 a lantern with `fuel <= 0` goes off. The win/lose step runs after every update of the tick, also on the dawn tick; no flames always loses first (`no_flames`) |

## 4. Growing capacity (new)
`capacity = 10 + 2 * successful_lights`, at most 20. `successful_lights` = number of successful lightings in the night (relights included; lanterns preset by a scenario do not count); reset to 0 at the start of each night. The HUD shows `carried / capacity`.

## 5. New score - [REPLACE] the whole old formula
| event | points |
|---|---|
| each firefly put into a lantern (new light, relight or refuel) | +5 |
| first lighting | +100 |
| relight | +40 |
| shade hit by a pulse | +5 each; +15 each if it was in `drain` just before |
| dawn (win only), each lit lantern | +50 + floor(fuel) |
| dawn (win only), each flame left | +50 |
| time bonus | removed |
| game total over several nights | unchanged from Ticket-02 |

## 6. Colour-blind mode (new)
A saved setting "easy-to-tell-apart palette": shade rim and eyes change from `#7A3CFF` to `#00B3FF`; the UI warning colour from `#FF5A5F` to `#FFFFFF` with a warning icon; unlit and lit lanterns must differ **without colour** (an unlit lantern is deflated by 20% and its paper looks torn; a nearly-out lantern blinks).

## 7. Test Contract v1.2 (changes)
- `contract_version: "1.2"`. `tuning` adds `fuel_max: 100`, `fuel_decay_per_s: 1.0`, `fuel_per_mote: 10`, `relight_cost: 5`, `win_ratio: 0.6`, `drain_per_s: 5`, `low_fuel_threshold: 30`, `capacity_max: 20`; and `night1_duration_s = 240`, `night2_duration_s = 270`, `night3_duration_s = 300`.
- Snapshot: each lantern adds `fuel` (a real number, 1 decimal; an unlit lantern has `fuel: 0`), `ever_lit`, `relit_count`; `player` adds `capacity`. Shades get the extra state `drain`.
- Scenario: each lantern can set `lit`, `fuel`, `ever_lit`; `player` adds `successful_lights`; `shades[]` adds `target_lantern_id`. A lantern set `lit: true` without `fuel` defaults to `fuel: 100`.
- New events: `refuel {lantern_id, amount, fuel}`, `lantern_out {lantern_id}`, `fuel_drain {lantern_id, shade_id, fuel}` (written every 60 ticks while draining). `lantern_lit` gains `relight: true|false`. `game_over.reason` gains `dawn_survived`; `all_lit` is no longer used.

## Definition of done
- Evidence that the game meets the phase's requirements.
- At least one design-decision note (ADR or similar) describing how the lantern state model and the win rule changed.
- Old tests broken by the new rules are updated or deleted with a reason, never silently skipped.
- A changelog listing the breaking changes of Phase 3.
- Every hidden test of Phases 1-2 that was not replaced still passes.
