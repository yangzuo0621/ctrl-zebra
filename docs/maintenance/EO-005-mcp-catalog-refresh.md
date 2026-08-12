# EO-005 MCP Catalog Refresh

## Scope Gate

- Base: exact latest `origin/main` `9e9e98e8a446a250a9ba9841d98d08371c33c5fe`; branch
  `codex/eo-005-mcp-catalog-refresh`.
- Authorized tranche: one package-private bounded pagination collector and one generation-bound
  catalog refresh lifecycle, migrated across the existing Tool, Prompt, and Resource catalog paths
  with equivalent behavior coverage before deleting the copied control flow.
- Contract gate: no Protocol/Core/Extension contract, public package export, SDK version, dependency,
  persistence, configuration, command, transport, approval, security policy, or capability-set change.
- Handoff gate: implementation remains on this branch for task-reviewer; task-executor does not merge
  or close the PR.

## Maintenance Change

- Goal: Promote MCP catalog refresh into an independent maintenance change by giving Tools, Prompts,
  and Resources one package-private pagination collector and one refresh lifecycle owner.
- Reason: `packages/mcp-client/src/controlled-mcp-client.ts` independently implemented three page
  walks and three refresh coordinators. Each copied cursor set, page/entry limits, cancellation
  checkpoints, generation checks, atomic replacement, and list-changed coalescing. Drift could make
  a newer catalog bypass a bound, publish after cancellation, or classify the same malformed page
  differently.
- Scope: Add `mcp-catalog-collector.ts` for bounded cursor pagination and
  `mcp-catalog-refresh.ts` for context/controller/promise coalescing, stale fencing, cancellation,
  and complete-value commits. Migrate the three existing catalog paths; retain Tool schema
  rejection/diagnostic ownership and Prompt/Resource normalization/read semantics in their modules.
  Add package-private contract tests and this evidence record.
- Planned files:
  - `packages/mcp-client/src/mcp-catalog-collector.ts`
  - `packages/mcp-client/src/mcp-catalog-refresh.ts`
  - `packages/mcp-client/src/mcp-catalog.test.ts`
  - `packages/mcp-client/src/controlled-mcp-client.ts`
  - `docs/engineering-opportunities.md`
  - `docs/maintenance/EO-005-mcp-catalog-refresh.md`
- Public-contract impact: None. `packages/mcp-client/src/index.ts`, CtrlZebra Protocol/Core/Extension
  interfaces, MCP SDK version, configuration, persisted data, commands, and user-visible behavior
  remain unchanged.
- Explicitly excluded: MCP protocol/version negotiation, transport/process ownership, capability
  projection, Tool schema policy, Tool/Resource/Prompt DTOs, SDK or dependency changes, Extension or
  Webview changes, public exports, repository-wide utilities, and unrelated refactoring.
- Build vs Buy triggers: Existing equivalent pagination and refresh infrastructure in three paths,
  lifecycle-sensitive cancellation/stale fencing, and boundary tests for cursor and collection limits.
- Build vs Buy decision and evidence: Build by deepening the existing package-private MCP module. The
  pinned official SDK owns JSON-RPC transport and DTO validation, but it does not own CtrlZebra's
  bounded page/entry policy, duplicate-cursor rejection, generation fencing, list-changed coalescing,
  atomic catalog publication, cancellation outcome, or stable per-catalog error mapping. No existing
  dependency or VS Code API provides this lifecycle seam. A generic pagination or concurrency
  dependency would still require a CtrlZebra adapter and would add license, version, package, and
  runtime surface without removing policy maintenance. The new modules use no I/O, timers, process,
  network, or third-party types and remain behind the current private boundary.

## Reuse Audit

- Initial repository-wide searches and evidence:
  - `rg -n "collectToolDescriptors|collectPromptList|collectResourceList|request.*Refresh|run.*Refresh|refresh.*Once|cursor|nextCursor|maxMcpListPages|maxMcpListEntries|AbortSignal|generation" packages/mcp-client/src apps docs`
  - `rg -n "McpCatalog|CatalogRefresh|pagination|list-changed|generation fencing" packages apps docs`
  - Re-read `docs/engineering-opportunities.md` EO-005, `docs/architecture.md` Controlled MCP Client
    Boundary, `docs/development.md` Reuse Before Build/Build vs Buy, and the latest EO-001–EO-004
    maintenance records.
- Found existing implementations and owners: `ControlledMcpClient.collectToolDescriptors` owned Tool
  paging; `collectPromptList` owned Prompt paging; `collectResourceList` owned Resource and Template
  paging; each caller separately owned a `request/run/refresh*` promise, request flag, controller,
  context, stale check, and replacement. No existing shared collector or refresh lifecycle was found
  in `packages/mcp-client`, `packages/testkit`, `apps`, or public entry points.
- Decision: deepen the existing MCP package with two package-private deep modules. The collector owns
  only common bounded page walking; the refresh module owns only context/controller/promise lifecycle.
  Tool schema validation, rejected-tool diagnostics, Prompt argument validation, Resource selection,
  result normalization, and caller-specific stable errors remain direct owners and are translated at
  the narrow collector boundary.
- Not reused: the official SDK's list request/DTO types are reused through the existing `Client` but
  cannot replace CtrlZebra policy. Existing catalog constructors and Tool snapshot code remain direct
  owners because they apply domain validation and normalization. No repository-wide `utils`, common
  package, forwarding wrapper, or second test-support implementation is introduced.
- Second/third implementation assessment: The three page walks and three refresh coordinators are
  the already-observed second/third equivalent implementations; this tranche removes all six copied
  control-flow bodies. The new collector and lifecycle each have one definition and three direct
  callers. No fourth equivalent implementation remains.
