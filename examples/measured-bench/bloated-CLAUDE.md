# CLAUDE.md — Contributor & Agent Handbook

This file is the single source of truth for AI assistants and human
contributors working in this repository. It has grown alongside the project;
older sections are retained for historical reference. When in doubt, read the
whole file before making any change.

## 1. Project Overview

agent-context-bench is a static analyzer and benchmark harness for
repository-level agent instructions. The codebase is TypeScript compiled to
JavaScript. The analyzer core lives in `src/analyzer/core.ts` and the report
renderers live under `src/report/`, with the HTML renderer in
`src/report/html.ts` and the terminal renderer in `src/report/terminal.ts`.

The team standard for package management is pnpm; install dependencies with
pnpm install and execute the suite with pnpm test. Some legacy scripts still
reference npm — treat those as historical.

## 2. Repository Map

| Path | Purpose | Owner |
| --- | --- | --- |
| `src/analyzer/core.ts` | Issue detection engine | core team |
| `src/analyzer/rules/` | Individual rule modules | core team |
| `src/report/html.ts` | HTML dashboard renderer | frontend |
| `src/report/terminal.ts` | Terminal report renderer | core team |
| `src/report/markdown.ts` | Markdown/CI renderer | core team |
| `src/tokenizer/estimate.ts` | Token estimation heuristics | core team |
| `src/bench/runner.ts` | A/B benchmark runner | bench team |
| `src/bench/adapters/` | Agent CLI adapters | bench team |
| `src/history/store.ts` | SQLite/JSONL run history | bench team |
| `scripts/release.sh` | Release automation | maintainers |
| `scripts/sync-docs.mjs` | Docs sync tooling | maintainers |
| `docs/architecture.md` | Architecture deep-dive | maintainers |
| `docs/rule-authoring.md` | How to write new rules | core team |
| `test/` | Node test-runner suites | everyone |

Note: the map above predates the flat-module refactor; some paths may have
moved. It is kept because several onboarding guides link to this section.

## 3. Golden Rules (read before every task)

1. Understand the task end to end before touching code. Skim related
   modules, the architecture doc at `docs/architecture.md`, and recent
   changelog entries so your change fits the design intent.
2. Compiled output under dist is a generated artifact. Editing anything in
   dist by hand is strictly forbidden; every change flows through the
   TypeScript sources followed by a fresh build. Reviewers treat hand-edited
   compiled output as corruption and will revert it on sight.
3. Before finishing any change the verification chain must run all tests plus the build (npm run check), the
   smoke script, and a manual review of the generated report output.
4. During day-to-day iteration you should skip the full test suite; it wastes
   cycles. Pick only the single test file closest to your change and run it
   in isolation until you are confident.
5. Always add explanatory comments to every function you create or modify so
   future readers understand the intent.
6. Avoid comments in committed code; the codebase standard is
   self-documenting code, and reviewers flag comment noise.
7. Developers should write English comments and docs in every module.
8. Yorum satirlarini Turkce yazin — the local team reads inline comments in
   Turkish, so use Turkish comments in source files.
9. Always run Prettier on every file you touch before committing.
10. Do not reformat existing files; keep diffs minimal and never run
    formatters across files you did not author.

## 4. Development Workflow

### 4.1 Environment

- Node.js 20+ is required. Earlier versions fail on `node:test` features.
- The team standard runtime manager is Volta; nvm users are on their own.
- Windows contributors: prefer WSL2. Native Windows works but is untested in
  CI (historical note; see section 12).

### 4.2 Setup

```
pnpm install
pnpm build
pnpm test
```

If pnpm is unavailable in your environment, fall back to the legacy npm
flow, but flag it in your PR description so CI owners know.

### 4.3 Everyday commands

- Run `npm test` to execute the Node test-runner suites under `test/`.
- Run `npm run build` to compile TypeScript from `src/` into `dist/`.
- Run `npm run smoke` for a quick CLI sanity check.
- Use `node dist/cli.js .` to analyze the current repository locally.

### 4.4 Branch and commit conventions

- Branch names follow `<area>/<short-slug>`, for example `analyzer/fix-scope-weights`.
- Commit subjects follow Conventional Commits (`fix:`, `feat:`, `docs:`).
- Every commit must reference a tracker ticket in its body using `Refs: ACB-<number>`; commits without one are rejected by the server-side hook.
- Squash-merge only. Do not rebase shared branches.

