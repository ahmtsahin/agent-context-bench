import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeRepo,
  generateOptimizedAgents,
  renderDashboardReports,
  renderReport
} from "../dist/index.js";

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-context-bench-"));
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

test("cli prints help", () => {
  const output = execFileSync("node", ["dist/cli.js", "--help"], {
    cwd: path.resolve("."),
    encoding: "utf8"
  });

  assert.match(output, /agent-context-bench/);
  assert.match(output, /--write-optimized/);
  assert.match(output, /dashboard/);
});
