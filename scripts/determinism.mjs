// Runs every scenario twice through the built CLI and requires byte-identical output.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readManifest, runEntry } from "./lib.mjs";

const tmp = mkdtempSync(path.join(os.tmpdir(), "ddl-det-"));
let bad = 0;
try {
  for (const e of readManifest()) {
    const a = path.join(tmp, `${e.name}.a.jsonl`);
    const b = path.join(tmp, `${e.name}.b.jsonl`);
    const ra = runEntry(e, a);
    const rb = runEntry(e, b);
    if (ra.status !== 0 || rb.status !== 0) {
      console.error(`FAIL ${e.name}: CLI exit ${ra.status}/${rb.status} ${ra.stderr}`);
      bad++;
    } else if (!readFileSync(a).equals(readFileSync(b))) {
      console.error(`FAIL ${e.name}: two runs differ`);
      bad++;
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (bad) process.exit(1);
console.log("determinism ok: every scenario gives identical bytes on two runs");
