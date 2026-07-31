# agent-context-bench

[![npm version](https://img.shields.io/npm/v/agent-context-bench.svg)](https://www.npmjs.com/package/agent-context-bench) [![npm downloads](https://img.shields.io/npm/dm/agent-context-bench.svg)](https://www.npmjs.com/package/agent-context-bench) [![CI](https://github.com/ahmtsahin/agent-context-bench/actions/workflows/ci.yml/badge.svg)](https://github.com/ahmtsahin/agent-context-bench/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Find out whether your agent context helps—or slows down—your coding agent.**

`agent-context-bench` is a linter plus an A/B benchmark for `AGENTS.md`,
`CLAUDE.md`, coding-agent `SKILL.md` files, Cursor rules, and Copilot
instructions. The audit is local and model-free; the benchmark runs your own
agent and test command to measure what actually happens.

## Quick start

Requires Node.js 20 or newer.

```bash
npx agent-context-bench@latest .
```

Abbreviated output from a configured repository:

```text
Status: Configured
Operational Score: 77/100
Inventory Score: 42/100
Context: 9 files, 924 lines, ~28,000 tokens

Static heuristic signals
- Outcome risk: moderate
- Token overhead risk: high
- Exploration overhead risk: high

Always loaded: 83/100 · 2 files · ~7,000 tokens
Deferred skills: 42/100 · 7 files · ~21,000 tokens
```

No usable context files (missing or empty)? The result is **Not configured**, not a perfect score.
Use `--write-optimized` to create a starter candidate, review it, and
rename it only if the repository needs agent-specific guidance.

## Audit or benchmark?

| Mode | Cost | What it tells you |
| --- | --- | --- |
| `agent-context-bench .` | No model calls | Heuristic risk signals, token footprint, conflicts, duplication, unsafe rules, broken paths, and scope |
| `agent-context-bench run-bench …` | Real agent runs | Observed task success, wall time, context tokens, file precision/recall, and relative efficiency |

The audit is a fast linter, not a prediction of runtime outcomes. Use it on
every change; use the benchmark when you need evidence that one context variant
beats another.

## What the measured case study found

Two July 2026 Claude Code runs used four restored bugs and three context
conditions. The planted bloated context produced the only result that repeated:
it added **58–69% wall time** and **18–37% agent cost** versus no context.

| Run | No context | Bloated context | Generated candidate | Bloated time / cost vs none |
| --- | ---: | ---: | ---: | ---: |
| Initial suite* | 4/4 | 1/4 | 4/4 | +69% / +18% |
| Gold-metrics rerun | 3/4 | 3/4 | 2/4 | +58% / +37% |

\* The generated-candidate cell was rerun after the benchmark exposed and the
project fixed a headless-template rule; its original result was 1/4.

The success ordering flipped. At one run per condition and `n=4`, success-rate
deltas are inconclusive; they are not marketed as a stable 75-point gain. The
repeatable signal here is the bloat tax on time and cost, plus an edit-recall
failure signature exposed by the gold-context metrics. Read the
[full method, both runs, caveats, and raw-result links](docs/benchmarks/claude-sonnet-2026-07.md).

## What the linter checks

- Oversized or dense always-loaded and deferred context.
- Scope-aware conflicts and duplicate rules across files that can co-load.
- Missing referenced code/config paths and package-manager mismatches.
- Weak `SKILL.md` frontmatter, descriptions, names, or empty bodies.
- Test guidance without a runnable command.
- Dangerous commands and concrete secret-file reads.
- Root, subtree-scoped, and deferred-skill context as separate inventories.

See [metrics and interpretation](docs/metrics.md) for scoring, categorical
signals, token counting, scope weights, and benchmark caveats.

## Common workflows

Write JSON for a baseline, edit context, then compare:

```bash
npx agent-context-bench@latest . --format json --output baseline.json
npx agent-context-bench@latest . --baseline baseline.json
```

Create a reviewable starter/candidate and an HTML dashboard:

```bash
npx agent-context-bench@latest . --write-optimized
npx agent-context-bench@latest . --format dashboard --output report.html
```

Generate and verify benchmark tasks from git history:

```bash
npx agent-context-bench@latest generate-bench . \
  --from-git-history --verify --success "npm test" \
  --output .agent-context-bench/tasks.json
```

Run each task with no, current, and generated context:

```bash
npx agent-context-bench@latest run-bench . \
  --agent "your-agent-cli --prompt-from-stdin" \
  --tasks .agent-context-bench/tasks.json \
  --success "npm test" \
  --conditions none,current,optimized
```

Each condition gets an isolated workspace. The prompt is sent on stdin and
through `AGENT_BENCH_PROMPT`; success requires both the agent and verification
command to exit `0`. Start with cheap, deterministic tasks and repeat noisy
runs before drawing conclusions.

The complete command and config reference is in [docs/cli.md](docs/cli.md).

## Dashboard

Create one dashboard from a live audit or combine saved JSON reports:

```bash
agent-context-bench dashboard reports --output dashboard.html
```

<p align="center">
  <img src="./docs/dashboard-screenshot.png" alt="Agent Context Bench dashboard built from synthetic repository data" width="800">
</p>

## GitHub Action

```yaml
name: Agent context
on: [pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
      - uses: ahmtsahin/agent-context-bench@v1
        with:
          fail-under: "70"
          comment: "true"
```

The action always writes Markdown to the job summary. PR comments require
`pull-requests: write`; fork pull requests still keep the summary when the
token cannot comment.

## Programmatic API

```js
import { analyzeRepo, renderReport } from "agent-context-bench";

const result = analyzeRepo(".");
console.log(result.status, result.score);
console.log(renderReport(result, "markdown"));
```

See [docs/api.md](docs/api.md) for types, benchmark adapters, and the pre-1.0
compatibility policy.

More: [CLI reference](docs/cli.md), [Action guide](docs/github-action.md), [metric model](docs/metrics.md), [roadmap](docs/roadmap.md),
[contributing](CONTRIBUTING.md), [security](SECURITY.md), [changelog](CHANGELOG.md), and [releasing](docs/releasing.md).

Found a false positive or public-repo result? Open an [issue](https://github.com/ahmtsahin/agent-context-bench/issues). If the tool earns a place in your workflow, a GitHub star helps other maintainers find it.

MIT © 2026 Ahmet Sahin.
