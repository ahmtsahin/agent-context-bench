# CLI reference

Both installed command names are equivalent:

```text
agent-context-bench
context-diet
```

Use `npx agent-context-bench@latest` in examples below if the package is not
installed. Node.js 20 or newer is required.

## Commands

| Command | Purpose |
| --- | --- |
| `[path]` | Audit context files in a repository |
| `generate-bench [path]` | Mine candidate benchmark tasks from git history |
| `run-bench [path]` | Run tasks under multiple context conditions |
| `dashboard <json-or-directory>` | Build HTML from one or more JSON audits |
| `history [path]` | List recorded benchmark runs |

Run `agent-context-bench --help` for the compact built-in reference.

## Audit

```bash
agent-context-bench [path] [options]
```

The path defaults to the current directory.

| Option | Meaning |
| --- | --- |
| `--format text\|json\|markdown\|dashboard` | Report format; default `text` (`html` is accepted as a dashboard alias) |
| `-o, --output <file>` | Write the report instead of printing it |
| `--write-optimized [file]` | Write a reviewable candidate; defaults to `AGENTS.starter.md` when not configured, otherwise `AGENTS.optimized.md` |
| `--fail-under <score>` | Exit `1` below the Operational Score threshold |
| `--max-lines <n>` | Per-file bloat threshold; default `350` |
| `--max-bytes <n>` | Per-file byte threshold; default `14000` |
| `--max-depth <n>` | Nested context search depth; default `6` |
| `--baseline <file.json>` | Add score/token deltas to text or Markdown output |
| `--exact-tokens` | Count with optional `o200k_base` instead of the heuristic |
| `-h, --help` | Print help |
| `-v, --version` | Print package version |

When no context is configured, scores are unavailable. A plain audit and
`--fail-under 0` exit `0`; a positive `--fail-under` exits `1`, because an
unavailable score cannot pass a positive quality gate.

### Configuration

Place `.agent-context-bench.json` at the analyzed repository root. CLI flags
override matching config values.

```json
{
  "maxLines": 250,
  "maxBytes": 12000,
  "maxDepth": 4,
  "failUnder": 70,
  "format": "markdown",
  "ignoreDirs": ["fixtures", "examples"]
}
```

Supported keys are `maxLines`, `maxBytes`, `maxDepth`, `failUnder`, `format`,
and `ignoreDirs`.

### Exact token counting

Normal installs use the dependency-free `ceil(chars / 4.28)` estimate. Exact
counting is opt-in so the tokenizer is not downloaded for every user:

```bash
npm install --save-dev gpt-tokenizer
npx agent-context-bench@latest . --exact-tokens
```

The CLI loads `gpt-tokenizer/encoding/o200k_base` from the analyzed project (or
from a local installation that contains both packages). If it cannot resolve
the tokenizer, it warns and falls back to the estimate.

### Baselines

```bash
agent-context-bench . --format json --output baseline.json
# edit context files
agent-context-bench . --baseline baseline.json --format markdown
```

Baseline comparison is rendered only in text and Markdown. Current reports use
`inventoryScore`; legacy JSON containing `inventoryRiskScore` remains readable
as a baseline.

### Candidate generation

```bash
agent-context-bench . --write-optimized
agent-context-bench . --write-optimized proposed/AGENTS.md
```

The output is a starter or reduced candidate inferred from repository commands
and safe rules. With no existing context, the default is `AGENTS.starter.md`;
with configured context, it is `AGENTS.optimized.md`. It is not automatically
authoritative. Review repository facts, paths, ownership boundaries, and
agent-specific loading behavior before use.

### Output formats

- `text`: terminal-oriented summary and issue list.
- `json`: complete machine-readable audit, including `status`, nullable scores,
  categorical static signals, scopes, files, and issues.
- `markdown`: report suitable for an artifact, job summary, or review comment.
- `dashboard`: standalone HTML for one audit.

Build a dashboard from saved JSON reports:

```bash
agent-context-bench dashboard reports --output dashboard.html
```

The directory form reads sorted `*.json` audit reports and skips unrelated JSON
when at least one valid report exists.

## Generate benchmark tasks

```bash
agent-context-bench generate-bench [path] \
  --from-git-history --limit 20 --output tasks.json
```

`--from-git-history` is accepted for clarity; git history is the generator's
current source. Candidates describe small commits that resemble bug fixes,
validation fixes, tests, or refactors. Generation does not modify the target
repository.

Vet candidates before spending model calls:

```bash
agent-context-bench generate-bench . \
  --verify --success "npm test" --timeout 600000 \
  --output .agent-context-bench/tasks.json
```

A verified task must fail its success command at `baseCommit` and pass at
`targetCommit`. Verification uses temporary git worktrees. Dropped candidates
are logged; an empty final task set exits `2`.

## Run the A/B benchmark

```bash
agent-context-bench run-bench [path] \
  --agent "<agent command>" \
  [--tasks tasks.json] \
  [--success "<verification command>"] \
  [--conditions none,current,optimized]
```

| Option | Meaning |
| --- | --- |
| `--agent <cmd>` | Required agent CLI invocation |
| `--tasks <file.json>` | JSON array or `{ "tasks": [...] }`; default mines up to five history tasks |
| `--success <cmd>` | Verification command; default inferred repository test script |
| `--conditions <list>` | Any ordered subset of `none,current,optimized`; default all |
| `--timeout <ms>` | Per agent/verification step timeout; default `600000` |
| `--output <file>` | Write the full summary JSON; compact summary still prints |
| `--history-file <file>` | Override the run-history path |
| `--no-history` | Do not persist this run |

The `optimized` condition name is retained in the data schema for compatibility;
it means the generated candidate returned by the library.

### Agent command contract

The task prompt is written to stdin and exposed through:

```text
AGENT_BENCH_PROMPT
AGENT_BENCH_CONDITION
AGENT_BENCH_WORKSPACE
```

`{prompt}` and `{workspace}` placeholders are parsed into executable arguments
without shell interpolation. Commands without placeholders run through the
platform shell and receive the prompt on stdin. Treat `--agent` and `--success`
as executable code: use only commands you trust.

Each task/condition runs in an isolated detached worktree at `baseCommit` when
possible, otherwise a copy. The condition setup removes or rewrites context;
the agent then runs in that workspace, followed by verification. A task counts
as successful only when both commands exit `0`.

## History

Runs are recorded by default under `.agent-context-bench/history.db`. Node.js
versions with built-in SQLite use it; other supported runtimes transparently
fall back to a sibling JSON Lines file.

```bash
agent-context-bench history . --limit 20
agent-context-bench history . --format json
```

Use `--history-file <path>` on both `run-bench` and `history` to select another
store.

## Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | Command completed; an audit without a gate may still be not configured |
| `1` | Invalid/runtime error, failed score gate, or unavailable score with a positive gate |
| `2` | No generated/loaded benchmark tasks or no dashboard reports |
