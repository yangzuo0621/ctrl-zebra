# CI Constraints

This document defines the continuous integration constraints established by T0004 and required by subsequent tasks. The validation workflow verifies commands that already exist locally; it does not publish or deploy artifacts. A separate packaging workflow may retain a verified VSIX for manual release, subject to the constraints below.

## Runtime and Triggers

- Validation CI runs on a controlled GitHub-hosted matrix of `ubuntu-latest`, `macos-latest`, and
  `windows-latest`.
- The Node.js runtime is pinned to `24.19.0` for every matrix leg.
- The first T1503 PR attempt requested the nonexistent `24.13.3`; Actions run
  `31316305029` failed during `Set up Node.js` on all three legs because the official
  `actions/node-versions` manifest had no matching release or platform archive. The manifest and
  Node release index list `24.19.0` as the current stable Node 24 release with Linux x64, macOS
  arm64, and Windows x64 archives. Corrected run `31316592340` passed setup, installation,
  checks, typecheck, unit tests, and build on all three legs; Ubuntu also passed integration and
  coverage, while macOS and Windows explicitly skipped those Ubuntu-only steps.
- The root `package.json` `packageManager` field is the single source of truth for the pnpm version, currently `pnpm@11.11.0`.
- The workflow runs for pushes to `main` and pull requests whose target branch is `main`.
- Only the latest run for the same workflow and branch or pull request remains active; a newer run cancels an unfinished older run.
- Matrix strategy uses `fail-fast: false` and does not set `continue-on-error`: every OS leg reports its own result, and any failed leg fails the workflow without cancelling the other legs. A skipped conditional step is an explicit matrix policy, not failure suppression.
- Each matrix leg has a 15-minute `timeout-minutes` limit. A timeout is reported as a failure and must not be hidden by increasing the limit arbitrarily.

## Validation Matrix

Every OS leg runs the repository-owned commands in this order and stops on the first failure:

1. `pnpm install --frozen-lockfile`
2. `pnpm check`
3. `pnpm typecheck`
4. `pnpm test:unit`
5. `pnpm build`

The Ubuntu leg additionally runs:

- `xvfb-run -a pnpm test:integration`, because the Extension Development Host requires a display and
  the existing harness/package workflow is already verified on the Linux/Xvfb path;
- `pnpm test:coverage`, retaining the single T1502 coverage gate without tripling the same unit-only
  report across the matrix.

macOS and Windows still execute the complete node/jsdom unit suite and production build. Those tests
provide the minimum real-runner evidence for platform-sensitive behavior already owned by the code:

- Windows drive/UNC, case, and separator rules in `workspace-scope.test.ts`, plus Windows environment
  and filesystem-path handling in `workspace-command-executor.test.ts`;
- CRLF and mixed line-ending behavior in `diff-presenter.test.ts` and `tool-output-limiter.test.ts`;
- child-process streaming, cancellation, process-tree termination, Windows `taskkill`, and POSIX
  (including `darwin`) branches in `spawn-command-runner.test.ts` and `mcp-stdio-port.test.ts`.

The skipped integration and coverage steps on macOS/Windows are visible in the matrix UI and do not
make those jobs successful when another step fails. The expensive VS Code/Electron integration path
is intentionally limited to Ubuntu; `package-vsix.yml` remains a separate Ubuntu-only artifact
workflow.

## VSIX Packaging Workflow

- `.github/workflows/package-vsix.yml` is separate from validation CI and never publishes to the
  Visual Studio Marketplace.
- Maintainers may run it manually with `workflow_dispatch`. A pushed version tag also runs it, but
  the tag must exactly equal `v` followed by the extension manifest version.
- The workflow checks out the selected GitHub ref, runs the repository-owned `pnpm package:vsix`
  command under `xvfb-run`, and requires exactly one resulting VSIX.
- The exact VSIX and a `SHA256SUMS` file are retained together as one GitHub Actions artifact for 30
  days. The workflow summary records the source commit, VSIX checksum, artifact archive digest, and
  download URL.
- The packaging workflow has `contents: read` permission, does not use secrets, and does not modify
  repository contents, versions, commits, tags, releases, or Marketplace state.
- Packaging jobs have a 20-minute limit and do not cancel another packaging run for the same ref.

## Marketplace Smoke Workflow

- `.github/workflows/marketplace-smoke.yml` is manual-only and runs the exact selected revision on
  `ubuntu-latest`, `macos-latest`, and `windows-latest` with `fail-fast: false`.
- Every leg validates listing metadata/assets, runs the official clean-worktree package command with
  the deterministic Marketplace integration enabled, and installs/smokes that exact VSIX in an
  isolated profile. Linux uses Xvfb; macOS and Windows use their native desktop runners.
- The deterministic integration uses a bounded loopback OpenAI-compatible Server without a key. It
  covers Provider selection, `list_files`, `read_file`, and Session continuation without external
  network or cloud dependencies. The installed harness separately checks activation, Provider
  metadata connection, MCP configuration rejection/disconnect, lifecycle command registration,
  Agent view display, and structured logs.
- The full unit suite remains part of `pnpm package:vsix`, so deletion, local-data clear, diagnostics
  export, redaction, cancellation, and save-port contracts run on each matrix leg.
- Each leg retains only a bounded JSON evidence file for 30 days. It contains the task, exact source
  commit, runner OS, stable pass labels, and a false private-state marker; it excludes the temporary
  profile, logs, fixtures, caches, workspace data, Provider content, conversations, and credentials.
- The workflow has `contents: read`, uses no secrets, and cannot publish, tag, release, push, or
  modify Marketplace state. See `docs/marketplace-smoke.md` for the evidence map and required
  release-candidate UI confirmation.

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
- CI validation and packaging jobs must not read, pass, or depend on repository, environment, or
  organization secrets. The only narrow exception is the manual release workflow's protected
  `release` environment gate after verification succeeds and `publish=true`: that gate may read
  exactly the `VSCE_PAT` credential from that environment's CI secret store, only to confirm it is
  configured. It must not expose, persist, or pass the credential to build/test steps, and this
  exception grants no access to repository or organization secrets.
- Using `pull_request_target` to execute pull request code is prohibited.
- Workflows must not publish packages to an external registry or Marketplace, push commits, create
  tags, modify pull requests, or write repository contents. Retaining the verified VSIX as a GitHub
  Actions build artifact is allowed only through the packaging workflow described above.

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

## T2206 reproducible release verification

`.github/workflows/release.yml` is a manual, verification-first workflow. It accepts the protected
`main` branch or the exact `v<extension-version>` tag, checks the manifest/CHANGELOG/lockfile and
release checklist, packages the VSIX twice, and fails if the two SHA-256 digests differ. A branch
verification also fails when the matching release tag already exists. It retains
the verified VSIX, checksum, third-party license inventory, and deterministic SPDX-2.3 SBOM as one
artifact. The workflow is not a tag or version creator.

The `publish` input defaults to `false`. Only an explicit `true` input can enter the protected
`release` environment, where a maintainer may configure Marketplace trusted publishing or a
`VSCE_PAT` secret. The workflow never prints, writes, or persists that credential. A cancelled run
is rejected before the credential gate, and missing credentials, a duplicate tag, a wrong branch,
or a version-tag mismatch fail closed.

`pnpm release:verify -- --artifact <path>` is the local/CI audit command. It compares generated
third-party packages and licenses with `release/third-party-dependencies.json` and
`release/sbom.spdx.json`, then independently inspects the VSIX archive for allowlist violations,
development caches, source maps, credentials, and undeclared executables. Update those declarations
only through `pnpm release:update-audit` after an intentionally reviewed dependency change.
