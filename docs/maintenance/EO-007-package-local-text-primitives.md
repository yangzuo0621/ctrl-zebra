# EO-007 Package-local Text Primitives

## Scope Gate

- Base: exact latest `origin/main` `ce9954069dbd89224893ccea55018c7f77e93543`; branch
  `codex/eo-007-protocol-text-primitives`.
- Authorized tranches: one independent maintenance change containing every repository-wide
  equivalent implementation named by the Problem Evidence within each shared package/application
  runtime. Each package keeps its own private
  seam: Protocol/Core/Builtin-tools/MCP-client/Providers/Extension/Webview text measurement,
  Core/MCP-client/Extension record predicates, Extension URI identity, and Core/Webview canonical
  JSON/equality.
  Preserve all existing limits, schema errors, malformed-Unicode handling, and public exports.
- Contract gate: no Protocol DTO/schema shape, package entry-point export, dependency, persistence
  format, configuration, command, lifecycle, security policy, or cross-package utility.
- Handoff gate: implementation remains on this branch for independent task-reviewer review;
  task-executor does not merge or close the PR.

## Maintenance Change

- Goal: Promote every equivalent small implementation named by the Problem Evidence into a
  package-local owner, removing duplicate maintenance points without creating a repository-wide
  utility.
- Reason: repeated UTF-8 measurement, record predicates, URI identity, and canonical JSON/equality
  implementations could drift at byte limits, Unicode boundaries, validation errors, and exact
  comparison behavior. One independent maintenance change keeps each semantic owner explicit.
- Scope: Add package-private seams for each equivalent category found in the repository-wide audit:
  Protocol/Core/Builtin-tools/MCP-client/Providers/Extension/Webview text measurement,
  Core/MCP-client/Extension record guards and exact-key checks, Extension URI identity comparison,
  Core/Webview canonical JSON/equality, and the directly evidenced test helpers. Migrate every
  equivalent caller in the matrix below, add contract coverage, and preserve package boundaries. No
  package public entry point imports or re-exports any new helper.
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
  - `packages/core/src/text-primitives.ts`
  - `packages/core/src/text-primitives.test.ts`
  - `packages/core/src/record-validation.ts`
  - `packages/core/src/record-validation.test.ts`
  - `packages/core/src/json-values.ts`
  - `packages/core/src/json-values.test.ts`
  - `packages/core/src/canonical-json.ts`
  - `packages/core/src/canonical-json.test.ts`
  - `packages/core/src/checkpoint-store.ts`
  - `packages/core/src/event-store.ts`
  - `packages/core/src/heuristic-token-counter.ts`
  - `packages/core/src/heuristic-token-counter.test.ts`
  - `packages/core/src/agent-runtime.ts`
  - `packages/core/src/conversation-summarizer.ts`
  - `packages/core/src/tool-input-validation.test.ts`
  - `packages/core/src/text-edit.ts`
  - `packages/core/src/tool-repetition-detector.ts`
  - `packages/builtin-tools/src/text-primitives.ts`
  - `packages/builtin-tools/src/text-primitives.test.ts`
  - `packages/builtin-tools/src/language-service.ts`
  - `packages/builtin-tools/src/propose-file-edit.ts`
  - `packages/mcp-client/src/text-primitives.ts`
  - `packages/mcp-client/src/text-primitives.test.ts`
  - `packages/mcp-client/src/record-validation.ts`
  - `packages/mcp-client/src/record-validation.test.ts`
  - `packages/mcp-client/src/mcp-negotiation.ts`
  - `packages/mcp-client/src/fixture-stdio-port.ts`
  - `packages/mcp-client/src/mcp-catalog-collector.ts`
  - `packages/mcp-client/src/mcp-prompt.ts`
  - `packages/mcp-client/src/mcp-resource.ts`
  - `packages/mcp-client/src/mcp-tool-call.ts`
  - `packages/mcp-client/src/mcp-tool-schema.ts`
  - `packages/mcp-client/src/mcp-tool-snapshot.ts`
  - `packages/providers/src/text-primitives.ts`
  - `packages/providers/src/text-primitives.test.ts`
  - `packages/providers/src/ai-sdk-model-gateway.ts`
  - `apps/extension/src/adapters/text-primitives.ts`
  - `apps/extension/src/adapters/text-primitives.test.ts`
  - `apps/extension/src/adapters/record-validation.ts`
  - `apps/extension/src/adapters/record-validation.test.ts`
  - `apps/extension/src/adapters/uri-comparison.ts`
  - `apps/extension/src/adapters/ide-source-projector.ts`
  - `apps/extension/src/adapters/workspace-scope.ts`
  - `apps/extension/src/adapters/vscode-diagnostics.ts`
  - `apps/extension/src/adapters/vscode-language-services.ts`
  - `apps/extension/src/adapters/mcp-server-configuration.ts`
  - `apps/extension/src/adapters/structured-logger.ts`
  - `apps/extension/src/adapters/vscode-diagnostics.test.ts`
  - `apps/extension/src/adapters/vsix-policy.test.ts`
  - `apps/extension/src/controllers/model-selection-command.ts`
  - `apps/extension/src/controllers/provider-connection-check-command.ts`
  - `apps/extension/src/controllers/session-history.ts`
  - `apps/extension/src/controllers/session-recovery.ts`
  - `apps/extension/src/controllers/json-values.ts`
  - `apps/extension/src/controllers/json-values.test.ts`
  - `apps/extension/src/controllers/mcp-webview-actions.test.ts`
  - `apps/extension/src/controllers/command-output-collector.ts`
  - `apps/extension/src/controllers/command-output-collector.test.ts`
  - `apps/extension/scripts/record-validation.mjs`
  - `apps/extension/scripts/vsix-policy.mjs`
  - `apps/webview/src/text-primitives.ts`
  - `apps/webview/src/text-primitives.test.ts`
  - `apps/webview/src/canonical-json.ts`
  - `apps/webview/src/canonical-json.test.ts`
  - `apps/webview/src/editor-context-store.ts`
  - `apps/webview/src/mcp-store.ts`
  - `apps/webview/src/markdown-message.tsx`
  - `docs/engineering-opportunities.md`
  - `docs/maintenance/EO-007-package-local-text-primitives.md`
