# CI Constraints

This document defines the current continuous-integration constraints. CI verifies repository
commands and workflow policy; it does not publish or deploy artifacts. Release-candidate gates are
owned by the [Release policy](release.md), and archive contents are owned by the
[VSIX Packaging Contract](packaging.md).

## Runtime and Triggers

- Validation CI runs on a GitHub-hosted matrix of `ubuntu-latest`, `macos-latest`, and
  `windows-latest`.
- The Node.js runtime is pinned to `24.19.0` for every matrix leg.
- The root `package.json` `packageManager` field is the single source of truth for the pnpm version,
  currently `pnpm@11.11.0`.
- Validation runs for pushes to `main` and pull requests targeting `main`.
- A newer run cancels an unfinished older run for the same workflow and branch or pull request.
- Matrix strategy uses `fail-fast: false` and does not use `continue-on-error`; every OS leg reports
  its own result and a failed leg fails the workflow.
- Each validation leg has a 15-minute timeout. A timeout is a failure.

## Validation Matrix

Every OS leg runs these repository-owned commands in order and stops on the first failure:

1. `pnpm install --frozen-lockfile`
2. `pnpm check`
3. `pnpm typecheck`
4. `pnpm test:unit`
5. `pnpm build`

The Ubuntu leg additionally runs `xvfb-run -a pnpm test:integration` and
`pnpm test:coverage`, because the Extension Development Host requires a display and the full
coverage gate is intentionally limited to one matrix leg. macOS and Windows still run the complete
unit suite and production build, including platform-sensitive path, line-ending, process, and
cancellation tests.

## Workflow Policy

- The VSIX packaging workflow is separate from validation CI and never publishes to the Marketplace.
- The Marketplace smoke workflow is manual-only, runs the exact selected revision on all three
  supported desktop runners, and cannot publish or modify Marketplace state.
- The release workflow is manual and verification-first; its release-candidate gates are defined in
  [Release](release.md).
- Every third-party Action is pinned to a full 40-character commit SHA with an inline version
  annotation. Mutable tags and branches are prohibited.
- Workflow `GITHUB_TOKEN` permissions are limited to `contents: read` unless an approved policy
  change documents a narrower need.
- Validation, packaging, and smoke workflows do not read or pass repository, environment, or
  organization secrets. The protected release environment is the only exception and is governed by
  [Release](release.md).
- Workflows must not publish packages, push commits, create tags, modify pull requests, or write
  repository contents. Retaining a verified artifact is allowed only in the explicitly documented
  packaging or release workflow.

## Installation and Caching

- Dependency installation must explicitly use `pnpm install --frozen-lockfile`.
- CI fails instead of rewriting a missing or out-of-sync lockfile.
- Only the pnpm store is cached, and the cache key includes `pnpm-lock.yaml`.
- `node_modules`, build output, coverage, test output, and other reproducible files are not cached.
- A cache miss or restore failure must not change validation results.

## Validation Commands

Use the project-pinned pnpm version for equivalent local validation on Windows, macOS, or Linux:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm build
```

On Ubuntu with an available Xvfb display, also run:

```bash
corepack pnpm test:integration
corepack pnpm test:coverage
```
