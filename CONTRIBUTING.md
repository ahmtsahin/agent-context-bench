# Contributing

Contributions are welcome: detector fixes, false-positive fixtures, benchmark
adapters, documentation, and reproducible public-repository case studies all
make the project more useful.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security-sensitive
reports belong in the [security process](SECURITY.md), not a public issue.

## Before opening an issue

- Search existing issues and the [roadmap](docs/roadmap.md).
- Include the package version (`agent-context-bench --version`), Node version,
  operating system, and the smallest sanitized context file that reproduces the
  behavior.
- For false positives, include the actual finding and why the files can or
  cannot load together.
- Never paste secrets, private repository content, full agent transcripts with
  credentials, or personal filesystem paths.

## Local development

Node.js 20 or newer and npm are required.

```bash
git clone https://github.com/ahmtsahin/agent-context-bench.git
cd agent-context-bench
npm ci
npm run check
```

Useful commands:

```bash
npm run build       # compile src/ into checked-in dist/
npm test            # run node:test regression tests
npm run check       # build, then run all tests
npm run smoke       # exercise CLI help
npm pack --dry-run  # inspect the public package file set
```

Repository map:

- `src/index.ts`: discovery, detectors, scoring/signals, report rendering.
- `src/cli.ts`: command parsing and CLI workflows.
- `src/bench.ts`: task verification, adapters, and isolated A/B runs.
- `src/dashboard.ts`: standalone dashboard rendering.
- `test/`: regression and CLI tests.
- `dist/`: generated JavaScript and declarations committed for the Action.
- `examples/measured-bench/`: scrubbed case-study fixtures and raw summaries.

## Making a code change

1. Add or update a focused regression test first when practical.
2. Keep detector changes scope-aware and test both true and false positives.
3. Preserve the distinction between static heuristic signals and measured
   benchmark outcomes. Static output must not imply causal percentage changes.
4. Run `npm run check` so `dist/` matches `src/`.
5. Verify `git diff --exit-code -- dist` succeeds after the final build.
6. Run `npm pack --dry-run` when exports, dependencies, CLI behavior, or Action
   behavior changes.

Do not hand-edit generated `dist/` without making the corresponding source
change. Do not add generated reports, local history stores, model credentials,
or personal paths to fixtures.

## Documentation changes

- Put the quick decision path in `README.md`; put full contracts in `docs/`.
- Label sample output as synthetic or abbreviated when it is not copied from a
  committed raw result.
- Keep benchmark claims paired with model, task count, repetition count,
  verification command, and limitations.
- Update `CHANGELOG.md` for user-visible behavior or schema changes.
- Check relative links and keep Markdown readable without the dashboard.

## Contributing a public-repository case study

Reproducible scorecards are especially valuable. Open an issue before a costly
run if you want feedback on task design. A useful submission includes:

```text
Repository and exact commit:
agent-context-bench version:
Node / OS:
Agent product, model, version, and adapter command:
Context conditions and exact context-file revisions:
Task source and task count:
Base-fails / target-passes verification:
Success command:
Runs per task and condition:
Usage/cost source:
Raw summary JSON path:
Known limitations:
```

Recommended flow:

```bash
agent-context-bench generate-bench <repo> \
  --verify --success "<deterministic test command>" \
  --output tasks.json

agent-context-bench run-bench <repo> \
  --agent "<trusted agent adapter>" \
  --tasks tasks.json \
  --success "<deterministic test command>" \
  --conditions none,current,optimized \
  --output results.json
```

Use a public repository and redistributable task prompts. Run agents only in a
disposable clone or the runner's isolated workspaces. Confirm the verification
command fails at each base commit, passes at its target, and rejects edits to
tests when that matters. Repeat cells when possible; do not present a single
small-sample success delta as conclusive.

Scrub usernames, absolute paths, credentials, private URLs, request IDs, and
unrelated transcript content. Preserve numeric outcomes and enough method detail
to reproduce them. A case-study pull request should include:

- a write-up under `docs/benchmarks/`;
- scrubbed raw summary JSON under a focused `examples/` directory;
- task definitions or a documented regeneration procedure;
- the adapter wrapper when its license permits redistribution;
- an honest account of failed cells and contradictory reruns.

## Pull requests

Keep each pull request focused. In its description, explain the observed
problem, the contract changed, tests added, and any compatibility or security
tradeoff. Complete the repository pull-request template and respond to review
with follow-up commits rather than hiding unrelated rewrites in generated files.

Maintainers may ask to split broad changes, add a false-positive fixture, or
repeat a benchmark claim. This protects the CLI's trust boundary and keeps
results auditable.
