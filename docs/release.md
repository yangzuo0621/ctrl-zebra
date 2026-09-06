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

[CI Constraints](ci.md#validation-matrix) owns validation policy. The
[official packaging command](../apps/extension/scripts/package-vsix.mjs) runs the release-required
formatting, type, unit/integration, and build checks; it does not duplicate CI-only coverage.
Install dependencies with `pnpm install --frozen-lockfile` before running it.

## Version and changelog

The extension manifest, lockfile importer, and changelog must describe the same release version.
The matching tag, when used, is exactly `v<extension-version>`. A tagged release must contain a
version-specific changelog section with release notes. An unreleased branch must contain the
`Unreleased` section and must not be treated as publication authorization.

## Reproducible packaging

Run `pnpm package:vsix` for the official artifact, then `pnpm release:verify -- --artifact <path>`
when auditing a retained VSIX. Reproducibility, provenance, and verification rules are owned by
[Packaging](packaging.md#release-provenance-and-dependency-audit).

## VSIX contents

The artifact must satisfy the [package boundary](packaging.md#package-boundary),
[forbidden-content policy](packaging.md#forbidden-content), and [size limits](packaging.md#size-limits).

## SBOM and license audit

Apply the [dependency and license audit](packaging.md#release-provenance-and-dependency-audit).
Retain the inventory, SBOM, and VSIX provenance with the artifact. Dependency/license changes require
an intentional `pnpm release:update-audit` and review of the resulting declarations.

## Smoke testing

Run the [packaged-artifact smoke command](packaging.md#repository-commands) against the exact VSIX
in isolated profiles. It must not upload user data, credentials, conversations, logs, or workspace content.

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
