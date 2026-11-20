// Stop hook: run `npm run check`; if it is red, block the stop (exit 2) with the reason on stderr.
// Loop guard: when Claude Code says stop_hook_active is true we already blocked once this turn,
// so print a warning and let it stop instead of looping forever.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
let payload = {};
try {
  payload = JSON.parse(raw || "{}");
} catch {
  /* no stdin JSON: treat as a normal first stop */
}

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const pkgPath = path.join(root, "package.json");
const custom = process.env.STOP_CHECK_CMD; // used by the harness self-test
if (!custom) {
  if (!existsSync(pkgPath)) process.exit(0);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (!pkg.scripts?.check) process.exit(0);
}

const nodeDir = path.dirname(process.execPath);
const env = { ...process.env, PATH: `${nodeDir}${path.delimiter}${process.env.PATH ?? ""}` };
const res = spawnSync(custom ?? "npm run check", { cwd: root, shell: true, encoding: "utf8", env, timeout: 600000 });

if (res.status === 0) process.exit(0);

const tail = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.trim().split("\n").slice(-40).join("\n");
if (payload.stop_hook_active) {
  process.stderr.write(`warning: npm run check is still red (exit ${res.status}); letting the session stop anyway (stop_hook_active).\n${tail}\n`);
  process.exit(0);
}
process.stderr.write(`blocked: npm run check failed (exit ${res.status}). Fix it before stopping.\n${tail}\n`);
process.exit(2);
