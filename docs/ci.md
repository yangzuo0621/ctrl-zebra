# CI Constraints

This document defines the continuous integration constraints established by T0004 and required by subsequent tasks. CI verifies commands that already exist locally; it does not publish or deploy artifacts.

## Runtime and Triggers

- CI runs on a GitHub-hosted Ubuntu runner.
- The Node.js major version is pinned to 24.
- The root `package.json` `packageManager` field is the single source of truth for the pnpm version, currently `pnpm@11.11.0`.
- The workflow runs for pushes to `main` and pull requests whose target branch is `main`.
- Only the latest run for the same workflow and branch or pull request remains active; a newer run cancels an unfinished older run.
- Each job has a 15-minute `timeout-minutes` limit. A timeout is reported as a failure and must not be hidden by increasing the limit arbitrarily.

## Installation and Caching

- Dependency installation must explicitly run `pnpm install --frozen-lockfile`.
- CI must fail instead of rewriting the lockfile when it is missing, is out of sync with package manifests, or was written by an incompatible newer pnpm version.
- Only the pnpm store is cached, and the cache key must include `pnpm-lock.yaml`.
- `node_modules`, build output, coverage, test output, and other reproducible files are not cached.
- Caching is only an optimization. A cache miss or restore failure must not change validation results.

## Permissions and Supply Chain

- Workflow `GITHUB_TOKEN` permissions are limited to `contents: read`. Additional permissions require a prior update to this document that explains why the current task needs them.
- Every `uses:` reference must be pinned to a full 40-character commit SHA, with the corresponding stable version tag recorded in an inline comment. Mutable tags and branches are prohibited.
- Before adding another third-party action, verify its maintenance status, source, and required permissions.
- CI must not read, pass, or depend on repository, environment, or organization secrets.
- Using `pull_request_target` to execute pull request code is prohibited.
- CI must not publish packages, push commits, create tags, modify pull requests, or write repository contents.

## Validation Commands

CI runs the following commands in order and stops when any command fails:

1. `pnpm install --frozen-lockfile`
2. `pnpm check`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm build`

Use the project-pinned pnpm version for equivalent local validation:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```
