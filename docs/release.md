# Release

This document defines the current release policy for the desktop VS Code Extension. It describes
quality and artifact gates; it does not itself authorize a version change, tag, release creation, or
Marketplace publication.

## Preconditions

- The extension manifest version, `CHANGELOG.md` release notes, and the `pnpm-lock.yaml` importer are
  consistent.
- An official package starts from a clean, committed revision. Local packaging requires that `HEAD`
  is reachable from its upstream; GitHub Actions requires the checked-out revision to equal
  `GITHUB_SHA`.
- The release source is the protected `main` branch or the exact tag `v<extension-version>`.
- The release candidate contains no credentials, user data, workspace files, logs, fixtures, or
  unreviewed executable content.

## Quality gates

Run the repository checks before packaging:

```text
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test:unit
pnpm build
```

The validation CI Ubuntu leg also runs the Extension Development Host integration tests and
coverage. The release packaging command runs the release-required checks, integration tests, and
build; it does not duplicate the CI-only coverage report. The required checks and workflow-level
policy are maintained in [CI Constraints](ci.md).

## Version and changelog

The extension manifest, lockfile importer, and changelog must describe the same release version.
The matching tag, when used, is exactly `v<extension-version>`. A tagged release must contain a
version-specific changelog section with release notes. An unreleased branch must contain the
`Unreleased` section and must not be treated as publication authorization.

## Reproducible packaging

Run `pnpm package:vsix` to build and independently verify one VSIX. The command records the full
source commit, version, lockfile and changelog digests, and validated source reference in build
provenance, then rejects a non-deterministic repeat build. Run `pnpm release:verify -- --artifact
<path>` to audit a retained artifact and generate the dependency inventory and deterministic SBOM.

The packaging boundary, allowlist, source-map rules, size limits, traceability, and dependency audit
are owned by the [VSIX Packaging Contract](packaging.md).

## VSIX contents

The archive must contain only the reviewed extension bundle, Webview assets, package metadata,
README, license, icon, Marketplace screenshots, and generated build metadata declared by the
allowlist. It must exclude source maps, tests, caches, lockfiles, development configuration,
credentials, local state, nested dependencies, and undeclared executables.

## SBOM and license audit

The release audit compares the production dependency graph with the declared third-party inventory,
requires compatible SPDX licenses, and validates the deterministic SPDX-2.3 SBOM. The inventory,
SBOM, and VSIX provenance are retained together with the artifact. A dependency or license change
requires an intentional update through `pnpm release:update-audit` and review of the resulting
declarations.

## Smoke testing

Run `pnpm smoke:vsix -- <artifact>` against the exact VSIX in isolated VS Code user-data and
extension directories. The smoke path verifies activation, the Agent view, Provider configuration,
MCP restrictions, lifecycle command registration, and structured logging. It must not upload user
data, credentials, conversations, logs, or workspace content.

## Marketplace candidate validation

Run `pnpm test:marketplace` to validate listing metadata, README parity, reviewed media, public
links, workflow restrictions, and the exact VSIX media allowlist. The manual
`.github/workflows/marketplace-smoke.yml` workflow must pass on Ubuntu, macOS, and Windows for one
exact source revision before a candidate is considered Marketplace-ready. It uses no secrets and
cannot publish.

The retained candidate must also receive the applicable manual UI confirmation for Provider/model
labels, credential deletion, local-data clearing, and diagnostics redaction. Evidence is revision
specific and must contain only bounded metadata and stable pass labels.

## Protected publication

`.github/workflows/release.yml` is a manual, verification-first workflow. It retains the verified
VSIX, checksum, dependency inventory, SBOM, and provenance for 30 days. The optional publication
confirmation enters the protected `release` environment only after verification succeeds and
`publish=true`; that environment may confirm that its `VSCE_PAT` credential is configured.

The workflow never prints, persists, or passes the credential to build or test steps. Marketplace
publication remains a separate manual release action.

## Explicit authorization boundary

Passing checks, retaining an artifact, creating a tag, or opening a pull request does not authorize
publication. Version changes, tags, GitHub Releases, Marketplace publication, and release
credentials require separate maintainer authorization through the protected release process.
