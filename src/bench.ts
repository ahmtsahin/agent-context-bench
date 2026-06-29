import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeRepo, discoverContextFiles, generateOptimizedAgents, inferRepoSignals } from "./index.js";

export type BenchCondition = "none" | "current" | "optimized";

export interface BenchTaskInput {
  id: string;
  prompt: string;
  baseCommit?: string;
  successCommand?: string;
  successCriteria?: string[];
  filesChanged?: string[];
}

export interface AdapterRunInput {
  prompt: string;
  workspace: string;
  condition: BenchCondition;
  timeoutMs: number;
}

export interface AdapterRunResult {
  ok: boolean;
  output: string;
  tokensUsed?: number;
  exitCode?: number;
}

export interface AgentAdapter {
  name: string;
  run(input: AdapterRunInput): AdapterRunResult;
}

export interface ConditionResult {
  condition: BenchCondition;
  adapterOk: boolean;
  success: boolean;
  durationMs: number;
  contextTokens: number;
  tokensUsed?: number;
  note?: string;
}

export interface TaskBenchResult {
  taskId: string;
  conditions: ConditionResult[];
}

export interface BenchSummary {
  adapter: string;
  generatedAt: string;
  root: string;
  conditions: BenchCondition[];
  tasks: number;
  successRate: Record<string, number>;
  avgContextTokens: Record<string, number>;
  deltas: {
    currentVsNone: number | null;
    optimizedVsCurrent: number | null;
    optimizedVsNone: number | null;
  };
  results: TaskBenchResult[];
}

export interface RunBenchOptions {
  adapter: AgentAdapter;
  tasks: BenchTaskInput[];
  conditions?: BenchCondition[];
  successCommand?: string;
  timeoutMs?: number;
  workspaceRoot?: string;
  onProgress?: (message: string) => void;
}

const DEFAULT_CONDITIONS: BenchCondition[] = ["none", "current", "optimized"];
const DEFAULT_TIMEOUT_MS = 600_000;
const COPY_IGNORE = new Set([".git", "node_modules", "dist", "build", "coverage", ".agent-context-bench"]);

