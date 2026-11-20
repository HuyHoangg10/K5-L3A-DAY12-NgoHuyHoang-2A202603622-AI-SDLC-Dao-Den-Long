# AGENTS.md

Dao Den Long (Lantern Island): a 3D game where Mây, a girl in a conical hat with a small lantern, collects fireflies and relights 5 big lanterns while Ink Shades chase her. Lab project, graded by process, evidence and a hidden headless test. Owner: Ngo Huy Hoang, 2A202603622.

## Layout
```
src/sim/       pure game logic (tuning, maps for 3 nights, sim, output): no Date, no Math.random, no DOM, no Three.js
src/headless/  Node CLI (reads args/scenario/inputs, writes JSONL)
src/render/    Three.js scene, HUD, menus, sound, settings, input (uses src/sim, adds no rules)
src/main.ts    web entry
src/extras/    creative additions (champion kits Q W E R), live game only, never imported by sim/headless
scenarios/     scenario + inputs used by tests and evidence (manifest.json lists them)
tests/         vitest
scripts/       Node .mjs only (build, evidence, determinism, hooks)
docs/          spec/ notes/ evidence/ demo/ lab-brief/
game.contract.json   Test Contract v1.0; "tuning" must equal src/sim/tuning.ts
```

## Commands (work on Windows, macOS, Linux)
- Install/build: `npm ci`, `npm run build`
- Run the game: `npm run dev`
- Tests: `npm test` (builds the CLI first, then vitest)
- Headless: `node dist/headless/cli.js --seed 1 --night 1 --ticks 600 --out out.jsonl [--scenario f.json] [--inputs f.json] [--snapshot-every 10]`
- Evidence: `npm run evidence` (writes `docs/evidence/**`)
- Everything the Stop hook runs: `npm run check` (typecheck + test + determinism)

## Scope now (Phase 3 done, Phase 4 in progress; contract v1.2 -> v1.3)
- Standard numbers and maps come from the lab ticket and live in `src/sim/tuning.ts` and `src/sim/maps.ts`; do not invent numbers, change them only when the ticket changes. Spec copies: `docs/spec/phase-2.md`, `phase-3.md`, `phase-4.md`; my gap-fillers: `docs/notes/assumptions.md` (P2-*, P3-*, P4-*).
- Every new feature needs a headless scenario in `scenarios/`, a test, and a requirement in `docs/evidence/requirements-phase-N.json`.
- Run all three nights headless with `--night 1|2|3`; a full night must finish in 30 s or less.
- `npm run evidence` now writes `docs/evidence/phase-3/` (`--phase phase-2` is frozen at the tagged code); `npm run evidence:extras` checks the champion kits did not change headless output. Phase 4: `npm start` (launcher + leaderboard), `npm run bench`, `npm run soak`.

## Conventions
- Fixed 60 ticks/s, 1 tick = 1/60 s. Tick model: snapshot 0 is before input; step k reads input of tick k, makes state k+1, events get `tick = k+1`.
- All numbers live in `src/sim/tuning.ts`. Change a number there and in `game.contract.json` together.
- Round to 3 decimals when writing output. Same seed + scenario + inputs must give the same bytes.
- Use only the seeded `Rng` in `src/sim/`. No `Date`, `Math.random`, object-key-order tricks.
- Scripts and npm scripts must not depend on the OS (no `rm -rf`, `cp`, bash-only syntax).
- `src/extras/` must not change headless output.
- English for README, HUD, commits. Short commit messages, small commits.

## Never
- Never edit `docs/evidence/**` or program output by hand; only `scripts/evidence.mjs` writes there.
- Never disable, skip or loosen a test to make it pass. Never write a test that cannot fail.
- Never invent results, numbers or evidence. Not done = write "not met" and why.
- Never force-push, never move a tag after pushing it, never delete harness files (AGENTS.md, CLAUDE.md, .claude/**, scripts/hooks/**).
- Never commit `.env`, keys or tokens.

## Process for every phase
1. Understand the spec. 2. List assumptions with ids in `docs/notes/assumptions.md` and acceptance criteria in `docs/evidence/requirements.json`.
3. Plan the checks before coding. 4. Build in small commits (sim first, then render). 5. Run tests + `npm run evidence`; fix code, never the evidence.
6. Review with the `reviewer` subagent (not the agent that wrote the code). 7. Update `docs/notes/*` (eval, AI log, AI errors). 8. Tag `phase-N` on the finishing commit and push only that tag.

## Rule updates
When the agent makes the same mistake twice, add exactly one line here saying how to avoid it.
- Derive a test's expected value from the rule in the spec, never by copying what the program printed; then check the test can fail by mutating the code once (seen twice in Phase 1).
