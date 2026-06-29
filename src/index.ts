import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { renderDashboardReports } from "./dashboard.js";

export { renderDashboardReports } from "./dashboard.js";

export type Severity = "info" | "warn" | "error";
export type ReportFormat = "text" | "json" | "markdown" | "dashboard";
export type LoadScope = "always" | "deferred";

export interface ContextTotals {
  files: number;
  lines: number;
  bytes: number;
  tokenEstimate: number;
}

export interface AnalyzeOptions {
  maxLines?: number;
  maxBytes?: number;
  maxDepth?: number;
}

export interface ContextFile {
  absolutePath: string;
  relativePath: string;
  kind: string;
  loadScope: LoadScope;
  content: string;
  lineCount: number;
  byteLength: number;
  tokenEstimate: number;
}

export interface Issue {
  id: string;
  title: string;
  severity: Severity;
  category: string;
  message: string;
  suggestion: string;
  impact: number;
  file?: string;
  line?: number;
}

export interface RepoSignals {
  name: string;
  languages: string[];
  packageManager?: string;
  packageScripts: Record<string, string>;
  commands: {
    install?: string;
    test?: string;
    build?: string;
    lint?: string;
    typecheck?: string;
  };
}

export interface EffectEstimate {
  taskSuccessDeltaPct: number;
  tokenCostDeltaPct: number;
  filesExploredDeltaPct: number;
  commandCountDeltaPct: number;
  risk: string;
}

export interface ContextScopeSummary {
  label: string;
  description: string;
  score: number;
  totals: ContextTotals;
  effect: EffectEstimate;
  issues: Issue[];
}

export interface ContextFileSummary {
  name: string;
  path: string;
  kind: string;
  loadScope: LoadScope;
  score: number;
  lines: number;
  bytes: number;
  tokenEstimate: number;
  effect: EffectEstimate;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  issues: Issue[];
}

export interface AnalysisResult {
  root: string;
  generatedAt: string;
  score: number;
  inventoryRiskScore: number;
  files: ContextFile[];
  issues: Issue[];
  repo: RepoSignals;
  totals: ContextTotals;
  effect: EffectEstimate;
  inventoryEffect: EffectEstimate;
  operationalWeights: {
    always: number;
    deferred: number;
  };
  skillReports: ContextFileSummary[];
  scopes: {
    always: ContextScopeSummary;
    deferred: ContextScopeSummary;
  };
}

export interface SerializableContextFile {
  path: string;
  kind: string;
  loadScope: LoadScope;
  lines: number;
  bytes: number;
  tokenEstimate: number;
}

export interface SerializableAnalysisResult extends Omit<AnalysisResult, "files"> {
  optimizedPath?: string;
  files: SerializableContextFile[];
}

export interface DashboardReportInput {
  label?: string;
  sourceFile?: string;
  result: SerializableAnalysisResult;
  agentsPreview?: string;
}

export interface GeneratedBenchTask {
  id: string;
  baseCommit: string;
  targetCommit: string;
  title: string;
  prompt: string;
  filesChanged: string[];
  successCriteria: string[];
}

const DEFAULT_MAX_LINES = 350;
const DEFAULT_MAX_BYTES = 14_000;
const DEFAULT_MAX_DEPTH = 6;
const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4.28;

const ROOT_CONTEXT_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "SKILL.md",
  ".cursorrules",
  path.join(".github", "copilot-instructions.md")
];

const WALK_CONTEXT_NAMES = new Set(["AGENTS.md", "CLAUDE.md", "SKILL.md"]);
const RULE_EXTENSIONS = new Set([".md", ".mdc", ".txt", ""]);
const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  ".tmp",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__"
]);

const COMMAND_REGEX =
  /(`[^`]*(?:npm|pnpm|yarn|bun|pytest|go test|cargo test|mvn|gradle|make|just|tox|rspec|phpunit|dotnet test)[^`]*`|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck)\b|\b(?:pytest|go test|cargo test|mvn test|gradle test|make test|just test|tox|rspec|phpunit|dotnet test)\b)/i;

const VAGUE_REGEX =
  /\b(best practices|be careful|clean code|use common sense|make sure|do not break|keep it simple|as needed|where appropriate|follow conventions|production ready)\b/i;

const DANGEROUS_CHECKS = [
  {
    id: "dangerous-rm-rf",
    regex: /\brm\s+-rf\s+(?:\/|\*|~|\$[A-Z_]+|\.)/i,
    title: "Dangerous delete command",
    suggestion: "Require explicit user approval and a scoped path before destructive commands."
  },
  {
    id: "dangerous-curl-bash",
    regex: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sh|bash)\b/i,
    title: "Piped remote shell command",
    suggestion: "Replace curl-pipe-shell setup with pinned install steps or a documented manual command."
  },
  {
    id: "dangerous-chmod",
    regex: /\bchmod\s+777\b/i,
    title: "Overbroad chmod instruction",
    suggestion: "Use the minimum permission change needed for the target file."
  },
  {
    id: "secret-access",
    regex: /\b(?:read|open|cat|inspect|load|use|access|print)\b.*(?:\.env|id_rsa|credentials?|secrets?)/i,
    title: "Secret access instruction",
    suggestion: "Tell agents not to read, print, or modify secrets unless explicitly requested."
  }
];

