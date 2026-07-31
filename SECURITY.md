# Security policy

## Supported versions

Security fixes target the latest published npm release and the current `main`
branch. Users should upgrade to the newest release before reporting behavior
that may already be fixed.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting page when available:

<https://github.com/ahmtsahin/agent-context-bench/security/advisories/new>

Include:

- affected version and platform;
- the smallest safe reproduction;
- expected and observed behavior;
- impact and required attacker capabilities;
- whether the issue has been disclosed elsewhere;
- a suggested fix, if known.

Do not open a public issue with exploit details, secrets, private repository
content, or an unpublished advisory. If private reporting is unavailable, open
a minimal public issue asking the maintainer for a private contact channel and
omit all sensitive details.

The project will acknowledge the report, investigate impact, coordinate a fix
and release, and credit the reporter when requested and appropriate. No fixed
response deadline is promised by this volunteer-maintained project.

## Security boundaries

The plain audit reads repository files and git/package metadata. It does not
call a model. Some explicit workflows execute local commands:

- `generate-bench --verify` runs the supplied success command in temporary git
  worktrees.
- `run-bench` runs both the supplied agent command and success command for each
  task/condition.
- command adapters without placeholders use the platform shell.

Treat `--agent`, `--success`, task files, config files, and analyzed repositories
as untrusted until reviewed. Run benchmarks in disposable clones or isolated CI
workers with least-privilege credentials and no production secrets.

The generated `AGENTS.md` file is a candidate, not a policy authority. Review it
before adoption. A linter false positive, score disagreement, or weak generated
wording is normally a product bug rather than a security vulnerability unless
it creates a concrete execution, disclosure, or supply-chain risk.

## Handling artifacts

- Scrub absolute paths, usernames, tokens, private URLs, and transcript content
  before committing benchmark results.
- Do not include `.env`, credentials, model keys, local history databases, or
  package-manager auth files in reports or fixtures.
- Prefer immutable version tags and verify npm provenance before installing in
  sensitive automation.
- Pin the Action to an immutable release tag or commit where your threat model
  requires it; `v1` is intentionally a mutable compatibility tag.

Please allow maintainers reasonable time to publish a fix before public
disclosure.
