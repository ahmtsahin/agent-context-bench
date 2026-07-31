# Measured case study: Claude Code (Sonnet), July 2026

This case study asks a narrow question: when the task and model stay fixed,
what changes when repository context is absent, bloated, or reduced to a small
generated candidate?

The replicated finding is about **time and cost**, not success rate. Across two
four-task runs, the bloated condition took 58–69% longer and cost 18–37% more
than no context. Success ordering changed between runs, so success-rate deltas
at this sample size are inconclusive.

## Results across both runs

| Run | Condition | Success | Context tokens | Time/task | Agent cost (4 tasks) |
| --- | --- | ---: | ---: | ---: | ---: |
| Initial suite | none | 4/4 | 0 | 186s | $5.13 |
| Initial suite | bloated | 1/4 | 3,383 | 314s | $6.04 |
| Initial suite | generated candidate, v1 | 1/4 | 403 | 143s | $3.39 |
| Initial suite | generated candidate, fixed rerun | 4/4 | 432 | 188s | $5.01 |
| Gold-metrics rerun | none | 3/4 | 0 | 175s | $3.89 |
| Gold-metrics rerun | bloated | 3/4 | 3,383 | 277s | $5.31 |
| Gold-metrics rerun | generated candidate | 2/4 | 432 | 146s | $3.46 |

The fixed candidate cell is a separate rerun of the same four tasks. The
benchmark exposed a bad rule in the first generated template; that defect was
fixed before rerunning only that condition. It must not be read as a
simultaneous repeat of all three initial cells.

Compared with `none`, bloated context produced:

| Signal | Initial suite | Gold-metrics rerun |
| --- | ---: | ---: |
| Wall time | +69% | +58% |
| Agent cost | +18% | +37% |
| Success-rate points | −75 | 0 |

The first run favored the fixed candidate over bloated context (4/4 versus
1/4). The rerun favored bloated context (3/4 versus 2/4). That reversal is why
this project does not present the initial 75-point difference as a stable
benefit.

## Experimental setup

- **Target:** `agent-context-bench` itself.
- **Agent:** headless Claude Code, Sonnet, with edit permissions and Bash
  restricted to tests.
- **Sample:** four tasks, one run per task/condition (`n=4` per cell).
- **Verification:** `git diff --quiet HEAD -- test && npm test`; the suite had
  to pass and the agent could not edit tests.
- **Isolation:** every task used a separate scratch repository with a bland,
  parentless import commit. The historical fix was not available in git
  history for the agent to inspect.
- **No install:** the checked-in `dist/` let the test suite run without
  installing packages.

The four tasks restored real defects from historical fixes:

1. `empty-skill-warning`: an empty `SKILL.md` body was no longer flagged.
2. `conflict-comments-detection`: contradictory comment policies were missed.
3. `missing-reference-precision`: placeholder paths were false positives.
4. `folded-frontmatter-description`: folded YAML descriptions parsed empty.

## Context conditions

- `none`: all recognized context files removed.
- `current`: a planted 375-line `CLAUDE.md`, modeled on patterns seen in
  real repositories. It contained bloat, four conflict categories, a package
  manager mismatch, and 12 nonexistent path references; the linter scored it
  0/100.
- `optimized`: the roughly 430-token candidate produced by
  `--write-optimized`, plus a `CLAUDE.md` bridge importing `@AGENTS.md`.

The bloated file was deliberately planted, not sampled unchanged from a public
repository. It is useful for an adversarial case study, but it limits external
validity.

## What the first run exposed

The original generated candidate also scored 1/4. Its working rules told the
headless agent to ask before network access. On a task that needed rebuilt
`dist/` but had no installed dependencies, the agent stopped with a question
that nobody could answer. Verification then failed.

The template now directs an unattended agent to take the smallest safe local
alternative when approval is impossible. The candidate rerun then scored 4/4.
The harness also gained a `CLAUDE.md` → `@AGENTS.md` bridge because the tested
Claude Code setup loaded that import but ignored a bare `AGENTS.md`.

This is a useful benchmark outcome even though it complicates the table: it
found a defect in the tool's own generated context.

## Gold-context rerun

The second full run rebuilt the tasks at the then-current `HEAD` and used the
stream-JSON adapter so the runner could recover explored file paths.

| Condition | Success | Efficiency | Edit F1 | Explored precision |
| --- | ---: | ---: | ---: | ---: |
| none | 3/4 | 0.75 | 0.92 | 0.41 |
| bloated | 3/4 | 0.56 | 0.92 | 0.38 |
| generated candidate | 2/4 | 0.48 | 0.83 | 0.48 |

Every failed cell had edit recall `0.5`: the agent fixed `src/index.ts` but did
not update the checked-in `dist/index.js` that the tests executed. Every
successful cell edited both gold files. The process metric identified that
failure mode without reading the transcripts.

None of the conditions stated the repository-specific fact that mattered most:
`dist/` is committed and, in this no-install fixture, had to be edited or
rebuilt. This is precisely the kind of concrete local fact that good agent
context should contain.

## Raw artifacts

- [Initial three-condition run](../../examples/measured-bench/results/run1-all-conditions.json)
- [Fixed-candidate rerun](../../examples/measured-bench/results/run2-optimized-after-fix.json)
- [Gold-context rerun](../../examples/measured-bench/results/run3-gold-metrics-rerun.json)
- [Fixture and adapter guide](../../examples/measured-bench/README.md)
- [Bloated context fixture](../../examples/measured-bench/bloated-CLAUDE.md)
- [Task template](../../examples/measured-bench/tasks.template.json)

The committed summaries have local paths scrubbed. Cost values came from the
agent usage stream collected by the wrappers; task success came only from the
verification command's exit status.

## Limitations

- Four tasks, one model, one run per cell: directional evidence only.
- Model runs are stochastic, as the reversed success ordering demonstrates.
- The tasks are unusually test-specified; no context can perform well when the
  failing tests already explain the change.
- The planted bloated file is adversarial and the target is this project, so
  results should not be generalized to all repositories.
- Explored-file metrics depend on paths visible in agent output. Edited-file
  metrics come from git status and are more direct.
- Agent cost depends on model pricing and the adapter's usage reporting at the
  time of the run.

For a stronger study, use more verified tasks, repeat each cell, randomize
condition order, retain raw summaries, and report variability instead of only
point estimates.

## Reproducing the run shape

The `baseCommit` entries in the committed task template refer to disposable
orphan snapshots and must be regenerated. Revert each listed historical fix in
both `src/` and `dist/`, keep the covering test, and commit each broken state as
an orphan snapshot in a scratch repository. Confirm that each base fails only
its intended test and the target passes.

Then run:

```bash
node dist/cli.js run-bench <scratch-repo> \
  --agent "node <absolute-path>/claude-agent-stream.mjs" \
  --tasks <regenerated-tasks.json> \
  --success "git diff --quiet HEAD -- test && npm test" \
  --conditions none,current,optimized \
  --timeout 900000
```

The runner creates an isolated workspace per task and condition, mutates only
context setup files before the agent starts, records the summary, and cleans up
the temporary workspace afterward.