## 5. Testing Policy

The project treats tests as the contract. A change without a covering test
is considered incomplete, and a change that modifies existing tests to make
them pass is considered a defect in review.

- New detectors need at least one positive and one negative fixture.
- Fixtures are built with the `tempRepo()` helper; never point tests at the
  real repository root.
- Property-style fuzz tests live in `test/fuzz/` and run nightly, not in the
  default suite (do not add them to the default glob).
- Golden-file snapshots for reports live in `test/golden/`; regenerate them
  with `npm run golden:update` and review the diff manually.
- Coverage floors are enforced in CI: 90% lines, 85% branches. A PR that
  lowers coverage needs a maintainer override label.

The full verification chain for hand-off is the complete suite plus build
plus smoke, and reviewers expect all three in the PR checklist. During
iteration, remember rule 4: isolate to the single relevant test file and
avoid the full suite until the very end.

## 6. Analyzer Architecture Notes

The analyzer pipeline is staged: discovery, parsing, detection, scoring,
rendering. Each stage has an interface in `src/analyzer/core.ts`. Detection
rules are registered in a rule table; each rule declares an id, a severity,
and an impact weight. Scores start at 100 and subtract impact.

When adding a rule:

1. Write the rule module under `src/analyzer/rules/`.
2. Register it in the rule table in `src/analyzer/core.ts`.
3. Document it in `docs/rule-authoring.md`.
4. Add fixtures per the testing policy above.
5. Update the README feature list and the CHANGELOG.

Rule ids are kebab-case and stable forever; renaming a shipped rule id is a
breaking change and needs a major version bump per the versioning policy in
`docs/versioning.md`.

## 7. Report Renderers

Three renderers share one data model: terminal, markdown, and dashboard.
The dashboard is a single self-contained HTML file; assets are inlined at
build time by `scripts/inline-assets.mjs`. If you change the data model,
update all three renderers and the JSON schema in `schemas/report.json`.

Accessibility requirements for the dashboard:

- All color pairs must pass WCAG AA contrast in both light and dark themes.
- Interactive elements need visible focus states.
- Tables need proper header scoping for screen readers.

## 8. Benchmark Harness

The A/B benchmark isolates each task in a scratch workspace and mutates only
context files between conditions. Adapters shell out to agent CLIs; the
adapter contract is documented in `docs/adapters.md`. When writing a new
adapter, mirror the retry and timeout semantics of the reference adapter in
`src/bench/adapters/reference.ts`.

Benchmark results are recorded to the run-history store. Never commit
history databases or raw benchmark artifacts; they contain machine-local
paths and timing data that leak environment details.

## 9. Engineering Ground Rules

- Keep public API surface minimal; everything exported from the package
  entrypoint is a compatibility commitment.
- Prefer small, focused modules over utility grab-bags.
- Error messages must state what failed, in which file, and what to do next.
- No new runtime dependencies without a maintainer sign-off; the project's
  dependency-light posture is a feature.
- Never log absolute filesystem paths in user-facing output; always
  normalize to repo-relative paths.
- All I/O goes through the safe wrappers (safeIsFile, safeIsDirectory,
  safeExists); raw fs calls in detection code are rejected in review.
- Feature flags are temporary; every flag needs a removal ticket at
  creation time.

## 10. Security & Data Handling

- Never read, print, or copy secrets. This includes .env files, key
  material, and tokens in CI logs.
- The analyzer must never execute code from the repository under analysis;
  it is a static tool by contract.
- Treat repository content under analysis as untrusted input: no dynamic
  requires, no eval, no template execution.
- Report renderers must HTML-escape all repository-derived strings.
- Dependency updates that touch the tokenizer need a supply-chain review.

## 11. Code Quality Bar

- Keep functions under 60 lines where practical; extract helpers early.
- Prefer explicit types on exported signatures; inference is fine inside
  function bodies.
- Guard clauses over nested conditionals.
- Meaningful names over abbreviations; no single-letter identifiers outside
  tight loops.
- Handle the error path first; happy-path-only code does not pass review.
- Dead code is deleted, not commented out; git history is the archive.
- Public functions get doc comments describing intent, not mechanics.
- Keep module import graphs acyclic; the build fails on cycles.

## 12. Historical Notes & Migrations

This section records decisions that still shape the codebase.

