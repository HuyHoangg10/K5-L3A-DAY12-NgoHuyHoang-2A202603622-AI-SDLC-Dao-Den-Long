// Headless CLI. Exit codes: 0 ok, 2 malformed/unreadable inputs or scenario file, 1 any other error.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { FormatError, parseInputs, parseScenario } from "../sim/validate";
import { runHeadless } from "./run";

const USAGE =
  "usage: cli --seed <int> --night 1|2|3 [--scenario <file.json>] [--inputs <file.json>] --ticks <int> --out <file.jsonl> [--snapshot-every <int>]";

class UsageError extends Error {}

function parseArgs(argv: string[]): Map<string, string> {
  const m = new Map<string, string>();
  const known = new Set(["seed", "night", "scenario", "inputs", "ticks", "out", "snapshot-every"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (!a.startsWith("--")) throw new UsageError(`unexpected argument "${a}"`);
    let key = a.slice(2);
    let val: string | undefined;
    const eq = key.indexOf("=");
    if (eq >= 0) {
      val = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else {
      val = argv[++i];
    }
    if (!known.has(key)) throw new UsageError(`unknown option --${key}`);
    if (val === undefined) throw new UsageError(`--${key} needs a value`);
    m.set(key, val);
  }
  return m;
}

function intArg(m: Map<string, string>, key: string, opts: { min?: number; required?: boolean; def?: number }): number {
  const v = m.get(key);
  if (v === undefined) {
    if (opts.required) throw new UsageError(`missing --${key}`);
    return opts.def as number;
  }
  if (!/^-?\d+$/.test(v)) throw new UsageError(`--${key} must be an integer, got "${v}"`);
  const n = Number(v);
  if (opts.min !== undefined && n < opts.min) throw new UsageError(`--${key} must be >= ${opts.min}`);
  return n;
}

function readJson(path: string, what: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new FormatError(`cannot read ${what} file "${path}": ${(e as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new FormatError(`${what} file "${path}" is not valid JSON: ${(e as Error).message}`);
  }
}

function main(): number {
  try {
    const args = parseArgs(process.argv.slice(2));
    const seed = intArg(args, "seed", { required: true });
    const night = intArg(args, "night", { def: 1 });
    const ticks = intArg(args, "ticks", { required: true, min: 0 });
    const every = intArg(args, "snapshot-every", { def: 10, min: 1 });
    const out = args.get("out");
    if (!out) throw new UsageError("missing --out");
    if (night !== 1 && night !== 2 && night !== 3) throw new UsageError("--night must be 1, 2 or 3");

    const scenarioPath = args.get("scenario");
    const inputsPath = args.get("inputs");
    const scenario = scenarioPath ? parseScenario(readJson(scenarioPath, "scenario")) : undefined;
    const frames = inputsPath ? parseInputs(readJson(inputsPath, "inputs")) : undefined;

    const lines = runHeadless({ seed, night: night as 1 | 2 | 3, ticks, snapshotEvery: every, scenario, frames });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, lines.join("\n") + "\n");
    return 0;
  } catch (e) {
    if (e instanceof FormatError) {
      process.stderr.write(`error: ${e.message}\n`);
      return 2;
    }
    if (e instanceof UsageError) {
      process.stderr.write(`error: ${e.message}\n${USAGE}\n`);
      return 1;
    }
    process.stderr.write(`error: ${(e as Error).stack ?? String(e)}\n`);
    return 1;
  }
}

process.exitCode = main();
