# agent-context-bench

Put your `AGENTS.md` and `SKILL.md` files on a diet. Measure whether AI coding context helps or hurts.

`agent-context-bench` is a dependency-light CLI for auditing repository-level agent instructions: `AGENTS.md`, `CLAUDE.md`, `SKILL.md`, `.cursor/rules`, `.cursorrules`, and `.github/copilot-instructions.md`.

## Quick Start

Requires Node.js 20 or newer.

Run the published CLI:

```bash
npx agent-context-bench
```

Install it globally if you want the shorter alias:

```bash
npm install -g agent-context-bench
context-diet
```

Run it from a source checkout:

```bash
git clone https://github.com/ahmtsahin/agent-context-bench.git
cd agent-context-bench
npm ci
npm run build
node dist/cli.js --help
node dist/cli.js .
```

Example output:

```text
Operational Score: 77/100
Inventory Risk Score: 0/100

Operational weights: always-loaded 80%, deferred skills 20%
Inventory context: 9 files, 924 lines, 112000 bytes, ~28000 tokens
Operational effect on agent:
- Task success: -14%
- Token cost: +31%
- Files explored: +40%
- Commands run: +20%
- Risk: Deferred skill risk: Context bloat detected
Inventory risk effect:
- Task success: -65%
- Token cost: +180%
- Files explored: +140%
- Commands run: +80%
- Risk: Context bloat detected

Always-loaded context: 83/100
- Files expected to be loaded up front: AGENTS.md, CLAUDE.md, Cursor rules, and Copilot instructions.
- Size: 2 files, 180 lines, 28000 bytes, ~7000 tokens

Deferred skill context: 42/100
- SKILL.md files that should be loaded only when a matching skill is selected.
- Size: 7 files, 744 lines, 84000 bytes, ~21000 tokens

Suggested optimized file: AGENTS.optimized.md
Run with --write-optimized to generate it.
```

## What It Checks

- Context bloat: long root instructions, skill instructions, large token footprint, dense lines.
- Conflicting instructions: for example "run all tests" and "avoid full test suites".
- Duplicate rules across `AGENTS.md`, `CLAUDE.md`, Cursor rules, and Copilot instructions.
- Ambiguous test guidance that mentions tests without concrete commands.
- Dangerous instructions such as `rm -rf`, `chmod 777`, `curl | bash`, or secret-file access.
- Package-manager mismatches such as `pnpm` instructions in an `npm` repo.

Reports are split into two buckets: always-loaded context for files that agents normally see up front, and deferred skill context for `SKILL.md` files that should only load after a skill is selected. The main `Operational Score` weights always-loaded context at 80% and deferred skills at 20% when both exist. `Inventory Risk Score` is the worst-case score if every discovered context file were loaded.

The first release is intentionally static analysis first. It gives fast signal without calling a model. The benchmark runner can be layered on top once the repo has generated tasks.

## Skill Breakdown

When `SKILL.md` files are present, the report includes a per-skill table. Each skill row shows:

- Score: score for that single `SKILL.md` file based on issues attached to that file.
- Estimated tokens: approximate tokens for that file only.
- Token cost: static estimate of extra token pressure from that skill file.
- Task success: static estimate of success drag from that skill file.
- Risk: highest-priority risk category for that skill file.
- Issues: error and warning counts attached to that file.

Terminal output shows the first 20 riskiest or largest skill files. Markdown and JSON reports include all skill rows.
## Metric Model

These numbers are static heuristics, not measured agent runtime results. They are designed to flag likely context risk before you spend model calls. Real A/B benchmark adapters can replace these estimates later.

- Estimated tokens: `ceil(character_count / 4.28)` for each context file. This is a calibrated approximation based on `o200k_base` tokenizer checks against representative AGENTS.md and SKILL.md reports, not exact tokenizer output for every model.
- Score: starts at `100` and subtracts issue impact points. Error issues cost more than warnings; the final score is clamped to `0..100`.
- Operational Score: weighted score for normal usage. When both scopes exist, always-loaded context counts 80% and deferred skills count 20%. If only one scope exists, that scope gets 100% weight.
- Inventory Risk Score: worst-case score across every discovered context file, including all `SKILL.md` files.
- Task success estimate: predicted success drag from context problems. Formula: `-min(65, round((100 - score) / 2 + error_count * 3 + warning_count))`.
- Token cost estimate: predicted extra context/tool cost pressure. Formula: `min(180, round(tokens / 120 + bloat_count * 14 + duplicate_count * 6 + conflict_count * 8))`.
- Files explored estimate: predicted extra file exploration from noisy context. Formula: `min(140, round(bloat_count * 22 + vague_rule_count * 14 + duplicate_count * 8 + conflict_count * 10))`.
- Commands run estimate: predicted extra command churn. Formula: `min(80, round(conflict_count * 12 + test_issue_count * 10))`.

Because these are estimates, a low deferred skill score does not mean every task is slow. It means the installed skill inventory is heavy or risky if the wrong skills are selected or loaded too broadly.
## CLI

```bash
agent-context-bench [path] [options]
context-diet [path] [options]
```

Options:

```text
--format text|json|markdown|dashboard  Report format (default: text)
-o, --output <file>             Write report to a file
--write-optimized [file]        Write a slim AGENTS.md suggestion
--fail-under <score>            Exit 1 when score is below the threshold
--max-lines <n>                 Context bloat line threshold (default: 350)
--max-bytes <n>                 Context bloat byte threshold (default: 14000)
--max-depth <n>                 Nested context file search depth (default: 6)
```

Generate a proposed slim context file:

```bash
agent-context-bench --write-optimized
```

Generate a Markdown report for CI:

```bash
agent-context-bench --format markdown --output agent-context-report.md --fail-under 70
```

Generate a standalone HTML dashboard for one analysis:

```bash
agent-context-bench --format dashboard --output agent-context-dashboard.html
```

Build a dashboard from existing JSON reports:

```bash
agent-context-bench dashboard reports --output dashboard.html
```

The dashboard includes overview metrics, per-skill rows, top issues, and an `AGENTS.md` preview.

Generate starter benchmark tasks from git history:

```bash
agent-context-bench generate-bench --from-git-history --limit 20 --output .agent-context-bench/tasks.json
```

The generated tasks identify small historical commits that look like bug fixes, validation fixes, tests, or refactors. They do not mutate the repo; they produce task metadata that a future Claude Code, Codex CLI, or Cursor adapter can execute.

## GitHub Action

Use this repo as an action:

```yaml
name: Agent Context Bench

on:
  pull_request:
  push:
    branches: [main]

jobs:
  context:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ahmtsahin/agent-context-bench@v1
        with:
          fail-under: "70"
          write-optimized: "true"
```

Create a `v1` tag before using the versioned action reference.

The action writes a Markdown report to the job summary.

## Development

```bash
npm ci
npm run build
npm test
```

The checked-in `dist/` files make the CLI runnable in this workspace without installing dependencies. Source lives in `src/` and is built with `tsc`.

Generated reports are ignored by default. Commit only scrubbed example reports if you want public fixtures.

## Roadmap

- Add model adapters for Claude Code, Codex CLI, Cursor, OpenAI, Anthropic, and Gemini.
- Run real A/B tasks with no context, current context, and optimized context.
- Track run history in SQLite.
- Comment context score on pull requests.
- Add examples from public repositories.
