# EO-003 IDE Source Projection

## Maintenance Change

- Goal: Establish one Extension-private `IdeSourceProjector` for IDE URI identity, workspace-relative
  paths, UTF-16 positions/ranges, deterministic ordering, and bounded Unicode/UTF-8 text projection.
- Reason: `vscode-diagnostics.ts`, `vscode-language-services.ts`, and `vscode-editor-context.ts`
  each carried substantially equivalent projection algorithms. Independent fixes could otherwise
  change stale checks, path containment, ordering, or truncation behavior in only one IDE path.
- Scope: Add the projector and its contract tests, migrate the three adapters, delete their superseded
  projection algorithms, and record the maintenance evidence in this document and the engineering
  opportunities ledger.
- Planned files:
  - `apps/extension/src/adapters/ide-source-projector.ts`
  - `apps/extension/src/adapters/ide-source-projector.test.ts`
  - `apps/extension/src/adapters/vscode-diagnostics.ts`
  - `apps/extension/src/adapters/vscode-language-services.ts`
  - `apps/extension/src/adapters/vscode-editor-context.ts`
  - `docs/engineering-opportunities.md`
  - `docs/maintenance/EO-003-ide-source-projection.md`
- Public-contract impact: None. Protocol DTOs, schemas, package entry points, configuration, commands,
  persisted data, and user-visible behavior remain unchanged.
- Explicitly excluded: Provider policy/EO-001 work, new package exports, repository-wide text utilities,
  dependency changes, configuration or command changes, persistence changes, and unrelated refactoring.
- Build vs Buy triggers: Three equivalent Extension-private implementations crossed the reuse threshold;
  the seam owns product-specific URI/path security, UTF-16 boundary validation, deterministic ordering,
  and truncation reasons. A general-purpose dependency would not own those semantics.
- Build vs Buy decision and evidence: Build by deepening an Extension-private adapter module. VS Code's
  URI and document APIs remain the source of host data, while standard JavaScript Unicode facilities
  (`String.prototype.isWellFormed`, code-point iteration primitives) do not provide the product's
  workspace identity/containment, bounded UTF-8 projection, or truncation-reason ordering. Existing
  dependencies expose no owner for this host boundary; adding one would add license, update, VSIX,
  runtime, and failure-mapping cost without removing the policy seam. The projector is synchronous,
  has no I/O or lifecycle, and keeps its error private; each caller retains its existing adapter error
  mapping and DTO/diagnostic composition.
- Reuse Audit: On the initial exact `origin/main` `0ce670c48beb623128f9a9a5231a60c0e2aa26be`, searched
  `sameUri`, `toWorkspaceRelativePath`, `pathSegments`, `isInsideSurrogate`, `readCodePoint`,
  `countCodePoints`, `utf8ByteLength`, `comparePositions`, `compareStrings`, `orderedReasons`,
  and bounded-text helpers under `apps/extension/src/adapters` and tests. After the requested rebase,
  the same search was revalidated against latest `origin/main` `ec33eeb01aea5c2ceb8e6917ef5887147a25ed26`;
  EO-002 changes do not add another owner for this IDE projection seam. The three adapter-local
  implementations were the only equivalent runtime owners. Existing Protocol limits and DTO types,
  VS Code `Uri`/`TextDocument` APIs, and the prior adapter tests were reused. `WorkspaceScope` was
  considered but deliberately not reused: its canonical containment policy has configurable path
  case-sensitivity, permits root equality, and reports `WorkspaceScopeError` codes rather than a
  non-empty relative projection. No package-level utility or new dependency was available. Decision:
  deepen the Extension adapter seam, keep error mapping in each caller, and do not create a
  repository-wide helper. No third equivalent implementation was found after migration.
- Verification: Contract tests are added before caller migration and cover normal, boundary, and
  invalid input. Run the focused projector/adapter tests, Extension typecheck, repository checks, full
  unit tests, build/integration smoke checks, `git diff --check`, and final status/diff review.

