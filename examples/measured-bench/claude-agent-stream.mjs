// Bench adapter: headless Claude Code with stream-json output, so run-bench can
// mine the transcript for explored files (gold-context metrics). Prints the
// assistant's text and tool-use inputs, skips tool results (file contents would
// pollute the explored-file signal), emits a TOKENS= line from the final result
// event, and appends per-run usage/cost records to $BENCH_LOG.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

let prompt = process.env.AGENT_BENCH_PROMPT || "";
if (!prompt) {
  prompt = fs.readFileSync(0, "utf8");
}

const args = [
  "-p",
  "--model", "sonnet",
  "--permission-mode", "acceptEdits",
  "--allowedTools", "Bash(npm test),Bash(npm test:*),Bash(node --test:*)",
  "--output-format", "stream-json",
  "--verbose"
];

const run = spawnSync("claude", args, {
  input: prompt,
  encoding: "utf8",
  cwd: process.cwd(),
  maxBuffer: 256 * 1024 * 1024
});

if (run.error) {
  console.error(`adapter spawn error: ${run.error.message}`);
  process.exit(1);
}

let tokens;
let result;
for (const line of (run.stdout || "").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed) {
    continue;
  }
  let event;
  try {
    event = JSON.parse(trimmed);
  } catch {
    console.log(trimmed.slice(0, 2000));
    continue;
  }
  if (event.type === "assistant" && event.message && Array.isArray(event.message.content)) {
    for (const block of event.message.content) {
      if (block.type === "text" && block.text) {
        console.log(block.text);
      } else if (block.type === "tool_use") {
        console.log(`TOOL ${block.name} ${JSON.stringify(block.input).slice(0, 2000)}`);
      }
    }
  } else if (event.type === "result") {
    result = event;
  }
}

if (result) {
  const usage = result.usage || {};
  tokens =
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);
  if (result.result) {
    console.log(String(result.result).slice(0, 4000));
  }
  if (process.env.BENCH_LOG) {
    fs.appendFileSync(
      process.env.BENCH_LOG,
      JSON.stringify({
        condition: process.env.AGENT_BENCH_CONDITION,
        workspace: process.env.AGENT_BENCH_WORKSPACE,
        tokens,
        cost_usd: result.total_cost_usd,
        duration_ms: result.duration_ms,
        num_turns: result.num_turns,
        is_error: result.is_error,
        subtype: result.subtype
      }) + "\n"
    );
  }
}

if (tokens) {
  console.log(`TOKENS=${tokens}`);
}
if (run.stderr) {
  console.error(run.stderr.slice(0, 2000));
}
process.exit(run.status ?? 1);
