# EO-006 MCP Error Ownership

## Scope Gate

- Authorized tranche: preserve MCP client-owned stable `{ code, message }` failures through the
  Extension controller, remove its copied client-message table, and keep Host/process/configuration
  mapping Extension-owned.
- Contract gate: no Protocol/Core/Extension DTO, package export, configuration, command, persistence,
  transport, approval, security policy, dependency, SDK, failure-code-set, or Webview projection change.
- Handoff gate: implementation remained available for independent task-reviewer review.

## Maintenance Change

- Goal: Make `packages/mcp-client` the sole owner of client error messages and normalized
  client-domain failures while retaining Host/process/configuration display mapping in
  `McpConnectionController`.
- Reason: `errors.ts` already normalized `McpClientErrorCode`, but the controller duplicated its
  message table and rebuilt objects from codes. Prompt, Resource, and Tool snapshot errors also used
  generic local messages, allowing stable client explanations to drift at the Host boundary.
- Scope: Reuse `createMcpClientError` in negotiation, Prompt, Resource, and Tool snapshot errors;
  preserve client error objects through the controller; restrict local mappings to Host/process/
  configuration fallbacks; retain lifecycle, diagnostics, cancellation, and process behavior; add
  focused normalization and Host-boundary regression tests.
- Planned owners: MCP client error classes/tests, `mcp-connection-controller` and its tests, and
  this record.
- Public-contract impact: None. Existing codes/messages, package entry points, DTO schemas,
  settings, commands, persisted values, dependencies, and user-visible code set remain unchanged.
- Explicitly excluded: New public error exports, renames, boundary changes, dependencies, SDK upgrades,
  transport/process lifecycle, diagnostics DTOs, localization, persistence, and unrelated cleanup.
- Build vs Buy: Deepen the existing package-local error module. SDK `Error` has no stable CtrlZebra
  code/message policy, and a generic package would add a dependency/adapter while leaving boundary
  ownership and lifecycle mapping here.
- Reuse: One client table/constructor and one Host fallback normalizer remain. Overlapping
  `server-exited`, `termination-unconfirmed`, and `internal` values are intentionally split by
  origin, not duplicate client-message ownership.
- Verification: Focused/affected/full tests, package/workspace typechecks, repository check/build,
  integration, and final diff review passed.

## Similarity Audit

`errorMessages` and `createMcpClientError` remain the single MCP-client owner consumed by transport,
negotiation, Tool discovery/snapshot, Prompt, and Resource classes. The controller's copied client
entries and code-only reconstruction were removed; `mcpHostErrorMessages` and
`normalizeMcpFailure` remain one Extension-local Host/process/configuration owner. Disconnect
informational text, disposal exceptions, Tool execution copy, negotiation diagnostics, and Webview
diagnostic copy have distinct lifecycle/operation ownership. Future client failures must use the
package owner; Host failures stay in the controller.

## Completion

- Implementation summary: Client failures preserve package-owned stable objects through the controller,
  while Host/process/configuration fallback messages remain local. No public contract, SDK, dependency,
  lifecycle, diagnostics, or persistence behavior changed.
- Verification conclusion: Focused/affected/full tests, typechecks, repository check, build,
  integration, and final diff review passed; the known harness warning was non-fatal.
- Similarity disposition: One client normalization owner and one Host fallback owner remain; reviewer
  should independently verify the boundary and remaining origin-based overlap.
- PR/branch: [PR #221](https://github.com/yangzuo0621/ctrl-zebra/pull/221),
  `codex/eo-006-mcp-error-ownership`, squash-merged after review and passing CI.
- Completion date: 2026-08-13.
