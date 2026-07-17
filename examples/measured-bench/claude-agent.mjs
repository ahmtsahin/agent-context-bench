// Bench adapter: runs headless Claude Code on the task prompt (stdin), emits the
// final text plus a TOKENS= line parsed by agent-context-bench, and appends full
// usage details to BENCH_LOG for later analysis.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

if (process.env.BENCH_LOG) {
  fs.appendFileSync(
    process.env.BENCH_LOG.replace(/\.jsonl$/, "-alive.log"),
    `alive cwd=${process.cwd()} stdin_isTTY=${process.stdin.isTTY}\n`
  );
}

let prompt = process.env.AGENT_BENCH_PROMPT || "";
if (!prompt) {
  prompt = fs.readFileSync(0, "utf8");
}
const args = [
  "-p",
  "--model", "sonnet",
  "--permission-mode", "acceptEdits",
  "--allowedTools", "Bash(npm test),Bash(npm test:*),Bash(node --test:*)",
  "--output-format", "json"
];

const run = spawnSync("claude", args, {
  input: prompt,
  encoding: "utf8",
  cwd: process.cwd(),
  maxBuffer: 64 * 1024 * 1024
});

if (run.error) {
  console.error(`adapter spawn error: ${run.error.message}`);
  process.exit(1);
}

if (process.env.BENCH_LOG) {
  fs.appendFileSync(
    process.env.BENCH_LOG.replace(/\.jsonl$/, "-debug.jsonl"),
    JSON.stringify({
      condition: process.env.AGENT_BENCH_CONDITION,
      status: run.status,
      stdout_head: (run.stdout || "").slice(0, 400),
      stderr_head: (run.stderr || "").slice(0, 400)
    }) + "\n"
  );
}

let text = run.stdout || "";
let tokens;
try {
  const parsed = JSON.parse(run.stdout);
  const usage = parsed.usage || {};
  tokens =
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);
  text = parsed.result || "";
  if (process.env.BENCH_LOG) {
    fs.appendFileSync(
      process.env.BENCH_LOG,
      JSON.stringify({
        condition: process.env.AGENT_BENCH_CONDITION,
        workspace: process.env.AGENT_BENCH_WORKSPACE,
        tokens,
        cost_usd: parsed.total_cost_usd,
        duration_ms: parsed.duration_ms,
        num_turns: parsed.num_turns,
        is_error: parsed.is_error,
        subtype: parsed.subtype
      }) + "\n"
    );
  }
} catch {
  // Non-JSON output: pass it through untouched.
}

console.log(text.slice(0, 4000));
if (tokens) {
  console.log(`TOKENS=${tokens}`);
}
if (run.stderr) {
  console.error(run.stderr.slice(0, 2000));
}
process.exit(run.status ?? 1);