- Public-contract impact: None. Protocol DTOs, schemas, limits, errors, package exports, persistence,
  configuration, commands, and dependencies remain unchanged.
- Explicitly excluded: cross-package utilities, public exports, dependency changes, Protocol schema
  redesign, persistence encoding, and unrelated refactoring. `packages/protocol/src/persistence.ts`
  retains `encodeUtf8`/`appendUtf8CodePoint` because they emit encoded bytes and reject malformed
  Unicode; they are not byte-counting primitives. MCP Tool schema descriptor validation retains its
  own descriptor/accessor checks after reusing the shared plain-record predicate. Extension's
  `sameJson` remains order-sensitive exact-operation comparison, not canonical JSON; provider
  `readRecord` and other one-off implementations remain single owners where no equivalent duplicate
  exists. The standalone `apps/extension/scripts/record-validation.mjs:isRecord` now owns the VSIX
  packaging-runtime predicate consumed by `vsix-policy.mjs`; release tooling runs directly under
  Node and therefore keeps a separate `.mjs` owner from the Extension TypeScript seam without
  coupling package policy to source/bundle loading. Its existing `src/adapters/vsix-policy.test.ts`
  suite covers the policy. Builtin-tools `boundary-validation.ts`
  already owns that package's
  `isRecord`/`hasOnlyKeys`; transport/storage/test `TextEncoder` calls that emit `Uint8Array` bytes
  remain encoders rather than measurements.

## Scope Matrix

