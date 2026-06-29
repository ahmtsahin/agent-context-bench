#!/usr/bin/env node
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeRepo,
  type BaselineSummary,
  type BenchCondition,
  type BenchSummary,
  type BenchTaskInput,
  commandAdapter,
  generateBenchFromGitHistory,
  type HistoryRecord,
  openHistory,
  renderBaselineComparison,
  renderDashboardReports,
  renderReport,
  runBench,
  type DashboardReportInput,
  type ReportFormat,
  type SerializableAnalysisResult,
  writeOptimizedAgents
} from "./index.js";

interface ParsedArgs {
  command: "analyze" | "generate-bench" | "dashboard" | "run-bench" | "history";
  target: string;
  format?: ReportFormat;
  output?: string;
  writeOptimized?: string | true;
  failUnder?: number;
  maxLines?: number;
  maxBytes?: number;
  maxDepth?: number;
  limit?: number;
  baseline?: string;
  exactTokens?: boolean;
  agent?: string;
  tasks?: string;
  success?: string;
  conditions?: BenchCondition[];
  timeout?: number;
  historyFile?: string;
  noHistory?: boolean;
}

interface BenchConfig {
  maxLines?: number;
  maxBytes?: number;
  maxDepth?: number;
  failUnder?: number;
  format?: ReportFormat;
  ignoreDirs?: string[];
}

export function main(argv = process.argv.slice(2)): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(helpText());
    return 0;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(packageVersion());
    return 0;
  }

  const args = parseArgs(argv);
  const root = path.resolve(args.target);

  if (args.command === "generate-bench") {
    const tasks = generateBenchFromGitHistory(root, { limit: args.limit });
    const payload = JSON.stringify({ root, tasks }, null, 2);
    if (args.output) {
      writeFile(root, args.output, payload);
    } else {
      console.log(payload);
    }
    return tasks.length === 0 ? 2 : 0;
  }

  if (args.command === "dashboard") {
    const reports = loadDashboardReports(root);
    if (reports.length === 0) {
      return 2;
    }
    const dashboard = renderDashboardReports(reports);
    if (args.output) {
      writeFile(dashboardOutputRoot(root), args.output, dashboard);
    } else {
      console.log(dashboard);
    }
    return 0;
  }

  if (args.command === "run-bench") {
    return runBenchCommand(root, args);
  }

  if (args.command === "history") {
    return historyCommand(root, args);
  }

  const config = loadConfig(root);
  const format = args.format ?? config.format ?? "text";
  const failUnder = args.failUnder ?? config.failUnder;

  const result = analyzeRepo(root, {
    maxLines: args.maxLines ?? config.maxLines,
    maxBytes: args.maxBytes ?? config.maxBytes,
    maxDepth: args.maxDepth ?? config.maxDepth,
    ignoreDirs: config.ignoreDirs,
    tokenizer: args.exactTokens ? buildExactTokenizer() : undefined
  });
  let optimizedPath: string | undefined;
  if (args.writeOptimized) {
    const output = args.writeOptimized === true ? undefined : args.writeOptimized;
    optimizedPath = writeOptimizedAgents(result, output);
  }

  let report = renderReport(result, format, optimizedPath);
  if (args.baseline) {
    const baseline = loadBaseline(args.baseline);
    if (format === "text" || format === "markdown") {
      report = `${report}\n${renderBaselineComparison(result, baseline, format)}`;
    } else {
      console.error("note: --baseline comparison is only rendered for text and markdown formats.");
    }
  }
  if (args.output) {
    writeFile(root, args.output, report);
  } else {
    console.log(report);
  }

  if (typeof failUnder === "number" && result.score < failUnder) {
    return 1;
  }
  return 0;
}