## Similarity Audit

- New behavior searched after migration: `ideSourceProjector`, `IdeSourceProjectionError`,
  `sameUri`, `toWorkspaceRelativePath`, `validateDocumentPosition`, `takeBoundedText`,
  `countCodePoints`, `utf8ByteLength`, `comparePositions`, `compareStrings`, and
  `orderedReasons` across the three adapters and Extension tests.
- Removed implementations: adapter-local URI identity and path segment/containment algorithms;
  surrogate and code-point readers; UTF-8 byte counters; bounded text loops and reason ordering;
  position/range/string comparator implementations. The implementation-specific logic now lives in
  `ide-source-projector.ts` and its contract suite.
- Retained caller-owned behavior: VS Code document/editor/provider source collection, diagnostic and
  language-service normalization, candidate/symbol sort-key composition, editor selection/chunking,
  aggregate budgets, and conversion of `IdeSourceProjectionError` to each adapter's existing stable
  error. Thin wrappers are error-boundary mappings, not alternate projection algorithms.
- Remaining adjacent similarities: `apps/extension/src/adapters/workspace-scope.ts` still owns
  `sameIdentityPart`/path-segment containment because it has different semantics (configurable
  case-sensitive canonical workspace containment, root equality, and stable `WorkspaceScopeError`
  codes). `vscode-language-services.ts` also retains provider URI-shape checks for encoded path
  hazards and bounded scheme/path input before provider normalization. Neither is an alternate
  source-to-relative-path or text projection owner, and neither was changed by this maintenance.
- Test disposition: `ide-source-projector.test.ts` locks URI identity/containment, ASCII/astral and
  multi-byte UTF-8 widths, no-split truncation and reason order, malformed Unicode, position/range
  boundaries, and deterministic scalar ordering. Existing adapter suites remain in place for their
  caller-owned behavior; no duplicate projection matrix remains.
- Disposition: No active duplicate IDE source projection remains in the three callers. Future IDE
  source projection semantics must be added to the Extension-private projector and covered by its
  contract tests; do not add another adapter-local implementation or a repository-wide utility.

## Completion

- Implementation summary: `ideSourceProjector` now owns the shared URI/path, Unicode/UTF-8, position,
  range, ordering, and truncation primitives. All three adapters use it while retaining their
  existing error mappings and source-specific behavior. No configuration, command, public contract,
  persistence, dependency, or package-boundary change was made.
- Test results:
  - Focused projector and three adapter suites: 4 files, 58 tests passed (`pnpm exec vitest run
    apps/extension/src/adapters/ide-source-projector.test.ts apps/extension/src/adapters/vscode-diagnostics.test.ts
    apps/extension/src/adapters/vscode-language-services.test.ts apps/extension/src/adapters/vscode-editor-context.test.ts`).
  - Full unit suite: 144 files, 1,721 tests passed (`pnpm run test:unit`).
  - Extension typecheck and full workspace typecheck passed (`pnpm --filter ./apps/extension exec tsc --noEmit`,
    `pnpm run typecheck`).
  - Biome repository check passed (`pnpm run check`); build passed (`pnpm run build`).
  - Extension integration passed with exit code 0 (`pnpm run test:integration`); the existing VS Code
    harness logged the non-fatal `Canceled Failed to load custom agents` warning.
  - `git diff --check` passed before commit/review; no configuration, command, public-contract,
    persistence, dependency, or package-boundary files changed.
- PR/branch: [draft PR #217](https://github.com/yangzuo0621/ctrl-zebra/pull/217),
  `codex/eo-003-ide-source-projection`, rebased onto latest exact `origin/main` commit
  `ec33eeb01aea5c2ceb8e6917ef5887147a25ed26` (original branch base was
  `0ce670c48beb623128f9a9a5231a60c0e2aa26be`).
- Review handoff: Task-reviewer must independently verify projector equivalence, deletion of the
  three superseded algorithms, caller-specific error/DTO behavior, public-contract stability, and
  the evidence above.
