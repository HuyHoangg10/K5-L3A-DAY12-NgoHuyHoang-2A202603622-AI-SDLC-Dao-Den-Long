# Phase 4 spec: Ticket-04 "Bình minh: phát hành v1.0.0" (contract v1.3)

**Source and honesty note.** Transcribed by me from the lab board (tab Phase 4: "Non-functional + Release", priority Cao, tag `phase-4` + GitHub Release `v1.0.0`, contract v1.3) by reading it on screen. Wording shortened and translated, numbers as read. If this file and the board disagree, the board wins. Gap-fillers are in `docs/notes/assumptions.md` (ids P4-*).

## Goal
Turn the game from "it runs" into a releasable product: measured performance, stability over long runs, a leaderboard, accessibility, easy to run, good docs. Every requirement has a concrete number and is graded automatically or by checklist. Creative additions stay, as long as rules, numbers and the Test Contract do not change and headless output stays the same. **In the benchmark scene and the soak test, characters, enemies and light effects that I added must be off** (or not affect the numbers) so that everyone is measured on the same scene.

## 1. Benchmark mode (mandatory)
Command: `<bench_cmd> --seed 42 --duration 30 --out bench.json`

Benchmark scene (identical for everyone):
1. A 1280x720 window, not full screen; vsync off if the engine allows (say in the README if it cannot be turned off).
2. Night 1 loaded with all effects and lighting as in real play.
3. Exactly **200 Ink Shades** in state `wander`, spread over the island (seed 42), and exactly **100 fireflies** (the bench may exceed the gameplay cap). Lanterns L1-L3 are lit with `fuel` 100.
4. In the bench scene these are **off**: spawning of new entities, damage, picking up fireflies, fuel decay and end-of-night conditions. Shades keep moving by `wander` as normal.
5. No player input. Mây stands still at (0,0,0). The camera flies a circle around the centre (0,0,0), radius 30 m, height Y = 15 m, always looking at (0,0,0), starting at angle 0° (point (30,15,0)), counter-clockwise seen from above, one lap per 15 s.
6. The first 3 s are warm-up (not measured). After that, measure exactly `--duration` seconds and exit with code 0.

Output `bench.json`:
```json
{ "contract_version": "1.3", "avg_fps": 87.3, "p1_low_fps": 52.1, "frame_ms_p95": 14.2, "frames": 2619,
  "load_ms": 2400, "peak_mem_mb": 512, "vsync_off": true, "renderer": "<engine/renderer and version>", "os": "<free text>" }
```
| field | meaning |
|---|---|
| `frames` | number N of frames in the measured interval |
| `avg_fps` | `1000 * N / sum(dt_i)`, dt_i = time of frame i in ms |
| `p1_low_fps` | `k = max(1, ceil(0.01 * N))`; take the k largest dt values; `p1_low_fps = 1000 / mean of those k values` |
| `frame_ms_p95` | 95th percentile of dt (ms) |
| `load_ms` | from process start to the first frame of the bench scene |
| `peak_mem_mb` | highest process (RSS) memory during the run; `null` for a web build that cannot measure it, with an explanation |

Pass thresholds, measured on the instructor's grading machine (its configuration is published before grading): `avg_fps > 60`, `p1_low_fps > 30`, `load_ms < 10000`.

## 2. Soak test (mandatory)
Command: `<soak_cmd> --seed 7 --nights 10 --out soak.json`
- Run headless **10 nights in a row in the same process** (night 1 -> 2 -> 3, cycling); night i uses seed `7 + i`; each night runs until it ends or time runs out (standard length). Inputs are random from the seed: every 30 ticks pick a new move direction; each tick has probability 5% jump, 3% dash, 2% pulse, 10% interact.
- `mem_start_mb`: process (RSS) memory just after the first night is loaded. `mem_end_mb`: RSS after the last night is reset.
- Output: `{"nights": 10, "crashes": 0, "results": ["lost","won","lost"], "mem_start_mb": 120, "mem_end_mb": 131, "duration_s": 84.2}`
- Pass: `crashes = 0` and `mem_end_mb < 1.2 * mem_start_mb`.

## 3. Local leaderboard
- After the Dawn screen (night 3 won) **or** after losing any night, let the player enter a name to save the score.
- Name: 3-12 characters `[A-Za-z0-9_]`. Vietnamese letters with diacritics are a bonus, not required.
- Each entry: `name`, `score` (total of the nights won), `nights_won` (0-3), `achieved_at` (ISO 8601 with time zone), `seed`.
- Keep the **top 10**, sorted by `score` descending; ties: the earlier one stays on top.
- Stored on the local disk, survives closing and reopening the game.
- A Leaderboard screen from the main menu.
- `<run_cmd> --export-leaderboard out.json` writes `{"entries": [ ... ]}` in that order.

## 4. Accessibility
| requirement | detail |
|---|---|
| Rebind keys | every action: move (4 directions), jump, dash, interact, pulse, pause. Detect duplicate keys and warn. A "Restore defaults" button. Saved |
| Subtitles / visual cues for sound | a shade appearing (with an arrow pointing to the screen edge), the wind warning, the last 10 s, a lantern with `fuel < 30` |
| Reduce motion | turn off camera shake and screen flashes |
| UI font size | at least 18 px at 1280x720; an option for large text (x1.25) |

## 5. Packaging and docs
- A clean clone, following the README in **at most 3 commands**, must run the game (the instructors try it on a clean machine).
- `README.md`: short description, screenshots or a GIF, system requirements, settings, controls, how to run tests, headless, bench, soak.
- `CHANGELOG.md` has entries for all 4 phases; `CREDITS.md` lists every asset, sound and AI tool that produced content; there is a `LICENSE`.
- GitHub Release `v1.0.0` has a runnable build: an executable, a static web folder, or a Docker image with instructions.

## 6. Test Contract v1.3
`contract_version: "1.3"`. `game.contract.json` adds `bench_cmd` and `soak_cmd`. Every requirement of v1.0-v1.2 stays.

## 7. Retro and demo
- A retro (1-2 pages, any name and place): a summary of the Evaluation of the 4 phases; what worked or did not when working with AI; the AI mistakes and how I caught them; which harness (AGENTS.md, skill, hook) helped most; total estimated AI tokens/cost and how I saved tokens; what I would change.
- A demo video `.mp4` under 5 minutes (attached to Release `v1.0.0` or `docs/demo/demo.mp4`): play a bit live and show the evidence that the game works (tests, headless, bench).

## Definition of done
- Evidence that the game meets the phase's requirements.
- Tag `phase-4` and Release `v1.0.0`.
- `bench.json` and `soak.json`, run by me, committed to the repo.
- Every hidden test of Phases 1-3 still passes.
- The repo is public with the AI harness and the documents required for submission.
