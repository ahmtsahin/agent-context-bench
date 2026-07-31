import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpusRoot = path.join(projectRoot, "examples", "public-corpus");
const resultsRoot = path.join(corpusRoot, "results");
const manifestPath = path.join(corpusRoot, "manifest.json");
const cliPath = path.join(projectRoot, "dist", "cli.js");
const packagePath = path.join(projectRoot, "package.json");
const outputPath = parseOutput(process.argv.slice(2));
const outputTarget = outputPath ? resolveSafeOutput(outputPath) : undefined;

const manifest = readJson(manifestPath);
const packageJson = readJson(packagePath);
validateManifest(manifest);

if (packageJson.version !== manifest.scanner.version) {
  throw new Error(
    `Scanner version mismatch: manifest requires ${manifest.scanner.version}, local package is ${packageJson.version}.`
  );
}
if (!fs.existsSync(cliPath)) {
  throw new Error("dist/cli.js is missing. Run `npm run build` before reproducing the corpus.");
}

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-context-corpus-"));
const hooksRoot = path.join(scratchRoot, "empty-hooks");
fs.mkdirSync(hooksRoot);

try {
  const repositories = [];
  for (const [index, repository] of manifest.repositories.entries()) {
    const checkout = path.join(scratchRoot, `${String(index + 1).padStart(2, "0")}-${slug(repository.name)}`);
    console.error(`[${index + 1}/${manifest.repositories.length}] ${repository.name}@${repository.commit.slice(0, 12)}`);
    checkoutPinned(repository, checkout, hooksRoot);
    const report = scan(checkout);
    repositories.push(toCorpusResult(repository, report, manifest.scanner));
  }

  const result = {
    schemaVersion: manifest.schemaVersion,
    kind: manifest.kind,
    generatedAt: manifest.snapshotGeneratedAt,
    disclaimer: manifest.disclaimer,
    scanner: manifest.scanner,
    sample: {
      repositories: repositories.length,
      selection: manifest.selection.sampleType,
      totals: sumTotals(repositories)
    },
    repositories
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;

  if (outputTarget) {
    fs.mkdirSync(path.dirname(outputTarget), { recursive: true });
    fs.writeFileSync(outputTarget, serialized, "utf8");
    console.error(`Wrote ${path.relative(projectRoot, outputTarget).replace(/\\/g, "/")}.`);
  } else {
    process.stdout.write(serialized);
  }
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
}

function checkoutPinned(repository, destination, hooksDirectory) {
  fs.mkdirSync(destination, { recursive: true });
  runGit(["init", "--quiet"], destination, hooksDirectory);
  runGit(["config", "core.symlinks", "false"], destination, hooksDirectory);
  runGit(["remote", "add", "origin", repository.cloneUrl], destination, hooksDirectory);
  runGit(["fetch", "--quiet", "--depth=1", "origin", repository.commit], destination, hooksDirectory);
  runGit(["checkout", "--quiet", "--detach", "FETCH_HEAD"], destination, hooksDirectory);

  const actualCommit = runGit(["rev-parse", "HEAD"], destination, hooksDirectory).trim();
  if (actualCommit !== repository.commit) {
    throw new Error(`${repository.name}: expected ${repository.commit}, checked out ${actualCommit}.`);
  }
}

function runGit(args, cwd, hooksDirectory) {
  const run = spawnSync("git", ["-c", `core.hooksPath=${hooksDirectory}`, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_LFS_SKIP_SMUDGE: "1",
      GIT_TERMINAL_PROMPT: "0"
    },
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024
  });
  if (run.error || run.status !== 0) {
    const detail = (run.stderr || run.stdout || run.error?.message || "unknown git error").trim();
    throw new Error(`git ${args[0]} failed in ${cwd}: ${detail}`);
  }
  return run.stdout;
}

function scan(checkout) {
  const run = spawnSync(process.execPath, [cliPath, checkout, "--format", "json"], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024
  });
  if (run.error || run.status !== 0) {
    const detail = (run.stderr || run.stdout || run.error?.message || "unknown scanner error").trim();
    throw new Error(`Static scan failed for ${checkout}: ${detail}`);
  }
  const report = JSON.parse(run.stdout);
  if (report.status !== "configured") {
    throw new Error(`${checkout}: pinned checkout no longer contains discoverable agent context.`);
  }
  if (!report.files.some((file) => file.path === "AGENTS.md" || file.path === "CLAUDE.md")) {
    throw new Error(`${checkout}: corpus entries must have a root AGENTS.md or CLAUDE.md.`);
  }
  return report;
}

function toCorpusResult(repository, report, scanner) {
  const issueCount = (severity) => report.issues.filter((issue) => issue.severity === severity).length;
  return {
    name: repository.name,
    url: repository.url,
    commit: repository.commit,
    license: repository.license,
    language: repository.language,
    scannerVersion: scanner.version,
    scannerCommand: scanner.command,
    status: report.status,
    context: {
      fileCount: report.totals.files,
      lineCount: report.totals.lines,
      byteCount: report.totals.bytes,
      tokenEstimate: report.totals.tokenEstimate,
      scopes: {
        alwaysFiles: report.scopes.always.totals.files,
        scopedFiles: report.scopes.scoped.totals.files,
        deferredFiles: report.scopes.deferred.totals.files
      }
    },
    scores: {
      operational: report.score,
      inventory: report.inventoryScore
    },
    issues: {
      total: report.issues.length,
      errors: issueCount("error"),
      warnings: issueCount("warn"),
      info: issueCount("info")
    }
  };
}

function sumTotals(repositories) {
  return repositories.reduce(
    (totals, repository) => ({
      contextFiles: totals.contextFiles + repository.context.fileCount,
      contextLines: totals.contextLines + repository.context.lineCount,
      tokenEstimate: totals.tokenEstimate + repository.context.tokenEstimate,
      issues: totals.issues + repository.issues.total
    }),
    { contextFiles: 0, contextLines: 0, tokenEstimate: 0, issues: 0 }
  );
}

function validateManifest(value) {
  if (!value || value.kind !== "static-context-corpus" || !Array.isArray(value.repositories)) {
    throw new Error("Invalid public corpus manifest.");
  }
  if (value.repositories.length !== 15) {
    throw new Error(`Expected 15 pinned repositories, found ${value.repositories.length}.`);
  }
  const names = new Set();
  for (const repository of value.repositories) {
    if (!/^[0-9a-f]{40}$/.test(repository.commit)) {
      throw new Error(`${repository.name}: commit must be a full 40-character SHA.`);
    }
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(repository.cloneUrl)) {
      throw new Error(`${repository.name}: only explicit HTTPS GitHub clone URLs are allowed.`);
    }
    if (names.has(repository.name)) {
      throw new Error(`Duplicate repository in manifest: ${repository.name}.`);
    }
    names.add(repository.name);
  }
}

function parseOutput(args) {
  if (args.length === 0) {
    return undefined;
  }
  if (args.length === 2 && args[0] === "--output") {
    return args[1];
  }
  throw new Error("Usage: node scripts/run-public-corpus.mjs [--output examples/public-corpus/results/aggregate.json]");
}

function resolveSafeOutput(value) {
  const target = path.resolve(projectRoot, value);
  const relative = path.relative(resultsRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative) || path.extname(target) !== ".json") {
    throw new Error("--output must be a .json file inside examples/public-corpus/results/.");
  }
  return target;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function slug(value) {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
}
