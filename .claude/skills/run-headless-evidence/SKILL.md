---
name: run-headless-evidence
description: Generate and read the headless evidence for the current phase (run scenarios, tests, determinism check, results table). Use before tagging a phase or whenever a claim like "it works" needs proof.
---

# Run headless evidence

When to use: before `git tag phase-N`, after changing anything in `src/sim`, `src/headless`, `scenarios/` or `game.contract.json`, or when asked for proof.

Steps
1. `npm run check` must be green first (typecheck, tests, determinism).
2. `npm run evidence`. It builds the CLI, runs every scenario in `scenarios/manifest.json` through the real CLI, writes `docs/evidence/phase-N/*.jsonl`, runs vitest, runs every scenario twice and compares bytes, then generates `docs/evidence/phase-N/README.md`.
3. Read `docs/evidence/phase-N/README.md` (the table: requirement | how checked | evidence path | result). Do not paste the JSONL into the chat; grep or read slices only.
4. If a row says "not met": fix the code (or, if the requirement itself was wrongly written, fix `docs/evidence/requirements-phase-N.json` and say so in the commit). Re-run. Never edit the generated files, the JSONL, or the result column.
5. For the champion kits run `npm run evidence:extras` too: it proves `src/extras` did not change headless output. A rule change in `src/sim` also changes the contract: `game.contract.json` and `src/sim/tuning.ts` must stay equal (tests/io.test.ts checks it).
6. Commit the regenerated `docs/evidence/**` in its own commit ("evidence: regenerate for <phase>"). Evidence must come from the same code as the tag.

Forbidden: editing `docs/evidence/**` by hand, copying output from another machine, changing an assertion in `scripts/evidence.mjs` only to turn a row green, marking a row as met without a check.
