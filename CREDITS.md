# Credits

- **Code, design, characters, names** (Mây, Ink Shades, Lantern Island): original, made for this lab.
- **Graphics**: no image, model or texture files. Everything is built at runtime from Three.js primitives (boxes, spheres, cones, cylinders) and lights.
- **Sound**: no audio files. Every sound is synthesised in the browser with WebAudio (`src/render/audio.ts`).
- **Screenshots** in `docs/img/` were taken from this game with headless Chrome (`/?demo=1`).
- **Libraries**: [Three.js](https://threejs.org) (MIT), [Vite](https://vitejs.dev) (MIT), [Vitest](https://vitest.dev) (MIT), [esbuild](https://esbuild.github.io) (MIT), [TypeScript](https://www.typescriptlang.org) (Apache-2.0).
- **AI tools**: Claude Code with Claude Sonnet 5.5 (Anthropic) wrote most of the code, tests and notes under my direction; separate reviewer subagents (fresh context, not the author) reviewed Phases 1, 2 and 3 including mutation testing (`docs/notes/phase-1-eval.md`, `phase-2-review.md`, `phase-3-review.md`). The demo video, the retro's judgement and the decisions are mine. Prompts, harness and the log of AI mistakes are in `AGENTS.md`, `CLAUDE.md`, `.claude/`, `docs/notes/`.
- Lab brief and rules: VinUni AI20k, kept in `docs/lab-brief/`.
- **Idea credit**: the Q/W/E/R champion kits (a card thrower, a shape-shifting brawler, a poison caster) follow the general shape of champion kits in MOBA games, and right-click movement follows the same genre. No character, name, art, model or number is taken from any game: the champions, skill names, looks and values are my own (the lab rules forbid existing characters).
