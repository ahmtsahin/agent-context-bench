# Roadmap

This is a direction-of-travel document, not a release promise. Priorities are
shaped by reproducible false positives, public-repository benchmarks, and
[GitHub issues](https://github.com/ahmtsahin/agent-context-bench/issues).

## Now: make the evidence trustworthy

- Stabilize the pre-1.0 API and JSON schema around nullable not-configured
  scores and categorical static heuristic signals.
- Expand detector regression fixtures, especially scope interactions and
  realistic false-positive cases.
- Keep the checked-in Action bundle, npm tarball, Windows, and supported Node
  versions covered by clean-install smoke tests.
- Publish reproducible public-repository scorecards with repeated conditions,
  verified tasks, scrubbed raw JSON, and explicit limitations. See the
  [case-study contribution template](../CONTRIBUTING.md#contributing-a-public-repository-case-study).

## Next: make benchmarking easier

- Add maintained adapters or presets for common agent CLIs on top of the generic
  command-adapter contract.
- Parse structured token and cost usage from supported agent outputs instead of
  relying only on an optional `TOKENS=` line.
- Add repeated-run summaries and variability reporting so small stochastic
  differences are harder to overinterpret.
- Add history trends to the standalone dashboard without turning local audit
  into a hosted telemetry service.

## Explore

- More agent-specific loading models for nested instructions and deferred
  skills.
- Safer automatic minimization experiments that preserve repository-specific
  commands, generated-file rules, and ownership boundaries.
- Shareable, reproducible comparison bundles that keep private paths and
  transcripts out of public artifacts.

## Completed

The shipped feature history lives in [CHANGELOG.md](../CHANGELOG.md), including
scope-aware conflict detection, skill metadata validation, baselines, exact
token opt-in, the A/B runner, verified history-mined tasks, run history,
gold-context metrics, dashboards, and the measured Claude Code case study.

Have a concrete use case? Open an issue with the repository shape, agent, and
decision you need the tool to support. Evidence-backed requests are easier to
prioritize than broad feature lists.
