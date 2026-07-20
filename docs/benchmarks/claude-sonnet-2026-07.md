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

## Rerun with gold-context metrics (2026-07-20)

After `run-bench` gained gold-context precision/recall/F1 and an efficiency
score, we rebuilt the four tasks at the then-current HEAD (same procedure,
fresh orphan snapshots, each base state re-verified to fail exactly its
covering test) and ran all three conditions again with a stream-json adapter
(`claude-agent-stream.mjs`) so explored files could be mined from the
transcript. Raw scrubbed summary:
[`results/run3-gold-metrics-rerun.json`](../../examples/measured-bench/results/run3-gold-metrics-rerun.json).

| Condition | Success | Ctx tokens | Time/task | Cost (4 tasks) | Efficiency | Edit F1 | Explored precision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| none | 3/4 | 0 | 175s | $3.89 | 0.75 | 0.92 | 0.41 |
| current (bloated) | 3/4 | 3,383 | **277s** | **$5.31** | 0.56 | 0.92 | 0.38 |
| optimized | 2/4 | 432 | 146s | $3.46 | 0.48 | 0.83 | 0.48 |

What the new metrics showed:

- **Every failed cell had the same signature: edit recall 0.5** — the agent
  fixed `src/index.ts` but never hand-edited the checked-in `dist/index.js`
  that the tests actually run. The gold-context metric identified the failure
  mode from the summary alone, with no transcript reading. Every successful
  cell edited both gold files.
- **The bloat tax reproduced on time and cost even though success did not
  drop this time**: +58% wall time and +37% spend vs no context, with two
  bloated runs grinding through 56–58 agent turns (vs 11–35 elsewhere).
- **Success-rate deltas at n=4 are noise**: the first run scored bloated
  context 1/4 and optimized 4/4; this run scored them 3/4 and 2/4. The
  stable, reproducible signals across both runs are wall time, cost, turn
  count, and the edit-recall failure signature — one more reason process
  metrics beat pass/fail at this scale.
- None of the three conditions told the agent the one thing it needed to
  hear: *`dist/` is checked in and must be hand-edited because `npm install`
  is unavailable*. That single missing line cost more success points than
  any planted conflict — repo-specific environment quirks are exactly what
  context files are for.

## Reproducing

Fixtures, the agent wrapper, task prompts, and scrubbed raw results live in
[`examples/measured-bench/`](../../examples/measured-bench/). Rebuild the
task repo by reverting the four fixes listed above at the current HEAD (in
`src/` and `dist/` together, keeping tests), committing each as an orphan
snapshot together with the bloated CLAUDE.md, and pointing `run-bench
--tasks` at those commits.
