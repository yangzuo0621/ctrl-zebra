# Contributing to CtrlZebra

Thanks for helping improve CtrlZebra. It is a local-first desktop VS Code Extension, and
contributions should preserve the product scope and the security, persistence, protocol, packaging,
and release rules documented in this repository.

## Before opening an issue or pull request

- Use the Bug report or Feature request form for ordinary product and documentation work.
- Do not disclose API keys, access tokens, authorization headers, private source, prompts, workspace
  contents, raw logs, or other sensitive data in an issue, pull request, fixture, or screenshot.
- Report suspected vulnerabilities privately through the [Security Policy](SECURITY.md). Do not use a
  public issue for a security report.
- Check the existing [README](README.md), [product and domain documentation](docs/), and open issues
  before starting duplicate work.

## Local development

Use Node.js 22 or later and pnpm 11. From the repository root:

```text
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test
pnpm test:docs
pnpm build
```

The documentation check validates repository links, governance-template fields, the private
security-reporting path, and the cross-document references used by this workflow. Keep checks
deterministic and offline; do not use real provider credentials, network services, or user data.

The [development guidelines](docs/development.md) define formatting, dependency, reuse, and
boundary rules. The [testing guidelines](docs/testing.md) define test layers, fakes, isolation,
cancellation, and cleanup requirements.

## Scope and changes

Work on one Issue/PR or one standalone maintenance change at a time. Preserve existing public
contracts and authoritative owner documents. A change to architecture, security boundaries,
persistence, protocol, release policy, or product scope needs documented change control before
implementation.

Keep changes focused, explain the user or maintainer value, and update the owning documentation when
a durable rule changes. Do not add dependencies, CI jobs, publishing behavior, telemetry, or
automatic release behavior without an explicitly authorized task.

## Branches, commits, and pull requests

- Use a task-scoped branch such as `codex/docs-maintenance` for an Issue or maintenance change.
- Keep commits small enough to review and use an imperative summary. The pull-request template
  describes the accepted title format and the evidence expected for scope, reuse, security, and
  verification.
- Complete the [pull-request template](.github/pull_request_template.md), including the exact task or
  maintenance scope, changed contracts, checks run, unrun checks, and any caveats.
- Keep secrets and private user or workspace data out of commits, logs, fixtures, screenshots, and
  issue or pull-request descriptions.
- A pull request is not approval to publish a VSIX, create a release, or change a version. Follow the
  [release policy](docs/release.md) for release-specific gates.

## Ownership and review

The default repository owner is listed in [.github/CODEOWNERS](.github/CODEOWNERS). `AGENTS.md` and
the linked domain documents are the authoritative engineering rules; the [security contract](docs/security.md)
owns product security invariants, while this guide describes contribution workflow only. When a
change touches a domain boundary, involve the owner of that document and record the relevant
verification in the pull request.

## License

By contributing, you agree that your contribution is provided under the repository's [MIT License](LICENSE).
