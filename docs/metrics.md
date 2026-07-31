# Metrics and interpretation

`agent-context-bench` has two evidence levels. The static audit reports
heuristics derived from files and rules. `run-bench` reports observations from
real agent runs. Keep those two layers separate when interpreting a result.

## Static audit

### Status

`status` is either:

- `configured`: at least one supported context file contains usable content.
- `not-configured`: no supported file was found, or all supported files are
  empty. `score` and `inventoryScore` are `null`, scope signals are
  `not-applicable`, and the CLI prints **Score: Not available**. Absence and
  empty placeholders are not treated as perfect scores.

Supported files include root and nested `AGENTS.md`, `CLAUDE.md`, and
`SKILL.md`; `.cursorrules`; `.cursor/rules`; and
`.github/copilot-instructions.md`.

### Scores

Each configured scope starts at 100. Detected issues carry rule-specific impact
points, which are subtracted and clamped to `0..100`. Higher scores mean fewer
detected static risks. A score is a linter result, not an expected task-success
percentage.

Two repository-level scores answer different questions:

- **Operational Score (`score`)** weights context by normal load behavior.
- **Inventory Score (`inventoryScore`)** treats every discovered context file
  as one combined worst-case inventory.

Operational weights are:

| Context present | Always loaded | Subtree scoped | Deferred skills |
| --- | ---: | ---: | ---: |
| All three | 70% | 15% | 15% |
| Always + scoped | 80% | 20% | — |
| Always + deferred | 80% | — | 20% |
| Scoped + deferred | — | 50% | 50% |
| Always only | 100% | — | — |
| Scoped only | — | 100% | — |
| Deferred only | — | — | 100% |

These weights model likely loading, not a provider guarantee. Agent products
apply context files differently; verify important assumptions with the target
agent.

### Categorical heuristic signals

Every static signal has `methodology: "static-heuristic"` and one of five
levels: `low`, `moderate`, `high`, `critical`, or `not-applicable`.

| Signal | Static evidence summarized |
| --- | --- |
| `outcomeRisk` | Score loss plus error/warning burden that may obstruct correct execution |
| `tokenOverheadRisk` | Token volume, bloat, duplication, and conflicting context |
| `explorationOverheadRisk` | Bloat, vague guidance, duplication, and conflicts that may encourage wandering |
| `commandOverheadRisk` | Conflicting rules and ambiguous test guidance that may cause command churn |
| `overallRisk` | Highest applicable category; detected dangerous instructions force `critical` |
| `primaryRisk` | Human-readable leading issue category |

The categories are directional triage. They are not probabilities, causal
effects, percentage changes, or model-runtime measurements. A `high` signal
means “inspect this area,” not “the agent will be slower by a known amount.”

### Token counts

The default token count is:

```text
ceil(character count / 4.28)
```

It is a calibrated approximation and intentionally avoids installing a
tokenizer for normal use. For exact `o200k_base` counts, install the optional
tokenizer in the analyzed project and opt in:

```bash
npm install --save-dev gpt-tokenizer
npx agent-context-bench@latest . --exact-tokens
```

Exact counts still describe context text, not the full provider request. Agent
wrappers may add prompts, tools, history, or hidden instructions.

### Scope summaries

- **Always loaded:** root instructions, Cursor rules, and Copilot instructions
  expected to be available up front.
- **Subtree scoped:** nested `AGENTS.md` or `CLAUDE.md` that applies only below
  its directory.
- **Deferred:** `SKILL.md` files expected to load only when selected.

Per-skill rows use the same issue model for one file. A poor deferred-skill
score does not mean every task pays that cost; it means the file is risky when
selected or loaded too broadly.

## Measured benchmark

`run-bench` executes every task under requested context conditions. Its default
conditions are `none`, `current`, and `optimized`. Each task/condition gets an
isolated worktree when a usable base commit exists, otherwise an isolated copy.

### Direct observations

- **Success:** both the agent command and task verification command exited `0`.
- **Success rate:** successful tasks divided by tasks for that condition.
- **Average duration:** wall time of the agent adapter command; verification
  time is not included.
- **Average context tokens:** tokens in the context files prepared for that
  condition.
- **Reported tokens:** optional agent usage parsed from a `TOKENS=<number>`
  line emitted by the adapter. It remains absent when an adapter reports none.
- **Success deltas:** differences between condition success rates, expressed as
  percentage points.

Agent cost is not inferred from context size. A custom adapter may preserve
provider usage/cost data separately, as the measured case-study wrappers do.

### Efficiency

For each condition:

```text
efficiency = successRate / (1 + averageContextTokens / 10000)
```

This is a compact comparison within one run. It rewards equal success with less
context. It is not a universal quality score and should not be compared across
different repositories, task sets, models, or verification commands.

### Gold-context file metrics

History-generated tasks can include `filesChanged`, the files touched by the
source fix. The runner treats these as gold context.

- **Edited files** come from git status after removing context-setup changes.
- **Explored files** combine edited files with workspace paths mentioned in the
  agent output.
- **Precision** asks how much selected work was relevant.
- **Recall** asks how much of the gold set was covered.
- **F1** is the harmonic mean of precision and recall.

Metrics are `null` when a task has no gold files or cannot use a git worktree.
Edited-file metrics are direct workspace observations. Explored-file metrics
are a best-effort proxy and depend on what the adapter exposes in its output.

## Drawing conclusions

Agent runs are stochastic. For decision-grade comparisons:

1. Verify tasks fail at the base commit and pass at the target commit.
2. Use deterministic verification that agents cannot satisfy by editing tests.
3. Run enough representative tasks and repeat every condition.
4. Randomize or rotate condition order where external load could drift.
5. Keep raw JSON and report variability, failures, model, version, and cost.
6. Prefer repeated process signals over a single small-sample success delta.

The [July 2026 case study](benchmarks/claude-sonnet-2026-07.md) demonstrates why:
time and cost effects repeated, while success ordering reversed at `n=4`.
