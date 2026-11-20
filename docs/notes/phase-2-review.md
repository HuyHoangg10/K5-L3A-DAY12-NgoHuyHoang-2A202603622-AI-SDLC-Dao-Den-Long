# Phase 2 independent review (reviewer subagent, commit 2a8400d)

The review was done by a separate subagent that did not write the code. It rebuilt the repo in its own clone, ran `npm run check` and `npm run evidence` (green, 24/24), and mutated `src/sim` 89 times: 83 valid mutants, 62 killed by vitest, 21 survived.

## What I changed because of it
| # | Finding | Action |
|---|---|---|
| 1 | `player_hit` from a shade carried `lost: 0`; the spec adds `lost` only for falls | Removed from shade hits (`tests/review2.test.ts`) |
| 2 | Charm did not clear a dash cooldown that was already running | Dash allowed while the charm is active (`tests/review2.test.ts`) |
| 3 | Mây moved on the respawn tick, so the respawn snapshot was not at the start point with velocity 0 | The respawn tick does not act (`tests/review2.test.ts`) |
| 4 | `end.state` could be `paused` (v1.0 allows only playing/won/lost) | `end` prints `playing` when stopped while paused |
| 10 | Skill and reviewer files still pointed at `requirements.json` | Both updated, visible in git history |
| 11 | Stale note C-10 | Rewritten |
| 12 | Boundary tests missing (pickup 1.0 / 1.5, detect 12, give-up 18, spawn >= 15 m) | Added; I checked the new tests fail on the old code |

## Not changed (honest list)
- 5. Night 3 start point (0,0,-30) is still my guess (P2-10); the spec gives none.
- 6, 7. Shade state during the fall wait, and the drifter drop timing: conventions left as they are (P2-*).
- 8. Timing conventions (acceleration, recoil per tick, TTL, fall wait) are documented guesses.
- 9. Lantern interaction ignores height (XZ only), as v1.0 says all distances are XZ.
- Surviving mutants M25, M27, M29, M33, M50, M56, M65, P05, P06, P08, P10, P13, P19, P20, P21 are not covered yet. Map-geometry mutants need more exact tests; I did not claim them as covered.
- 13. FPS and the UI items stay manual checks.

The reviewer did not read the board, so the transcription of `docs/spec/phase-2.md` was not cross-checked by it.
