# Where the AI got it wrong

Real cases only. Format: what happened, how it was noticed, what changed in the harness.

| # | phase | what went wrong | how it was found | fix / harness change |
|---|---|---|---|---|
| 1 | 0 | Node.js was not installed; the first plan assumed `npm` was on PATH. | `node: command not found` on the first command. | Asked before installing (winget, LTS). `scripts/hooks/stop-check.mjs` adds the folder of the running node to PATH so the hook works in a stale shell. |
| 2 | 1 | The first big Bash heredoc with TypeScript code failed to parse (quotes inside the heredoc). | Bash error `unexpected EOF`; nothing was written. | CLAUDE.md now says to use the Write tool for code files. |
| 3 | 1 | The `vite.config.ts` used `test:` with `defineConfig` from `vite`, which the types reject. | `npm run typecheck`. | Switched to `vitest/config`. |
| 4 | 1 | First version of the hit-drop test only used `carried: 4`, where `floor` and `ceil` give the same answer, so a wrong rounding would still pass. | Manual mutation (changed `floor` to `ceil`, tests stayed green). | Added `tests/drop.test.ts` with carried 5, 1, 0. Reviewer instructions say to prove suspicion by mutating a scratch copy. |
| 5 | 1 | The `full_night` evidence scenario ended after 1187 ticks (the idle player was killed) but the speed check only asked for `>= 1000` ticks, so it would not prove a full night. | Reading the generated scenario table. | Player is parked on a lantern, check now requires exactly 14400 ticks. |
| 6 | 1 | Pulse ran after shades had already moved in the same tick, so a shade 8.05 m away in snapshot k counted as in range, and the push was d - 0.067 + 4. My own tests had copied that behaviour (expected values came from the output). | Independent `reviewer` pass, item 1. | Pulse now runs before shades move; tests derive the expected positions from the rule (5 + 4), boundary tests added. |
| 7 | 1 | The test "a stunned shade cannot hit the player" could not fail: the pulse pushes the shade 4 m away, so it never touches the player anyway. | Reviewer mutated the code (removed the stun check), 88/88 still passed. | Test rewritten so the player walks into the stunned shade. |
| 8 | 1 | No tests for radius boundaries, win-vs-dawn priority, yaw sign, air jump, cooldown off-by-one, wall radius, max shades. Wall test sampled one tick and missed a wall at 60 m. | Reviewer mutation run: 11 of 36 mutants survived. | `tests/edges.test.ts` added; I re-ran the surviving mutants and they are now caught. |
| 9 | 1 | The requirement text said "one mote per step" but the code takes every mote in range. | Reviewer read the code against the text. | Text and test names fixed to describe the real rule (A-22). |
| 10 | extras | First kit test suite let a mutant survive (all three cards flying the same direction), and the skill bar labels were clipped / mispositioned in the browser. | Own mutation run; screenshot. | Added the fan-spread test; fixed CSS (`left: 0`, wider cells). |
| 11 | extras | Mutation run on the new kits: the speed-bonus test only walked along Z, so a bug on the X axis survived; the stone-catch test would pass without any cooldown refund. | Own mutation run. | Diagonal-walk test and an exact refund test added. |
| 12 | extras | The first draft of the steering function had an arrival radius (0.12 m) bigger than one step (0.1 m), so the slow-down for the last step was dead code. | Reading the failing overshoot test. | Radius 0.05 m, test checks the last step is shorter. |