| Tranche | Exact evidence and semantic owner | Disposition and reuse decision | Build vs Buy | Planned edits/tests |
|---|---|---|---|---|
| Protocol text | `packages/protocol/src/tool.ts`, `run-command.ts`, `messages.ts`, `mcp-resource.ts`, `mcp-prompt.ts`, `ide-context.ts` (`utf8ByteLength`); `ide-context.ts`, `reasoning.ts` (`utf8BytesForCodePoint`); `mcp-connection.test.ts` (`utf8Bytes`) | Migrate all equivalent counters to `packages/protocol/src/text-primitives.ts`; no public export | Pure package-local helper; standard `TextEncoder` would allocate and cannot serve numeric width callers | `text-primitives.test.ts` scalar boundaries, mixed text, lone surrogates; existing schema suites |
| Core text | `packages/core/src/checkpoint-store.ts`, `event-store.ts`, `heuristic-token-counter.test.ts` (`utf8ByteLength`); `heuristic-token-counter.ts` bounded counter (`codePoint` width mapping) | Migrate equivalent byte counters and the bounded counter's numeric width mapping to `packages/core/src/text-primitives.ts`; bounded streaming/cycle/depth algorithm remains local | Reuse package-local pure width logic; no dependency | Core text primitive tests plus checkpoint/event/heuristic suites |
| Builtin-tools text | `packages/builtin-tools/src/language-service.ts` (`utf8ByteLength`) and `propose-file-edit.ts` (`TextEncoder` byte count) | Migrate equivalent bounded input/replacement measurements to `builtin-tools/src/text-primitives.ts`; keep byte decoding/encoding fakes unchanged | Reuse standard `TextEncoder` behind a package-private helper; no dependency | Helper boundary tests plus language-service/propose-file-edit suites |
| MCP text | `packages/mcp-client/src/mcp-prompt.ts`, `mcp-resource.ts`, `mcp-tool-call.ts`, `mcp-tool-schema.ts`, `mcp-tool-snapshot.ts` (`utf8Bytes`/direct `TextEncoder` counts) | Migrate all equivalent serialized-byte and per-code-point byte measurements to `mcp-client/src/text-primitives.ts`; transport encoding remains direct | Reuse existing runtime `TextEncoder` behind package-private owner; no dependency | Helper tests plus prompt/resource/tool call/schema/snapshot suites |
| Provider text | `packages/providers/src/ai-sdk-model-gateway.ts` (`utf8LengthOfCodePoint`) | Migrate the provider's bounded reasoning splitter to `providers/src/text-primitives.ts`; keep the provider-local seam and no public export | Reuse deterministic numeric width logic; no dependency | Provider helper boundary test plus AI SDK gateway suite |
| Builtin-tools records | `packages/builtin-tools/src/boundary-validation.ts` (`isRecord`, `hasOnlyKeys`) already serves all builtin-tool callers | Keep the existing package-local owner; no second equivalent implementation exists in this package, and cross-package sharing would violate the seam boundary | Reuse existing owner; no dependency | Existing boundary-validation and tool parser suites |
| Core records/equality | `core/src/agent-runtime.ts`, `conversation-summarizer.ts`, `text-edit.ts`, and test-only `tool-input-validation.test.ts` (`isRecord`/plain guard and exact keys); `agent-runtime.ts`/`tool-repetition-detector.ts` (`jsonValuesEqual`/canonical JSON) | `core/src/record-validation.ts` owns loose/strict record guards and exact keys; `core/src/json-values.ts` and `canonical-json.ts` own equality/canonicalization; bounded heuristic JSON writer remains streaming but reuses numeric width | Pure product boundary predicates; no library | Core record/equality/canonical tests plus agent/summarizer/text-edit/tool-input/repetition suites |
| MCP records | `mcp-negotiation.ts`, `fixture-stdio-port.ts`, `mcp-catalog-collector.ts` (`isRecord`/read wrapper); prompt/resource/tool-call/snapshot/schema (`readRecord`/strict predicates); negotiation/prompt/resource/tool-call/snapshot (`hasOnlyKeys`) | `mcp-client/src/record-validation.ts` owns loose/plain predicates and allowed-key check; domain callers retain narrow error mapping, allowed-key policy, and schema descriptor/accessor checks | Deepen existing package boundary; no dependency | Record helper tests plus MCP negotiation/catalog/prompt/resource/tool-call/schema/snapshot suites |
| Extension records/URI | `ide-source-projector.ts`, `vscode-diagnostics.ts`, `vscode-language-services.ts`, `model-selection-command.ts`, `provider-connection-check-command.ts`, `session-recovery.ts` (`isRecord`); `session-history.ts` (`asRecord`/exact keys); `mcp-server-configuration.ts` (exact keys); projector/workspace-scope (`sameIdentityPart`), projector (`sameUri`) | `adapters/record-validation.ts` owns equivalent loose/plain/exact predicates; `adapters/uri-comparison.ts` owns shared identity-part/full comparison; domain wrappers retain URI/path/error policy | Pure Extension-private predicates; no dependency | Helper tests plus projector/workspace-scope/diagnostic/language/session/config suites |
| Extension packaging records | `apps/extension/scripts/vsix-policy.mjs:isRecord` validates VSIX build metadata in standalone Node tooling | Migrate to standalone `apps/extension/scripts/record-validation.mjs:isRecord`; this preserves the Node packaging-runtime owner without coupling release policy to bundled Extension TS. No duplicate predicate remains in `vsix-policy.mjs`. | Keep standalone Node owner; no dependency/export | Existing VSIX policy suite exercises invalid record/array metadata through the policy owner |
| Extension text | `ide-source-projector.ts` strict UTF-8 width, `mcp-server-configuration.ts`/`structured-logger.ts` Buffer counts, `command-output-collector.ts` numeric width, diagnostics/command-output/MCP test byte helpers | `adapters/text-primitives.ts` owns valid-string/numeric widths; projector delegates after preserving strict malformed check; migrate equivalent config/logger/runtime/test counters | Reuse standard `TextEncoder`/numeric width; no dependency | Helper tests plus affected adapter/controller suites |
| Webview text/canonical JSON | `markdown-message.tsx` numeric byte width; `editor-context-store.ts` and `mcp-store.ts` canonical JSON | `webview/src/text-primitives.ts` owns code-point width; `webview/src/canonical-json.ts` owns one canonical serializer | Pure package-local helpers; no dependency | Helper tests plus markdown/editor/MCP store suites |

