# VSIX Packaging Contract

This contract is the T1004 constraint gate. It applies to every CtrlZebra VSIX intended for release
or release-candidate smoke testing.

## Package boundary

The extension manifest owns one explicit `files` allowlist. The package contains only:

- the bundled Extension Host entry point;
- the production Webview bundle and its static assets;
- the extension icon and other declared media;
- the extension README, MIT license, and package manifest; and
- generated build metadata containing the exact source Git commit.

The allowlist is authoritative; do not add a `.vscodeignore` alongside it. Before packaging, `vsce
ls` must be compared with the repository-owned expected-file policy. An unexpected file is a failed
package, even when it would be harmless at runtime.

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
  checks its structured log, and removes the temporary profile.

The repository and packaged extension declare MIT and contain identical license text. The official
command does not use `--skip-license`; `vsce` and the independent archive verifier must both observe
the packaged license.