function runBenchCommand(root: string, args: ParsedArgs): number {
  if (!args.agent) {
    throw new Error("run-bench requires --agent <command> (the agent CLI to invoke per task).");
  }
  const tasks = loadBenchTasks(root, args);
  if (tasks.length === 0) {
    console.error("No bench tasks found. Pass --tasks <file.json> or run in a git repo with task-like commits.");
    return 2;
  }
  const summary = runBench(root, {
    adapter: commandAdapter(args.agent),
    tasks,
    conditions: args.conditions,
    successCommand: args.success,
    timeoutMs: args.timeout,
    onProgress: (message) => console.error(message)
  });

  if (!args.noHistory) {
    recordHistory(root, args, summary);
  }

  if (args.output) {
    writeFile(root, args.output, JSON.stringify(summary, null, 2));
  }
  console.log(renderBenchSummary(summary));
  return 0;
}

function historyCommand(root: string, args: ParsedArgs): number {
  const store = openHistory(historyFilePath(root, args));
  try {
    const rows = store.list(args.limit ?? 20);
    if (args.format === "json") {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      console.log(renderHistory(rows, store.backend));
    }
  } finally {
    store.close();
  }
  return 0;
}

function loadBenchTasks(root: string, args: ParsedArgs): BenchTaskInput[] {
  if (args.tasks) {
    const stat = safeStat(args.tasks);
    if (!stat?.isFile()) {
      throw new Error(`Tasks file not found: ${args.tasks}`);
    }
    const parsed = JSON.parse(fs.readFileSync(args.tasks, "utf8")) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed as { tasks?: unknown[] }).tasks ?? [];
    return list.map((task) => task as BenchTaskInput).filter((task) => task && task.id && task.prompt);
  }
  return generateBenchFromGitHistory(root, { limit: args.limit ?? 5 });
}

function recordHistory(root: string, args: ParsedArgs, summary: BenchSummary): void {
  const store = openHistory(historyFilePath(root, args));
  try {
    store.add({
      runId: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      root,
      adapter: summary.adapter,
      tasks: summary.tasks,
      successNone: summary.successRate.none ?? null,
      successCurrent: summary.successRate.current ?? null,
      successOptimized: summary.successRate.optimized ?? null,
      contextScore: analyzeRepo(root).score,
      summaryJson: JSON.stringify(summary)
    });
  } finally {
    store.close();
  }
}

function historyFilePath(root: string, args: ParsedArgs): string {
  if (args.historyFile) {
    return path.isAbsolute(args.historyFile) ? args.historyFile : path.join(root, args.historyFile);
  }
  return path.join(root, ".agent-context-bench", "history.db");
}

function renderBenchSummary(summary: BenchSummary): string {
  const lines: string[] = [];
  lines.push(`Bench summary (adapter: ${summary.adapter})`);
  lines.push(`- Tasks: ${summary.tasks}`);
  for (const condition of summary.conditions) {
    const rate = Math.round((summary.successRate[condition] ?? 0) * 100);
    lines.push(`- ${condition}: ${rate}% success, ~${summary.avgContextTokens[condition] ?? 0} context tokens`);
  }
  lines.push("Measured deltas (success-rate points):");
  lines.push(`- current vs none: ${formatDelta(summary.deltas.currentVsNone)}`);
  lines.push(`- optimized vs current: ${formatDelta(summary.deltas.optimizedVsCurrent)}`);
  lines.push(`- optimized vs none: ${formatDelta(summary.deltas.optimizedVsNone)}`);
  return lines.join("\n");
}

function renderHistory(rows: HistoryRecord[], backend: string): string {
  if (rows.length === 0) {
    return `No bench runs recorded yet (${backend} store).`;
  }
  const lines: string[] = [`Bench run history (${backend} store, ${rows.length} shown):`];
  for (const row of rows) {
    const parts = [
      row.timestamp,
      `adapter=${row.adapter}`,
      `tasks=${row.tasks}`,
      `none=${formatRate(row.successNone)}`,
      `current=${formatRate(row.successCurrent)}`,
      `optimized=${formatRate(row.successOptimized)}`,
      `score=${row.contextScore ?? "-"}`
    ];
    lines.push(`- ${parts.join(" | ")}`);
  }
  return lines.join("\n");
}

