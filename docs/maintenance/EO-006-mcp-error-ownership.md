# EO-006 MCP Error Ownership

## Scope Gate

- Base: exact latest `origin/main` `521b892320420ba0f4a72c9efdf750bbb9e0cdbc`; branch
  `codex/eo-006-mcp-error-ownership`.
- Authorized tranche: preserve MCP client-owned stable `{ code, message }` failures through the
  Extension connection controller, remove the controller's copied client-message table, and make
  client domain errors use the existing package-owned normalization. Host/process/configuration
  failures remain Extension-owned.
- Contract gate: no Protocol/Core/Extension public DTO, package entry-point export, configuration,
  command, persistence, transport, approval, security policy, dependency, or SDK change. The
  existing failure code set and Webview projections remain unchanged.
- Handoff gate: implementation remains on this branch for independent task-reviewer review;
  task-executor does not merge or close the PR.

## Maintenance Change

- Goal: Make `packages/mcp-client` the sole owner of MCP client error messages and normalized
  client-domain failures while keeping Host/process/configuration display mapping in
  `McpConnectionController`.
- Reason: `packages/mcp-client/src/errors.ts` already normalized every `McpClientErrorCode`, but
  `apps/extension/src/controllers/mcp-connection-controller.ts` duplicated the client message
  table and rebuilt `{ code, message }` from a code. Prompt, Resource, and Tool snapshot errors
  also used generic local messages, so a caller could lose the client's stable explanation at the
  Host boundary. The copies could drift in user-visible diagnostics and violate the controlled MCP
  client ownership boundary.
- Scope: Reuse `createMcpClientError` in the client negotiation, Prompt, Resource, and Tool snapshot
  error
  classes; let the controller accept and preserve client-owned error objects; restrict its local
  message table and error-code type to Host/process/configuration fallback outcomes; retain
  connection lifecycle, diagnostics, cancellation, and process mapping behavior. Add focused
  normalization and Host-boundary regression tests plus this evidence record.
- Planned files:
  - `packages/mcp-client/src/mcp-prompt.ts`
  - `packages/mcp-client/src/mcp-resource.ts`
  - `packages/mcp-client/src/mcp-tool-snapshot.ts`
  - `packages/mcp-client/src/mcp-negotiation.ts`
  - `packages/mcp-client/src/errors.test.ts`
  - `apps/extension/src/controllers/mcp-connection-controller.ts`
  - `apps/extension/src/controllers/mcp-connection-controller.test.ts`
  - `docs/engineering-opportunities.md`
  - `docs/maintenance/EO-006-mcp-error-ownership.md`
- Public-contract impact: None. `McpClientErrorCode`, `McpClientError`, existing package entry
  points, Extension/Webview DTO schemas, Protocol/Core interfaces, settings, commands, persisted
  values, dependencies, and user-visible error codes remain unchanged. Only the already-defined
  stable client messages now flow through the existing error object.
- Explicitly excluded: New public error exports, code renames, Protocol/Core/Extension boundary
  changes, new dependencies, SDK upgrades, transport/process lifecycle changes, diagnostics DTO
  changes, localization, persistence, and unrelated error cleanup.
- Build vs Buy triggers: Existing equivalent client-message mapping in two modules; stable error
  normalization crosses an Extension/package boundary and needs normal, boundary, and failure-path
  coverage. No general-purpose parser, queue, retry, concurrency, or third-party mechanism is
  introduced.
- Build vs Buy decision and evidence: Reuse and deepen the existing package-local error module.
  The MCP SDK owns transport/protocol failures internally but does not own CtrlZebra's closed
  error codes or display-safe normalized messages. Standard-library `Error` supplies no stable
  code/message policy, and no existing dependency or VS Code API owns this boundary. A generic
  error package would add an adapter, dependency/version/license/VSIX surface while still leaving
  CtrlZebra's policy and lifecycle mapping to maintain. The change adds no I/O, timer, process,
  network, cancellation, or security mechanism and keeps third-party failures private.

## Reuse Audit

