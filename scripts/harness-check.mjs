// Self-test of the hooks: feeds real hook payloads to the real hook scripts and records the exit codes.
// Used by scripts/evidence.mjs, which writes docs/evidence/harness-check.md from the result.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { root } from "./lib.mjs";

const guard = path.join(root, "scripts/hooks/pretool-guard.mjs");
const stop = path.join(root, "scripts/hooks/stop-check.mjs");

function run(script, payload, env = {}) {
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, ...env },
    cwd: root,
  });
  return { code: r.status, stderr: (r.stderr ?? "").trim().split("\n")[0] ?? "" };
}

export function runHarnessChecks() {
  const rows = [];
  const add = (name, res, expectCode, expectInStderr) => {
    const pass = res.code === expectCode && (!expectInStderr || res.stderr.includes(expectInStderr));
    rows.push({ name, expect: `exit ${expectCode}`, got: `exit ${res.code}${res.stderr ? ` - ${res.stderr}` : ""}`, pass });
  };
  const tool = (tool_name, tool_input) => run(guard, { tool_name, tool_input });

  add("Write docs/evidence/phase-1/x.md", tool("Write", { file_path: "docs/evidence/phase-1/x.md", content: "x" }), 2, "evidence");
  add("Edit docs\\evidence\\phase-1\\a.jsonl (backslashes)", tool("Edit", { file_path: "D:\\repo\\docs\\evidence\\phase-1\\a.jsonl" }), 2, "evidence");
  add("Write docs/evidence/requirements.json (hand-written file, allowed)", tool("Write", { file_path: "docs/evidence/requirements.json" }), 0);
  add("Write docs/evidence/requirements-extras.json (hand-written file, allowed)", tool("Write", { file_path: "docs/evidence/requirements-extras.json" }), 0);
  add("Write src/sim/sim.ts (normal file)", tool("Write", { file_path: "src/sim/sim.ts" }), 0);
  add("Bash: echo x > docs/evidence/a.md", tool("Bash", { command: "echo x > docs/evidence/a.md" }), 2, "evidence");
  add("Bash: cp a docs/evidence/b", tool("Bash", { command: "cp a docs/evidence/b" }), 2, "evidence");
  add("Bash: npm run evidence (the allowed way)", tool("Bash", { command: "npm run evidence" }), 0);
  add("Bash: git add docs/evidence", tool("Bash", { command: "git add docs/evidence" }), 0);
  add("Bash: git push --force origin main", tool("Bash", { command: "git push --force origin main" }), 2, "force push");
  add("Bash: git push --force-with-lease", tool("Bash", { command: "git push --force-with-lease origin main" }), 2, "force push");
  add("Bash: git push -f origin main", tool("Bash", { command: "git push -f origin main" }), 2, "force push");
  add("Bash: git push origin +main", tool("Bash", { command: "git push origin +main" }), 2, "force push");
  add("Bash: git push origin main (normal push)", tool("Bash", { command: "git push origin main" }), 0);
  add("Bash: git push origin phase-1 (tag push)", tool("Bash", { command: "git push origin phase-1" }), 0);
  add("Read .env", tool("Read", { file_path: "D:\\repo\\.env" }), 2, ".env");
  add("Write .env.local", tool("Write", { file_path: ".env.local", content: "K=v" }), 2, ".env");
  add("Read .env.example (template, allowed)", tool("Read", { file_path: ".env.example" }), 0);
  add("Bash: cat .env", tool("Bash", { command: "cat .env" }), 2, ".env");
  add("Bash: node -e with .env.production", tool("Bash", { command: "type .env.production" }), 2, ".env");
  add("Bash: ls (no .env)", tool("Bash", { command: "ls -la" }), 0);

  add("Stop hook, check failing, first stop: blocks", run(stop, { stop_hook_active: false }, { STOP_CHECK_CMD: 'node -e "process.exit(1)"' }), 2, "blocked");
  add("Stop hook, check failing, stop_hook_active true: lets stop (loop guard)", run(stop, { stop_hook_active: true }, { STOP_CHECK_CMD: 'node -e "process.exit(1)"' }), 0, "warning");
  add("Stop hook, check passing: lets stop", run(stop, { stop_hook_active: false }, { STOP_CHECK_CMD: 'node -e "process.exit(0)"' }), 0);
  return rows;
}