function formatDelta(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return value > 0 ? `+${value}` : String(value);
}

function formatRate(value: number | null): string {
  return value === null || value === undefined ? "-" : `${Math.round(value * 100)}%`;
}

function parseConditions(value: string): BenchCondition[] {
  const allowed: BenchCondition[] = ["none", "current", "optimized"];
  const conditions = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  for (const condition of conditions) {
    if (!allowed.includes(condition as BenchCondition)) {
      throw new Error(`Invalid --conditions value: ${condition} (use none, current, optimized)`);
    }
  }
  return conditions as BenchCondition[];
}

function loadConfig(root: string): BenchConfig {
  const configPath = path.join(root, ".agent-context-bench.json");
  if (!safeStat(configPath)?.isFile()) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as BenchConfig;
    if (parsed.format) {
      parsed.format = parseFormat(parsed.format);
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid .agent-context-bench.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function loadBaseline(file: string): BaselineSummary {
  const stat = safeStat(file);
  if (!stat?.isFile()) {
    throw new Error(`Baseline report not found: ${file}`);
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SerializableAnalysisResult>;
  if (typeof parsed.score !== "number" || typeof parsed.inventoryRiskScore !== "number" || !parsed.totals) {
    throw new Error(`${file} is not an agent-context-bench JSON report.`);
  }
  return {
    label: path.basename(file, ".json"),
    score: parsed.score,
    inventoryRiskScore: parsed.inventoryRiskScore,
    totals: { tokenEstimate: parsed.totals.tokenEstimate }
  };
}

function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function buildExactTokenizer(): ((text: string) => number) | undefined {
  try {
    const require = createRequire(import.meta.url);
    const mod = require("gpt-tokenizer") as { encode?: (text: string) => unknown[]; default?: { encode?: (text: string) => unknown[] } };
    const encode = mod.encode ?? mod.default?.encode;
    if (typeof encode === "function") {
      return (text: string) => encode(text).length;
    }
  } catch {
    // gpt-tokenizer is an optional dependency; fall through to the warning below.
  }
  console.error("warning: --exact-tokens needs the optional 'gpt-tokenizer' package; using the heuristic estimate instead.");
  return undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  let command: ParsedArgs["command"] = "analyze";
  if (args[0] === "generate-bench") {
    args.shift();
    command = "generate-bench";
  } else if (args[0] === "dashboard") {
    args.shift();
    command = "dashboard";
  } else if (args[0] === "run-bench") {
    args.shift();
    command = "run-bench";
  } else if (args[0] === "history") {
    args.shift();
    command = "history";
  }
  const parsed: ParsedArgs = {
    command,
    target: "."
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--format") {
      parsed.format = parseFormat(requireValue(args, ++index, arg));
    } else if (arg.startsWith("--format=")) {
      parsed.format = parseFormat(arg.slice("--format=".length));
    } else if (arg === "--output" || arg === "-o") {
      parsed.output = requireValue(args, ++index, arg);
    } else if (arg.startsWith("--output=")) {
      parsed.output = arg.slice("--output=".length);
    } else if (arg === "--write-optimized") {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) {
        parsed.writeOptimized = next;
        index += 1;
      } else {
        parsed.writeOptimized = true;
      }
    } else if (arg.startsWith("--write-optimized=")) {
      parsed.writeOptimized = arg.slice("--write-optimized=".length);
    } else if (arg === "--fail-under") {
      parsed.failUnder = parseNumber(requireValue(args, ++index, arg), arg);
    } else if (arg.startsWith("--fail-under=")) {
      parsed.failUnder = parseNumber(arg.slice("--fail-under=".length), "--fail-under");
    } else if (arg === "--max-lines") {
      parsed.maxLines = parseNumber(requireValue(args, ++index, arg), arg);
    } else if (arg.startsWith("--max-lines=")) {
      parsed.maxLines = parseNumber(arg.slice("--max-lines=".length), "--max-lines");
    } else if (arg === "--max-bytes") {
      parsed.maxBytes = parseNumber(requireValue(args, ++index, arg), arg);
    } else if (arg.startsWith("--max-bytes=")) {
      parsed.maxBytes = parseNumber(arg.slice("--max-bytes=".length), "--max-bytes");
    } else if (arg === "--max-depth") {
      parsed.maxDepth = parseNumber(requireValue(args, ++index, arg), arg);
    } else if (arg.startsWith("--max-depth=")) {
      parsed.maxDepth = parseNumber(arg.slice("--max-depth=".length), "--max-depth");
    } else if (arg === "--limit") {
      parsed.limit = parseNumber(requireValue(args, ++index, arg), arg);
    } else if (arg.startsWith("--limit=")) {
      parsed.limit = parseNumber(arg.slice("--limit=".length), "--limit");
    } else if (arg === "--baseline") {
      parsed.baseline = requireValue(args, ++index, arg);
    } else if (arg.startsWith("--baseline=")) {
      parsed.baseline = arg.slice("--baseline=".length);
    } else if (arg === "--exact-tokens") {
      parsed.exactTokens = true;
    } else if (arg === "--agent") {
      parsed.agent = requireValue(args, ++index, arg);
    } else if (arg.startsWith("--agent=")) {
      parsed.agent = arg.slice("--agent=".length);
    } else if (arg === "--tasks") {
      parsed.tasks = requireValue(args, ++index, arg);
    } else if (arg.startsWith("--tasks=")) {
      parsed.tasks = arg.slice("--tasks=".length);
    } else if (arg === "--success") {
      parsed.success = requireValue(args, ++index, arg);
    } else if (arg.startsWith("--success=")) {
      parsed.success = arg.slice("--success=".length);
    } else if (arg === "--conditions") {
      parsed.conditions = parseConditions(requireValue(args, ++index, arg));
    } else if (arg.startsWith("--conditions=")) {
      parsed.conditions = parseConditions(arg.slice("--conditions=".length));
    } else if (arg === "--timeout") {
      parsed.timeout = parseNumber(requireValue(args, ++index, arg), arg);
    } else if (arg.startsWith("--timeout=")) {
      parsed.timeout = parseNumber(arg.slice("--timeout=".length), "--timeout");
    } else if (arg === "--history-file") {
      parsed.historyFile = requireValue(args, ++index, arg);
    } else if (arg.startsWith("--history-file=")) {
      parsed.historyFile = arg.slice("--history-file=".length);
    } else if (arg === "--no-history") {
      parsed.noHistory = true;
    } else if (arg === "--from-git-history") {
      // Accepted for readability: generate-bench already uses git history.
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      parsed.target = arg;
    }
  }

  return parsed;
}

function writeFile(root: string, output: string, content: string) {
  const absolute = path.isAbsolute(output) ? output : path.join(root, output);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function loadDashboardReports(target: string): DashboardReportInput[] {
  const files = dashboardJsonFiles(target);
  const allowSkip = files.length > 1;
  const reports: DashboardReportInput[] = [];
  for (const file of files) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!isSerializableAnalysisResult(parsed)) {
      if (allowSkip) {
        continue;
      }
      throw new Error(`${file} is not an agent-context-bench JSON report.`);
    }
    reports.push({
      label: path.basename(file, ".json"),
      sourceFile: normalizePath(path.relative(process.cwd(), file)),
      result: parsed
    });
  }
  return reports;
}

