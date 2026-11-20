// Shared helpers for scripts (plain Node, no OS-specific commands).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const cliPath = path.join(root, "dist/headless/cli.js");

export function readManifest() {
  return JSON.parse(readFileSync(path.join(root, "scenarios/manifest.json"), "utf8")).scenarios;
}

/** Run the real built CLI for one manifest entry. Returns { status, stderr }. */
export function runEntry(entry, outFile) {
  mkdirSync(path.dirname(outFile), { recursive: true });
  const dir = path.join(root, "scenarios", entry.name);
  const args = [cliPath, "--seed", String(entry.seed), "--night", "1", "--ticks", String(entry.ticks), "--out", outFile, "--snapshot-every", String(entry.snapshot_every ?? 10)];
  if (existsSync(path.join(dir, "scenario.json"))) args.push("--scenario", path.join(dir, "scenario.json"));
  if (existsSync(path.join(dir, "inputs.json"))) args.push("--inputs", path.join(dir, "inputs.json"));
  const r = spawnSync(process.execPath, args, { encoding: "utf8" });
  return { status: r.status, stderr: r.stderr };
}

export function runCli(args) {
  const r = spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
  return { status: r.status, stderr: r.stderr };
}
