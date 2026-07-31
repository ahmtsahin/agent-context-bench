# GitHub Action

The composite Action runs the checked-in CLI bundle, writes a Markdown report
to the job summary, and can expose a reviewable context candidate. It does not
commit or push files.

## Basic pull-request audit

```yaml
name: Agent context

on:
  pull_request:

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
      - id: context
        uses: ahmtsahin/agent-context-bench@v1
        with:
          path: "."
          fail-under: "70"
          write-optimized: "true"
          comment: "true"
```

Use an immutable `vX.Y.Z` tag or full commit SHA instead of `v1` when your
supply-chain policy does not allow floating tags.

## Inputs

| Input | Default | Behavior |
| --- | --- | --- |
| `path` | `.` | Repository path to audit |
| `fail-under` | `0` | Positive Operational Score gate; `0` never fails, including not-configured repositories |
| `write-optimized` | `false` | With `true`, writes `AGENTS.optimized.md` as a review candidate |
| `comment` | `false` | With `true` on `pull_request`, creates or updates this Action's marked comment |

`write-optimized` is a boolean string and accepts only `true` or `false`.

## Outputs

| Output | Value |
| --- | --- |
| `report-file` | Relative path to `agent-context-bench-report.md` |
| `optimized-file` | Relative candidate path, or an empty string when generation is disabled |
| `optimized-generated` | String boolean indicating whether the candidate exists |

Upload the files for review:

```yaml
      - name: Upload context audit
        if: ${{ always() }}
        uses: actions/upload-artifact@v7
        with:
          name: agent-context-bench
          path: |
            ${{ steps.context.outputs.report-file }}
            ${{ steps.context.outputs.optimized-file }}
          if-no-files-found: warn
```

Or show a non-blocking candidate diff without interpolating an output directly
into the shell script:

```yaml
      - name: Preview candidate diff
        if: ${{ steps.context.outputs.optimized-generated == 'true' }}
        shell: bash
        env:
          CANDIDATE_FILE: ${{ steps.context.outputs.optimized-file }}
        run: |
          if [ -f AGENTS.md ]; then
            diff -u AGENTS.md "$CANDIDATE_FILE" || true
          else
            sed -n '1,200p' "$CANDIDATE_FILE"
          fi
```

## Pull-request comments

Commenting requires `pull-requests: write`. The Action adds a hidden marker and
updates only the previous comment carrying that marker; it does not use the
generic “last bot comment.” If the token is read-only, as it commonly is for a
fork pull request, comment creation becomes a warning and the job summary
remains available.

For workflows that do not need comments, leave `comment: "false"` and grant only
`contents: read`.

## Failure behavior

- A score below a positive `fail-under` value fails the Action after writing the
  report and outputs.
- A not-configured repository passes with the default gate `0` and is clearly
  labeled **Not configured**; it fails a positive gate.
- Invalid boolean input or a CLI/runtime error fails the Action.
- PR-comment permission failures do not hide or fail an otherwise valid audit.

The Action receives input expressions through environment variables and quotes
path/gate arguments. Caller workflows should still avoid mapping untrusted event
text into executable workflow fields.
