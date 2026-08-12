# EO-004 Bounded Text Persistence

## Scope Gate

- Base: exact latest `origin/main` `6ef3a3b74780734e7c5bf4faffc7e43ac6e3c9db`; branch
  `codex/eo-004-bounded-text-persistence`.
- Authorized tranche: one Extension-private bounded text storage seam and migration of the two
  existing Session/Checkpoint callers, with equivalent contract coverage before deleting copied I/O.
- Contract gate: no configuration, command, Protocol/Core contract, persisted format, dependency,
  module-boundary, atomicity, recovery, compatibility, or domain-error changes.
- Handoff gate: changes remain uncommitted and unpushed for independent task-reviewer review.

## Maintenance Change

- Goal: Establish one Extension-private `VscodeBoundedTextStorage` seam and remove the repeated
  bounded persistence I/O from the Session and Checkpoint adapters.
- Reason: `vscode-session-storage.ts` and `vscode-checkpoint-storage.ts` independently resolved
  relative paths, created parent directories, encoded and bounded UTF-8 text, mapped missing files,
  deleted files, and renamed temporary files. The copies could drift in persistence safety behavior
  before the Phase 21 Session data controls add another storage consumer.
- Scope: Add the private storage seam and contract tests, migrate both adapters, delete their copied
  path/I/O implementation, and record the revalidated evidence and similarity disposition. Domain
  stores retain atomic replacement, recovery, compatibility, and domain error ownership.
- Planned files:
  - `apps/extension/src/adapters/vscode-bounded-text-storage.ts`
  - `apps/extension/src/adapters/vscode-bounded-text-storage.test.ts`
  - `apps/extension/src/adapters/vscode-file-system-error.ts`
  - `apps/extension/src/adapters/vscode-session-storage.ts`
  - `apps/extension/src/adapters/vscode-checkpoint-storage.ts`
  - `apps/extension/src/test/suite/session-storage.test.ts`
  - `docs/engineering-opportunities.md`
  - `docs/maintenance/EO-004-bounded-text-persistence.md`
- Public-contract impact: None. Configuration keys, commands, Protocol/Core interfaces, persisted
  paths and JSON format, package entry points, and dependencies remain unchanged.
- Explicitly excluded: Configuration or command changes, public exports, Core storage-contract
  changes, persisted-format migration, new dependencies, changes to atomic/recovery semantics,
  changes to checkpoint integrity or Session compatibility rules, and unrelated refactoring.
- Build vs Buy triggers: Existing equivalent host I/O in two adapters, bounded UTF-8 behavior, and
  security-sensitive relative-path handling require an explicit replacement decision and contract
  coverage.
- Build vs Buy decision and evidence: Build by deepening an Extension-private VS Code adapter. The
  VS Code `FileSystem` API already owns the underlying URI and file operations; it does not provide
  CtrlZebra's relative-path validation, bounded UTF-8 read/write policy, missing-file normalization,
  or atomic temporary-file semantics. Existing dependencies and the VS Code API expose no owning
  bounded persistence abstraction. A file-system library would add license, update, packaging,
  runtime, and adapter-boundary cost while still requiring the same product policy. The seam adds
  no dependency, network, timer, process, or cancellation lifecycle and keeps host errors private.
- Reuse Audit: Searches covered `vscode-session-storage`, `vscode-checkpoint-storage`,
  `assertPathSegment`, `Uri.joinPath`, `readFile`, `writeFile`, `TextEncoder`, `TextDecoder`,
  `FileNotFound`, `createDirectory`, `rename`, `delete`, `appendText`, `listFiles`, and
  `exists` across `apps/extension/src`, Core persistence contracts, tests, `docs/persistence.md`,
  `docs/security.md`, and `docs/development.md` on latest `origin/main` `6ef3a3b74780734e7c5bf4faffc7e43ac6e3c9db`.
  The only equivalent runtime owners were the two adapters. Core's `ManifestStorage`,
  `EventStorage`, and `CheckpointStorage` interfaces own domain operations and therefore remain
  unchanged; the existing VS Code integration suite remains the compatibility evidence. Decision:
  deepen the Extension adapter with one private seam and keep Session/Checkpoint domain mapping in
  their callers. No third equivalent implementation was found.
- Similarity Audit gate: Before migration, the two adapters contained matching path validation,
  URI resolution, parent creation, bounded text encoding/decoding, missing-file handling, delete,
  and rename logic. The replacement must have equivalent tests before the old copies are removed;
  no pass-through compatibility implementation is retained.