// Run each task through the adapter under each context condition and measure
// whether the success command passes. "Success" is observed, not estimated:
// it is the exit status of the configured success command after the agent runs.
export function runBench(rootInput: string, options: RunBenchOptions): BenchSummary {
  const root = path.resolve(rootInput);
  const conditions = options.conditions ?? DEFAULT_CONDITIONS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const successCommand = options.successCommand ?? inferRepoSignals(root).commands.test;
  const baseDir = options.workspaceRoot
    ? (fs.mkdirSync(options.workspaceRoot, { recursive: true }), options.workspaceRoot)
    : fs.mkdtempSync(path.join(os.tmpdir(), "acb-bench-"));
  const log = options.onProgress ?? (() => {});

  const results: TaskBenchResult[] = [];
  for (const task of options.tasks) {
    const conditionResults: ConditionResult[] = [];
    for (const condition of conditions) {
      log(`task ${task.id} [${condition}]`);
      const workspace = prepareWorkspace(root, task, condition, baseDir);
      try {
        const contextTokens = applyCondition(workspace, condition);
        const start = Date.now();
        const run = options.adapter.run({ prompt: task.prompt, workspace, condition, timeoutMs });
        const durationMs = Date.now() - start;
        const verification = runSuccessCommand(workspace, task.successCommand ?? successCommand, timeoutMs);
        conditionResults.push({
          condition,
          adapterOk: run.ok,
          success: verification.success,
          durationMs,
          contextTokens,
          tokensUsed: run.tokensUsed,
          note: verification.note
        });
      } finally {
        cleanupWorkspace(root, workspace);
      }
    }
    results.push({ taskId: task.id, conditions: conditionResults });
  }

  if (!options.workspaceRoot) {
    try {
      fs.rmSync(baseDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup of the temp workspace root.
    }
  }

  return summarize(root, options.adapter.name, conditions, results);
}

// Adapter that shells out to a user-provided command. The prompt is exposed via
// stdin and the AGENT_BENCH_* env vars; {prompt} and {workspace} placeholders in
// the command are substituted as a convenience.
export function commandAdapter(command: string, name = "command"): AgentAdapter {
  return {
    name,
    run({ prompt, workspace, condition, timeoutMs }) {
      const withPrompt = command.includes("{prompt}") ? command.replace(/\{prompt\}/g, shellQuote(prompt)) : command;
      const finalCommand = withPrompt.replace(/\{workspace\}/g, workspace);
      const result = spawnSync(finalCommand, {
        cwd: workspace,
        shell: true,
        encoding: "utf8",
        timeout: timeoutMs,
        input: prompt,
        env: {
          ...process.env,
          AGENT_BENCH_PROMPT: prompt,
          AGENT_BENCH_CONDITION: condition,
          AGENT_BENCH_WORKSPACE: workspace
        }
      });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      return {
        ok: !result.error && result.status === 0,
        output,
        tokensUsed: parseReportedTokens(output),
        exitCode: result.status ?? undefined
      };
    }
  };
}

function summarize(
  root: string,
  adapter: string,
  conditions: BenchCondition[],
  results: TaskBenchResult[]
): BenchSummary {
  const successRate: Record<string, number> = {};
  const avgContextTokens: Record<string, number> = {};
  for (const condition of conditions) {
    const rows = results.map((result) => result.conditions.find((entry) => entry.condition === condition)).filter(Boolean) as ConditionResult[];
    successRate[condition] = rows.length === 0 ? 0 : round(rows.filter((row) => row.success).length / rows.length, 4);
    avgContextTokens[condition] = rows.length === 0 ? 0 : Math.round(rows.reduce((sum, row) => sum + row.contextTokens, 0) / rows.length);
  }

  const delta = (a: BenchCondition, b: BenchCondition): number | null =>
    successRate[a] === undefined || successRate[b] === undefined ? null : round((successRate[a] - successRate[b]) * 100, 2);

  return {
    adapter,
    generatedAt: new Date().toISOString(),
    root,
    conditions,
    tasks: results.length,
    successRate,
    avgContextTokens,
    deltas: {
      currentVsNone: delta("current", "none"),
      optimizedVsCurrent: delta("optimized", "current"),
      optimizedVsNone: delta("optimized", "none")
    },
    results
  };
}

function prepareWorkspace(root: string, task: BenchTaskInput, condition: BenchCondition, baseDir: string): string {
  const workspace = path.join(baseDir, `${sanitize(task.id)}__${condition}`);
  fs.rmSync(workspace, { recursive: true, force: true });
  if (isGitRepo(root)) {
    const ref = task.baseCommit ?? "HEAD";
    try {
      execFileSync("git", ["worktree", "add", "--force", "--detach", workspace, ref], { cwd: root, stdio: "ignore" });
      return workspace;
    } catch {
      // Fall back to a plain copy if the ref is missing or worktrees are unavailable.
    }
  }
  copyTree(root, workspace);
  return workspace;
}

function cleanupWorkspace(root: string, workspace: string): void {
  if (isGitRepo(root)) {
    try {
      execFileSync("git", ["worktree", "remove", "--force", workspace], { cwd: root, stdio: "ignore" });
    } catch {
      // Ignore; the directory removal below is the real cleanup.
    }
  }
  try {
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
}

// Mutate the workspace's context files for the condition and return the token
// footprint the agent would actually see.
function applyCondition(workspace: string, condition: BenchCondition): number {
  if (condition === "current") {
    return contextTokensFor(workspace);
  }
  if (condition === "optimized") {
    const optimized = generateOptimizedAgents(analyzeRepo(workspace));
    removeContextFiles(workspace);
    fs.writeFileSync(path.join(workspace, "AGENTS.md"), optimized, "utf8");
    return contextTokensFor(workspace);
  }
  removeContextFiles(workspace);
  return 0;
}

function contextTokensFor(workspace: string): number {
  return discoverContextFiles(workspace).reduce((sum, file) => sum + file.tokenEstimate, 0);
}

function removeContextFiles(workspace: string): void {
  for (const file of discoverContextFiles(workspace)) {
    try {
      fs.rmSync(file.absolutePath, { force: true });
    } catch {
      // Ignore files that cannot be removed in the workspace copy.
    }
  }
}

function runSuccessCommand(workspace: string, command: string | undefined, timeoutMs: number): { success: boolean; note?: string } {
  if (!command) {
    return { success: false, note: "no success command (pass --success or expose a test script)" };
  }
  const result = spawnSync(command, { cwd: workspace, shell: true, encoding: "utf8", timeout: timeoutMs });
  if (result.error) {
    return { success: false, note: `success command error: ${result.error.message}` };
  }
  return { success: result.status === 0 };
}

function isGitRepo(root: string): boolean {
  return fs.existsSync(path.join(root, ".git"));
}

function copyTree(root: string, destination: string): void {
  fs.cpSync(root, destination, {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source);
      return !COPY_IGNORE.has(name);
    }
  });
}

function parseReportedTokens(output: string): number | undefined {
  const match = output.match(/\bTOKENS?\b\s*[=:]\s*(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function shellQuote(value: string): string {
  if (process.platform === "win32") {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
