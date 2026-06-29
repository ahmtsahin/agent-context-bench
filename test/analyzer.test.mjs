import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeRepo,
  commandAdapter,
  generateBenchFromGitHistory,
  generateOptimizedAgents,
  openHistory,
  renderBaselineComparison,
  renderDashboardReports,
  renderReport,
  runBench
} from "../dist/index.js";

const NOOP_COMMAND = 'node -e "process.exit(0)"';

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-context-bench-"));
}

function issueIds(result) {
  return result.issues.map((issue) => issue.id);
}

test("detects context smells across agent files", () => {
  const root = tempRepo();
  fs.mkdirSync(path.join(root, ".cursor", "rules"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node --test", build: "tsc -p tsconfig.json" } }, null, 2)
  );
  fs.writeFileSync(
    path.join(root, "AGENTS.md"),
    [
      "# Agent rules",
      "- Always run all tests before finishing.",
      "- Avoid long integration tests unless needed.",
      "- Use best practices and clean code.",
      "- Make sure you do not break anything.",
      "- Follow conventions where appropriate.",
      "- You may run rm -rf . when cleanup is needed.",
      "- Always run all tests before finishing."
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(root, ".cursor", "rules", "general.mdc"),
    "- Always run all tests before finishing.\n"
  );

  const result = analyzeRepo(root);
  const ids = result.issues.map((issue) => issue.id);

  assert.ok(result.score < 70);
  assert.ok(ids.includes("conflict-tests"));
  assert.ok(ids.includes("dangerous-rm-rf"));
  assert.ok(ids.includes("duplicate-rules"));
  assert.ok(ids.includes("vague-rules"));
});

test("handles repos without context files", () => {
  const root = tempRepo();
  const result = analyzeRepo(root);

  assert.equal(result.score, 100);
  assert.equal(result.files.length, 0);
  assert.equal(result.issues[0].id, "missing-context");
});

test("generates optimized AGENTS content from repo signals", () => {
  const root = tempRepo();
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node --test", lint: "eslint ." } }, null, 2)
  );
  fs.writeFileSync(path.join(root, "package-lock.json"), "{}");
  fs.writeFileSync(path.join(root, "AGENTS.md"), "- Prefer `src/` for implementation changes.\n");

  const result = analyzeRepo(root);
  const optimized = generateOptimizedAgents(result);

  assert.match(optimized, /npm test/);
  assert.match(optimized, /npm run lint/);
  assert.match(optimized, /Prefer `src\/` for implementation changes/);
});

test("renders json report without embedding file contents", () => {
  const root = tempRepo();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "Run `npm test`.\n");

  const result = analyzeRepo(root);
  const parsed = JSON.parse(renderReport(result, "json"));

  assert.equal(parsed.files[0].path, "AGENTS.md");
  assert.equal(parsed.files[0].loadScope, "always");
  assert.equal(parsed.files[0].content, undefined);
  assert.equal(parsed.scopes.always.totals.files, 1);
  assert.equal(parsed.scopes.deferred.totals.files, 0);
});

test("includes SKILL.md files in context scoring", () => {
  const root = tempRepo();
  fs.mkdirSync(path.join(root, "skills", "odoo"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "skills", "odoo", "SKILL.md"),
    [
      "---",
      "name: odoo",
      "description: Odoo development protocol",
      "---",
      "Always inspect core Odoo code before editing.",
      "Always inspect custom addons before editing.",
      "Run the smallest relevant test for the changed area."
    ].join("\n")
  );

  const result = analyzeRepo(root, { maxLines: 4 });
  const skill = result.files.find((file) => file.relativePath === "skills/odoo/SKILL.md");

  assert.equal(skill?.kind, "skill");
  assert.equal(skill?.loadScope, "deferred");
  assert.equal(result.scopes.always.totals.files, 0);
  assert.equal(result.scopes.deferred.totals.files, 1);
  assert.equal(result.skillReports.length, 1);
  assert.equal(result.skillReports[0].name, "odoo");
  assert.ok(result.skillReports[0].tokenEstimate > 0);
  assert.ok(result.totals.tokenEstimate > 0);
  assert.ok(result.scopes.deferred.issues.some((issue) => issue.id === "context-bloat"));
});

