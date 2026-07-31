# Public repository context corpus (July 2026)

> **Static corpus — not an agent benchmark.** These results are read-only
> linter observations from pinned public repositories. No coding agent was run,
> no task-success A/B test was performed, and no score below should be read as
> evidence that a repository's instructions help or hurt a model.

This snapshot applies `agent-context-bench` 0.6.0 to 15 public repositories at
exact commit SHAs. It exists to make the linter's behavior inspectable on real
files and to define a defensible protocol for a later measured study.

## Snapshot

- **Scanner:** `agent-context-bench` 0.6.0
- **Command:** `node dist/cli.js <pinned-checkout> --format json`
- **Public-package equivalent:**
  `npx --yes agent-context-bench@0.6.0 <pinned-checkout> --format json`
- **Token mode:** deterministic `ceil(characters / 4.28)` estimate; not provider
  usage, billing tokens, or an exact tokenizer count
- **Sample:** purposive convenience sample, not a random or representative
  sample of repositories using agent context
- **Execution:** source was cloned and read; dependencies, tests, and repository
  code were not executed
- **Aggregate inventory:** 60 discovered files, 7,352 lines, about 94,662
  estimated tokens, and 118 heuristic findings

The aggregate totals describe the sampled inventories. They do **not** mean a
model receives all 94,662 tokens in one prompt. Loading behavior varies by
agent, path, file kind, and task.

## Results

`Op` is the Operational Score, which emphasizes always-loaded context and
down-weights scoped and deferred files. `Inv` scores the complete discovered
inventory. Both are static heuristics. `E/W/I` is the count of error, warning,
and informational findings; every finding still requires human review.

