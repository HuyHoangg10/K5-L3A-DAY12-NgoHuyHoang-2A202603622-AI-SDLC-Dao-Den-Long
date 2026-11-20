// Runs the real commands shown in the demo video (part 2 and part 3) and stores their real output in a JSON file.
// Usage: node scripts/demo/capture-commands.mjs <out.json>      (needs bash on the PATH; run `npm run build` first)
// Nothing here is staged: every number in the video comes from this file, which comes from these commands.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const out = process.argv[2];
if (!out) throw new Error("usage: capture-commands.mjs <out.json>");
const tmp = mkdtempSync(path.join(os.tmpdir(), "ddl-demo-"));
const t = (f) => f.split(String.fromCharCode(92)).join("/");
const steps = [
  { part: 2, title: "Tests, typecheck, determinism", cmd: "npm run check", keep: 22 },
  { part: 2, title: "Evidence for phase 4", cmd: "npm run evidence", keep: 12 },
  { part: 2, title: "Headless run, seed 42, run 1", cmd: `node dist/headless/cli.js --seed 42 --night 1 --ticks 3000 --out ${t(tmp)}/run1.jsonl && wc -l ${t(tmp)}/run1.jsonl`, keep: 6 },
  { part: 2, title: "Headless run, seed 42, run 2", cmd: `node dist/headless/cli.js --seed 42 --night 1 --ticks 3000 --out ${t(tmp)}/run2.jsonl && wc -l ${t(tmp)}/run2.jsonl`, keep: 6 },
  { part: 2, title: "Same bytes?", cmd: `sha256sum ${t(tmp)}/run1.jsonl ${t(tmp)}/run2.jsonl && cmp ${t(tmp)}/run1.jsonl ${t(tmp)}/run2.jsonl && echo "cmp: files are identical"`, keep: 6 },
  { part: 2, title: "Soak test, 10 nights", cmd: `node --expose-gc dist/headless/soak.js --seed 7 --nights 10 --out ${t(tmp)}/soak.json && cat ${t(tmp)}/soak.json`, keep: 6 },
  { part: 2, title: "Benchmark file (committed, made by npm run bench)", cmd: `node -e "const b=require('./bench.json');for(const k of ['avg_fps','p1_low_fps','frame_ms_p95','frames','load_ms','peak_mem_mb','vsync_off','renderer','os'])console.log(k+': '+b[k])"`, keep: 12 },
  { part: 3, title: "Git history", cmd: "git log --oneline -n 12", keep: 14 },
  { part: 3, title: "Tags", cmd: "git tag && git ls-remote --tags origin | cut -c1-12,41-", keep: 12 },
  { part: 3, title: "Harness files", cmd: "ls AGENTS.md CLAUDE.md .github/workflows/ci.yml && ls .claude/skills .claude/agents scripts/hooks", keep: 16 },
];
const results = [];
for (const s of steps) {
  const t0 = Date.now();
  const r = spawnSync("bash", ["-c", s.cmd], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const output = (r.stdout + r.stderr).split(String.fromCharCode(27)).map((x, i) => (i === 0 ? x : x.replace(/^\[[0-9;]*m/, ""))).join("");
  results.push({ ...s, exit: r.status, secs: Math.round((Date.now() - t0) / 100) / 10, at: new Date().toISOString(), output });
  console.log(`${s.cmd.slice(0, 60)} -> exit ${r.status} in ${(Date.now() - t0) / 1000}s`);
}
writeFileSync(out, JSON.stringify(results, null, 2));
