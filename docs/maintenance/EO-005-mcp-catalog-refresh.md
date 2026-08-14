# EO-005 MCP Catalog Refresh

## Scope Gate

- Authorized tranche: one package-private bounded pagination collector and one generation-bound catalog
  refresh lifecycle for Tool, Prompt, and Resource paths, with equivalent behavior coverage.
- Contract gate: no Protocol/Core/Extension contract, public export, SDK/dependency, persistence,
  configuration, command, transport, approval, security-policy, or capability-set change.
- Handoff gate: implementation remained available for independent task-reviewer review.

## Maintenance Change

- Goal: Give Tools, Prompts, and Resources one package-private pagination collector and one refresh
  lifecycle owner.
- Reason: `controlled-mcp-client.ts` had three page walks and three refresh coordinators, each
  duplicating cursor/entry limits, cancellation checkpoints, generation fencing, atomic replacement,
  and list-changed coalescing. Drift could publish stale or unbounded catalogs.
- Scope: Add `mcp-catalog-collector.ts` for bounded cursor pagination and
  `mcp-catalog-refresh.ts` for context/controller/promise coalescing, stale fencing, cancellation,
  and complete-value commits. Migrate all three paths; retain Tool schema/diagnostic and
  Prompt/Resource normalization/read ownership in their modules; add package-private contract tests.
- Planned owners: the two private MCP modules, `controlled-mcp-client.ts`, catalog contract tests,
  and this record.
- Public-contract impact: None. Package entry points, Protocol/Core/Extension interfaces, MCP SDK
  version, configuration, persistence, commands, and user-visible behavior remain unchanged.
- Explicitly excluded: Protocol/version negotiation, transport/process ownership, capability
  projection, Tool schema policy, Tool/Resource/Prompt DTOs, SDK/dependency changes, Extension/Webview
  changes, public exports, repository-wide utilities, and unrelated refactoring.
- Build vs Buy: Deepen the existing package-private MCP module. The pinned SDK owns transport/DTO
  validation but not CtrlZebra bounds, duplicate-cursor rejection, generation fencing, coalescing,
  atomic publication, cancellation outcomes, or stable per-catalog mapping; a generic dependency
  would still need the same product adapter and lifecycle policy.
- Reuse: The three page walks and three coordinators were the only equivalent owners. The collector
  owns common page walking, refresh owns lifecycle; domain validation and error mapping remain local.
  No public utility, forwarding wrapper, or fourth implementation is introduced.
- Verification: Focused/catalog and full tests, package/workspace typechecks, repository check/build,
  integration smoke, and final diff review passed.

## Similarity Audit

The shared owners remove all six copied control-flow bodies. `collectMcpCatalogPages`,
`McpCatalogCollectionError`, and `McpCatalogRefresh` each have one package-private definition and
three direct catalog uses. Remaining Tool/Prompt/Resource SDK requests and stable error translation
are narrow boundary composition. Tool snapshot revocation remains a commit callback and runs on
lifecycle clear. Resource/Template lists remain sequential for atomic publication.

The collector's private `readRecord` only rejects malformed page shapes; domain
`readRecord`/descriptor/schema guards in Prompt, Resource, Tool snapshot/schema, provider, and test
modules retain distinct error, descriptor, or cloning semantics and are not a duplicate pagination
mechanism. Future catalog types must use the shared collector/refresh owners; a generic record
validator needs separate evidence.

## Completion

- Implementation summary: Added the bounded cursor collector and generation-bound refresh lifecycle;
  Tool, Prompt, and Resource discovery now use them while Tool schema/diagnostic and domain
  normalization remain local. No public contract, SDK, dependency, or host module changed.
- Verification conclusion: Focused/full MCP tests, typechecks, repository check, build, integration,
  and final diff review passed; the known integration harness warning was non-fatal.
- Similarity disposition: One collector and one refresh owner remain; old cursor/page-limit loops and
  refresh promise/request/controller/context coordinators are gone.
- PR/branch: [draft PR #220](https://github.com/yangzuo0621/ctrl-zebra/pull/220),
  `codex/eo-005-mcp-catalog-refresh`; implementation commit
  `52b8744d571e4069a9c8224a7e3e8db80f82acac`.
- Completion date: 2026-08-13 implementation verification; finalizer owns closure date.