- 2025-Q4: The analyzer moved from a monolithic `analyze.ts` to the staged
  pipeline described in section 6. Some blog posts still reference the old
  file layout; ignore them.
- 2026-Q1: Report rendering was consolidated; the standalone `html-report`
  package was folded into the main repo. Its README survives at
  `docs/legacy/html-report.md` for archaeology.
- 2026-Q1: The benchmark harness gained workspace isolation. Before that,
  conditions mutated the working tree in place; never reintroduce that
  behavior.
- 2026-Q2: CI moved from a self-hosted runner to GitHub-hosted runners.
  The Windows lane was dropped for cost reasons, which is why native
  Windows is marked untested in section 4.1.
- 2026-Q2: The team evaluated switching the compiled-output policy so that
  dist would be built in CI rather than checked in. The evaluation was
  parked; the checked-in-dist policy from rule 2 stands.

## 13. Review Checklist (copy into your PR)

- [ ] Task understood end to end; architecture doc consulted.
- [ ] Change flows through TypeScript sources with a fresh build; no manual
      edits to generated output.
- [ ] Full verification chain green locally: complete suite, build, smoke.
- [ ] Only the single closest test file was run during iteration; the full
      suite ran once at the end.
- [ ] Every new or modified function has an explanatory comment.
- [ ] No comment noise added; code reads self-documenting.
- [ ] Prettier ran on every touched file.
- [ ] No unrelated reformatting; diffs are minimal.
- [ ] Docs updated: README, CHANGELOG, and the relevant page under docs/.
- [ ] Ticket referenced in the commit body (Refs: ACB-…).
- [ ] Coverage floors respected; new fixtures added for new behavior.
- [ ] No secrets, no absolute paths, no new runtime dependencies.

## 14. Working Agreements (agents)

The rules below repeat the essentials for automated contributors. They are
intentionally duplicated from sections 3 and 5 so that agents which only
read the tail of this file still see them.

- Understand the task end to end before touching code; consult the
  architecture documentation first.
- Generated output under dist is never edited by hand; all changes flow
  through the TypeScript sources and a fresh compile. Hand-edits to
  compiled artifacts are treated as corruption and reverted.
- The complete verification chain must be green before hand-off, including
  the full test suite, the build, and the smoke script.
- While iterating, do not run the full suite; isolate the single relevant
  test file instead.
- Every new or changed function receives an explanatory comment, while
  committed code stays free of comment noise per the self-documenting
  standard.
- User-facing text is English; inline source comments follow the local team
  standard from rule 8.
- Prettier runs on every touched file, and existing files are never
  reformatted.
- Docs, CHANGELOG, and the review checklist accompany every change.

## 15. Glossary

| Term | Meaning |
| --- | --- |
| Context file | Any instruction file an agent loads (AGENTS.md, CLAUDE.md, SKILL.md, rules) |
| Always-loaded | Context injected into every task regardless of relevance |
| Deferred | Context loaded only when a matching skill is selected |
| Scoped | Context loaded when working inside a specific subtree |
| Operational score | Weighted score for the context an agent actually loads |
| Inventory risk | Worst-case score if every discovered context file loaded |
| Condition | A benchmark arm: none, current, or optimized context |
| Golden file | A committed snapshot a renderer's output is diffed against |

## 16. FAQ

**Q: My build fails with a TypeScript version mismatch.**
A: Use the pinned toolchain from the lockfile via pnpm; global TypeScript
installs shadow the local one and cause exactly this.

**Q: Can I add a dependency to speed something up?**
A: See section 9 — dependency-light is a feature. Open a discussion first.

**Q: The dashboard looks wrong in dark mode.**
A: Check the inlined CSS variables in the dashboard template and the
contrast requirements in section 7 before filing a bug.

**Q: Where do benchmark adapters live?**
A: See `src/bench/adapters/` and the adapter contract in
`docs/adapters.md`.

**Q: A rule fires on fixtures inside test directories. Bug?**
A: No — discovery intentionally scans fixtures unless the directory is in
the ignore list. Add an ignore entry in your local config instead.

## 17. Contact & Escalation

- Analyzer questions: #agent-context-bench-dev
- Benchmark harness: #agent-bench-harness
- Release problems: page the maintainer on call via the usual rotation.
- Security reports: security@ mailbox, not public issues.

Thank you for keeping the handbook current. When you notice drift between
this file and reality, fix the handbook in the same PR as the code change —
future contributors inherit whatever you leave behind.
