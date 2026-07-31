# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
semantic versioning.

## [0.6.0]

### Breaking changes
- Static audit results now include `status`, use nullable `score` and
  `inventoryScore`, and report categorical `signals` instead of synthetic
  causal percentage fields. Empty placeholder files are not treated as a
  perfect configured inventory.
- `inventoryRiskScore` was renamed to `inventoryScore`. The CLI still reads
  legacy 0.5 baselines and dashboards; programmatic baseline comparison accepts
  either name during migration.

### Added
- Preferred `generateAgentsCandidate` and `writeAgentsCandidate` APIs. The old
  optimized-named functions remain deprecated aliases; unconfigured repos
  default to a reviewable `AGENTS.starter.md`.
- Node 20/22/24, Windows, checked-in `dist`, packed-package, and local Action
  CI coverage; tag-driven npm provenance/GitHub Release automation; and a
  separately approved workflow for promoting the floating Action `v1` tag.
- Contribution, security, conduct, API, CLI, metric, Action, release, and live
  roadmap documentation, plus sanitized dashboard and social-preview assets.

### Fixed
- `--exact-tokens` now loads `gpt-tokenizer/encoding/o200k_base` explicitly.
  The tokenizer is an optional peer, so normal consumers no longer download
  its large data set by default.
- Not-configured reports no longer display 100/100; positive `--fail-under`
  gates fail clearly while `--fail-under 0` remains non-blocking.
- The composite Action quotes caller inputs, exposes generated-candidate
  outputs, updates only its own marked PR comment, and degrades safely with
  read-only fork tokens.
- The measured case study and README now lead with the result that reproduced
  across both runs (the wall-time and spend penalty) and label the `n=4`
  success ordering as inconclusive.

## [0.5.0]

### Added
- Gold-context metrics in `run-bench`, inspired by ContextBench's
  process-oriented evaluation: each task's source-commit files act as the gold
  context, agent edits are read from the workspace's git status, and explored
  files add workspace files mentioned in the agent output. The summary reports
  per-condition file-level precision/recall/F1 for edits and exploration.
- An efficiency score per bench condition
  (`successRate / (1 + contextTokens / 10k)`) plus average task duration, so
  conditions can be compared on success per unit of context pressure.
- `generate-bench --verify`: keeps only tasks whose success command fails at
  the base commit and passes at the target commit, the same vetting idea as
  ContextBench's Verified subset. Verified tasks carry `"verified": true`.
- A rerun of the measured case study with the new metrics
  (`examples/measured-bench/results/run3-gold-metrics-rerun.json`) and a
  stream-json Claude Code adapter that exposes explored files to the metrics.
- Pipeline and measured-results figures in the README, in light and dark
  variants.

## [0.4.1]

### Added
- A measured A/B case study run with headless Claude Code (Sonnet): 4 restored
  historical bugs, three context conditions, observed success rates and costs.
  Writeup in `docs/benchmarks/claude-sonnet-2026-07.md`, reproducible fixtures
  and scrubbed raw results in `examples/measured-bench/`.
- Subtree-scoped reporting and operational weights for nested `AGENTS.md` and
  `CLAUDE.md` files.
- Folded and literal multi-line YAML frontmatter value support.

### Fixed
- The generated Working Rules no longer tell agents to stop and ask before
  network access. In measured A/B bench runs, headless agents obeyed the rule
  literally, ended their run with a question nobody could answer, and failed
  tasks they had already half-solved. The rule now directs agents to take the
  smallest safe local alternative when approval is impossible.
- Optimized-file "Notes To Keep" no longer carry over rules that point at
  missing paths, rules sitting on either side of a detected conflict pair, or
  hard-wrapped mid-sentence line fragments.
- The `optimized` bench condition now writes a `CLAUDE.md` bridge file
  (`@AGENTS.md`) when the repo's context included a root `CLAUDE.md`, so agents
  that load `CLAUDE.md` but not `AGENTS.md` (for example Claude Code) still see
  the optimized context. Verified empirically: headless `claude -p` applies
  `CLAUDE.md` and `@AGENTS.md` imports but ignores a bare `AGENTS.md`.
- Benchmark conditions now require both the agent adapter and verification
  command to succeed.
- Command placeholders are substituted as arguments without shell interpolation.

## [0.4.0]

### Added
- Broken-reference detection: inline-code and markdown-link paths with a known
  code/config extension that do not resolve against the repo (or the context
  file's own directory) are flagged, with placeholders, URLs, scoped packages,
  MIME types, and RPC method names filtered out.
- Empty-skill detection: a `SKILL.md` with frontmatter but no body is flagged.
- More conflict pairs: code comments, formatting/formatter, and comment/doc
  language, each designed so a single negated sentence cannot self-trigger.

## [0.3.0]

### Added
- `run-bench` command: a pluggable agent adapter plus an A/B runner that executes
  each task under `none`, `current`, and `optimized` context conditions and
  measures success by actually running the configured success command. Success is
  observed, not estimated.
- `commandAdapter`: shell-command adapter that exposes the task prompt via stdin
  and the `AGENT_BENCH_*` environment variables, with `{prompt}`/`{workspace}`
  placeholders.
- Run history store with a built-in SQLite backend (`node:sqlite`) and a
  dependency-free JSON Lines fallback, plus a `history` command to list past runs.

## [0.2.0]

### Added
- Scope-aware conflict detection: instructions are only compared when they can
  load together, so two skills that never co-load (or two unrelated nested
  `AGENTS.md` files) are no longer falsely flagged.
- SKILL.md frontmatter validation: missing frontmatter, missing/thin/bloated
  `description`, and `name` that does not match the skill folder.
- Nested context awareness: a nested `AGENTS.md`/`CLAUDE.md` is noted as loading
  only when working inside its directory.
- `.agent-context-bench.json` config file for default thresholds and ignore dirs.
- `--baseline <file.json>` to compare scores against a previous report.
- `--exact-tokens` to count tokens with the optional `gpt-tokenizer` package,
  with a graceful fallback to the heuristic estimate.
- GitHub Action `comment` input to post (and update) the report on pull requests.

### Changed
- Duplicate-rule findings now name the files involved and only flag copies that
  can actually load together.
- `secret-access` detection narrowed to concrete secret reads to reduce false
  positives.
- Byte counts are computed from normalized content, so CRLF checkouts no longer
  inflate the size on Windows.

## [0.1.0]

### Added
- Initial release: static analysis of `AGENTS.md`, `CLAUDE.md`, `SKILL.md`,
  Cursor rules, and Copilot instructions, with text/JSON/Markdown/dashboard
  reports, an optimized `AGENTS.md` generator, `generate-bench`, and a GitHub
  Action.