function dashboardJsonFiles(target: string): string[] {
  const stat = safeStat(target);
  if (!stat) {
    throw new Error(`Dashboard input not found: ${target}`);
  }
  if (stat.isFile()) {
    return [target];
  }
  if (!stat.isDirectory()) {
    throw new Error(`Dashboard input must be a JSON file or directory: ${target}`);
  }
  return fs
    .readdirSync(target)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(target, name));
}

function dashboardOutputRoot(target: string): string {
  const stat = safeStat(target);
  return stat?.isFile() ? path.dirname(target) : target;
}

function isSerializableAnalysisResult(value: unknown): value is SerializableAnalysisResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SerializableAnalysisResult>;
  return (
    typeof candidate.root === "string" &&
    typeof candidate.score === "number" &&
    typeof candidate.inventoryRiskScore === "number" &&
    Array.isArray(candidate.files) &&
    Array.isArray(candidate.issues) &&
    typeof candidate.repo === "object" &&
    typeof candidate.totals === "object" &&
    typeof candidate.scopes === "object"
  );
}

function safeStat(target: string): fs.Stats | undefined {
  try {
    return fs.statSync(target);
  } catch {
    return undefined;
  }
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function parseFormat(value: string): ReportFormat {
  if (value === "text" || value === "json" || value === "markdown" || value === "dashboard") {
    return value;
  }
  if (value === "html") {
    return "dashboard";
  }
  throw new Error(`Invalid --format value: ${value}`);
}

function parseNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} expects a number`);
  }
  return parsed;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} expects a value`);
  }
  return value;
}

