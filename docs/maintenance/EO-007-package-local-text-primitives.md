# EO-007 Package-local Text Primitives

## Scope Gate

- Base: exact latest `origin/main` `ce9954069dbd89224893ccea55018c7f77e93543`; branch
  `codex/eo-007-protocol-text-primitives`.
- Authorized tranche: one `packages/protocol`-private UTF-8 measurement seam. Migrate the six
  equivalent schema-module string byte counters in Tool, command-output, Protocol message,
  Resource, Prompt, and IDE-context; migrate the equivalent numeric code-point counter in the
  reasoning and IDE-context paths; and replace the equivalent MCP-connection test helper. Preserve
  all existing limits, schema errors, malformed-Unicode handling, and public exports.
- Contract gate: no Protocol DTO/schema shape, package entry-point export, dependency, persistence
  format, configuration, command, lifecycle, security policy, or cross-package utility.
- Handoff gate: implementation remains on this branch for independent task-reviewer review;
  task-executor does not merge or close the PR.

## Maintenance Change

- Goal: Give `packages/protocol` one package-private owner for UTF-8 byte measurement and
  code-point byte width, removing equivalent local implementations without creating a repository-wide
  text utility.
- Reason: the Protocol package had six equivalent `utf8ByteLength` functions, two equivalent
  `utf8BytesForCodePoint` functions, and an equivalent test-only byte counter. Copies could drift at
  schema byte limits, Unicode boundaries, and exact-envelope tests.
- Scope: Add `packages/protocol/src/text-primitives.ts` with package-private
  `utf8ByteLength` and `utf8BytesForCodePoint`; migrate the six schema modules, two numeric helper
  callers, and test helper listed in the Scope Gate; add direct contract tests for ASCII,
  two-/three-/four-byte scalars,
  mixed strings, and lone-surrogate behavior; record the final similarity audit. No package public
  entry point imports or re-exports the new module.
- Planned files:
  - `packages/protocol/src/text-primitives.ts`
  - `packages/protocol/src/text-primitives.test.ts`
  - `packages/protocol/src/tool.ts`
  - `packages/protocol/src/run-command.ts`
  - `packages/protocol/src/messages.ts`
  - `packages/protocol/src/mcp-resource.ts`
  - `packages/protocol/src/mcp-prompt.ts`
  - `packages/protocol/src/ide-context.ts`
  - `packages/protocol/src/reasoning.ts`
  - `packages/protocol/src/mcp-connection.test.ts`
  - `docs/engineering-opportunities.md`
  - `docs/maintenance/EO-007-package-local-text-primitives.md`
- Public-contract impact: None. Protocol DTOs, schemas, limits, errors, package exports, persistence,
  configuration, commands, and dependencies remain unchanged.
- Explicitly excluded: `isRecord`, URI comparison, canonical JSON, cross-package utilities, public
  exports, dependency changes, Protocol schema redesign, persistence encoding, and unrelated
  refactoring. `packages/protocol/src/persistence.ts` retains `appendUtf8CodePoint` because it emits
  encoded bytes and rejects malformed Unicode; it is not a byte-counting primitive with equivalent
  semantics.
- Build vs Buy triggers: Equivalent implementation already exists in multiple package modules and
  requires Unicode boundary coverage.
- Build vs Buy decision and evidence: Deepen the existing Protocol package with a private pure
  helper. `TextEncoder` is the standard-library candidate for string byte counts, but it allocates a
  byte array, cannot directly serve numeric code-point callers, and would not replace the explicit
  width mapping needed by the existing incremental reasoning path. The existing width mapping is
  small, deterministic, and already covered by Protocol's limits; retaining it avoids a dependency,
  package/runtime compatibility burden, and an adapter that would still own the same semantics.
  The helper has no I/O, lifecycle, cancellation, security, or third-party error surface.
- Reuse Audit: Initial exact-base searches covered `utf8ByteLength`, `utf8BytesForCodePoint`,
  UTF-8/code-point byte wording, `TextEncoder`, and related encoding helpers across all
  `packages/protocol/src`, tests, engineering opportunities, architecture, security, and prior
  maintenance records. Found six string counters in `tool.ts`, `run-command.ts`, `messages.ts`,
  `mcp-resource.ts`, `mcp-prompt.ts`, and `ide-context.ts`; numeric width counters in `ide-context.ts`
  and `reasoning.ts`; and the equivalent `mcp-connection.test.ts` helper. Chose one Protocol-private
  owner and direct callers. The same repository-wide search also found non-Protocol counters in
  `packages/core/src/checkpoint-store.ts` and `event-store.ts`,
  `packages/builtin-tools/src/language-service.ts`,
  `packages/providers/src/ai-sdk-model-gateway.ts`,
  `packages/mcp-client/src/mcp-prompt.ts`, `mcp-resource.ts`, `mcp-tool-call.ts`,
  `mcp-tool-schema.ts`, and `mcp-tool-snapshot.ts`, plus Extension/Webview adapters. They remain
  separate owners because this tranche is one package and their limits, streaming, persistence,
  host, or provider error semantics are not authorized to cross package boundaries. The same audit
  found `isRecord` definitions across Core, MCP, Extension, and tests, URI identity helpers in the
  Extension adapters, and canonical JSON helpers in Core/Webview; those are distinct semantics and
  are explicitly deferred to separate one-package tranches. Existing `persistence.ts` encoding
  remains separate for its strict malformed-input and byte-emission semantics; no repository-wide
  utility or public export is added.