| Repository at pinned commit | License | Files | Lines | Est. tokens | Op | Inv | E/W/I |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| [`agentsmd/agents.md@d1ac7f0`](https://github.com/agentsmd/agents.md/tree/d1ac7f063d20e70015ed6732664049ae4ba9d74e) | MIT | 1 | 44 | 474 | 94 | 94 | 0/1/0 |
| [`AfterShip/clickhouse-sql-parser@1ca7066`](https://github.com/AfterShip/clickhouse-sql-parser/tree/1ca70664041ef01562302b40aa33c87d43c99ed6) | MIT | 2 | 78 | 1,241 | 81 | 81 | 1/1/0 |
| [`breyta/breyta-cli@26f448d`](https://github.com/breyta/breyta-cli/tree/26f448da4886d4d27b1728fd96a4f162ae42894d) | MIT | 1 | 33 | 448 | 96 | 96 | 0/1/0 |
| [`grafana/oats@47c18f5`](https://github.com/grafana/oats/tree/47c18f5afb3153b5b7c5423737afbf7ecc1b6b8d) | Apache-2.0 | 2 | 114 | 795 | 85 | 85 | 0/2/0 |
| [`mongodb-js/zstd@affeaa7`](https://github.com/mongodb-js/zstd/tree/affeaa7aedfc4094af259a25171203ec410af121) | Apache-2.0 | 2 | 43 | 600 | 96 | 96 | 0/1/0 |
| [`gominimal/minimal@7e690dc`](https://github.com/gominimal/minimal/tree/7e690dc55d15f37d02ccc74722c8a0901f1ac3b3) | Apache-2.0 | 2 | 242 | 3,381 | 75 | 75 | 1/1/0 |
| [`makecindy/cindy@cd31ce9`](https://github.com/makecindy/cindy/tree/cd31ce92a750c67e51d6315be6d9411a45ec7e77) | Apache-2.0 | 3 | 207 | 1,957 | 92 | 82 | 0/3/1 |
| [`stackql/stackql@c926a33`](https://github.com/stackql/stackql/tree/c926a33a83922123b8d6217b6ca915fdb2cffffd) | MIT | 3 | 407 | 6,652 | 87 | 61 | 0/7/1 |
| [`freee/freee-mcp@fd70235`](https://github.com/freee/freee-mcp/tree/fd70235f5d8a63bbf689dea0eff0aee3ca17dffe) | Apache-2.0 | 3 | 355 | 3,057 | 95 | 90 | 0/2/1 |
| [`KyaniteHQ/linctl@5dd95ea`](https://github.com/KyaniteHQ/linctl/tree/5dd95eaa80ee6220fd0d95303ae376c95ea5307e) | MIT | 3 | 315 | 3,424 | 91 | 67 | 0/6/0 |
| [`pydantic/pydantic-ai-harness@c199053`](https://github.com/pydantic/pydantic-ai-harness/tree/c199053ea6cc7eda2337be754a7031f753d6e316) | MIT | 6 | 698 | 7,741 | 91 | 72 | 0/6/0 |
| [`Clawdi-AI/clawdi@d88a25a`](https://github.com/Clawdi-AI/clawdi/tree/d88a25a4450478253b64e12bc972cb581812002a) | MIT | 6 | 432 | 5,225 | 87 | 66 | 1/4/2 |
| [`zuke-build/zuke@fe84a38`](https://github.com/zuke-build/zuke/tree/fe84a384a427a72030a5fe6c81565c5d9d591591) | MIT | 6 | 1,150 | 15,336 | 73 | 32 | 0/10/0 |
| [`dialexity/dialectical-framework@c90891a`](https://github.com/dialexity/dialectical-framework/tree/c90891a277d5ac8f4effa7894f7a1c4fcdadf38c) | MIT | 5 | 903 | 15,301 | 17 | 0 | 3/16/0 |
| [`EvolveHQ/docflow@7ddc774`](https://github.com/EvolveHQ/docflow/tree/7ddc77476555ea6c50e5a8bf9ac632dfc63c592f) | MIT | 15 | 2,331 | 29,030 | 66 | 0 | 1/43/2 |

The median Operational Score is 87; the median Inventory Score is 75. The
sample ranges from one discovered file and roughly 448 estimated tokens to 15
files and roughly 29,030 estimated tokens. Larger Operational/Inventory gaps
occur when much of the inventory is scoped or deferred. That is a loading-model
distinction, not evidence that the larger inventory is ineffective.

Seven findings were classified as errors, 104 as warnings, and seven as
informational. These labels express linter severity, not confirmed defects.
For example, a command that resembles a dangerous shell pattern can be safely
quoted as a warning in documentation; the static scanner cannot infer intent.

## Selection and interpretation

Each pinned checkout met these criteria at collection time:

1. Public repository with a root `AGENTS.md` or `CLAUDE.md`.
2. Machine-readable MIT or Apache-2.0 license and a license file in the
   checkout.
3. A checkout practical for a read-only scan.
4. Useful variation in language, context size, and root/scoped/deferred layout.

This is deliberately a heterogeneous smoke corpus, not a leaderboard. The
repositories were selected partly because they exercise different analyzer
paths. Results can therefore expose scanner behavior and false positives, but
they cannot estimate ecosystem-wide prevalence. Inclusion does not imply that
repository maintainers endorse this project or these findings.

The scanner used default thresholds and discovery depth. Counts include every
recognized context file found within that depth. Two files can contain the same
text or one can import the other; inventory totals still count the files on
disk. See [Metric semantics](../metrics.md) for the score, scope, and token
definitions.

## Reproduce the static corpus

The manifest and aggregate result are committed here:

- [`examples/public-corpus/manifest.json`](../../examples/public-corpus/manifest.json)
- [`examples/public-corpus/results/aggregate.json`](../../examples/public-corpus/results/aggregate.json)

Requirements are Node.js 20 or newer, Git, and outbound HTTPS access to GitHub.
From this repository at a revision whose package version is 0.6.0:

```bash
npm ci
npm run build
node scripts/run-public-corpus.mjs \
  --output examples/public-corpus/results/aggregate.json
```

The script validates the scanner version, initializes a new checkout for every
entry, fetches only the exact manifest SHA, disables symlink checkout and Git
hooks, scans the source without executing it, and removes its unique temporary
directory in a `finally` block. It refuses output paths outside
`examples/public-corpus/results/`. With the pinned inputs and scanner version,
the regenerated aggregate should be byte-for-byte stable.

Running without `--output` writes JSON to stdout. A fetch fails closed if a
pinned commit is no longer available; the script does not silently substitute a
branch head.

## Protocol for a future measured A/B study

The static corpus is useful input discovery, but it is not sufficient for a
claim about agent effectiveness. A measured follow-up should use this separate
protocol:

1. **Use provider-aligned context.** Test `CLAUDE.md` with a Claude Code adapter
   and `AGENTS.md` with an adapter documented to load it. Do not assume one
   provider loads another provider's file.
2. **Build leak-free tasks.** Select small historical fixes, then reconstruct a
   parentless scratch snapshot that contains the failing implementation and the
   regression test but not the historical fix or its commit metadata. Rewrite
   prompts as neutral bug reports; do not pass target SHAs or revealing commit
   subjects to the agent.
3. **Verify before model calls.** The exact success command must fail at the
   broken snapshot and pass after the historical patch. Protect the regression
   test with a clean-diff check so an agent cannot pass by weakening tests.
4. **Isolate only the treatment.** Preserve skills, fixtures, and instruction
   files that are application data. The `none`, `current`, and candidate
   snapshots must differ only in context the tested provider actually loads.
5. **Repeat and randomize.** Use at least three repositories, three verified
   tasks per repository, three conditions, and three repetitions per cell.
   Randomize condition order and run every cell in a fresh worktree. A five-repo
   version is 135 model runs, so cost and elapsed time should be budgeted before
   launch.
6. **Pin and retain evidence.** Record model ID, agent CLI version, date,
   permissions, timeout, success command, provider-reported tokens and cost,
   wall time, edited files, exit status, and sanitized raw transcripts.
7. **Report uncertainty.** Task success is the primary outcome. Report counts
   and per-task paired results plus median/IQR for time and tokens. With a small
   sample, label reversals and inconclusive results instead of promoting a point
   estimate as a stable percentage improvement.

No corpus-wide measured result is published yet because those verified,
leak-free fixtures and repeated model calls have not been completed. Publishing
the static scan now, while reserving outcome claims for the protocol above,
keeps reproducible observations separate from hypotheses. The earlier
[Claude Code case study](claude-sonnet-2026-07.md) remains a distinct,
four-task experiment with its own limitations; it is not part of this corpus.
