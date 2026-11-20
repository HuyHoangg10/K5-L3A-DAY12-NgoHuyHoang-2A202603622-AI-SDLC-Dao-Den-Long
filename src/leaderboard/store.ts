// Disk store for the leaderboard (Node side): data/leaderboard.json, plus the tiny HTTP API the web game talks to.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname } from "node:path";
import { addEntry, exportJson, parseStore, type Entry } from "./board";

export function readBoard(file: string): Entry[] {
  if (!existsSync(file)) return [];
  try {
    return parseStore(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return []; // a damaged file must not stop the game
  }
}

export function writeBoard(file: string, entries: Entry[]): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, exportJson(entries));
}

/** Handles GET/POST /api/leaderboard. Returns false when the request is not for the API. */
export function handleApi(req: IncomingMessage, res: ServerResponse, file: string): boolean {
  if (!req.url?.startsWith("/api/leaderboard")) return false;
  const send = (code: number, body: unknown) => {
    res.statusCode = code;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET") {
    send(200, { entries: readBoard(file) });
  } else if (req.method === "POST") {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 10000) req.destroy();
    });
    req.on("end", () => {
      try {
        const e = JSON.parse(raw) as Entry;
        const next = addEntry(readBoard(file), { name: String(e.name), score: Number(e.score), nights_won: Number(e.nights_won), achieved_at: String(e.achieved_at), seed: Number(e.seed) });
        writeBoard(file, next);
        send(200, { entries: next });
      } catch (err) {
        send(400, { error: (err as Error).message });
      }
    });
  } else send(405, { error: "method not allowed" });
  return true;
}
