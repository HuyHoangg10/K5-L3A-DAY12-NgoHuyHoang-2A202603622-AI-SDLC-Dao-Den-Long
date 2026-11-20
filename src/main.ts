import { Game } from "./render/game";

const host = document.getElementById("stage");
if (!host) throw new Error("missing #stage");
const game = new Game(host);
// dev-only handle for poking at the game from the browser console
if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