- Initial repository-wide searches and evidence (against exact base `521b892`):
  - `rg -n 'errorMessages|mcpHostErrorMessages|McpClientErrorCode|McpHostErrorCode|createMcpClientError|new Mcp(Prompt|Resource|Tool).*Error|#failAndNotify|#mapConnectionFailure' packages/mcp-client/src apps/extension/src docs/engineering-opportunities.md docs/architecture.md`
  - `rg -n -i 'error ownership|stable error|client error|host error|error message' docs/architecture.md docs/security.md docs/protocol.md docs/engineering-opportunities.md docs/maintenance`
  - Re-read `docs/development.md` (Reuse Before Build/Build vs Buy), `docs/testing.md`, the
    Controlled MCP Client Boundary and SDK/JSON Schema isolation sections of `docs/architecture.md`,
    and EO-005's completed maintenance evidence.
- Found existing implementations and owners: `packages/mcp-client/src/errors.ts` owns the closed
  client message table and `createMcpClientError`; `McpToolDiscoveryError` already used that owner,
  while `McpNegotiationFailure`, `McpPromptError`, `McpResourceError`, and `McpToolSnapshotError`
  had equivalent local messages.
  `McpConnectionController` owned Host/process/configuration mapping but also duplicated all client
  messages. No existing cross-boundary adapter or public message helper was found.
- Decision: deepen the existing package-private/client-owned normalization and pass its existing
  `{ code, message }` object through the controller. Keep one narrow controller translation for
  Host/process/configuration fallback strings. Do not add a public export, repository-wide error
  utility, wrapper layer, or second package.
- Not reused: SDK errors and `Error` are not stable CtrlZebra client contracts; Protocol schemas
  consume the already-bounded controller snapshot and do not own MCP error text. Host process
  failures remain local because process creation/termination/display is an Extension boundary.
- Second/third implementation assessment: the Extension table and package-private negotiation
  message branch were the observed duplicate client-message implementations; the four domain error
  classes were local normalization gaps, not additional owners. After migration there is one client
  table/constructor and one Host table/normalizer; no third equivalent client-message implementation
  remains. Overlapping `server-exited`,
  `termination-unconfirmed`, and `internal` codes are intentionally represented as Host fallback
  strings when the failure originates in the process/controller and as client objects when it
  originates in the MCP package.
- Active reuse plan: all MCP client failures retain the package-created message; the controller
  invokes `normalizeMcpFailure` only for Host/process/configuration fallback strings and forwards
  client error objects unchanged. Tests lock both paths.

## Similarity Audit

- Final audit commands (run after implementation stabilizes):
  - `rg -n '^const (errorMessages|mcpHostErrorMessages)|^export function createMcpClientError|^export class Mcp(TransportFailure|PromptError|ResourceError|ToolSnapshotError|ToolDiscoveryError|NegotiationFailure)|^export type McpHostError(Code)?|#mapConnectionFailure|#failAndNotify' packages/mcp-client/src/errors.ts packages/mcp-client/src/mcp-negotiation.ts packages/mcp-client/src/mcp-prompt.ts packages/mcp-client/src/mcp-resource.ts packages/mcp-client/src/mcp-tool-snapshot.ts packages/mcp-client/src/controlled-mcp-client.ts apps/extension/src/controllers/mcp-connection-controller.ts`
  - `rg -n 'Could not connect to the MCP Server|does not support the required protocol|requested an unsupported capability|sent a malformed message|supplied an invalid or unsupported Tool schema|exceeded a resource limit|exited unexpectedly|MCP Server is disconnected|MCP Tool is unavailable|MCP Resource is unavailable|MCP Prompt is unavailable|process could not be confirmed|connection failed unexpectedly' packages/mcp-client/src apps/extension/src/controllers/mcp-connection-controller.ts`
  - `rg -n -i 'error ownership|client-owned|Host/process|stable client message|McpClientError' docs/engineering-opportunities.md docs/maintenance/EO-006-mcp-error-ownership.md docs/architecture.md`
  - `git diff --check`, `git status --short`, and final diff review against exact base.
- Actual symbols and definitions after implementation: `errorMessages` and
  `createMcpClientError` remain one definition in `packages/mcp-client/src/errors.ts`; the client
  transport, negotiation, Tool discovery, Prompt, Resource, and Tool snapshot classes consume that
  owner. `mcpHostErrorMessages` and
  `normalizeMcpFailure` are one Extension-local definition in
  `apps/extension/src/controllers/mcp-connection-controller.ts`, scoped to Host/process/
  configuration fallback codes. `McpHostError` is one controller type union that permits either a
  Host-normalized object or the existing package-owned `McpClientError`.
