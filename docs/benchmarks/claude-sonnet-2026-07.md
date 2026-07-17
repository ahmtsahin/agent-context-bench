# Measured case study: Claude Code (Sonnet), July 2026

A real A/B run of `agent-context-bench run-bench` with a real agent, measuring
how repository context quality changes task success, wall time, and cost.
Everything here is observed — success is the exit status of the verification
command after the agent runs, never an estimate.

## Setup

- **Target repo:** agent-context-bench itself. Its test suite runs with zero
  installed dependencies (`node --test` against the checked-in `dist/`), so
  benchmark workspaces need no `npm install`.
- **Tasks:** 4 real bugs, produced by reverting four historical fixes
  (from commits `3e26f63` and `b63c4ac`) in both `src/` and `dist/` while
  keeping their covering tests:
  1. `empty-skill-warning` — SKILL.md files with frontmatter but no body were
     no longer flagged.
  2. `conflict-comments-detection` — contradictory code-comment policies were
     no longer reported as a conflict.
  3. `missing-reference-precision` — the missing-path detector flagged
     placeholder paths like `path/to/example.ts`.
  4. `folded-frontmatter-description` — YAML folded/literal multi-line
     descriptions parsed as empty.
- **Leak prevention:** each task is a single parentless (orphan) commit in a
  separate scratch repo, so the workspace git history contains one bland
  "import" commit — no fix to diff against.
- **Agent:** headless Claude Code (`claude -p --model sonnet
  --permission-mode acceptEdits`), Bash restricted to running tests. One run
  per task/condition (n=4 per cell — a demo-scale run, not a statistics paper).
- **Success:** `git diff --quiet HEAD -- test && npm test` — tests must pass
  and must not have been edited.
- **Conditions:**
  - `none` — all context files removed.
  - `current` — a 375-line CLAUDE.md planted to model real-world context rot
    (patterns copied from context files found in the wild). The analyzer
    scores it 0/100 with seven issue categories: context bloat, four conflict
    types, a package-manager mismatch, and 12 references to files that do not
    exist.
  - `optimized` — the slim AGENTS.md that `--write-optimized` generates from
    that repo state (~430 tokens), plus the `CLAUDE.md → @AGENTS.md` bridge.

## Results

| Condition | Success | Avg context tokens | Avg wall time / task | Agent cost (4 tasks) |
| --- | --- | --- | --- | --- |
| none | 4/4 | 0 | 186s | $5.13 |
| current (bloated) | **1/4** | 3,383 | **314s** | **$6.04** |
| optimized, v1 template | 1/4 | 403 | 143s | $3.39 |
| optimized, fixed template | **4/4** | 432 | 188s | $5.01 |

- **Bloated context cost 75 success points** (25% vs 100%), +69% wall time,
  and +18% agent spend — the agent burned turns obeying pnpm instructions in
  an npm repo, refusing to touch `dist/`, and consulting architecture docs
  that do not exist.
- **The optimized context matched no-context success at ~430 tokens** — an
  87% token reduction against the bloated file with none of the damage.

## The benchmark caught a bug in our own template

The first optimized run also scored 1/4 — and the probe transcript showed
why. The v1 template told agents to *"ask before … network access."* The
headless agent applied the fix to `src/index.ts`, discovered it could not
rebuild `dist/` without `npm install`, and obeyed the rule literally:

> Which would you prefer? — asked a headless run, to nobody, and exited.

Claude reported success; verification failed. The template now says to take
the smallest safe local alternative when approval is impossible, and the
rerun scored 4/4. Two more fixes fell out of building the harness: the
`optimized` condition now writes a `CLAUDE.md → @AGENTS.md` bridge (headless
Claude Code ignores a bare `AGENTS.md` — verified with marker files), and
generated "Notes To Keep" no longer inherit stale paths, conflict-pair rules,
or wrapped-line fragments.

## Caveats

- n=4 tasks, one run per cell, one model. Agent runs are noisy; treat deltas
  as directional, not precise.
- The bloated context is planted (modeled on real files, but authored for
  this run), and `none` scoring 4/4 reflects tasks whose failing tests fully
  specify the work — in less self-describing repos, good context should earn
  back more.
- The target repo's checked-in `dist/` makes "hand-edit compiled output" the
  only viable path in a no-install workspace, which is exactly the kind of
  environment quirk that stale context rules get wrong.

## Reproducing

Fixtures, the agent wrapper, task prompts, and scrubbed raw results live in
[`examples/measured-bench/`](../../examples/measured-bench/). Rebuild the
task repo by reverting the four fixes listed above at the current HEAD (in
`src/` and `dist/` together, keeping tests), committing each as an orphan
snapshot together with the bloated CLAUDE.md, and pointing `run-bench
--tasks` at those commits.
