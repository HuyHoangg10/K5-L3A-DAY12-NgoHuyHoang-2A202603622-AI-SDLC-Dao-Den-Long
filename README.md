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

Pick a champion on the start screen (click it, press 1 / 2 / 3, or use the left and right arrows) and press Enter to begin. Then:

| input | action |
|---|---|
| right mouse button | walk to the point under the mouse (hold to keep following it) |
| left or middle mouse drag | turn the camera (the 3D view still rotates) |
| arrow keys | walk with the keyboard (cancels a click target) |
| Space | jump |
| F | put the fireflies you carry into the nearest lantern (within 3 m) |
| D | glow: stuns and pushes away Ink Shades nearby, costs 2 fireflies |
| Q W E R | the champion's four skills, aimed at the mouse |
| Enter | start with the highlighted champion; play again after the night is over |
| Esc | back to the champion screen (after the night is over) |

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

## Creative additions: champions with Q W E R

Everything in this section is live-game only. It lives in `src/extras/` and is wired in by `src/render/game.ts`; `src/sim` and `src/headless` never import it, so **headless mode does not contain it**. `npm run evidence:extras` re-runs every scenario and checks that the output is byte-identical to the files recorded at tag `phase-1` (see `docs/evidence/extras/README.md`). Names, art and numbers are my own; the shape of the kits is inspired by champion kits in MOBA games.

Shades have 3 "ink". Skills thin the ink; at 0 the shade dissolves into a firefly (30 points). Fireflies are the mana of the champions that need it.

**1. Mây the Card Reader**

| key | skill | what it does | cooldown |
|---|---|---|---|
| Q | Card Fan | costs 1 firefly. 3 cards fly toward the mouse in a fan and pass through shades: each is stunned 1 s and loses 1 ink | 2.5 s |
| W | Roll the Card | a card flips gold, blue, pink over your hat. Press W again to stop (it stops by itself after 3 s) and the card acts at once. **Gold**: every shade within 7 m freezes 2.5 s. **Blue**: +3 fireflies. **Pink**: run 1.5x faster for 4 s | 8 s |
| E | Lure Lantern | costs 1 firefly. Throw a bright lantern up to 10 m toward the mouse. For 4 s shades within 16 m of it walk to the lantern instead of to you, then it bursts: stun 2 s and 1 ink | 14 s |
| R | Lantern Gate | put the mouse near a lantern and press R. After 1.5 s you appear 2 m from it. A hit cancels it | 25 s (5 s if cancelled) |

**2. Rowdy Cub** (no mana, uses a rage bar; rage comes from hitting shades and from being hit)

| key | small form | big form (rage full, 10 s) |
|---|---|---|
| Q | Rebound Stone: a stone flies out, comes back, slows what it touches both ways, catching it refunds 40% of the cooldown | Boulder Toss: a big boulder, 2 ink, slows, does not return |
| W | Zippy Streak (passive): every 3 hits within 6 s you sprint 1.3x for 2 s | Wallop: after a short wind-up, a cone in front is stunned 1.25 s and thinned |
| E | Bounce: leap up to 6 m toward the mouse; shades where you land are slowed | Crunch: same leap, wider landing, stronger slow and 1 ink |
| R | needs the big form | Rampage: shades within 5 m are thrown back 6 m and stunned 1.5 s |

The cub is 10% faster than Mây when small and grows 1.55x when big.

**3. Serpent Weaver** (fireflies are her mana, +10% move speed always)

| key | skill | what it does | cooldown |
|---|---|---|---|
| Q | Venom Burst | 1 firefly. A circle appears at the mouse (up to 9 m) and bursts after 0.4 s: shades inside are poisoned (1 ink over 3 s). If it hits, you run 1.4x faster for 3 s | 3.5 s |
| W | Haze Ring | 1 firefly. After 0.5 s a haze stays for 5 s at the mouse: shades inside are slowed to half speed and kept poisoned | 14 s |
| E | Twin Sting | free. Hits the shade nearest to the mouse within 8 m for 1 ink (2 if it is poisoned). If it dissolves you get 2 fireflies back | 2 s |
| R | Stone Stare | 2 fireflies. An 80 degree cone, 9 m, toward the mouse: shades inside freeze 2 s and lose 1 ink | 25 s |

The rules of every kit are tested in `tests/extras.test.ts`, `tests/champions.test.ts` and `tests/steer.test.ts`.

## Repository map

- `src/extras/`: the card skills (live mode only)
- `docs/spec/phase-1.md`: the Phase 1 spec, copied as given
- `docs/notes/`: assumptions, AI usage log, where the AI was wrong, evaluation, retro
- `docs/evidence/`: generated evidence (`phase-1/README.md` is the table), `harness-check.md` for the hooks
- `AGENTS.md`, `CLAUDE.md`, `.claude/`, `scripts/hooks/`: the AI harness
- `docs/lab-brief/`: the lab's own files (README, rules, rubric, guide)
- `CREDITS.md`, `LICENSE` (MIT)