- Active reuse plan: call `collectMcpCatalogPages` from Tool, Prompt, and Resource paths; call one
  `McpCatalogRefresh` instance per catalog type; keep domain error mapping at each caller; extend the
  shared package-private tests for page limits, duplicate cursors, cancellation, coalescing, stale
  completion, and atomic commit.

## Similarity Audit

- Final audit commands (run after implementation stabilizes):
  - `rg -n "collectToolDescriptors|collectPromptList|collectResourceList|collectMcpCatalogPages|McpCatalogRefresh|new Set<string>|nextCursor|toolRefreshRequested|resourceRefreshRequested|promptRefreshRequested|requestToolRefresh|requestResourceRefresh|requestPromptRefresh|run.*Refresh|refresh.*Once" packages/mcp-client/src packages/testkit apps`
  - `rg -n "pagination|cursor|list-changed|generation fencing|MCP catalog" docs/engineering-opportunities.md docs/maintenance docs/architecture.md`
  - `git diff --check`, `git status --short`, and final diff review against exact base.
- Actual new symbols and definitions: `collectMcpCatalogPages` (one definition in
  `mcp-catalog-collector.ts`, three direct callers), `McpCatalogCollectionError` (one definition,
  three caller translations), `McpCatalogRefresh` (one definition, three instances in
  `ControlledMcpClient`), and `McpCatalogRefreshState`/options interfaces (one package-private
  definition each). These symbols have no public entry-point export.
- Removed implementations: the three `cursors`/page-limit loops and their `nextCursor` validation;
  `toolRefreshPromise`/`toolRefreshRequested`/`toolController`/`toolContext` coordination;
  equivalent Prompt coordination; equivalent Resource coordination. Domain-specific Tool snapshot
  revocation remains a commit callback, not a duplicate lifecycle.
- Remaining similarities: Tool, Prompt, and Resource still each make their own SDK list request and
  map the shared collection code to their stable error class; this is intentional boundary-specific
  composition. Resource and Template lists still run sequentially because one Resource catalog must
  publish both complete collections atomically. Existing constructors and read/call operations remain
  distinct semantic owners. No copied cursor set or refresh request flag remains in
  `controlled-mcp-client.ts`.
- Disposition: shared pagination and refresh behavior is centralized; domain policy remains local.
  Future catalog types must use these package-private owners rather than add a fourth page walk or
  refresh coordinator. Any change to public protocol or lifecycle semantics requires separate change
  control.
- Independent reviewer comparison: task-reviewer must repeat the searches above, verify one definition
  per shared symbol and deletion of all three old control-flow paths, and compare the remaining
  similarities/dispositions against the final diff.

## Verification

- Focused: `pnpm exec vitest run packages/mcp-client/src/mcp-catalog.test.ts packages/mcp-client/src/mcp-tool-discovery.test.ts packages/mcp-client/src/mcp-resource-discovery.test.ts packages/mcp-client/src/mcp-prompt-discovery.test.ts packages/mcp-client/src/mcp-tool-snapshot.test.ts packages/mcp-client/src/mcp-resource.test.ts packages/mcp-client/src/mcp-prompt.test.ts packages/mcp-client/src/t1806-legacy-security.test.ts`.
- Typecheck: `pnpm --filter @ctrl-zebra/mcp-client exec tsc --noEmit`, then `pnpm run typecheck`.
- Broader verification: `pnpm run test:unit`, `pnpm run check`, `pnpm run build`, and
  `pnpm run test:integration` as applicable; finish with `git diff --check`, status, and diff review.

## Completion

- Implementation summary: Added one package-private bounded cursor collector and one isolated
  generation-bound `McpCatalogRefresh` lifecycle. Tool, Prompt, and Resource discovery now call the
  shared owners; Tool snapshot revocation remains a commit callback, while Tool schema/diagnostics
  and Prompt/Resource domain normalization remain local. No public contract, dependency, SDK, or
  host module changed.
- Test results: focused MCP catalog/discovery/schema/snapshot/security tests passed (8 files, 71
  tests); full unit suite passed (146 files, 1,730 tests, `pnpm run test:unit`); package and workspace
  typechecks passed (`pnpm --filter @ctrl-zebra/mcp-client exec tsc --noEmit`, `pnpm run typecheck`);
  Biome check passed for 383 files (`pnpm run check`); workspace build passed (`pnpm run build`);
  Extension integration exited 0 (`pnpm run test:integration`) with the existing non-fatal
  `Canceled Failed to load custom agents` warning; `git diff --check` passed.
- Similarity Audit: final repository search found one `collectMcpCatalogPages` definition with three
  direct catalog callers and one `McpCatalogRefresh` definition with three `ControlledMcpClient`
  instances. The old three cursor/page-limit loops and three refresh promise/request/controller/
  context coordinators are gone. Remaining `collectToolDescriptors`, `collectPromptList`, and
  `collectResourceList` methods are narrow SDK request plus caller-specific error translation, not
  duplicate pagination; remaining `Set<string>` matches belong to Tool/Prompt/Resource identity or
  schema validation semantics. Reviewer must independently repeat the documented search and compare
  this disposition.
- Actual direct reuse/deepening: existing MCP Client request/transport, catalog constructors,
  Tool snapshot/schema validator, and stable error types; no new dependency or public export.
- Deleted or replaced old implementations: copied Tool/Prompt/Resource pagination loops and refresh
  lifecycle state in `controlled-mcp-client.ts`, replaced by the two package-private owners.
- Design deviation: none.
- PR/branch: [draft PR #220](https://github.com/yangzuo0621/ctrl-zebra/pull/220), branch
  `codex/eo-005-mcp-catalog-refresh`, implementation commit `52b8744d571e4069a9c8224a7e3e8db80f82acac`.
- Completion date: 2026-08-13 implementation verification; finalizer owns closure date.
