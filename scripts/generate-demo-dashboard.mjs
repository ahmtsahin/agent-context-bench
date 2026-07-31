import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeRepo, renderDashboardReports, renderReport } from "../dist/index.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-context-bench-demo-"));

try {
  writeDemoRepository(demoRoot);

  const analysis = analyzeRepo(demoRoot);
  const result = JSON.parse(renderReport(analysis, "json"));
  result.root = "examples/checkout-service";
  result.repo.name = "checkout-service";
  result.generatedAt = "2026-07-31T12:00:00.000Z";

  const dashboard = renderDashboardReports([
    {
      label: "checkout-service (synthetic demo)",
      result
    }
  ], { generatedAt: "2026-07-31T12:00:00.000Z" });

  fs.writeFileSync(path.join(projectRoot, "docs", "dashboard.html"), dashboard, "utf8");
  console.log("Wrote docs/dashboard.html from a sanitized synthetic repository.");
} finally {
  fs.rmSync(demoRoot, { recursive: true, force: true });
}

function writeDemoRepository(root) {
  write(
    root,
    "package.json",
    JSON.stringify(
      {
        name: "checkout-service",
        private: true,
        scripts: {
          build: "tsc -p tsconfig.json",
          lint: "eslint src test",
          test: "node --test"
        }
      },
      null,
      2
    ) + "\n"
  );
  write(root, "src/index.ts", "export const service = 'checkout';\n");
  write(root, "test/checkout.test.ts", "// Synthetic fixture used only for the dashboard demo.\n");
  write(
    root,
    "AGENTS.md",
    [
      "# Checkout service agent notes",
      "",
      "- Run the full test suite before every edit.",
      "- Never run all tests; only run the smallest focused test.",
      "- Install dependencies with pnpm before making changes.",
      "- Run `npm test` before finishing.",
      "- Follow best practices and be careful.",
      "- Read `docs/missing-architecture.md` before changing checkout behavior.",
      "- Keep API changes backward compatible and add a focused regression test."
    ].join("\n") + "\n"
  );
  write(
    root,
    "packages/payments/AGENTS.md",
    [
      "# Payments subtree",
      "",
      "- Keep gateway adapters behind the existing interface.",
      "- Run `npm test -- payments` after changing this subtree."
    ].join("\n") + "\n"
  );
  write(
    root,
    "skills/release/SKILL.md",
    [
      "---",
      "name: release",
      "description: Prepare a checkout-service release after the user explicitly asks for one.",
      "---",
      "",
      "# Release",
      "",
      "1. Run `npm test` and `npm run build`.",
      "2. Summarize user-visible changes before creating a tag."
    ].join("\n") + "\n"
  );
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}
