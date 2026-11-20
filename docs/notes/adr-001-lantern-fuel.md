# ADR 001: lanterns have fuel, the night is won at dawn

Status: accepted (Phase 3, Ticket-03). Replaces the lantern model and the win rule of Phase 2.

## Context
In Phase 2 a lantern had two states, unlit and lit, and lit was forever: 10 fireflies lit it, the safe zone never closed, and lighting all of them ended the night at once. Playtests of the lab showed good players finishing in 2 minutes with no tension.

## Decision
1. **Lantern state** is now `fuel` (0..100) plus two flags: `ever_lit` and a relight counter. "Lit" means `fuel > 0`. Fuel falls by 1/s on its own and by 5/s for each shade that drains it. At 0 the lantern goes off (`lantern_out`), its deposited fireflies reset to 0, `ever_lit` stays true.
2. **Fireflies keep a lit lantern alive:** interact at a lit, not-full lantern puts in `min(carried, ceil((100-fuel)/10))` fireflies, +10 fuel each. A lantern that went off needs only 5 fireflies to relight; a never-lit one still needs 10.
3. **Shades become a threat to lit lanterns:** below 30 fuel a lantern loses its safe zone; shades that are wandering walk to the weakest lit lantern and stand next to it in the new state `drain`.
4. **Win at dawn:** the night does not end when everything is lit. Mây wins by being alive at the end of the night with at least `ceil(0.6 * lanterns)` lanterns lit.
5. **Capacity grows** with successful lightings (10 + 2 per lighting, max 20) so that refuelling many lanterns later in the night is possible.
6. **Score** pays for keeping light: +5 per firefly put in, +100 first light, +40 relight, dawn bonus per lit lantern (+50 + fuel) and per flame (+50); the time bonus is gone.

## Consequences
- Rules that used `lit` as a permanent fact changed meaning: the safe zone, the shade spawn filter and the wander target now ask for "lit with fuel >= 30". The win check moved from "all lit" to the dawn tick; `game_over.reason` is `dawn_survived`, `all_lit` disappears.
- Tests that assumed "lighting all lanterns wins at once" (win, win_last_tick, pre-lit scenarios) and the old score numbers were rewritten, see CHANGELOG.
- The headless contract grows (v1.2): `fuel`, `ever_lit`, `relit_count`, `capacity`, three new events.
- Fuel is stored in sixtieths of a unit (an integer) so that long runs do not accumulate float error; output rounds to one decimal.

## Alternatives I did not take
- Keep "lit forever" and add a second, separate fuel meter: rejected, the ticket wants lanterns to go out.
- Let drain stop at 1 fuel: rejected, the ticket says the lantern goes off at 0.
