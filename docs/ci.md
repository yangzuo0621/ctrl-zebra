# CI Constraints

This document defines the current continuous-integration constraints. CI verifies repository
commands and workflow policy; it does not publish or deploy artifacts. Release-candidate gates are
owned by the [Release policy](release.md), and archive contents are owned by the
[VSIX Packaging Contract](packaging.md).

## Runtime and Triggers

- Validation CI runs on a GitHub-hosted matrix of `ubuntu-latest`, `macos-latest`, and
  `windows-latest`.
- The [validation workflow](../.github/workflows/ci.yml) pins the Node.js runtime for every matrix leg.
- The root [package.json](../package.json) `packageManager` field owns the exact pnpm version.
- Validation runs for pushes to `main` and pull requests targeting `main`.
- A newer run cancels an unfinished older run for the same workflow and branch or pull request.
- Matrix strategy uses `fail-fast: false` and does not use `continue-on-error`; every OS leg reports
  its own result and a failed leg fails the workflow.
- Each validation leg has a 15-minute timeout. A timeout is a failure.

## Validation Matrix

The [validation workflow](../.github/workflows/ci.yml) owns the executable step list and order.
Every OS leg validates frozen installation, dependency-update policy, architecture gates and fixtures,
formatting/lint, types, unit tests, and the production build; it stops on failure.

Ubuntu additionally runs Extension Development Host integration tests, coverage, and the
[performance benchmark](performance.md). Host integration and benchmarking use Xvfb; coverage is
intentionally limited to one matrix leg. macOS and Windows still run the complete unit suite and
build, including platform-sensitive path, line-ending, process, and cancellation tests.

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

For local validation, use the runtime and package manager above and the commands in the
[validation workflow](../.github/workflows/ci.yml); command definitions are in
[package.json](../package.json). On Linux, Extension Development Host checks need an Xvfb display.
Use `pnpm test:docs` for document changes; [CONTRIBUTING](../CONTRIBUTING.md#local-development)
describes its tracked-file coverage. Local task-specific checks do not replace required CI gates.
