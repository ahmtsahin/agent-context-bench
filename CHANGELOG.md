# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
semantic versioning.

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