- Removed implementation: the controller's copied entries for `connect-failed`,
  `protocol-incompatible`, `capability-unsupported`, `malformed-message`, `invalid-schema`,
  `limit-exceeded`, `disconnected`, `tool-unavailable`, `resource-unavailable`,
  `resource-unsupported`, `prompt-unavailable`, and `prompt-unsupported`; code-only rebuilding of
  client failures at connect and initial catalog failure paths.
- Remaining similarities and disposition: Host `server-exited`,
  `termination-unconfirmed`, and generic `internal` fallback messages remain in the controller by
  ownership; the same codes in `errors.ts` remain for package-originated client failures. The
  disconnect informational text and disposal exception are Host UX/lifecycle text, not client
  error mappings. Tool execution and diagnostic modules contain fixed operation/diagnostic copy with
  distinct ownership and are not equivalent client error tables.
- Independent reviewer comparison: task-reviewer must repeat the commands above, verify one client
  normalization owner, verify deletion of the controller client entries and code-only remapping,
  and compare the remaining overlap disposition against the final diff.

## Verification

- Focused: `pnpm exec vitest run packages/mcp-client/src/errors.test.ts apps/extension/src/controllers/mcp-connection-controller.test.ts`.
- MCP/Extension affected suite: `pnpm exec vitest run packages/mcp-client/src apps/extension/src/controllers`.
- Typecheck: `pnpm --filter @ctrl-zebra/mcp-client exec tsc --noEmit`, then `pnpm run typecheck`.
- Broader verification: `pnpm run test:unit`, `pnpm run check`, `pnpm run build`, and
  `pnpm run test:integration`; finish with `git diff --check`, status, and diff review.

## Completion

- Implementation summary: `packages/mcp-client` now owns the stable messages for transport,
  negotiation, Tool discovery/snapshot, Prompt, and Resource client failures through the existing
  `createMcpClientError` owner. `McpConnectionController` preserves client `{ code, message }`
  objects and retains only Host/process/configuration fallback messages. No Protocol/Core/Extension
  public contract, SDK, dependency, lifecycle, diagnostics, or persisted behavior changed.
- Test results:
  - Focused client/Host ownership tests: 2 files, 32 tests passed after the final negotiation
    normalization change (6 client-error tests and 26 controller tests).
  - Affected MCP + Extension controller suite: 46 files, 480 tests passed.
  - Full unit suite: 147 files, 1,740 tests passed (`pnpm run test:unit`).
  - MCP package typecheck and workspace typecheck passed (`pnpm --filter @ctrl-zebra/mcp-client exec
    tsc --noEmit`, `pnpm run typecheck`).
  - Biome repository check passed (`pnpm run check`, 384 files).
  - Workspace build passed (`pnpm run build`).
  - Extension integration passed with exit code 0 (`pnpm run test:integration`); the existing
    VS Code harness emitted the non-fatal `Canceled Failed to load custom agents` warning.
  - `git diff --check` passed; final worktree is clean.
- Similarity Audit: Final repository search found one `errorMessages`/`createMcpClientError`
  definition in `packages/mcp-client/src/errors.ts`, consumed by `McpTransportFailure`,
  `McpNegotiationFailure`, `McpToolDiscoveryError`, `McpToolSnapshotError`, `McpPromptError`, and
  `McpResourceError`; one Extension `mcpHostErrorMessages` table and one `normalizeMcpFailure`
  helper for Host/process/configuration fallback. The controller's copied client entries and
  code-only reconstruction are removed. Remaining `server-exited`, `termination-unconfirmed`,
  and `internal` text is intentionally split by origin: Host process/controller failures stay in
  Extension; package-originated client failures stay in the client owner. Disconnect informational
  text, disposal exception, Tool execution text, negotiation diagnostics, and Webview diagnostic
  copy have distinct UX/operation owners and are not duplicate client-error tables. Reviewer must
  independently repeat the documented searches and compare this disposition with the final diff.
- Actual direct reuse/deepening: existing `createMcpClientError`/`errorMessages`, client error
  classes, and the controller's Host mapping seam; no new dependency or public export.
- Deleted or replaced old implementations: controller-local client message entries and code-only
  client failure reconstruction.
- Design deviation: None.
- PR/branch: [PR #221](https://github.com/yangzuo0621/ctrl-zebra/pull/221), branch
  `codex/eo-006-mcp-error-ownership`, squash-merged after independent review and passing CI.
- Completion date: 2026-08-13.