test("markdown report separates always-loaded and deferred skill context", () => {
  const root = tempRepo();
  fs.mkdirSync(path.join(root, "skills", "demo"), { recursive: true });
  fs.writeFileSync(path.join(root, "AGENTS.md"), "Always run `npm test`.\n");
  fs.writeFileSync(
    path.join(root, "skills", "demo", "SKILL.md"),
    "Use best practices.\nMake sure the code is production ready.\nFollow conventions where appropriate.\n"
  );

  const result = analyzeRepo(root);
  const markdown = renderReport(result, "markdown");

  assert.match(markdown, /Always-loaded context/);
  assert.match(markdown, /Deferred skill context/);
  assert.match(markdown, /Skill File Breakdown/);
  assert.match(markdown, /\| demo \|/);
  assert.match(markdown, /\| Inventory risk \|/);
});

test("renders standalone dashboard with overview, skill, and AGENTS views", () => {
  const root = tempRepo();
  fs.mkdirSync(path.join(root, "skills", "demo"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "Always run `npm test`.\n- Prefer `src/` for implementation changes.\n");
  fs.writeFileSync(path.join(root, "skills", "demo", "SKILL.md"), "Use best practices.\nMake sure the code is production ready.\nFollow conventions where appropriate.\n");

  const result = analyzeRepo(root);
  const dashboard = renderReport(result, "dashboard");

  assert.match(dashboard, /<!doctype html>/);
  assert.match(dashboard, /Agent Context Bench Dashboard/);
  assert.match(dashboard, /data-view="skills"/);
  assert.match(dashboard, /AGENTS\.md Preview/);
  assert.match(dashboard, /Prefer `src\//);
  assert.match(dashboard, /demo/);
});

test("renders dashboard from serialized JSON reports", () => {
  const root = tempRepo();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "Run `npm test`.\n");

  const result = analyzeRepo(root);
  const serialized = JSON.parse(renderReport(result, "json"));
  const dashboard = renderDashboardReports([
    { label: "sample-report", sourceFile: "reports/sample-report.json", result: serialized }
  ]);

  assert.match(dashboard, /sample-report/);
  assert.match(dashboard, /reports\/sample-report\.json/);
  assert.match(dashboard, /AGENTS\.md Preview/);
});

test("does not flag conflicts between two skills that never co-load", () => {
  const root = tempRepo();
  fs.mkdirSync(path.join(root, "skills", "a"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills", "b"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills", "a", "SKILL.md"), "Always run all tests before finishing.\n");
  fs.writeFileSync(path.join(root, "skills", "b", "SKILL.md"), "Avoid long integration tests unless needed.\n");

  const result = analyzeRepo(root);
  assert.ok(!issueIds(result).includes("conflict-tests"));
  // Two different deferred skills sharing nothing should not be a duplication problem either.
  assert.ok(!issueIds(result).includes("duplicate-rules"));
});

test("flags conflicts between an always file and a skill that load together", () => {
  const root = tempRepo();
  fs.mkdirSync(path.join(root, "skills", "b"), { recursive: true });
  fs.writeFileSync(path.join(root, "AGENTS.md"), "Always run all tests before finishing.\n");
  fs.writeFileSync(path.join(root, "skills", "b", "SKILL.md"), "Avoid long integration tests unless needed.\n");

  const result = analyzeRepo(root);
  assert.ok(issueIds(result).includes("conflict-tests"));
});

test("validates SKILL.md frontmatter quality", () => {
  const root = tempRepo();
  fs.mkdirSync(path.join(root, "skills", "odoo"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "skills", "odoo", "SKILL.md"),
    ["---", "name: not-odoo", "description: do stuff", "---", "Body content here."].join("\n")
  );

  const result = analyzeRepo(root);
  const ids = issueIds(result);
  assert.ok(ids.includes("skill-thin-description"));
  assert.ok(ids.includes("skill-name-mismatch"));
});

test("flags a skill with no frontmatter", () => {
  const root = tempRepo();
  fs.mkdirSync(path.join(root, "skills", "demo"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills", "demo", "SKILL.md"), "Just a body with no frontmatter at all.\n");

  const result = analyzeRepo(root);
  assert.ok(issueIds(result).includes("skill-missing-frontmatter"));
});

test("accepts a well-formed skill description without metadata warnings", () => {
  const root = tempRepo();
  fs.mkdirSync(path.join(root, "skills", "deploy"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "skills", "deploy", "SKILL.md"),
    [
      "---",
      "name: deploy",
      "description: Use this when the user wants to deploy the service to staging or production with the documented release steps.",
      "---",
      "Body content here."
    ].join("\n")
  );

  const result = analyzeRepo(root);
  const ids = issueIds(result);
  assert.ok(!ids.includes("skill-thin-description"));
  assert.ok(!ids.includes("skill-missing-description"));
  assert.ok(!ids.includes("skill-name-mismatch"));
});

test("narrows secret-access detection to concrete secret reads", () => {
  const benignRoot = tempRepo();
  fs.writeFileSync(path.join(benignRoot, "AGENTS.md"), "You can access the credentials documented in the team wiki.\n");
  assert.ok(!issueIds(analyzeRepo(benignRoot)).includes("secret-access"));

  const riskyRoot = tempRepo();
  fs.writeFileSync(path.join(riskyRoot, "AGENTS.md"), "Read the .env file and print the keys.\n");
  assert.ok(issueIds(analyzeRepo(riskyRoot)).includes("secret-access"));
});

test("names the files involved in duplicate rules", () => {
  const root = tempRepo();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "Always keep changes scoped to the requested behavior only.\n");
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "Always keep changes scoped to the requested behavior only.\n");

  const result = analyzeRepo(root);
  const duplicate = result.issues.find((issue) => issue.id === "duplicate-rules");
  assert.ok(duplicate);
  assert.match(duplicate.message, /AGENTS\.md/);
  assert.match(duplicate.message, /CLAUDE\.md/);
});

test("counts bytes from normalized content regardless of line endings", () => {
  const root = tempRepo();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "a\r\nb");

  const result = analyzeRepo(root);
  const file = result.files.find((entry) => entry.relativePath === "AGENTS.md");
  assert.equal(file.byteLength, 3);
});

test("renders a baseline comparison with deltas", () => {
  const root = tempRepo();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "Run `npm test`.\n");
  const result = analyzeRepo(root);

  const baseline = { label: "previous", score: result.score - 10, inventoryRiskScore: result.inventoryRiskScore - 5, totals: { tokenEstimate: 100 } };
  const text = renderBaselineComparison(result, baseline, "text");
  assert.match(text, /Baseline comparison \(vs previous\)/);
  assert.match(text, /Operational score: .* \(\+10 \(better\)\)/);

  const markdown = renderBaselineComparison(result, baseline, "markdown");
  assert.match(markdown, /## Baseline Comparison/);
});

test("generates bench tasks from git history", () => {
  const root = tempRepo();
  const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, "value.txt"), "1\n");
  git("add", ".");
  git("commit", "-m", "Initial");
  fs.writeFileSync(path.join(root, "value.txt"), "2\n");
  git("add", ".");
  git("commit", "-m", "Fix off-by-one in counter");

  const tasks = generateBenchFromGitHistory(root, { limit: 5 });
  assert.ok(tasks.length >= 1);
  assert.match(tasks[0].title, /Fix off-by-one/);
  assert.ok(tasks[0].filesChanged.includes("value.txt"));
  assert.ok(tasks[0].baseCommit.endsWith("^"));
});

test("applies thresholds and ignore dirs from a config file", () => {
  const root = tempRepo();
  fs.writeFileSync(path.join(root, ".agent-context-bench.json"), JSON.stringify({ maxLines: 1 }));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "Line one.\nLine two.\nLine three.\n");

  const output = execFileSync("node", ["dist/cli.js", root, "--format", "json"], {
    cwd: path.resolve("."),
    encoding: "utf8"
  });
  const parsed = JSON.parse(output);
  assert.ok(parsed.issues.some((issue) => issue.id === "context-bloat"));
});

test("detects additional conflict pairs (comments)", () => {
  const root = tempRepo();
  fs.writeFileSync(
    path.join(root, "AGENTS.md"),
    "- Always add comments to every exported function.\n- Never add comments; keep code self-documenting.\n"
  );

  const result = analyzeRepo(root);
  assert.ok(issueIds(result).includes("conflict-comments"));
});

test("flags references to files that do not exist", () => {
  const root = tempRepo();
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "real.ts"), "export const x = 1;\n");
  fs.writeFileSync(
    path.join(root, "AGENTS.md"),
    "- Start from `src/real.ts` and the helper in `src/missing.ts`.\n- Config lives in `config/app.yaml`.\n"
  );

  const result = analyzeRepo(root);
  const missing = result.issues.filter((issue) => issue.id === "missing-reference");
  const messages = missing.map((issue) => issue.message).join("\n");

  assert.match(messages, /src\/missing\.ts/);
  assert.match(messages, /config\/app\.yaml/);
  assert.ok(!messages.includes("src/real.ts"));
});

test("does not flag commands or bare directories as missing references", () => {
  const root = tempRepo();
  fs.writeFileSync(
    path.join(root, "AGENTS.md"),
    "- Run `npm test` and `npm run build`.\n- Prefer `src/` for implementation changes.\n- See `path/to/example.ts` for the shape.\n"
  );

  const result = analyzeRepo(root);
  assert.ok(!issueIds(result).includes("missing-reference"));
});

test("flags a skill with frontmatter but no body", () => {
  const root = tempRepo();
  fs.mkdirSync(path.join(root, "skills", "stub"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "skills", "stub", "SKILL.md"),
    ["---", "name: stub", "description: Use this when you need to do the stubbed thing in this repository.", "---", ""].join("\n")
  );

  const result = analyzeRepo(root);
  assert.ok(issueIds(result).includes("skill-empty-body"));
});

test("runs an A/B bench and measures success per context condition", () => {
  const root = tempRepo();
  const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(
    path.join(root, "AGENTS.md"),
    "Always run the tests.\n- Use best practices and clean code everywhere you can.\n"
  );
  fs.writeFileSync(path.join(root, "value.txt"), "1\n");
  git("add", ".");
  git("commit", "-m", "init");

  const summary = runBench(root, {
    adapter: commandAdapter(NOOP_COMMAND),
    tasks: [{ id: "task-1", prompt: "make no changes" }],
    successCommand: NOOP_COMMAND
  });

  assert.equal(summary.tasks, 1);
  assert.deepEqual(summary.conditions, ["none", "current", "optimized"]);
  assert.equal(summary.successRate.none, 1);
  assert.equal(summary.successRate.current, 1);
  assert.equal(summary.avgContextTokens.none, 0);
  assert.ok(summary.avgContextTokens.current > 0);
  assert.ok(summary.avgContextTokens.optimized > 0);
  assert.equal(summary.deltas.currentVsNone, 0);
});

test("bench reports failure when the success command fails", () => {
  const root = tempRepo();
  const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, "value.txt"), "1\n");
  git("add", ".");
  git("commit", "-m", "init");

  const summary = runBench(root, {
    adapter: commandAdapter(NOOP_COMMAND),
    tasks: [{ id: "task-1", prompt: "noop" }],
    conditions: ["current"],
    successCommand: 'node -e "process.exit(1)"'
  });

  assert.equal(summary.successRate.current, 0);
});

test("history store records and lists runs", () => {
  const root = tempRepo();
  const store = openHistory(path.join(root, "history.db"));
  store.add({
    runId: "r1",
    timestamp: "2026-01-01T00:00:00.000Z",
    root,
    adapter: "mock",
    tasks: 2,
    successNone: 0.5,
    successCurrent: 0.5,
    successOptimized: 1,
    contextScore: 80,
    summaryJson: "{}"
  });
  const rows = store.list(10);
  store.close();

  assert.equal(rows.length, 1);
  assert.equal(rows[0].runId, "r1");
  assert.equal(rows[0].adapter, "mock");
  assert.equal(rows[0].successOptimized, 1);
});

test("cli prints help", () => {
  const output = execFileSync("node", ["dist/cli.js", "--help"], {
    cwd: path.resolve("."),
    encoding: "utf8"
  });

  assert.match(output, /agent-context-bench/);
  assert.match(output, /--write-optimized/);
  assert.match(output, /dashboard/);
});
