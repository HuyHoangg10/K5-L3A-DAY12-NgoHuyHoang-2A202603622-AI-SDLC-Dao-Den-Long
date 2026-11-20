# Lantern Island (Đảo Đèn Lồng)

**Demo video:** _coming in Phase 4 (link goes here)_

A small 3D night game. Dark mist has swallowed the lights of the island. You play **Mây**, a girl in a conical hat with a little lantern hanging on a stick. Pick up fireflies, carry them to the five big lanterns and light them all before dawn. Ink Shades (purple-black blobs) chase you; a touch costs a flame and makes you drop some fireflies. You can glow to push them away, but glowing burns fireflies too. The island gets brighter with every lantern you light.

Everything is made from Three.js shapes and lights, no downloaded assets. The game rules are plain TypeScript in `src/sim/` and are used both by the 3D game and by the headless mode.

## Run it (3 commands)

Needs Node 20 or newer.

```
npm ci
npm run build
npm run dev
```

Then open the address Vite prints (http://localhost:5173). Click "Begin the night" or press Space.

## Controls

| key | action |
|---|---|
| W A S D / arrow keys | move (relative to the camera) |
| Space | jump |
| E | put the fireflies you carry into the nearest lantern (within 3 m) |
| Q or F | glow: stuns and pushes away Ink Shades nearby, costs 2 fireflies |
| mouse drag | turn the camera |
| R | restart |

Fireflies are picked up automatically when you walk over them.

## How scoring works

| event | points |
|---|---|
| each firefly picked up | 10 |
| each lantern lit | 100 |
| each Ink Shade stunned by a glow | 20 |
| **win only:** each full second left on the clock | 2 |
| **win only:** each flame left | 50 |

You win when all 5 lanterns are lit. You lose when your 3 flames are gone or the night (4:00) runs out. A lantern needs 5 fireflies; you can carry 10. All numbers are in `src/sim/tuning.ts`.

## Tests and headless mode

```
npm test                 # builds the CLI, then runs vitest
npm run typecheck
npm run check            # typecheck + tests + determinism check
npm run evidence         # runs scenarios, writes docs/evidence/**
```

The headless CLI runs the same rules without a window or GPU, 60 ticks per second, and writes JSON lines (snapshots, events, final `end` line):

```
node dist/headless/cli.js --seed 1 --night 1 --ticks 600 --out out.jsonl
node dist/headless/cli.js --seed 1 --night 1 --scenario scenarios/pickup/scenario.json --inputs scenarios/pickup/inputs.json --ticks 60 --out pickup.jsonl
```

Options: `--seed <int>`, `--night 1`, `--scenario <file>`, `--inputs <file>`, `--ticks <int>`, `--out <file>`, `--snapshot-every <int>` (default 10). Exit code 0 on success, 2 if the inputs or scenario file is unreadable or malformed, 1 for other errors (message on stderr).

A scenario (see `scenarios/` for all of them):

```json
{ "player": { "pos": [0, 0, 0], "carried": 0, "flames": 3 },
  "random_motes": false, "random_shades": false,
  "motes": [[0, 0, 5]],
  "shades": [{ "pos": [10, 0, 0] }],
  "lanterns": [{ "id": "L1", "pos": [0, 0, 25], "deposited": 0 }],
  "time_left_s": 300 }
```

Inputs:

```json
{ "frames": [ { "tick": 0, "move": [0, 1], "cam_yaw_deg": 0 }, { "tick": 120, "interact": true }, { "tick": 121, "interact": false } ] }
```

The contract for the grader is in `game.contract.json` (`tuning` equals `src/sim/tuning.ts`, a test checks that).

### Tuning values that are `false` or not literal

- `fall_enabled: false`: there is no falling. The island edge (50 m from the centre) is a wall, so the `player_hit` event with `by: "fall"` never appears.
- `hit_drop_ratio: 0.5`: a hit makes you drop `floor(carried × 0.5)` fireflies, which land on the ground around you.
- `safe_radius: 4`: Ink Shades cannot enter 4 m around any lantern (lit or not), so a lantern is a safe place to stand.
- `pulse_cost: 2`: the glow costs 2 carried fireflies. With fewer than 2 nothing happens.
- `lantern_cost: 5`: fireflies needed to light one lantern. You may deposit part of it and come back.

Every other guess I had to make is listed with an id in `docs/notes/assumptions.md`.

## Repository map

- `docs/spec/phase-1.md`: the Phase 1 spec, copied as given
- `docs/notes/`: assumptions, AI usage log, where the AI was wrong, evaluation, retro
- `docs/evidence/`: generated evidence (`phase-1/README.md` is the table), `harness-check.md` for the hooks
- `AGENTS.md`, `CLAUDE.md`, `.claude/`, `scripts/hooks/`: the AI harness
- `docs/lab-brief/`: the lab's own files (README, rules, rubric, guide)
- `CREDITS.md`, `LICENSE` (MIT)
