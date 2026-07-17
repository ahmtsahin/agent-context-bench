# Measured bench fixtures

Everything used by the July 2026 Claude Code case study
([writeup](../../docs/benchmarks/claude-sonnet-2026-07.md)).

- `bloated-CLAUDE.md` — the planted 375-line context file for the `current`
  condition. The analyzer scores it 0/100 (bloat, four conflict types, a
  package-manager mismatch, 12 missing references). Its patterns are modeled
  on context files found in real repositories.
- `tasks.template.json` — the four task prompts. `baseCommit` values point at
  orphan snapshots in a scratch repo; regenerate them as described in the
  writeup before running.
- `claude-agent.mjs` — the `--agent` wrapper for headless Claude Code. Reads
  the prompt from `AGENT_BENCH_PROMPT`/stdin, restricts Bash to test
  commands, emits a `TOKENS=` line from Claude's usage JSON, and appends
  per-run usage/cost records to `$BENCH_LOG`.
- `results/run1-all-conditions.json` — raw summary of the first full run
  (none / current / optimized-v1), paths scrubbed.
- `results/run2-optimized-after-fix.json` — the optimized rerun after the
  template fix, paths scrubbed.

Run shape (Windows note: use `C:/...`-style paths inside `--agent`; POSIX
`/c/...` paths embedded in a composite argument are not converted by git-bash
and node resolves them to `C:\c\...`):

```bash
node dist/cli.js run-bench <scratch-repo> \
  --agent "node <abs-path>/claude-agent.mjs" \
  --tasks tasks.json \
  --success "git diff --quiet HEAD -- test && npm test" \
  --conditions none,current,optimized \
  --timeout 900000
```
