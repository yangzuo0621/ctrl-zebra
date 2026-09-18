# Changelog

All notable changes to CtrlZebra are documented here. The repository uses an `Unreleased` section
for work that has not been published as a release; its presence does not authorize version changes,
tags, or Marketplace publication.

## [Unreleased]

### Pending

- No changes yet.

## [0.3.1] - 2026-09-18

This is a preview release. Install it through VS Code's **Switch to Pre-Release Version** action or
from the attached VSIX to evaluate the current product before the next stable line.

### Added

- Added controlled MCP server lifecycle, Tool, Resource, and Prompt support, including modern and
  legacy stdio negotiation, schema isolation, approvals, diagnostics, and accessible Webview flows.
- Added multi-turn Sessions with continuation, regeneration, editable history, deletion, retention,
  token accounting, context-overflow recovery, and safe persistence recovery.
- Added Provider onboarding for Gemini, OpenAI, and OpenAI-compatible endpoints, including model
  selection, credential lifecycle, connection checks, retry handling, and reasoning summaries.
- Added bounded editor and selection context, diagnostics, workspace file references, symbol and
  reference lookup, and controlled regex search.
- Added reviewable file creation, deletion, rename, single-file edit, and atomic multi-file edit
  workflows with workspace confinement and checkpoint restoration.
- Added run token budgets, redacted diagnostics export, local-data clearing, Marketplace assets,
  reproducible VSIX verification, SBOM generation, and packaged-artifact smoke testing.

### Changed

- Upgraded the development and runtime baseline to Node.js 24, TypeScript 7, and VS Code 1.125.
- Consolidated shared validation, text, path, schema, and controller primitives while preserving the
  existing package boundaries and public contracts.
- The release line now uses odd minor versions for Marketplace previews and even minor versions for
  stable releases; preview VSIX files are marked during packaging and independently verified.

### Fixed

- Fixed Windows drive-letter workspace validation and bounded file delete/rename reads.
- Honored Provider `Retry-After` guidance and added jittered retry backoff.
- Fixed Markdown thematic breaks and table alignment, assistant message styling, and session recovery
  error semantics.

### Documentation

- Added repository governance, dependency update policy, architecture fitness checks, performance
  baselines, and contributor/security reporting guidance.

[Unreleased]: https://github.com/yangzuo0621/ctrl-zebra/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/yangzuo0621/ctrl-zebra/compare/v0.1.1...v0.3.1
