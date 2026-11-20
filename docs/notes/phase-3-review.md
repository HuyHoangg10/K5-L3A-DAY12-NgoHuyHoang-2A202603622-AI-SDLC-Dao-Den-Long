# Phase 3 independent review (reviewer subagent, commit ed233f2)

A separate subagent (not the author) cloned the repo, ran `npm run check` (315 tests green), `npm run evidence` (30/30), compared `src/sim` with `docs/spec/phase-3.md` item by item and mutated the sim 87 times (2 were no-op controls): 62 of 85 real mutants killed, 23 survived, 12 of those equivalent or practically equivalent. It did not run the web UI and could not read the board, so my transcription of the ticket is unverified.

## What I changed because of it
| finding | action |
|---|---|
| No test for the nearest weak lantern, the tie rule, weak-before-unlit (N08, M48, M49) | `tests/phase3b.test.ts` |
| `ever_lit` after a natural light, burn-out and relight untested (N03) | `tests/phase3b.test.ts` (6100-tick run) |
| Snapshot fuel rounding untested (M52) | `tests/phase3b.test.ts` |
| Exactly-30, 2 m and 6 m boundaries untested (M02-M04, M44-M46) | `tests/phase3b.test.ts`; I checked two of them fail when the rule is mutated (range 3 m, floor instead of round) |
| Tests that could not fail or had wrong titles | rewritten in `tests/phase3.test.ts` |
| `refuel.amount` undocumented | P3-13 in `docs/notes/assumptions.md` |
| P3-6 contradicted the spec (2 m), P3-10 had a wrong float claim | corrected |
| 3D lantern blink was about 3 Hz, spec says 1 Hz | `src/render/view.ts` |
| AGENTS.md still said contract v1.0 | corrected |
| The tag commit also holds Phase 4 groundwork | said so in CHANGELOG |

## Not changed
- Refuel to exactly 30 (M41) and the 30 vs 31 tick push-out (N17) are still not tested; the first is hard to reach because lanterns decay before the interact step.
- A draining shade pushed out by another lantern's light keeps draining for up to 30 ticks; `target_lantern_id` on an unlit lantern is kept; `fuel_drain` is written before `lantern_out` in the same tick. All rare or scenario-only; left as they are.
- Evidence assertions mirror the tests, so they add no kill power of their own.