- Verification: Run the focused storage contract tests, affected Extension tests, full unit tests,
  Extension/workspace type checks, Biome, build, integration smoke, `git diff --check`, and final
  status/diff review. Preserve the existing Session/Checkpoint integration test as behavior-level
  compatibility coverage; no implementation-specific storage test existed before this tranche.

## Similarity Audit

- New behavior searched after migration: `VscodeBoundedTextStorage`,
  `VscodeBoundedTextFileSystem`, `assertPathSegment`, `isFileNotFound`, `readText`, `writeText`,
  `appendText`, `readDirectory`, `exists`, `rename`, `deleteFile`, `TextEncoder`, `TextDecoder`,
  and `Uri.joinPath` across both adapters, the private seam, and tests.
- Removed implementations: the duplicate `#resolve`/`#ensureParent`/`assertPathSegment` helpers,
  bounded `readFile`/`writeFile` and UTF-8 encoding/decoding, FileNotFound catches, delete calls,
  and rename calls from `vscode-session-storage.ts` and `vscode-checkpoint-storage.ts`. Their
  repeated host-operation type shapes were consolidated into the seam's private port type; the
  Session adapter keeps a narrower alias only to preserve its existing provider signature.
- Removed or reduced implementation-specific tests: no prior unit test targeted either adapter's
  copied I/O implementation. The new contract suite covers the shared behavior; the existing
  VS Code integration suite remains because it verifies repository/checkpoint compatibility through
  real VS Code storage rather than duplicating the low-level algorithm.
- Retained caller-owned behavior: Session initialization/listing, manifest JSON validation,
  JSONL append sequencing and event limits; Checkpoint stat/list filtering, integrity parsing,
  duplicate detection, atomic non-overwrite commit, cleanup, and cancellation remain in their
  owning adapters/Core stores. Caller-specific limit labels are mapped at the adapter boundary.
- Remaining similarities: Both callers instantiate the same private seam with `Uri.joinPath` and
  retain their own storage-root initialization paths. This is shared wiring and domain setup, not a
  second I/O algorithm. Checkpoint additionally requires `stat` for `exists`; Session additionally
  requires directory filtering and append semantics. These distinct operations remain intentionally
  in their owning caller. Both callers inject the same private `FileSystemError` classifier; this
  is one host error policy, not caller-local missing-file logic. The integration test proves a real
  VS Code `FileSystemError.FileNotFound` maps to absence while a plain same-code `Error` propagates.
- Disposition: No active duplicate bounded persistence I/O implementation remains in the two
  Extension callers. Future persistence consumers must use `VscodeBoundedTextStorage` rather than
  reimplementing path, byte-bound, missing-file, delete, or rename behavior; a different storage
  policy requires a separate ownership and compatibility review.

## Completion

- Implementation summary: `VscodeBoundedTextStorage` now owns Extension-private URI path
  resolution/validation, parent creation, bounded UTF-8 reads/writes, append replacement,
  FileNotFound normalization, existence checks, directory reads, delete, and configurable rename
  atomicity. Session and Checkpoint adapters delegate the shared I/O while retaining their domain
  behavior. No configuration, command, public contract, persisted format, dependency, or module
  boundary changed.
- Test results:
  - Bounded storage contract: 5 tests passed.
  - Reviewer-directed error-boundary regression: plain `Error` with `code: "FileNotFound"` is
    propagated; the VS Code integration suite validates real `FileSystemError.FileNotFound` mapping.
  - Affected Extension adapter tests: 24 files, 225 tests passed.
  - Full unit suite: 145 files, 1,726 tests passed (`pnpm run test:unit`).
  - Coverage gate passed (`pnpm run test:coverage`): statements 83.01%, branches 77.28%,
    functions 80.49%, lines 84.15%.
  - Workspace typecheck passed (`pnpm run typecheck`).
  - Biome repository check passed (`pnpm run check`, 380 files).
  - Workspace build passed (`pnpm run build`).
  - VS Code integration passed with exit code 0 (`pnpm run test:integration`); the existing harness
    emitted the non-fatal `Canceled Failed to load custom agents` warning.
  - `git diff --check` passed. Official VSIX packaging was not run because its policy requires a
    clean worktree, which is incompatible with this uncommitted maintenance handoff.
- Similarity Audit: Final search and results are recorded above after the caller migration.
- Deleted or replaced old implementations: Caller-local path/I/O helpers in
  `vscode-session-storage.ts` and `vscode-checkpoint-storage.ts`; no prior implementation-specific
  storage unit tests existed.
- Design deviation: None.
- PR/branch: Not created or pushed; branch `codex/eo-004-bounded-text-persistence` is intentionally
  uncommitted for reviewer handoff.