Every row is one package-local seam within this single EO-007 maintenance PR. Remaining one-off
helpers and semantically different encoders/comparators are listed in the exclusions and final audit,
not silently deferred as equivalent duplicates.
- Build vs Buy triggers: Equivalent implementation already exists in multiple modules in each
  semantic package and requires Unicode/validation boundary coverage.
- Build vs Buy decision and evidence: Deepen each existing package with one private pure helper for
  its equivalent cluster. `TextEncoder` is the standard-library candidate for string byte counts,
  but it allocates a byte array and cannot directly serve numeric code-point callers; the existing
  width mapping is small and deterministic. No third-party dependency or cross-package utility
  reduces maintenance while preserving package ownership, runtime compatibility, and stable errors.
  Record predicates, URI identity, and canonical JSON similarly have no I/O, lifecycle,
  cancellation, security, or third-party error surface. `TextEncoder` is provided by the existing
  ECMAScript/Node/VS Code runtimes and needs no package installation, license review, lockfile, VSIX,
  or build change; the numeric width helper has no equivalent standard API. The selected modules are
  synchronous and allocation-bounded for the existing call sites, require no adapter around
  cancellation or security policy, and preserve CtrlZebra-owned limits/error translation at each
  caller. Adding a dependency would not remove any of those package-owned semantics or materially
  reduce maintenance.
- Reuse Audit: Initial exact-base searches covered `utf8ByteLength`, `utf8BytesForCodePoint`,
  UTF-8/code-point byte wording, `TextEncoder`, and related encoding helpers across all
  `packages/protocol/src`, tests, engineering opportunities, architecture, security, and prior
  maintenance records. Found six Protocol string counters, two Protocol numeric width counters, and
  the Protocol test helper; the matrix then expands the audit to equivalent Core, Builtin-tools,
  MCP-client, Providers, Extension, and Webview counters. It also found loose/strict `isRecord` and exact-key
  predicates across Core/MCP/Extension, two Extension URI identity helpers, Core and Webview
  canonical JSON/equality implementations, and directly evidenced test helpers. Each equivalent
  cluster now has a package-local owner in the Scope Matrix; callers retain narrow error mapping,
  policy, streaming, and host composition. Provider read-record helpers, persistence byte encoding,
  descriptor/accessor validation, order-sensitive `sameJson`, and other one-off semantics remain
  separate because they are not equivalent. No repository-wide utility or public export is added.
- Test plan:
  - Unit: each text-primitives test covers empty/ASCII, 2-/3-/4-byte scalars, mixed strings,
    lone-surrogate byte width, and numeric width boundaries where applicable. Core/MCP/Extension
    record tests cover loose vs plain objects and exact-key failures; Core/Webview canonical JSON
    and JSON equality tests cover nested key ordering and array-order boundaries. Existing schema,
    host, and store suites retain normal, limit, and rejection coverage through migrated callers.
  - Integration: Run affected package suites, package typechecks, the full unit suite, repository
    check/build, and integration smoke as applicable.
  - Manual smoke: Not applicable; no runtime/UI behavior changes.
- Constraint gate:
  - Required rules: preserve malformed-text and byte-limit behavior, keep the module package-private,
    and do not introduce a repository-wide `text-utils`/`common` dependency.
  - Independent constraint PR: Not required; no contract, config, or security-policy rule changes.

## Similarity Audit

