# Demo video scripts

The video in `docs/demo/demo.mp4` (and the Release asset `lantern-island-demo.mp4`) was recorded by these scripts, not by hand.

1. `capture-commands.mjs <out.json>` runs the real commands shown in parts 2 and 3 (`npm run check`, `npm run evidence`, two headless runs with the same seed and a byte comparison, the soak test, the committed `bench.json`, `git log`, `git tag`, the harness files) and stores their real output, exit code and duration.
2. `record.mjs <commands.json> <out dir>` records 1280x720 WebM files with Playwright and the installed Chrome:
   - part 1: the real game from `npm run dev`, played through real key presses by a small bot that only reads positions from the game (it never writes game state). The bot is simple, so it can lose; the video shows what happened.
   - parts 2 and 3: the captured command output on a plain HTML page, with short subtitles.
3. The WebM files were joined and converted with ffmpeg: `-c:v libx264 -crf 28 -preset veryfast -pix_fmt yuv420p -movflags +faststart`.

Playwright and ffmpeg are not dependencies of the repo. Install them in a temp folder: `npm i playwright-core ffmpeg-static`, run `node node_modules/playwright-core/cli.js install ffmpeg` there (Playwright's own recorder needs it), and start the scripts with `PW_DIR=<that folder>`.
