import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeRepo, discoverContextFiles, generateOptimizedAgents, inferRepoSignals } from "./index.js";

export type BenchCondition = "none" | "current" | "optimized";

export interface BenchTaskInput {
  id: string;
  prompt: string;
  baseCommit?: string;
  targetCommit?: string;
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

// File-level context metrics for one task run, ContextBench-style: the files
// changed by the task's source commit act as the gold context, edited files are
// read from the workspace's git status, and explored files are edited files
// plus workspace files the agent's output mentioned.
export interface ConditionContextMetrics {
  goldFiles: string[];
  editedFiles: string[];
  exploredFiles: string[];
  editRecall: number | null;
  editPrecision: number | null;
  editF1: number | null;
  exploredRecall: number | null;
  exploredPrecision: number | null;
  exploredF1: number | null;
}

export interface ConditionResult {
  condition: BenchCondition;
  adapterOk: boolean;
  success: boolean;
  durationMs: number;
  contextTokens: number;
  tokensUsed?: number;
  contextMetrics?: ConditionContextMetrics;
  note?: string;
}

export interface TaskBenchResult {
  taskId: string;
  conditions: ConditionResult[];
}

// Per-condition averages of the file-level context metrics, computed over the
// tasks that carry gold files (filesChanged) and ran in a git worktree.
export interface BenchConditionMetricsSummary {
  tasksWithGold: number;
  editRecall: number | null;
  editPrecision: number | null;
  editF1: number | null;
  exploredRecall: number | null;
  exploredPrecision: number | null;
  exploredF1: number | null;
}

export interface BenchSummary {
  adapter: string;
  generatedAt: string;
  root: string;
  conditions: BenchCondition[];
  tasks: number;
  successRate: Record<string, number>;
  avgContextTokens: Record<string, number>;
  avgDurationMs: Record<string, number>;
  // Success per unit of context pressure: successRate / (1 + tokens / 10k).
  efficiency: Record<string, number | null>;
  contextMetrics: Record<string, BenchConditionMetricsSummary>;
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
        // Snapshot the files the condition setup already touched (removed or
        // rewritten context files) so they do not count as agent edits.
        const preDirty = gitDirtyFiles(workspace);
        const start = Date.now();
        const run = options.adapter.run({ prompt: task.prompt, workspace, condition, timeoutMs });
        const durationMs = Date.now() - start;
        const contextMetrics = collectContextMetrics(task, workspace, preDirty, run.output);
        const verification = runSuccessCommand(workspace, task.successCommand ?? successCommand, timeoutMs);
        conditionResults.push({
          condition,
          adapterOk: run.ok,
          success: run.ok && verification.success,
          durationMs,
          contextTokens,
          tokensUsed: run.tokensUsed,
          contextMetrics,
          note: combineNotes(
            run.ok ? undefined : `agent command failed${run.exitCode === undefined ? "" : ` (exit ${run.exitCode})`}`,
            verification.note
          )
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
      const spawnOptions = {
        cwd: workspace,
        encoding: "utf8" as const,
        timeout: timeoutMs,
        input: prompt,
        env: {
          ...process.env,
          AGENT_BENCH_PROMPT: prompt,
          AGENT_BENCH_CONDITION: condition,
          AGENT_BENCH_WORKSPACE: workspace
        }
      };
      let result: SpawnSyncReturns<string>;
      try {
        if (/\{(?:prompt|workspace)\}/.test(command)) {
          const expand = (value: string) =>
            value
              .replace(/\{prompt\}/g, prompt)
              .replace(/\{workspace\}/g, workspace);
          const [executable, ...args] = parseCommandTemplate(command);
          result = spawnSync(expand(executable), args.map(expand), spawnOptions);
        } else {
          result = spawnSync(command, { ...spawnOptions, shell: true });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          output: `agent command error: ${message}`
        };
      }
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

export interface TaskVerification {
  taskId: string;
  baseFails: boolean | null;
  targetPasses: boolean | null;
  verified: boolean;
  note?: string;
}

export interface VerifyBenchTasksOptions {
  successCommand?: string;
  timeoutMs?: number;
  onProgress?: (message: string) => void;
}

// Vet generated tasks the way ContextBench vets its Verified subset: a task
// only counts when the success command fails at the base commit (the bug is
// really present, so an agent cannot pass by doing nothing) and passes at the
// target commit (the historical fix really solves it).
export function verifyBenchTasks(
  rootInput: string,
  tasks: BenchTaskInput[],
  options: VerifyBenchTasksOptions = {}
): TaskVerification[] {
  const root = path.resolve(rootInput);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const successCommand = options.successCommand ?? inferRepoSignals(root).commands.test;
  const log = options.onProgress ?? (() => {});
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-verify-"));

  const verifications: TaskVerification[] = [];
  try {
    for (const task of tasks) {
      verifications.push(verifyTask(root, task, successCommand, timeoutMs, baseDir, log));
    }
  } finally {
    try {
      fs.rmSync(baseDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup of the temp verification root.
    }
  }
  return verifications;
}

function verifyTask(
  root: string,
  task: BenchTaskInput,
  successCommand: string | undefined,
  timeoutMs: number,
  baseDir: string,
  log: (message: string) => void
): TaskVerification {
  const unverified = (note: string): TaskVerification => {
    log(`verify ${task.id}: skipped (${note})`);
    return { taskId: task.id, baseFails: null, targetPasses: null, verified: false, note };
  };
  if (!successCommand) {
    return unverified("no success command (pass --success or expose a test script)");
  }
  if (!task.baseCommit || !task.targetCommit) {
    return unverified("task lacks baseCommit/targetCommit");
  }
  if (!isGitRepo(root)) {
    return unverified("not a git repository");
  }

  const workspace = path.join(baseDir, sanitize(task.id));
  fs.rmSync(workspace, { recursive: true, force: true });
  try {
    execFileSync("git", ["worktree", "add", "--force", "--detach", workspace, task.baseCommit], {
      cwd: root,
      stdio: "ignore"
    });
  } catch {
    return unverified(`could not create a worktree at ${task.baseCommit}`);
  }

  try {
    const base = runSuccessCommand(workspace, successCommand, timeoutMs);
    const baseFails = !base.success;
    let targetPasses: boolean | null = null;
    try {
      execFileSync("git", ["checkout", "--force", "--detach", task.targetCommit], { cwd: workspace, stdio: "ignore" });
      targetPasses = runSuccessCommand(workspace, successCommand, timeoutMs).success;
    } catch {
      return { taskId: task.id, baseFails, targetPasses: null, verified: false, note: `could not checkout ${task.targetCommit}` };
    }
    const verified = baseFails && targetPasses;
    const note = verified
      ? undefined
      : !baseFails
        ? "success command already passes at the base commit"
        : "success command fails at the target commit";
    log(
      `verify ${task.id}: base ${baseFails ? "fails" : "passes"}, target ${targetPasses ? "passes" : "fails"}${verified ? "" : " -> dropped"}`
    );
    return { taskId: task.id, baseFails, targetPasses, verified, note };
  } finally {
    cleanupWorkspace(root, workspace);
  }
}

function summarize(
  root: string,
  adapter: string,
  conditions: BenchCondition[],
  results: TaskBenchResult[]
): BenchSummary {
  const successRate: Record<string, number> = {};
  const avgContextTokens: Record<string, number> = {};
  const avgDurationMs: Record<string, number> = {};
  const efficiency: Record<string, number | null> = {};
  const contextMetrics: Record<string, BenchConditionMetricsSummary> = {};
  for (const condition of conditions) {
    const rows = results.map((result) => result.conditions.find((entry) => entry.condition === condition)).filter(Boolean) as ConditionResult[];
    successRate[condition] = rows.length === 0 ? 0 : round(rows.filter((row) => row.success).length / rows.length, 4);
    avgContextTokens[condition] = rows.length === 0 ? 0 : Math.round(rows.reduce((sum, row) => sum + row.contextTokens, 0) / rows.length);
    avgDurationMs[condition] = rows.length === 0 ? 0 : Math.round(rows.reduce((sum, row) => sum + row.durationMs, 0) / rows.length);
    efficiency[condition] =
      rows.length === 0 ? null : round(successRate[condition] / (1 + avgContextTokens[condition] / 10_000), 3);
    const metricRows = rows.map((row) => row.contextMetrics).filter(Boolean) as ConditionContextMetrics[];
    contextMetrics[condition] = {
      tasksWithGold: metricRows.length,
      editRecall: averageMetric(metricRows.map((row) => row.editRecall)),
      editPrecision: averageMetric(metricRows.map((row) => row.editPrecision)),
      editF1: averageMetric(metricRows.map((row) => row.editF1)),
      exploredRecall: averageMetric(metricRows.map((row) => row.exploredRecall)),
      exploredPrecision: averageMetric(metricRows.map((row) => row.exploredPrecision)),
      exploredF1: averageMetric(metricRows.map((row) => row.exploredF1))
    };
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
    avgDurationMs,
    efficiency,
    contextMetrics,
    deltas: {
      currentVsNone: delta("current", "none"),
      optimizedVsCurrent: delta("optimized", "current"),
      optimizedVsNone: delta("optimized", "none")
    },
    results
  };
}

function averageMetric(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null && value !== undefined);
  return present.length === 0 ? null : round(present.reduce((sum, value) => sum + value, 0) / present.length, 4);
}

// Gold files come from the task's source commit; edited files from git status;
// explored files add workspace files mentioned in the agent's output. Metrics
// stay undefined when the task has no gold files or the workspace is not a git
// worktree (the plain-copy fallback), so estimates never masquerade as data.
function collectContextMetrics(
  task: BenchTaskInput,
  workspace: string,
  preDirty: Set<string> | null,
  agentOutput: string
): ConditionContextMetrics | undefined {
  const goldFiles = (task.filesChanged ?? []).map(normalizeRepoPath).filter((file) => file.length > 0);
  if (goldFiles.length === 0 || preDirty === null) {
    return undefined;
  }
  const postDirty = gitDirtyFiles(workspace);
  if (postDirty === null) {
    return undefined;
  }
  const editedFiles = [...postDirty].filter((file) => !preDirty.has(file)).sort();
  const mentioned = extractMentionedFiles(agentOutput, workspace);
  const exploredFiles = [...new Set([...editedFiles, ...mentioned])].sort();
  const edit = precisionRecall(goldFiles, editedFiles);
  const explored = precisionRecall(goldFiles, exploredFiles);
  return {
    goldFiles,
    editedFiles,
    exploredFiles,
    editRecall: edit.recall,
    editPrecision: edit.precision,
    editF1: edit.f1,
    exploredRecall: explored.recall,
    exploredPrecision: explored.precision,
    exploredF1: explored.f1
  };
}

function precisionRecall(gold: string[], predicted: string[]): { recall: number | null; precision: number | null; f1: number | null } {
  const goldSet = new Set(gold);
  const hits = predicted.filter((file) => goldSet.has(file)).length;
  const recall = gold.length === 0 ? null : round(hits / gold.length, 4);
  const precision = predicted.length === 0 ? null : round(hits / predicted.length, 4);
  if (recall === null || precision === null) {
    return { recall, precision, f1: null };
  }
  const f1 = precision + recall === 0 ? 0 : round((2 * precision * recall) / (precision + recall), 4);
  return { recall, precision, f1 };
}

// Workspace-relative paths of files git considers modified, added, deleted, or
// untracked. Returns null when the workspace is not a git checkout.
function gitDirtyFiles(workspace: string): Set<string> | null {
  let raw = "";
  try {
    raw = execFileSync("git", ["status", "--porcelain"], {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return null;
  }
  const files = new Set<string>();
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    let value = line.slice(3);
    const arrow = value.indexOf(" -> ");
    if (arrow >= 0) {
      value = value.slice(arrow + 4);
    }
    files.add(normalizeRepoPath(unquoteGitPath(value)));
  }
  return files;
}

function unquoteGitPath(value: string): string {
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1).replace(/\\(["\\tn])/g, (_, char: string) => (char === "t" ? "\t" : char === "n" ? "\n" : char));
  }
  return value;
}

const MENTIONED_FILE_REGEX = /[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.[A-Za-z0-9]{1,8}\b/g;
const MAX_MENTIONED_FILES = 500;

// Best-effort scan of the agent's stdout/stderr for workspace files it talked
// about. Catches plain path mentions and the file_path fields of structured
// transcript formats such as Claude Code's stream-json output.
function extractMentionedFiles(output: string, workspace: string): string[] {
  let normalizedOutput = output.replace(/\\+/g, "/");
  const workspacePrefix = `${workspace.replace(/\\+/g, "/").replace(/\/+$/, "")}/`;
  // Absolute mentions become workspace-relative before matching; the path
  // regex cannot cross drive-letter colons, so the prefix is stripped first.
  for (const prefix of workspacePrefixVariants(workspacePrefix)) {
    normalizedOutput = normalizedOutput.split(prefix).join(" ");
  }
  const files = new Set<string>();
  for (const raw of normalizedOutput.match(MENTIONED_FILE_REGEX) ?? []) {
    if (files.size >= MAX_MENTIONED_FILES) {
      break;
    }
    const candidate = raw.replace(/^\.\/+/, "");
    if (candidate.length === 0 || candidate.includes("..") || path.isAbsolute(candidate) || files.has(candidate)) {
      continue;
    }
    try {
      if (fs.statSync(path.join(workspace, candidate)).isFile()) {
        files.add(candidate);
      }
    } catch {
      // Mentioned string is not a real workspace file; skip it.
    }
  }
  return [...files].sort();
}

function workspacePrefixVariants(prefix: string): string[] {
  const variants = [prefix];
  const drive = prefix.match(/^([A-Za-z]):\//);
  if (drive) {
    const letter = drive[1];
    const toggled = letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase();
    variants.push(`${toggled}${prefix.slice(1)}`);
  }
  return variants;
}

function normalizeRepoPath(value: string): string {
  return value.replace(/\\+/g, "/").replace(/^\.\/+/, "").trim();
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
    const hadRootClaudeMd = discoverContextFiles(workspace).some((file) => file.relativePath === "CLAUDE.md");
    const optimized = generateOptimizedAgents(analyzeRepo(workspace));
    removeContextFiles(workspace);
    fs.writeFileSync(path.join(workspace, "AGENTS.md"), optimized, "utf8");
    if (hadRootClaudeMd) {
      // Claude Code loads CLAUDE.md but not AGENTS.md, so repos that relied on a
      // root CLAUDE.md keep the optimized context visible via an import bridge.
      fs.writeFileSync(path.join(workspace, "CLAUDE.md"), "@AGENTS.md\n", "utf8");
    }
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

function parseCommandTemplate(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "\"" | "'" | undefined;
  let tokenStarted = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else if (
        char === "\\" &&
        quote === "\"" &&
        command[index + 1] === "\""
      ) {
        current += "\"";
        index += 1;
      } else {
        current += char;
      }
      tokenStarted = true;
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char as "\"" | "'";
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        args.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }

    if (/[|&;<>]/.test(char)) {
      throw new Error("shell operators cannot be combined with {prompt} or {workspace}; use stdin or AGENT_BENCH_* variables instead");
    }

    const next = command[index + 1] ?? "";
    if (char === "\\" && /[\s"'\\]/.test(next)) {
      current += next;
      index += 1;
    } else {
      current += char;
    }
    tokenStarted = true;
  }

  if (quote) {
    throw new Error("unclosed quote in agent command");
  }
  if (tokenStarted) {
    args.push(current);
  }
  if (args.length === 0) {
    throw new Error("agent command is empty");
  }
  return args;

}
function combineNotes(...notes: Array<string | undefined>): string | undefined {
  const present = notes.filter((note): note is string => Boolean(note));
  return present.length > 0 ? present.join("; ") : undefined;
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