function helpText(): string {
  return [
    "agent-context-bench",
    "",
    "Measure whether AI coding agent context files help or hurt a repo.",
    "",
    "Usage:",
    "  agent-context-bench [path] [options]",
    "  context-diet [path] [options]",
    "  agent-context-bench generate-bench [path] --from-git-history [options]",
    "  agent-context-bench dashboard [json-file-or-report-dir] -o dashboard.html",
    "  agent-context-bench run-bench [path] --agent \"<cmd>\" [--tasks file.json] [--success \"<cmd>\"]",
    "  agent-context-bench history [path] [--limit n] [--format json]",
    "",
    "Options:",
    "  --format text|json|markdown|dashboard  Report format (default: text)",
    "  -o, --output <file>              Write report to a file",
    "  --write-optimized [file]         Write a slim AGENTS.md suggestion",
    "  --fail-under <score>             Exit 1 when score is below the threshold",
    "  --max-lines <n>                  Context bloat line threshold (default: 350)",
    "  --max-bytes <n>                  Context bloat byte threshold (default: 14000)",
    "  --max-depth <n>                  Nested context file search depth (default: 6)",
    "  --baseline <file.json>           Compare scores against a previous JSON report",
    "  --exact-tokens                   Use the optional gpt-tokenizer for exact token counts",
    "  --limit <n>                      Bench task limit for generate-bench/history",
    "  --agent <cmd>                    run-bench: agent CLI to invoke per task",
    "  --tasks <file.json>              run-bench: task list (default: from git history)",
    "  --success <cmd>                  run-bench: success command (default: repo test script)",
    "  --conditions <list>              run-bench: none,current,optimized (default: all)",
    "  --timeout <ms>                   run-bench: per-step timeout",
    "  --history-file <file>            run-bench/history: history store path",
    "  --no-history                     run-bench: do not record the run",
    "  -h, --help                       Show help",
    "  -v, --version                    Show version",
    "",
    "Config: place a .agent-context-bench.json in the target repo to set",
    "maxLines, maxBytes, maxDepth, failUnder, format, or ignoreDirs defaults."
  ].join("\n");
}
try {
  if (isDirectInvocation()) {
    process.exitCode = main();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function isDirectInvocation(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  const currentFile = fileURLToPath(import.meta.url);
  if (path.resolve(process.argv[1]) === path.resolve(currentFile)) {
    return true;
  }
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(currentFile);
  } catch {
    return false;
  }
}
