import { Bench } from "./render/bench";
import { Game } from "./render/game";

const host = document.getElementById("stage");
if (!host) throw new Error("missing #stage");
const q = new URLSearchParams(window.location.search);
if (q.has("bench")) {
  // benchmark mode (Ticket-04): scripts/bench.mjs opens this page; you can also open /?bench=1&seed=42&duration=30 by hand
  new Bench(host, Number(q.get("seed") ?? 42), Number(q.get("duration") ?? 30));
} else {
  const game = new Game(host);
  if (q.has("demo")) game.startDemo(); // README screenshots
  // dev-only handle for poking at the game from the browser console
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
}
