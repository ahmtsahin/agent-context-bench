# Release checklist

Releases are tag-driven. A `vX.Y.Z` tag starts
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which
verifies source and generated files, packs the exact checkout, publishes to npm
with provenance, and creates or updates the matching GitHub Release.

Project dependencies and tests run only in the unprivileged verification job.
The OIDC-enabled job downloads that job's artifact through a pinned Action,
validates it, and publishes the tarball with package scripts disabled.

Publishing, moving the floating Action tag, and changing repository settings
are maintainer-only external actions. They are deliberately separate from
normal code changes.

## One-time repository setup

1. Configure npm trusted publishing for package `agent-context-bench` with
   GitHub owner `ahmtsahin`, repository `agent-context-bench`, workflow filename
   `release.yml` (the filename, not a path), and environment `npm`.
2. Set the trusted publisher's allowed action to `npm publish` (required for
   newly configured publishers since 2026-05-20).
3. Protect the GitHub `npm` environment if release approval is desired.
4. Confirm Actions can create releases and request an OIDC identity token.
5. Protect the GitHub `action-major-tag` environment. It gates the separate
   workflow that moves the mutable `v1` Action tag.
6. Upload [`docs/img/social-preview.png`](img/social-preview.png) under
   **GitHub Settings → General → Social preview**. This is a one-time discovery
   setting, not part of the package artifact.
7. Keep the repository About description and topics aligned with the package
   (`agents-md`, `claude-code`, `codex`, `cursor`, `ai-coding-agents`,
   `context-engineering`, `benchmark`, and `linter`).
8. After the first healthy versioned release, edit that release from the
   `action.yml` Marketplace banner, select **Publish this Action to the GitHub
   Marketplace**, accept the developer agreement, and choose accurate CI/code
   quality categories. Marketplace publication is a manual GitHub UI action;
   the release workflow cannot accept the agreement or choose categories.

The workflow does not require a long-lived `NPM_TOKEN`. Keep trusted-publisher
scope restricted to this repository and workflow. Trusted publishing requires
npm 11.5.1 or newer and Node.js 22.14 or newer; the workflow uses Node.js 24.
Trusted publishing generates provenance automatically, and the workflow also
passes `--provenance` explicitly so that intent remains visible in review.

## Prepare a release

1. Start from a clean checkout of the commit intended for release.
2. Update `package.json` and `package-lock.json` to the same semantic version.
3. Add user-facing changes to [`CHANGELOG.md`](../CHANGELOG.md).
4. Rebuild and commit `dist/` whenever source changed.
5. Run the same checks as release verification:

   ```bash
   npm ci
   npm run check
   git diff --exit-code
   git status --porcelain --untracked-files=all
   npm pack --dry-run --ignore-scripts
   ```

   The `git status` command must print nothing.

6. Let the full CI matrix and local Action/package smoke jobs pass on the
   release commit.
7. Review the tarball file list. It should contain only the declared public
   package files and no local reports, credentials, benchmark history, or
   personal paths.

Do not reuse a published version. If that version already exists, the workflow
compares npm's `dist.integrity` with the exact local tarball's SHA-512 SRI. It
skips publication only when they match; a mismatch fails before a GitHub Release
is created.

## Publish

Create the immutable version tag only after the release commit has passed CI:

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

The workflow checks that the tag matches `package.json`, runs the test suite,
requires the entire release worktree to remain clean, packs once with lifecycle
scripts disabled, publishes that tarball with npm provenance, and attaches the
same tarball to the GitHub Release. A tag/package mismatch stops before
publication.

Watch the Release workflow through completion. Do not promote the floating
Action tag while npm or the GitHub Release is only partially complete.

## Verify the published release

From a directory outside the source checkout:

```bash
npx --yes agent-context-bench@X.Y.Z --version
npx --yes agent-context-bench@X.Y.Z --help
npm view agent-context-bench@X.Y.Z version dist.integrity
```

Also verify:

- the GitHub Release points at the intended commit;
- the attached tarball matches the release workflow artifact;
- npm displays provenance for the version;
- importing `analyzeRepo` from a clean install succeeds;
- `ahmtsahin/agent-context-bench@vX.Y.Z` passes a small Action smoke run.

## Promote the floating Action major

`v1` is a mutable convenience tag for Action consumers; `vX.Y.Z` remains the
immutable release record. Promote `v1` only after the versioned Action smoke
test passes and the release is healthy.

Run **Actions → Promote Action major tag → Run workflow**, enter the immutable
`vX.Y.Z` release tag, and approve the `action-major-tag` environment. The
manual [promotion workflow](../.github/workflows/promote-action.yml):

- checks the input is a semantic version matching `package.json`;
- requires the immutable tag and its GitHub Release to exist;
- installs cleanly, runs the full checks, and verifies committed `dist/`;
- resolves the release commit and moves only `refs/tags/v1` to it.

The environment approval makes the force-update explicit and reviewable. Never
force-move a version tag. Record the promoted version in the release notes so
Action users can audit what `v1` referenced.

## If a release is bad

- Stop `v1` promotion, or move `v1` back to the last verified Action release.
- Prefer a patch release over deleting or rewriting an immutable version tag.
- Deprecate a broken npm version with a clear replacement when necessary.
- Document impact and recovery in the GitHub Release and changelog.
- Revoke trusted-publisher access only if the publishing path itself may be
  compromised.

Never publish from an uncommitted worktree or hand-built directory. The tag,
GitHub Release, npm provenance, package metadata, and checked-in `dist/` should
all identify the same source revision.
