import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { addEntry, exportJson, normalise, parseStore, validName, type Entry } from "../src/leaderboard/board";
import { root } from "./helpers";

const tmp = mkdtempSync(path.join(os.tmpdir(), "ddl-lb-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const entry = (name: string, score: number, at = "2026-11-20T10:00:00+07:00", won = 1, seed = 1): Entry => ({ name, score, nights_won: won, achieved_at: at, seed });
const launcher = path.join(root, "dist/headless/launcher.js");

describe("leaderboard rules", () => {
  it.each(["abc", "Mây_Den", "A1_b2_c3_d4_", "Hoàng123", "x".repeat(12)])("accepts the name %s", (n) => expect(validName(n)).toBe(true));
  it.each(["ab", "x".repeat(13), "has space", "dash-name", "", "emoji🙂ok", "dot.name"])("rejects the name '%s'", (n) => expect(validName(n)).toBe(false));
  it("sorts by score descending and keeps only the top 10", () => {
    let list: Entry[] = [];
    for (let i = 1; i <= 12; i++) list = addEntry(list, entry(`player${i}`, i * 100, `2026-11-20T10:${String(i).padStart(2, "0")}:00+07:00`));
    expect(list).toHaveLength(10);
    expect(list.map((e) => e.score)).toEqual([1200, 1100, 1000, 900, 800, 700, 600, 500, 400, 300]);
  });
  it("on equal scores the earlier entry stays on top", () => {
    const list = normalise([entry("late", 500, "2026-11-20T12:00:00+07:00"), entry("early", 500, "2026-11-20T09:00:00+07:00"), entry("same_time_a", 500, "2026-11-20T10:00:00+07:00")]);
    expect(list.map((e) => e.name)).toEqual(["early", "same_time_a", "late"]);
  });
  it("time zones are respected when comparing times", () => {
    const list = normalise([entry("utc_later", 100, "2026-11-20T03:00:00Z"), entry("vn_earlier", 100, "2026-11-20T09:00:00+07:00")]);
    expect(list[0]?.name).toBe("vn_earlier"); // 09:00+07:00 is 02:00Z
  });
  it("a new entry with the same score as an old one goes below it", () => {
    const first = addEntry([], entry("old_one", 300, "2026-11-20T09:00:00+07:00"));
    const both = addEntry(first, entry("new_one", 300, "2026-11-20T09:00:00+07:00"));
    expect(both.map((e) => e.name)).toEqual(["old_one", "new_one"]);
  });
  it("addEntry refuses a bad name", () => {
    expect(() => addEntry([], entry("no", 1))).toThrow();
  });
  it("an entry that is too low for a full board is dropped", () => {
    let list: Entry[] = [];
    for (let i = 1; i <= 10; i++) list = addEntry(list, entry(`player${i}`, 1000 + i));
    list = addEntry(list, entry("tooLow", 5));
    expect(list.some((e) => e.name === "tooLow")).toBe(false);
  });
  it("parseStore drops rows that do not follow the rules and accepts both shapes", () => {
    const rows = [entry("good_one", 10), { name: "x", score: 1, nights_won: 1, achieved_at: "2026-11-20T10:00:00Z", seed: 1 }, { name: "bad_date", score: 1, nights_won: 1, achieved_at: "yesterday", seed: 1 }, { name: "four_won", score: 1, nights_won: 4, achieved_at: "2026-11-20T10:00:00Z", seed: 1 }, 42, null];
    expect(parseStore({ entries: rows }).map((e) => e.name)).toEqual(["good_one"]);
    expect(parseStore(rows).map((e) => e.name)).toEqual(["good_one"]);
    expect(parseStore("junk")).toEqual([]);
  });
  it("exportJson has exactly the shape {entries: [...]} in rank order", () => {
    const out = JSON.parse(exportJson([entry("low_one", 10), entry("top_one", 99)]));
    expect(Object.keys(out)).toEqual(["entries"]);
    expect(out.entries.map((e: Entry) => e.name)).toEqual(["top_one", "low_one"]);
    expect(Object.keys(out.entries[0]).sort()).toEqual(["achieved_at", "name", "nights_won", "score", "seed"]);
  });
});

describe("--export-leaderboard (run_cmd)", () => {
  const run = (file: string, out: string) =>
    spawnSync(process.execPath, [launcher, "--export-leaderboard", out], { encoding: "utf8", env: { ...process.env, LEADERBOARD_FILE: file } });
  it("writes {entries: []} when nothing was saved yet", () => {
    const out = path.join(tmp, "empty.json");
    expect(run(path.join(tmp, "none.json"), out).status).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ entries: [] });
  });
  it("exports the stored board in rank order", () => {
    const f = path.join(tmp, "store.json");
    writeFileSync(f, JSON.stringify({ entries: [entry("second", 50), entry("first_one", 80)] }));
    const out = path.join(tmp, "out.json");
    expect(run(f, out).status).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8")).entries.map((e: Entry) => e.name)).toEqual(["first_one", "second"]);
  });
  it("survives a damaged store file", () => {
    const f = path.join(tmp, "broken.json");
    writeFileSync(f, "{ not json");
    const out = path.join(tmp, "out2.json");
    expect(run(f, out).status).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ entries: [] });
  });
  it("needs a file name", () => {
    const r = spawnSync(process.execPath, [launcher, "--export-leaderboard"], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("error:");
  });
});

describe("web game server (run_cmd without arguments)", () => {
  it("serves the build and keeps the board on disk across restarts", async () => {
    if (!existsSync(path.join(root, "dist/web/index.html"))) return; // `npm run build` not run in this checkout
    const file = path.join(tmp, "api-store.json");
    const port = 4300 + Math.floor(Math.random() * 500);
    const start = () => spawn(process.execPath, [launcher, "--no-open"], { env: { ...process.env, PORT: String(port), LEADERBOARD_FILE: file }, stdio: "ignore" });
    const wait = async () => {
      for (let i = 0; i < 50; i++) {
        try {
          return await fetch(`http://localhost:${port}/api/leaderboard`);
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      throw new Error("server did not start");
    };
    let srv = start();
    try {
      expect((await wait()).status).toBe(200);
      const page = await (await fetch(`http://localhost:${port}/`)).text();
      expect(page).toContain("Lantern Island");
      const post = await fetch(`http://localhost:${port}/api/leaderboard`, { method: "POST", body: JSON.stringify(entry("api_test", 777)) });
      expect(post.status).toBe(200);
      const bad = await fetch(`http://localhost:${port}/api/leaderboard`, { method: "POST", body: JSON.stringify(entry("no", 1)) });
      expect(bad.status).toBe(400);
      srv.kill();
      await new Promise((r) => setTimeout(r, 300));
      srv = start();
      const again = await (await wait()).json();
      expect(again.entries.map((e: Entry) => e.name)).toEqual(["api_test"]);
    } finally {
      srv.kill();
    }
  });
});
