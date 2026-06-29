#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeRepo,
  generateBenchFromGitHistory,
  renderDashboardReports,
  renderReport,
  type DashboardReportInput,
  type ReportFormat,
  type SerializableAnalysisResult,
  writeOptimizedAgents
} from "./index.js";

interface ParsedArgs {
  command: "analyze" | "generate-bench" | "dashboard";
  target: string;
  format: ReportFormat;
  output?: string;
  writeOptimized?: string | true;
  failUnder?: number;
  maxLines?: number;
  maxBytes?: number;
  maxDepth?: number;
  limit?: number;
}

export function main(argv = process.argv.slice(2)): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(helpText());
    return 0;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log("0.1.0");
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

  const result = analyzeRepo(root, {
    maxLines: args.maxLines,
    maxBytes: args.maxBytes,
    maxDepth: args.maxDepth
  });
  let optimizedPath: string | undefined;
  if (args.writeOptimized) {
    const output = args.writeOptimized === true ? undefined : args.writeOptimized;
    optimizedPath = writeOptimizedAgents(result, output);
  }

  const report = renderReport(result, args.format, optimizedPath);
  if (args.output) {
    writeFile(root, args.output, report);
  } else {
    console.log(report);
  }

  if (typeof args.failUnder === "number" && result.score < args.failUnder) {
    return 1;
  }
  return 0;
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
  }
  const parsed: ParsedArgs = {
    command,
    target: ".",
    format: "text"
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
    "",
    "Options:",
    "  --format text|json|markdown|dashboard  Report format (default: text)",
    "  -o, --output <file>              Write report to a file",
    "  --write-optimized [file]         Write a slim AGENTS.md suggestion",
    "  --fail-under <score>             Exit 1 when score is below the threshold",
    "  --max-lines <n>                  Context bloat line threshold (default: 350)",
    "  --max-bytes <n>                  Context bloat byte threshold (default: 14000)",
    "  --max-depth <n>                  Nested context file search depth (default: 6)",
    "  --limit <n>                      Bench task limit for generate-bench",
    "  -h, --help                       Show help",
    "  -v, --version                    Show version"
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
