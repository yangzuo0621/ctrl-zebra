# EO-004 Bounded Text Persistence

## Scope Gate

- Authorized tranche: one Extension-private bounded text storage seam and migration of the two
  Session/Checkpoint callers, with equivalent coverage before deleting copied I/O.
- Contract gate: no configuration, command, Protocol/Core contract, persisted format, dependency,
  module-boundary, atomicity, recovery, compatibility, or domain-error change.
- Handoff gate: implementation was kept for independent task-reviewer review.

## Maintenance Change

- Goal: Establish `VscodeBoundedTextStorage` and remove repeated bounded persistence I/O from the
  Session and Checkpoint adapters.
- Reason: Both adapters duplicated relative-path resolution, parent creation, bounded UTF-8
  encoding/decoding, missing-file mapping, deletion, and temporary-file rename behavior.
- Scope: Add the private seam and contract tests; migrate both adapters; preserve domain stores'
  atomic replacement, recovery, compatibility, and error ownership.
- Planned owners: `vscode-bounded-text-storage.ts`/tests, the Session and Checkpoint adapters and
  integration test, the host error classifier, and this record.
- Public-contract impact: None. Configuration, commands, Protocol/Core interfaces, persisted paths and
  JSON format, package entry points, and dependencies remain unchanged.
- Explicitly excluded: Configuration/command changes, public exports, Core storage contracts,
  persisted-format migration, dependencies, atomic/recovery semantics, checkpoint integrity/session
  compatibility changes, and unrelated refactoring.
- Build vs Buy: Deepen the Extension-private VS Code adapter. VS Code `FileSystem` owns raw operations
  but not CtrlZebra relative-path validation, bounded UTF-8 policy, missing-file normalization, or
  atomic temporary-file semantics; a library would still require this product seam.
- Reuse: The two adapters were the only equivalent runtime owners. Core `ManifestStorage`,
  `EventStorage`, and `CheckpointStorage` remain domain interfaces; callers retain their mapping.
- Verification: Focused storage/error-boundary and existing integration coverage, typechecks,
  repository check/build/integration smoke, and final diff review passed.

## Similarity Audit

`VscodeBoundedTextStorage` now owns URI path validation/resolution, parent creation, bounded UTF-8
reads/writes, append replacement, FileNotFound normalization, existence, directory reads, delete,
and configurable rename atomicity. The duplicate adapter helpers and copied I/O were removed. Session
initialization/listing, manifest validation, JSONL sequencing/limits, Checkpoint stat/list filtering,
integrity/duplicate handling, atomic non-overwrite commit, cleanup, cancellation, and caller-specific
limit labels remain local. Shared seam wiring and host-error classification are intentional reuse, not
duplicate algorithms. Future persistence consumers must use this seam; a different storage policy
requires separate ownership and compatibility review.

## Completion

- Implementation summary: Session and Checkpoint adapters delegate shared bounded I/O while retaining
  domain behavior. No configuration, command, public contract, persisted format, dependency, or module
  boundary changed.
- Verification conclusion: Storage contract/error-boundary tests, affected/full tests, coverage,
  typecheck, repository check, build, integration, and final diff review passed; VSIX packaging was
  not run because its clean-worktree policy conflicts with an uncommitted handoff.
- Similarity disposition: No active duplicate bounded persistence I/O remains; no prior adapter-local
  storage unit tests were retained as duplicates.
- PR/branch: Not created or pushed; `codex/eo-004-bounded-text-persistence` remained uncommitted
  for reviewer handoff.
