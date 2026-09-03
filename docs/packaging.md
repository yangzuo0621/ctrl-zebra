# VSIX Packaging Contract

This contract applies to every CtrlZebra VSIX intended for release or release-candidate smoke
testing.

## Package boundary

The extension manifest owns one explicit `files` allowlist. The package contains only:

- the bundled Extension Host entry point;
- the production Webview bundle and its static assets;
- the extension icon and three reviewed, sanitized Marketplace screenshots;
- the extension README, MIT license, and package manifest; and
- generated build metadata containing the exact source Git commit.

The allowlist is authoritative; do not add a `.vscodeignore` alongside it. Before packaging, `vsce
ls` must be compared with the repository-owned expected-file policy. An unexpected file is a failed
package, even when it would be harmless at runtime.

Marketplace screenshots are static package media, not runtime captures. They must contain only
invented values, remain bounded PNG files, pass `pnpm test:marketplace`, and be named explicitly in
both the manifest and archive policies. Captured workspaces, conversations, Provider responses,
credentials, user-data, logs, fixtures, and caches remain forbidden even when intended as listing
evidence.

## Source maps and dependencies

Official VSIX files exclude all source maps. Local development builds may continue to generate maps,
but the package allowlist and verifier must reject `*.map` entries.

The Extension Host bundle is self-contained. Workspace packages and third-party runtime packages are
build inputs and must not be copied as `node_modules` into the VSIX. Packaging therefore invokes
`vsce` with dependency collection disabled. Development-only tools, including `@vscode/vsce`, remain
root development dependencies and never enter the extension manifest's runtime dependency graph.

Do not use `vscode:prepublish`: current `vsce` executes that hook through npm or Yarn, while this
repository requires pnpm. The repository package command owns build, verification, and `vsce`
invocation explicitly.

## Forbidden content

The verifier rejects the package if any entry contains or represents:

- source files, tests, fixtures, snapshots, coverage, caches, or `.vscode-test` state;
- source maps, lockfiles, workspace configuration, Git metadata, CI files, or build tooling;
- `.env` files, credentials, API keys, authentication material, logs, or local editor state;
- MCP fixture Servers, user or developer MCP configuration, raw MCP logs or transcripts, captured
  stderr, caches, credentials, and executable files not already reviewed as declared package media;
- `node_modules`, nested archives, or files outside the documented allowlist; or
- absolute paths, parent-directory segments, backslashes, or duplicate archive paths.

The package must also pass `vsce`'s own secret and manifest validation. No bypass flag for package
secrets or environment files is permitted.

## Size limits

The completed VSIX must be at most 5 MiB. Its uncompressed payload must be at most 10 MiB, and every
individual entry must be at most 5 MiB. The verifier computes these limits from the archive rather
than trusting console output. Exceeding a limit blocks packaging until the cause is reviewed; do not
raise a limit as a routine fix.

## Git traceability and cleanliness

An official package may start only when:

1. `git status --porcelain` is empty;
2. `HEAD` is a commit, not an uncommitted or synthetic tree;
3. the current branch has an upstream and `HEAD` is reachable from that exact upstream; and
4. the build metadata records the full `HEAD` SHA and the extension version.

In GitHub Actions, the checked-out `HEAD` must instead exactly equal the event's immutable
`GITHUB_SHA`. Only a manual `workflow_dispatch` branch or tag ref and a pushed release tag are
accepted. A pushed tag must exactly equal `v` followed by the extension manifest version; other
events and mismatched refs fail before quality checks or packaging. Local packaging continues to
require the upstream ancestry check above.

Generated bundles, metadata, and VSIX output live only in ignored build/output locations. The
packaging command rechecks that tracked files did not change. A dirty workspace, missing upstream,
unpublished commit, mismatched metadata, or changed tracked file makes the package unofficial and
must fail the official command.

## Verification and retention

The package workflow must run the repository quality gates, build production bundles, list the files
selected by `vsce`, create the VSIX at an explicit ignored path, and independently inspect the final
archive. The smoke test installs that exact artifact into an isolated VS Code extensions directory
and user-data directory.

VSIX artifacts and temporary profiles are never committed. Verification reports the artifact path,
compressed and uncompressed sizes, file list, version, and embedded source commit so a retained
artifact can be traced without relying on its filename.

The repository packaging workflow retains exactly one verified VSIX together with its SHA-256
checksum for 30 days. It may be started manually or by pushing the matching version tag. This is
artifact retention only: downloading and publishing the VSIX to the Marketplace remains a separate
manual release action.

## Repository commands

- `pnpm package:vsix` runs the official clean-worktree workflow and writes the verified artifact to
  `.artifacts/`.
- `pnpm smoke:vsix -- <path-to-vsix>` installs that exact artifact into temporary isolated VS Code
  user-data and extensions directories, activates the installed extension, opens the Agent view,
  checks loopback Provider configuration, MCP restrictions, lifecycle command registration and the
  structured log, then removes the temporary profile.
- `pnpm test:marketplace` validates the listing metadata, README links/parity, reviewed icon and
  screenshot bounds, and their exact package inclusion without contacting the Marketplace.

The repository and packaged extension declare MIT and contain identical license text. The official
command does not use `--skip-license`; `vsce` and the independent archive verifier must both observe
the packaged license.

## Release provenance and dependency audit

The package command writes deterministic metadata at `dist/package/build-metadata.json` containing
the full source commit, extension version, SHA-256 digests of `pnpm-lock.yaml` and `CHANGELOG.md`,
and a validated source ref/type. It packages the same clean commit a second time and rejects a digest
mismatch. `vsce` receives the fixed `SOURCE_DATE_EPOCH=0` value so ZIP entry timestamps and
ordering remain stable across invocations and runners. The archive is then independently checked
against the selected-file and archive allowlists.

The release audit walks the production graph reported by the pinned pnpm lockfile, excludes private
workspace packages from the third-party inventory, and requires every external package to declare a
compatible SPDX license. SPDX expressions use a bounded parser: base licenses and `WITH` exception
identifiers must be in the pinned canonical data under `release/spdx-exceptions.json`. That catalog
is sourced from the immutable SPDX License List v3.28.0 commit and records both the upstream raw-file
SHA-256 and a local catalog digest; both the source metadata and catalog contents are validated
fail-closed. Only the explicitly reviewed compatible exception subset is accepted; unknown,
compound, or incompatible exceptions are rejected. The generated inventory and deterministic SPDX-2.3
SBOM must match the repository declarations under `release/`; a license or SBOM diff is a release
failure. The audit also checks the packaged manifest against declared runtime dependencies and rejects
development caches, source maps, credentials, nested dependency trees, and executables outside the
reviewed bundle allowlist.