const CONFLICT_CHECKS = [
  {
    id: "conflict-tests",
    title: "Conflicting test instructions",
    positive: /\b(?:always|must|run)\b.{0,40}\b(?:all|full)\b.{0,25}\btests?\b/i,
    negative: /\b(?:avoid|skip|do not|don't|never)\b.{0,50}\b(?:all|full|long|slow|e2e|integration)\b.{0,25}\btests?\b/i,
    suggestion: "Split test guidance into focused checks for normal edits and broader checks for shared behavior."
  },
  {
    id: "conflict-commit",
    title: "Conflicting git commit instructions",
    positive: /\b(?:always|must|required to)\b.{0,30}\b(?:commit|push)\b/i,
    negative: /\b(?:never|do not|don't|avoid)\b.{0,30}\b(?:commit|push)\b/i,
    suggestion: "State one explicit policy for commits and pushes."
  },
  {
    id: "conflict-network",
    title: "Conflicting network instructions",
    positive: /\b(?:npm install|pnpm install|yarn install|pip install|curl|wget|go get|cargo install)\b/i,
    negative: /\b(?:never|do not|don't|avoid|no)\b.{0,35}\b(?:network|internet|download|install)\b/i,
    suggestion: "Clarify when dependency installation or network access is allowed."
  },
  {
    id: "conflict-autonomy",
    title: "Conflicting autonomy instructions",
    positive: /\b(?:ask|confirm|get approval)\b.{0,45}\b(?:before|prior to)\b.{0,30}\b(?:edit|change|write|modify)\b/i,
    negative: /\b(?:do not ask|don't ask|work autonomously|make changes without asking)\b/i,
    suggestion: "Define which actions require confirmation and which can be done autonomously."
  },
  {
    id: "conflict-generated",
    title: "Conflicting generated-file instructions",
    positive: /\b(?:regenerate|update|modify|edit)\b.{0,35}\b(?:generated|vendor|dist)\b/i,
    negative: /\b(?:never|do not|don't|avoid)\b.{0,35}\b(?:modify|edit|touch)\b.{0,35}\b(?:generated|vendor|dist)\b/i,
    suggestion: "Name the generated directories and the exact command that regenerates them."
  }
];

export function analyzeRepo(rootInput = ".", options: AnalyzeOptions = {}): AnalysisResult {
  const root = path.resolve(rootInput);
  const files = discoverContextFiles(root, options);
  const repo = inferRepoSignals(root);
  const issues: Issue[] = [];
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  if (files.length === 0) {
    issues.push({
      id: "missing-context",
      title: "No agent context files found",
      severity: "info",
      category: "coverage",
      message: "No AGENTS.md, CLAUDE.md, SKILL.md, Cursor rule, or Copilot instruction file was found.",
      suggestion: "Add a short AGENTS.md only if the repo needs agent-specific commands or boundaries.",
      impact: 0
    });
  }

  for (const file of files) {
    detectFileIssues(file, { maxLines, maxBytes }, issues);
  }

  detectConflicts(files, issues);
  detectDuplicateRules(files, issues);
  detectRepoMismatches(files, repo, issues);
  detectMissingSpecificCommands(files, repo, issues);

  const totals = sumFileTotals(files);
  const sortedIssues = sortIssues(issues);
  const inventoryRiskScore = contextScore(sortedIssues);
  const scopes = buildScopeSummaries(files, sortedIssues);
  const operationalWeights = scopeWeights(scopes);
  const score = operationalScore(scopes, operationalWeights);
  const skillReports = buildContextFileSummaries(files, sortedIssues).filter((summary) => summary.kind === "skill");

  return {
    root,
    generatedAt: new Date().toISOString(),
    score,
    inventoryRiskScore,
    files,
    issues: sortedIssues,
    repo,
    totals,
    effect: estimateOperationalEffect(scopes, operationalWeights),
    inventoryEffect: estimateEffect(inventoryRiskScore, sortedIssues, totals),
    operationalWeights,
    skillReports,
    scopes
  };
}

export function discoverContextFiles(rootInput = ".", options: AnalyzeOptions = {}): ContextFile[] {
  const root = path.resolve(rootInput);
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const seen = new Set<string>();
  const files: ContextFile[] = [];

  const addFile = (absolutePath: string, kind: string) => {
    const normalized = path.resolve(absolutePath);
    const key = normalized.toLowerCase();
    if (seen.has(key) || !safeIsFile(normalized)) {
      return;
    }
    seen.add(key);
    const content = fs.readFileSync(normalized, "utf8").replace(/\r\n/g, "\n");
    const stat = fs.statSync(normalized);
    files.push({
      absolutePath: normalized,
      relativePath: normalizePath(path.relative(root, normalized)),
      kind,
      loadScope: contextLoadScope(kind),
      content,
      lineCount: content.length === 0 ? 0 : content.split("\n").length,
      byteLength: stat.size,
      tokenEstimate: estimateTokens(content)
    });
  };

  for (const relative of ROOT_CONTEXT_FILES) {
    addFile(path.join(root, relative), contextKind(relative));
  }

  const cursorRules = path.join(root, ".cursor", "rules");
  if (safeIsFile(cursorRules)) {
    addFile(cursorRules, "cursor");
  } else if (safeIsDirectory(cursorRules)) {
    walkRuleDirectory(cursorRules, root, addFile);
  }

  walkForNamedContext(root, root, maxDepth, addFile);

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function inferRepoSignals(rootInput = "."): RepoSignals {
  const root = path.resolve(rootInput);
  const name = path.basename(root);
  const packageJsonPath = path.join(root, "package.json");
  const packageScripts: Record<string, string> = {};
  let packageManager: string | undefined;
  const languages: string[] = [];

  if (safeIsFile(packageJsonPath)) {
    languages.push("Node.js");
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
        scripts?: Record<string, string>;
        packageManager?: string;
      };
      Object.assign(packageScripts, pkg.scripts ?? {});
      if (pkg.packageManager) {
        packageManager = pkg.packageManager.split("@")[0];
      }
    } catch {
      // Ignore malformed package.json here; the analyzer is not a package linter.
    }
  }

  if (safeIsFile(path.join(root, "tsconfig.json"))) {
    languages.push("TypeScript");
  }
  if (safeIsFile(path.join(root, "pyproject.toml")) || safeIsFile(path.join(root, "requirements.txt"))) {
    languages.push("Python");
  }
  if (safeIsFile(path.join(root, "go.mod"))) {
    languages.push("Go");
  }
  if (safeIsFile(path.join(root, "Cargo.toml"))) {
    languages.push("Rust");
  }
  if (safeIsFile(path.join(root, "pom.xml")) || safeIsFile(path.join(root, "build.gradle"))) {
    languages.push("Java");
  }

  packageManager ??= detectPackageManager(root);

  return {
    name,
    languages: [...new Set(languages)],
    packageManager,
    packageScripts,
    commands: inferCommands(root, packageManager, packageScripts)
  };
}

export function generateOptimizedAgents(result: AnalysisResult): string {
  const repo = result.repo;
  const lines: string[] = [];
  const usefulRules = extractUsefulRules(result.files);

  lines.push("# AGENTS.md");
  lines.push("");
  lines.push("## Project Snapshot");
  lines.push(`- Repository: ${repo.name}`);
  lines.push(`- Stack: ${repo.languages.length > 0 ? repo.languages.join(", ") : "Unknown; infer from touched files before editing."}`);
  lines.push("");
  lines.push("## Commands");
  lines.push(`- Install: ${repo.commands.install ? code(repo.commands.install) : "Use the repo's documented package manager; do not install new dependencies without a reason."}`);
  lines.push(`- Test: ${repo.commands.test ? code(repo.commands.test) : "Run the smallest relevant test for the changed area."}`);
  if (repo.commands.build) {
    lines.push(`- Build: ${code(repo.commands.build)}`);
  }
  if (repo.commands.lint) {
    lines.push(`- Lint: ${code(repo.commands.lint)}`);
  }
  if (repo.commands.typecheck) {
    lines.push(`- Typecheck: ${code(repo.commands.typecheck)}`);
  }
  lines.push("");
  lines.push("## Working Rules");
  lines.push("- Read the files directly related to the task before editing.");
  lines.push("- Keep changes scoped to the requested behavior and the nearby code style.");
  lines.push("- Prefer focused tests first; run broader checks when shared behavior or public contracts change.");
  lines.push("- Do not read, print, or modify secrets such as `.env`, credentials, keys, or tokens.");
  lines.push("- Ask before destructive filesystem actions, broad rewrites, dependency upgrades, or network access.");
  lines.push("");
  lines.push("## Avoid");
  lines.push("- Repeating generic coding advice that is already expected from the agent.");
  lines.push("- Duplicating rules across AGENTS.md, CLAUDE.md, Cursor rules, and Copilot instructions.");
  lines.push("- Long checklists without concrete commands, paths, or ownership boundaries.");

  if (usefulRules.length > 0) {
    lines.push("");
    lines.push("## Project-Specific Notes To Keep");
    for (const rule of usefulRules.slice(0, 10)) {
      lines.push(`- ${rule}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function writeOptimizedAgents(
  result: AnalysisResult,
  outputPath = path.join(result.root, "AGENTS.optimized.md")
): string {
  const absolute = path.isAbsolute(outputPath) ? outputPath : path.join(result.root, outputPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, generateOptimizedAgents(result), "utf8");
  return absolute;
}

export function renderReport(
  result: AnalysisResult,
  format: ReportFormat = "text",
  optimizedPath?: string
): string {
  if (format === "json") {
    return JSON.stringify(toSerializableResult(result, optimizedPath), null, 2);
  }
  if (format === "dashboard") {
    return renderDashboardReports([{ result: toSerializableResult(result, optimizedPath), agentsPreview: generateOptimizedAgents(result) }]);
  }
  if (format === "markdown") {
    return renderMarkdownReport(result, optimizedPath);
  }
  return renderTextReport(result, optimizedPath);
}

export function generateBenchFromGitHistory(
  rootInput = ".",
  options: { limit?: number; scanCommits?: number } = {}
): GeneratedBenchTask[] {
  const root = path.resolve(rootInput);
  const scanCommits = options.scanCommits ?? 200;
  const limit = options.limit ?? 20;
  let raw = "";

  try {
    raw = execFileSync(
      "git",
      [
        "log",
        "--no-merges",
        `-n${scanCommits}`,
        "--pretty=format:__COMMIT__%x09%H%x09%h%x09%s",
        "--name-only"
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
  } catch {
    return [];
  }

  const commits = parseGitLog(raw);
  const candidates = commits.filter((commit) => {
    const fileCount = commit.files.length;
    const subject = commit.subject.toLowerCase();
    const taskLike = /\b(fix|bug|regression|handle|prevent|support|refactor|test|validate|correct)\b/.test(subject);
    const notChore = !/\b(merge|release|version|snapshot|format only)\b/.test(subject);
    return fileCount > 0 && fileCount <= 8 && taskLike && notChore;
  });

  return candidates.slice(0, limit).map((commit, index) => ({
    id: `git-${String(index + 1).padStart(3, "0")}-${commit.shortHash}`,
    baseCommit: `${commit.hash}^`,
    targetCommit: commit.hash,
    title: commit.subject,
    prompt: [
      `Checkout ${commit.hash}^ and reproduce the issue implied by this commit: "${commit.subject}".`,
      "Implement the smallest fix that restores the behavior from the target commit.",
      "Keep the patch focused and avoid changing agent context files unless the task requires it."
    ].join(" "),
    filesChanged: commit.files,
    successCriteria: [
      "The relevant tests pass.",
      "The diff is limited to files touched by the target commit or directly related helpers.",
      `The final behavior matches target commit ${commit.shortHash}.`
    ]
  }));
}

function detectFileIssues(
  file: ContextFile,
  options: { maxLines: number; maxBytes: number },
  issues: Issue[]
) {
  if (file.lineCount > options.maxLines || file.byteLength > options.maxBytes) {
    issues.push({
      id: "context-bloat",
      title: "Context bloat detected",
      severity: file.lineCount > options.maxLines * 2 || file.byteLength > options.maxBytes * 2 ? "error" : "warn",
      category: "context-bloat",
      file: file.relativePath,
      line: 1,
      message: `${file.relativePath} has ${file.lineCount} lines and about ${file.tokenEstimate} tokens.`,
      suggestion: `Keep root context under ${options.maxLines} lines and move detailed docs into task-specific files.`,
      impact: file.lineCount > options.maxLines * 2 || file.byteLength > options.maxBytes * 2 ? 18 : 10
    });
  }

  const lines = file.content.split("\n");
  const longLine = lines.findIndex((line) => line.length > 240);
  if (longLine >= 0) {
    issues.push({
      id: "long-rule-line",
      title: "Overlong instruction line",
      severity: "warn",
      category: "readability",
      file: file.relativePath,
      line: longLine + 1,
      message: "A single instruction line is longer than 240 characters.",
      suggestion: "Split dense rules into short, concrete bullets.",
      impact: 4
    });
  }

  for (const check of DANGEROUS_CHECKS) {
    const found = findLine(file.content, check.regex);
    if (found) {
      issues.push({
        id: check.id,
        title: check.title,
        severity: "error",
        category: "security",
        file: file.relativePath,
        line: found.line,
        message: `Potentially unsafe instruction: "${truncate(found.text, 140)}"`,
        suggestion: check.suggestion,
        impact: 15
      });
    }
  }

  const vagueLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => VAGUE_REGEX.test(line) && !line.trim().startsWith("#"));
  if (vagueLines.length >= 3) {
    issues.push({
      id: "vague-rules",
      title: "Generic instruction leakage",
      severity: "warn",
      category: "specificity",
      file: file.relativePath,
      line: vagueLines[0].index + 1,
      message: `${file.relativePath} contains ${vagueLines.length} generic rules that most agents already know.`,
      suggestion: "Replace generic coding advice with repo-specific commands, paths, and constraints.",
      impact: Math.min(10, 3 + vagueLines.length)
    });
  }

  if (/\b(?:test|tests|testing|spec|e2e|integration)\b/i.test(file.content) && !COMMAND_REGEX.test(file.content)) {
    issues.push({
      id: "ambiguous-tests",
      title: "Ambiguous test guidance",
      severity: "warn",
      category: "tests",
      file: file.relativePath,
      line: findLine(file.content, /\btests?\b/i)?.line ?? 1,
      message: "The context mentions tests but does not provide a concrete command.",
      suggestion: "Name the exact focused test command and the broader pre-merge command.",
      impact: 8
    });
  }
}

function detectConflicts(files: ContextFile[], issues: Issue[]) {
  const content = files.map((file) => file.content).join("\n");
  for (const check of CONFLICT_CHECKS) {
    if (!check.positive.test(content) || !check.negative.test(content)) {
      continue;
    }
    const location = findFirstLine(files, check.negative) ?? findFirstLine(files, check.positive);
    issues.push({
      id: check.id,
      title: check.title,
      severity: "error",
      category: "conflict",
      file: location?.file,
      line: location?.line,
      message: "Two instructions appear to point the agent in opposite directions.",
      suggestion: check.suggestion,
      impact: 14
    });
  }
}

function detectDuplicateRules(files: ContextFile[], issues: Issue[]) {
  const seen = new Map<string, { raw: string; file: string; line: number; count: number; files: Set<string> }>();

  for (const file of files) {
    const lines = file.content.split("\n");
    lines.forEach((line, index) => {
      const raw = cleanupRuleLine(line);
      if (!raw) {
        return;
      }
      const key = normalizeRule(raw);
      if (key.length < 35) {
        return;
      }
      const existing = seen.get(key);
      if (existing) {
        existing.count += 1;
        existing.files.add(file.relativePath);
      } else {
        seen.set(key, {
          raw,
          file: file.relativePath,
          line: index + 1,
          count: 1,
          files: new Set([file.relativePath])
        });
      }
    });
  }

  const duplicates = [...seen.values()].filter((value) => value.count > 1 || value.files.size > 1);
  if (duplicates.length === 0) {
    return;
  }

  const first = duplicates[0];
  issues.push({
    id: "duplicate-rules",
    title: "Duplicate rules across context files",
    severity: "warn",
    category: "duplication",
    file: first.file,
    line: first.line,
    message: `${duplicates.length} repeated rule${duplicates.length === 1 ? "" : "s"} found across agent context files.`,
    suggestion: "Keep one source of truth and delete repeated instructions from the other context files.",
    impact: Math.min(12, 4 + duplicates.length * 2)
  });
}

function detectRepoMismatches(files: ContextFile[], repo: RepoSignals, issues: Issue[]) {
  if (!repo.packageManager || files.length === 0) {
    return;
  }
  const all = files.map((file) => file.content).join("\n");
  const managers = ["npm", "pnpm", "yarn", "bun"].filter((manager) => manager !== repo.packageManager);
  const mismatched = managers.find((manager) => new RegExp(`\\b${manager}\\b`, "i").test(all));
  if (!mismatched) {
    return;
  }
  const location = findFirstLine(files, new RegExp(`\\b${mismatched}\\b`, "i"));
  issues.push({
    id: "package-manager-mismatch",
    title: "Package manager mismatch",
    severity: "warn",
    category: "commands",
    file: location?.file,
    line: location?.line,
    message: `The repo appears to use ${repo.packageManager}, but context instructions mention ${mismatched}.`,
    suggestion: `Use ${repo.packageManager} commands consistently, or explain when ${mismatched} is required.`,
    impact: 6
  });
}

function detectMissingSpecificCommands(files: ContextFile[], repo: RepoSignals, issues: Issue[]) {
  if (files.length === 0) {
    return;
  }
  const all = files.map((file) => file.content).join("\n");
  if (!repo.commands.test || COMMAND_REGEX.test(all)) {
    return;
  }
  issues.push({
    id: "missing-test-command",
    title: "Missing concrete test command",
    severity: "warn",
    category: "tests",
    message: `package.json exposes a test script, but the context file does not name ${repo.commands.test}.`,
    suggestion: `Add a short testing section with ${code(repo.commands.test)} and when to run it.`,
    impact: 7
  });
}

function contextScore(issues: Issue[]): number {
  return Math.max(0, Math.min(100, 100 - issues.reduce((sum, issue) => sum + issue.impact, 0)));
}

function sumFileTotals(files: ContextFile[]): ContextTotals {
  return {
    files: files.length,
    lines: files.reduce((sum, file) => sum + file.lineCount, 0),
    bytes: files.reduce((sum, file) => sum + file.byteLength, 0),
    tokenEstimate: files.reduce((sum, file) => sum + file.tokenEstimate, 0)
  };
}

function buildScopeSummaries(files: ContextFile[], issues: Issue[]): AnalysisResult["scopes"] {
  const filesByPath = new Map(files.map((file) => [file.relativePath, file]));
  const alwaysFiles = files.filter((file) => file.loadScope === "always");
  const deferredFiles = files.filter((file) => file.loadScope === "deferred");
  const alwaysIssues = issues.filter((issue) => issueLoadScope(issue, filesByPath) === "always");
  const deferredIssues = issues.filter((issue) => issueLoadScope(issue, filesByPath) === "deferred");

  return {
    always: buildScopeSummary(
      "Always-loaded context",
      "Files expected to be loaded up front: AGENTS.md, CLAUDE.md, Cursor rules, and Copilot instructions.",
      alwaysFiles,
      alwaysIssues
    ),
    deferred: buildScopeSummary(
      "Deferred skill context",
      "SKILL.md files that should be loaded only when a matching skill is selected.",
      deferredFiles,
      deferredIssues
    )
  };
}

function buildScopeSummary(
  label: string,
  description: string,
  files: ContextFile[],
  issues: Issue[]
): ContextScopeSummary {
  const totals = sumFileTotals(files);
  const score = contextScore(issues);
  return {
    label,
    description,
    score,
    totals,
    effect: estimateEffect(score, issues, totals),
    issues
  };
}

function issueLoadScope(issue: Issue, filesByPath: Map<string, ContextFile>): LoadScope {
  if (issue.file) {
    return filesByPath.get(issue.file)?.loadScope ?? "always";
  }
  return "always";
}

function buildContextFileSummaries(files: ContextFile[], issues: Issue[]): ContextFileSummary[] {
  return files
    .map((file) => {
      const fileIssues = issues.filter((issue) => issue.file === file.relativePath);
      const totals = fileTotals(file);
      const score = contextScore(fileIssues);
      return {
        name: contextFileDisplayName(file),
        path: file.relativePath,
        kind: file.kind,
        loadScope: file.loadScope,
        score,
        lines: file.lineCount,
        bytes: file.byteLength,
        tokenEstimate: file.tokenEstimate,
        effect: estimateEffect(score, fileIssues, totals),
        issueCount: fileIssues.length,
        errorCount: fileIssues.filter((issue) => issue.severity === "error").length,
        warningCount: fileIssues.filter((issue) => issue.severity === "warn").length,
        issues: fileIssues
      };
    })
    .sort((a, b) => {
      const risk = b.errorCount - a.errorCount || b.issueCount - a.issueCount;
      if (risk !== 0) {
        return risk;
      }
      return b.tokenEstimate - a.tokenEstimate;
    });
}

function fileTotals(file: ContextFile): ContextTotals {
  return {
    files: 1,
    lines: file.lineCount,
    bytes: file.byteLength,
    tokenEstimate: file.tokenEstimate
  };
}

function contextFileDisplayName(file: ContextFile): string {
  if (file.kind === "skill") {
    const parts = file.relativePath.split("/");
    const skillIndex = parts.lastIndexOf("SKILL.md");
    if (skillIndex > 0) {
      return parts[skillIndex - 1];
    }
  }
  return file.relativePath;
}

function scopeWeights(scopes: AnalysisResult["scopes"]): AnalysisResult["operationalWeights"] {
  const hasAlways = scopes.always.totals.files > 0 || scopes.always.issues.length > 0;
  const hasDeferred = scopes.deferred.totals.files > 0 || scopes.deferred.issues.length > 0;
  if (hasAlways && hasDeferred) {
    return { always: 0.8, deferred: 0.2 };
  }
  if (hasDeferred && !hasAlways) {
    return { always: 0, deferred: 1 };
  }
  return { always: 1, deferred: 0 };
}

function operationalScore(
  scopes: AnalysisResult["scopes"],
  weights: AnalysisResult["operationalWeights"]
): number {
  return Math.round(scopes.always.score * weights.always + scopes.deferred.score * weights.deferred);
}

function estimateOperationalEffect(
  scopes: AnalysisResult["scopes"],
  weights: AnalysisResult["operationalWeights"]
): EffectEstimate {
  const weighted = (field: keyof Omit<EffectEstimate, "risk">) =>
    Math.round(scopes.always.effect[field] * weights.always + scopes.deferred.effect[field] * weights.deferred);
  return {
    taskSuccessDeltaPct: weighted("taskSuccessDeltaPct"),
    tokenCostDeltaPct: weighted("tokenCostDeltaPct"),
    filesExploredDeltaPct: weighted("filesExploredDeltaPct"),
    commandCountDeltaPct: weighted("commandCountDeltaPct"),
    risk: operationalRisk(scopes, weights)
  };
}

function operationalRisk(scopes: AnalysisResult["scopes"], weights: AnalysisResult["operationalWeights"]): string {
  if (weights.always > 0 && scopes.always.effect.risk !== "No major risk detected") {
    return scopes.always.effect.risk;
  }
  if (weights.deferred > 0 && scopes.deferred.effect.risk !== "No major risk detected") {
    return `Deferred skill risk: ${scopes.deferred.effect.risk}`;
  }
  return "No major risk detected";
}

function estimateEffect(
  score: number,
  issues: Issue[],
  totals: AnalysisResult["totals"]
): EffectEstimate {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warns = issues.filter((issue) => issue.severity === "warn").length;
  const bloat = issues.filter((issue) => issue.category === "context-bloat").length;
  const conflicts = issues.filter((issue) => issue.category === "conflict").length;
  const vague = issues.filter((issue) => issue.category === "specificity").length;
  const duplicates = issues.filter((issue) => issue.category === "duplication").length;
  const security = issues.filter((issue) => issue.category === "security").length;

  const tokenCostDeltaPct = Math.min(
    180,
    Math.max(0, Math.round(totals.tokenEstimate / 120 + bloat * 14 + duplicates * 6 + conflicts * 8))
  );
  const filesExploredDeltaPct = Math.min(140, Math.max(0, Math.round(bloat * 22 + vague * 14 + duplicates * 8 + conflicts * 10)));
  const commandCountDeltaPct = Math.min(80, Math.max(0, Math.round(conflicts * 12 + issues.filter((issue) => issue.category === "tests").length * 10)));
  const taskSuccessDeltaPct = -Math.min(65, Math.max(0, Math.round((100 - score) / 2 + errors * 3 + warns)));

  let risk = "No major risk detected";
  if (security > 0) {
    risk = "Dangerous instruction detected";
  } else if (conflicts > 0) {
    risk = "Conflicting instructions detected";
  } else if (bloat > 0) {
    risk = "Context bloat detected";
  } else if (duplicates > 0) {
    risk = "Duplicate context rules detected";
  }

  return {
    taskSuccessDeltaPct,
    tokenCostDeltaPct,
    filesExploredDeltaPct,
    commandCountDeltaPct,
    risk
  };
}

function renderTextReport(result: AnalysisResult, optimizedPath?: string): string {
  const lines: string[] = [];
  lines.push(`Operational Score: ${result.score}/100`);
  lines.push(`Inventory Risk Score: ${result.inventoryRiskScore}/100`);
  lines.push("");
  lines.push(`Operational weights: always-loaded ${Math.round(result.operationalWeights.always * 100)}%, deferred skills ${Math.round(result.operationalWeights.deferred * 100)}%`);
  lines.push(`Inventory context: ${result.totals.files} files, ${result.totals.lines} lines, ${result.totals.bytes} bytes, ~${result.totals.tokenEstimate} tokens`);
  lines.push("Operational effect on agent:");
  lines.push(`- Task success: ${signed(result.effect.taskSuccessDeltaPct)}%`);
  lines.push(`- Token cost: +${result.effect.tokenCostDeltaPct}%`);
  lines.push(`- Files explored: +${result.effect.filesExploredDeltaPct}%`);
  lines.push(`- Commands run: +${result.effect.commandCountDeltaPct}%`);
  lines.push(`- Risk: ${result.effect.risk}`);
  lines.push("Inventory risk effect:");
  lines.push(`- Task success: ${signed(result.inventoryEffect.taskSuccessDeltaPct)}%`);
  lines.push(`- Token cost: +${result.inventoryEffect.tokenCostDeltaPct}%`);
  lines.push(`- Files explored: +${result.inventoryEffect.filesExploredDeltaPct}%`);
  lines.push(`- Commands run: +${result.inventoryEffect.commandCountDeltaPct}%`);
  lines.push(`- Risk: ${result.inventoryEffect.risk}`);

  renderTextScope(lines, result.scopes.always);
  renderTextScope(lines, result.scopes.deferred);
  renderTextSkillBreakdown(lines, result.skillReports, 20);

  lines.push("");
  lines.push(`Suggested optimized file: ${optimizedPath ? normalizePath(path.relative(result.root, optimizedPath)) : "AGENTS.optimized.md"}`);
  if (!optimizedPath) {
    lines.push("Run with --write-optimized to generate it.");
  }
  return lines.join("\n");
}

function renderMarkdownReport(result: AnalysisResult, optimizedPath?: string): string {
  const lines: string[] = [];
  lines.push(`# Agent Context Bench Report`);
  lines.push("");
  lines.push(`**Operational Score:** ${result.score}/100`);
  lines.push(`**Inventory Risk Score:** ${result.inventoryRiskScore}/100`);
  lines.push("");
  lines.push(`Operational weights: always-loaded ${Math.round(result.operationalWeights.always * 100)}%, deferred skills ${Math.round(result.operationalWeights.deferred * 100)}%.`);
  lines.push("");
  lines.push("| Scope | Score | Files | Lines | Estimated tokens | Task success | Token cost | Files explored | Risk |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
  lines.push(markdownScopeRow("Inventory risk", result.inventoryRiskScore, result.totals, result.inventoryEffect));
  lines.push(markdownScopeRow(result.scopes.always.label, result.scopes.always.score, result.scopes.always.totals, result.scopes.always.effect));
  lines.push(markdownScopeRow(result.scopes.deferred.label, result.scopes.deferred.score, result.scopes.deferred.totals, result.scopes.deferred.effect));

  renderMarkdownScope(lines, result.scopes.always);
  renderMarkdownScope(lines, result.scopes.deferred);
  renderMarkdownSkillBreakdown(lines, result.skillReports);

  lines.push("");
  lines.push(`Suggested optimized file: \`${optimizedPath ? normalizePath(path.relative(result.root, optimizedPath)) : "AGENTS.optimized.md"}\``);
  return lines.join("\n");
}

function renderTextScope(lines: string[], summary: ContextScopeSummary) {
  lines.push("");
  lines.push(`${summary.label}: ${summary.score}/100`);
  lines.push(`- ${summary.description}`);
  lines.push(`- Size: ${summary.totals.files} files, ${summary.totals.lines} lines, ${summary.totals.bytes} bytes, ~${summary.totals.tokenEstimate} tokens`);
  lines.push(`- Effect: task success ${signed(summary.effect.taskSuccessDeltaPct)}%, token cost +${summary.effect.tokenCostDeltaPct}%, files explored +${summary.effect.filesExploredDeltaPct}%`);
  lines.push(`- Risk: ${summary.effect.risk}`);
  lines.push("Problems:");
  const actionable = summary.issues.filter((issue) => issue.severity !== "info");
  if (actionable.length === 0) {
    lines.push("- No high-risk issues found.");
  } else {
    for (const issue of actionable) {
      lines.push(`- ${severityMark(issue.severity)} [${issue.severity}] ${issue.title}`);
      const location = issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ""}` : undefined;
      lines.push(`  ${location ? `${location} - ` : ""}${issue.message}`);
      lines.push(`  Fix: ${issue.suggestion}`);
    }
  }
  const notes = summary.issues.filter((issue) => issue.severity === "info");
  if (notes.length > 0) {
    lines.push("Notes:");
    for (const issue of notes) {
      lines.push(`- ${issue.title}: ${issue.message}`);
    }
  }
}

function renderMarkdownScope(lines: string[], summary: ContextScopeSummary) {
  lines.push("");
  lines.push(`## ${summary.label}`);
  lines.push("");
  lines.push(summary.description);
  lines.push("");
  const actionable = summary.issues.filter((issue) => issue.severity !== "info");
  if (actionable.length === 0) {
    lines.push("No high-risk issues found.");
  } else {
    lines.push("| Severity | Problem | Location | Fix |");
    lines.push("| --- | --- | --- | --- |");
    for (const issue of actionable) {
      const location = issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ""}` : "";
      lines.push(`| ${issue.severity} | ${escapePipe(issue.title)} | ${escapePipe(location)} | ${escapePipe(issue.suggestion)} |`);
    }
  }
}

function markdownScopeRow(label: string, score: number, totals: ContextTotals, effect: EffectEstimate): string {
  return `| ${escapePipe(label)} | ${score}/100 | ${totals.files} | ${totals.lines} | ${totals.tokenEstimate} | ${signed(effect.taskSuccessDeltaPct)}% | +${effect.tokenCostDeltaPct}% | +${effect.filesExploredDeltaPct}% | ${escapePipe(effect.risk)} |`;
}

function renderTextSkillBreakdown(lines: string[], reports: ContextFileSummary[], limit: number) {
  if (reports.length === 0) {
    return;
  }
  const shown = reports.slice(0, limit);
  lines.push("");
  lines.push(`Skill file breakdown: ${reports.length} SKILL.md files`);
  lines.push("Columns: score | tokens | token cost | task success | risk | issues | skill path");
  for (const report of shown) {
    lines.push(
      `- ${report.score}/100 | ~${report.tokenEstimate} tokens | +${report.effect.tokenCostDeltaPct}% cost | ${signed(report.effect.taskSuccessDeltaPct)}% success | ${report.effect.risk} | ${report.errorCount}e/${report.warningCount}w | ${report.path}`
    );
  }
  if (reports.length > shown.length) {
    lines.push(`- ... ${reports.length - shown.length} more skill files omitted from terminal output; use --format markdown or --format json for all rows.`);
  }
}

function renderMarkdownSkillBreakdown(lines: string[], reports: ContextFileSummary[]) {
  if (reports.length === 0) {
    return;
  }
  lines.push("");
  lines.push("## Skill File Breakdown");
  lines.push("");
  lines.push("Each row is calculated only from issues attached to that `SKILL.md` file.");
  lines.push("");
  lines.push("| Skill | Score | Lines | Estimated tokens | Token cost | Task success | Files explored | Risk | Issues | Path |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |");
  for (const report of reports) {
    lines.push(
      `| ${escapePipe(report.name)} | ${report.score}/100 | ${report.lines} | ${report.tokenEstimate} | +${report.effect.tokenCostDeltaPct}% | ${signed(report.effect.taskSuccessDeltaPct)}% | +${report.effect.filesExploredDeltaPct}% | ${escapePipe(report.effect.risk)} | ${report.errorCount}e/${report.warningCount}w | ${escapePipe(report.path)} |`
    );
  }
}

function toSerializableResult(result: AnalysisResult, optimizedPath?: string) {
  return {
    ...result,
    optimizedPath: optimizedPath ? normalizePath(path.relative(result.root, optimizedPath)) : undefined,
    files: result.files.map((file) => ({
      path: file.relativePath,
      kind: file.kind,
      loadScope: file.loadScope,
      lines: file.lineCount,
      bytes: file.byteLength,
      tokenEstimate: file.tokenEstimate
    }))
  };
}

function inferCommands(
  root: string,
  packageManager: string | undefined,
  scripts: Record<string, string>
): RepoSignals["commands"] {
  const commands: RepoSignals["commands"] = {};
  const manager = packageManager ?? "npm";
  if (safeIsFile(path.join(root, "package.json"))) {
    commands.install = installCommand(manager);
    if (scripts.test) {
      commands.test = runScriptCommand(manager, "test");
    }
    if (scripts.build) {
      commands.build = runScriptCommand(manager, "build");
    }
    if (scripts.lint) {
      commands.lint = runScriptCommand(manager, "lint");
    }
    if (scripts.typecheck) {
      commands.typecheck = runScriptCommand(manager, "typecheck");
    } else if (scripts.check?.includes("tsc")) {
      commands.typecheck = runScriptCommand(manager, "check");
    }
  }
  if (!commands.test && safeIsFile(path.join(root, "Makefile"))) {
    commands.test = "make test";
  }
  if (!commands.test && safeIsFile(path.join(root, "pyproject.toml"))) {
    commands.test = "pytest";
  }
  if (!commands.test && safeIsFile(path.join(root, "go.mod"))) {
    commands.test = "go test ./...";
  }
  if (!commands.test && safeIsFile(path.join(root, "Cargo.toml"))) {
    commands.test = "cargo test";
  }
  return commands;
}

function detectPackageManager(root: string): string | undefined {
  if (safeIsFile(path.join(root, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (safeIsFile(path.join(root, "yarn.lock"))) {
    return "yarn";
  }
  if (safeIsFile(path.join(root, "bun.lockb")) || safeIsFile(path.join(root, "bun.lock"))) {
    return "bun";
  }
  if (safeIsFile(path.join(root, "package-lock.json"))) {
    return "npm";
  }
  return undefined;
}

function installCommand(manager: string): string {
  if (manager === "pnpm") {
    return "pnpm install";
  }
  if (manager === "yarn") {
    return "yarn install";
  }
  if (manager === "bun") {
    return "bun install";
  }
  return "npm install";
}

function runScriptCommand(manager: string, script: string): string {
  if (manager === "pnpm") {
    return script === "test" ? "pnpm test" : `pnpm run ${script}`;
  }
  if (manager === "yarn") {
    return `yarn ${script}`;
  }
  if (manager === "bun") {
    return `bun run ${script}`;
  }
  return script === "test" ? "npm test" : `npm run ${script}`;
}

function walkForNamedContext(
  directory: string,
  root: string,
  maxDepth: number,
  addFile: (absolutePath: string, kind: string) => void,
  depth = 0
) {
  if (depth > maxDepth || !safeIsDirectory(directory)) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        walkForNamedContext(path.join(directory, entry.name), root, maxDepth, addFile, depth + 1);
      }
      continue;
    }
    if (entry.isFile() && WALK_CONTEXT_NAMES.has(entry.name)) {
      const absolute = path.join(directory, entry.name);
      if (path.resolve(absolute) !== path.resolve(root, entry.name)) {
        addFile(absolute, contextKind(entry.name));
      }
    }
  }
}

function walkRuleDirectory(
  directory: string,
  root: string,
  addFile: (absolutePath: string, kind: string) => void,
  depth = 0
) {
  if (depth > 4) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkRuleDirectory(absolute, root, addFile, depth + 1);
    } else if (entry.isFile() && RULE_EXTENSIONS.has(path.extname(entry.name))) {
      addFile(absolute, "cursor");
    }
  }
}

function contextLoadScope(kind: string): LoadScope {
  return kind === "skill" ? "deferred" : "always";
}

function contextKind(relative: string): string {
  const normalized = normalizePath(relative);
  if (normalized.includes(".cursor/")) {
    return "cursor";
  }
  if (normalized.includes("copilot-instructions")) {
    return "copilot";
  }
  if (normalized.endsWith("CLAUDE.md")) {
    return "claude";
  }
  if (normalized.endsWith("SKILL.md")) {
    return "skill";
  }
  if (normalized.endsWith("AGENTS.md")) {
    return "agents";
  }
  return "context";
}

function extractUsefulRules(files: ContextFile[]): string[] {
  const rules: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const line of file.content.split("\n")) {
      const cleaned = cleanupRuleLine(line);
      if (!cleaned || cleaned.length > 180 || VAGUE_REGEX.test(cleaned)) {
        continue;
      }
      if (DANGEROUS_CHECKS.some((check) => check.regex.test(cleaned))) {
        continue;
      }
      if (/^(always|never|do not|don't|must|run|use|prefer|keep|ask|avoid)\b/i.test(cleaned) || /`[^`]+`/.test(cleaned)) {
        const key = normalizeRule(cleaned);
        if (!seen.has(key)) {
          seen.add(key);
          rules.push(cleaned.replace(/\.$/, ""));
        }
      }
    }
  }
  return rules;
}

function cleanupRuleLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("|") || trimmed.startsWith("```")) {
    return undefined;
  }
  const cleaned = trimmed.replace(/^[-*+\d.)\s]+/, "").trim();
  if (cleaned.length < 25 || /^https?:\/\//i.test(cleaned)) {
    return undefined;
  }
  return cleaned;
}

function normalizeRule(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[^a-z0-9\s/_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseGitLog(raw: string): Array<{ hash: string; shortHash: string; subject: string; files: string[] }> {
  const commits: Array<{ hash: string; shortHash: string; subject: string; files: string[] }> = [];
  let current: { hash: string; shortHash: string; subject: string; files: string[] } | undefined;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("__COMMIT__\t")) {
      if (current) {
        commits.push(current);
      }
      const [, hash, shortHash, ...subjectParts] = line.split("\t");
      current = {
        hash,
        shortHash,
        subject: subjectParts.join("\t"),
        files: []
      };
      continue;
    }
    if (current && line.trim()) {
      current.files.push(normalizePath(line.trim()));
    }
  }
  if (current) {
    commits.push(current);
  }
  return commits;
}

function findFirstLine(files: ContextFile[], regex: RegExp): { file: string; line: number } | undefined {
  for (const file of files) {
    const found = findLine(file.content, regex);
    if (found) {
      return { file: file.relativePath, line: found.line };
    }
  }
  return undefined;
}

function findLine(content: string, regex: RegExp): { line: number; text: string } | undefined {
  const flags = regex.flags.includes("i") ? "i" : "";
  const lineRegex = new RegExp(regex.source, flags);
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (lineRegex.test(lines[index])) {
      return { line: index + 1, text: lines[index].trim() };
    }
  }
  return undefined;
}

function sortIssues(issues: Issue[]): Issue[] {
  const severityRank: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
  return [...issues].sort((a, b) => {
    const severity = severityRank[a.severity] - severityRank[b.severity];
    if (severity !== 0) {
      return severity;
    }
    return b.impact - a.impact;
  });
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN));
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function safeIsFile(value: string): boolean {
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
}

function safeIsDirectory(value: string): boolean {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function severityMark(severity: Severity): string {
  if (severity === "error") {
    return "x";
  }
  if (severity === "warn") {
    return "!";
  }
  return "i";
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function escapePipe(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function code(value: string): string {
  return `\`${value}\``;
}