- Test plan:
  - Unit: `text-primitives.test.ts` covers empty/ASCII, 2-/3-/4-byte scalars, mixed strings,
    lone-surrogate byte width, and numeric width boundaries; existing Protocol schema suites retain
    normal, limit, and rejection coverage through migrated callers.
  - Integration: None; this is host-independent Protocol code. Run the Protocol package suite,
    package typecheck, full unit suite, repository check/build, and integration smoke as applicable.
  - Manual smoke: Not applicable; no runtime/UI behavior changes.
- Constraint gate:
  - Required rules: preserve malformed-text and byte-limit behavior, keep the module package-private,
    and do not introduce a repository-wide `text-utils`/`common` dependency.
  - Independent constraint PR: Not required; no contract, config, or security-policy rule changes.

## Similarity Audit

- Final audit commands (after implementation stabilizes):
  - `rg -n '^function (utf8ByteLength|utf8BytesForCodePoint)|^export function (utf8ByteLength|utf8BytesForCodePoint)|utf8ByteLength|utf8BytesForCodePoint|function utf8Bytes\(' packages apps docs`
  - `rg -n -i 'utf-8|utf8|code.?point byte|text primitive|appendUtf8CodePoint|TextEncoder' packages/protocol/src docs/engineering-opportunities.md docs/maintenance`
  - `git diff --check`, `git status --short`, and final diff review against exact base.
- Actual symbol inventory and disposition: one `utf8ByteLength` and one `utf8BytesForCodePoint`
  definition in `text-primitives.ts`, with direct callers in the six migrated schema modules,
  `ide-context.ts`, `reasoning.ts`, and `mcp-connection.test.ts`; neither symbol is exported by
  `packages/protocol/src/index.ts`. The Protocol `persistence.ts` `encodeUtf8`/
  `appendUtf8CodePoint` pair remains separate as a strict encoder. Non-Protocol UTF-8 counters,
  `isRecord`, URI identity, and canonical JSON definitions listed in the Reuse Audit remain
  unchanged and are follow-up opportunities, not duplicate owners of this package-private seam.
- Independent reviewer comparison: task-reviewer must repeat the repository-wide searches, verify
  all equivalent Protocol counters and the test helper were removed, compare malformed-Unicode and
  schema-limit behavior, and confirm the persistence encoder remains separate for its different
  contract.

## Completion

- Implementation summary: Added the package-private `text-primitives.ts` owner and migrated all
  equivalent Protocol string and numeric UTF-8 width callers plus the MCP connection boundary test
  helper. Schema limits, malformed-text behavior, and public exports are unchanged.
- Test results:
  - Focused Protocol migration suite: 9 files, 148 tests passed.
  - Full unit suite: 148 files, 1,743 tests passed (`pnpm run test:unit`).
  - Protocol package typecheck and full workspace typecheck passed (`pnpm --filter
    @ctrl-zebra/protocol exec tsc --noEmit`, `pnpm run typecheck`).
  - Biome repository check passed for 386 files (`pnpm run check`).
  - Workspace build passed (`pnpm run build`).
  - Extension integration exited 0 (`pnpm run test:integration`); the existing harness emitted
    non-fatal custom-agent cancellation and extension-host responsiveness warnings.
  - `git diff --check` passed before final handoff.
- Similarity Audit: The final repository-wide search found exactly one definition of each new symbol:
  `packages/protocol/src/text-primitives.ts:1` (`utf8ByteLength`) and `:11`
  (`utf8BytesForCodePoint`). Direct callers are the six migrated schema modules, `ide-context.ts`,
  `reasoning.ts`, and `mcp-connection.test.ts`; `packages/protocol/src/index.ts` has no deep-module
  export. The former six string counters, two numeric counters, and test helper are deleted. The
  Protocol `persistence.ts` `encodeUtf8`/`appendUtf8CodePoint` encoder remains intentionally
  separate because it emits bytes and rejects malformed Unicode. Non-Protocol UTF-8 counters,
  `isRecord`, URI identity, and canonical JSON helpers remain at their owning package/application
  boundaries as documented follow-up opportunities. Reviewer must independently repeat the listed
  searches and compare this disposition with the final diff.
- Actual direct reuse/deepening: Existing Protocol callers and limits were preserved; the new
  package-private owner deepens their common byte-width semantics without adding a public export or
  dependency.
- Deleted or replaced old implementations: six schema-local `utf8ByteLength` functions, the
  `ide-context.ts` and `reasoning.ts` `utf8BytesForCodePoint` functions, and the
  `mcp-connection.test.ts` `utf8Bytes` helper.
- Design deviation: None.
- PR/branch: `codex/eo-007-protocol-text-primitives` (PR to be created when a meaningful reviewable
  state exists).
