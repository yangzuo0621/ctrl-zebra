# EO-003 IDE Source Projection

## Maintenance Change

- Goal: Establish one Extension-private `IdeSourceProjector` for IDE URI identity, workspace-relative
  paths, UTF-16 positions/ranges, deterministic ordering, and bounded Unicode/UTF-8 projection.
- Reason: `vscode-diagnostics.ts`, `vscode-language-services.ts`, and
  `vscode-editor-context.ts` carried equivalent projection algorithms whose fixes could drift in
  stale checks, containment, ordering, or truncation.
- Scope: Add the projector and contract tests; migrate the three adapters; delete superseded
  algorithms; record the maintenance evidence.
- Planned owners: `ide-source-projector.ts` and tests plus the three adapter callers and this record.
- Public-contract impact: None. Protocol DTOs, schemas, package entry points, configuration, commands,
  persistence, and user-visible behavior remain unchanged.
- Explicitly excluded: Provider-policy work, new package exports, repository-wide text utilities,
  dependencies, configuration/commands, persistence changes, and unrelated refactoring.
- Build vs Buy: Deepen the Extension-private adapter. VS Code supplies URI/document data and standard
  Unicode facilities supply primitives, but neither owns CtrlZebra workspace identity/containment,
  bounded UTF-8 projection, or truncation ordering; a dependency would add policy and failure-mapping
  cost without removing the seam.
- Reuse: The three adapter-local algorithms were the only equivalent runtime owners. Reuse existing
  `WorkspaceScope` only where semantics match; retain its configurable containment/error contract
  separately.
- Verification: Projector and adapter contract tests cover normal, boundary, malformed Unicode,
  position/range, ordering, and truncation cases; typecheck, repository/build/integration checks,
  and final diff review passed.

## Similarity Audit

`ideSourceProjector` now owns URI/path, Unicode/UTF-8, position/range, ordering, and truncation
primitives. Adapter-specific source collection, sort-key composition, editor chunking, aggregate
budgets, DTO/diagnostic composition, and conversion of `IdeSourceProjectionError` remain caller
owners. `WorkspaceScope` retains configurable case sensitivity, root equality, and stable
`WorkspaceScopeError` semantics; provider URI-shape checks remain distinct. No alternate source
projection algorithm remains, and future projection semantics belong in the private projector/tests.

## Completion

- Implementation summary: All three adapters use `ideSourceProjector` while retaining their
  existing error mappings and source-specific behavior; no configuration, command, public contract,
  persistence, dependency, or package-boundary change was made.
- Verification conclusion: Focused/full tests, Extension/workspace typechecks, repository check,
  build/integration smoke, and final diff review passed; known VS Code harness warnings were non-fatal.
- PR/branch: [PR #217](https://github.com/yangzuo0621/ctrl-zebra/pull/217),
  `codex/eo-003-ide-source-projection`; independently reviewed and rebased before merge.
- Review disposition: No active duplicate IDE source projection remains; do not add another
  adapter-local implementation or repository-wide utility.