- Final audit commands:
  - `rg -n 'function (utf8ByteLength|utf8BytesForCodePoint|utf8Bytes|isRecord|isPlainRecord|canonicalJson|canonicalizeJson|jsonValuesEqual|sameUri|sameIdentityPart)|export function (utf8ByteLength|utf8BytesForCodePoint|isRecord|isPlainRecord|canonicalJson|canonicalizeJson|jsonValuesEqual|sameUri|sameIdentityPart)' packages apps`
  - `rg -n -i 'utf-8|utf8|code.?point byte|text primitive|appendUtf8CodePoint|TextEncoder|canonical.?json|sameJson|isRecord' packages apps docs/engineering-opportunities.md docs/maintenance`
  - `git diff --check`, `git status --short`, and final diff review against exact base.
- Actual symbol inventory and disposition:
  - Text owners: one `utf8ByteLength`/numeric width owner in each of Protocol, Core, Builtin-tools,
    MCP-client, Extension, and Providers; Webview owns the numeric width needed by Markdown
    truncation. Core's bounded heuristic writer and Providers' bounded reasoning splitter call their
    package owner. Protocol's `persistence.ts` `encodeUtf8`/`appendUtf8CodePoint` remains a strict
    byte emitter. Extension's projector keeps a malformed-Unicode rejecting wrapper, while
    diagnostics/language-services keep error-mapping wrappers over the projector; these wrappers do
    not duplicate the byte-width algorithm.
  - Record owners: Builtin-tools retains its existing boundary-validation owner; Core, MCP-client,
    and Extension each have one loose/plain predicate owner and Core/Extension exact-key owners.
    Core's former test-only `isPlainObject` and inline allowed-key guard in
    `tool-input-validation.test.ts` now reuse `core/src/record-validation.ts` and have zero
    definitions. Domain `readRecord`/`readStrictRecord` wrappers remain only where they map errors or
    enforce allowed keys/descriptors. The standalone Node VSIX packaging runtime now has one owner,
    `apps/extension/scripts/record-validation.mjs:isRecord`, consumed by `vsix-policy.mjs`; the
    policy test covers the preserved runtime seam.
  - Identity/equality owners: Extension `uri-comparison.ts` owns shared URI identity-part/full
    comparison; Core owns JSON equality/canonicalization and Webview owns its unknown-value
    canonical serializer; Extension's `sameJson` remains order-sensitive by contract.
  - Direct test helpers now call their package owners, and the standalone VSIX Node script imports its
    package-local `.mjs` owner. Provider one-offs, actual byte-emitting transports/storage,
    descriptor/accessor validation, and other no-equivalent implementations remain explicitly separate.
- Independent reviewer comparison: task-reviewer must repeat the repository-wide searches, verify
  each matrix row's equivalent definitions were removed, compare malformed-Unicode/validation and
  schema-limit behavior, confirm no package public export changed, and confirm each listed exclusion
  has materially different semantics.

## Completion

- Implementation summary: Added package-private text, record, URI, canonical JSON, and JSON equality
  seams in the owning packages/applications. Migrated every equivalent caller and directly evidenced
  test helper in the matrix, including the standalone VSIX predicate into its Node package-local
  owner, while retaining strict malformed-Unicode, descriptor, streaming, order-sensitive, and
  transport/persistence semantics where they differ.
- Test results:
  - Focused affected-package suites before the final audit-only additions: 52 files, 601 tests
    passed (`pnpm exec vitest run ...`).
  - Final audit-focused suites: 3 files, 16 tests passed (`pnpm exec vitest run packages/core/src/tool-input-validation.test.ts packages/core/src/record-validation.test.ts apps/extension/src/adapters/vsix-policy.test.ts`).
  - Full unit suite: 161 files, 1,766 tests passed (`pnpm run test:unit`).
  - Full workspace typecheck passed (`pnpm run typecheck`); affected package typechecks also passed.
  - Biome repository check passed for 414 files (`pnpm run check`).
  - Workspace build passed (`pnpm run build`).
  - Extension integration exited 0 (`pnpm run test:integration`); the harness emitted its known
    cached-data/custom-agent cancellation and extension-host responsiveness warnings.
  - `git diff --check` and final status/diff review are run immediately before commit/handoff.
- Similarity Audit: exact definition counts and remaining wrappers are listed above; the final
  repository-wide searches below are rerun after the last edit and recorded with the commit/PR.
- Design deviation: None.
- PR/branch: `codex/eo-007-protocol-text-primitives` (existing draft PR #222; no merge/close by the
  executor).
