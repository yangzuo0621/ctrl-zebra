
## Controlled MCP Client Boundary

The long-term decision and rejected alternatives are recorded in
[ADR 0001](../adr/0001-controlled-mcp-client-boundary.md). MCP is an external protocol adapter, not a
second Agent Runtime.

[ADR 0002](../adr/0002-mcp-dual-era-stdio-compatibility.md) approves the stage 18 extension for
explicit modern-only/dual stdio compatibility. T1804 records the cross-boundary contract and
configuration migration in this document. The current Extension runtime applies the reviewed
mode-aware lifecycle. The user-visible setting and versioned representation are owned by the
[configuration contract](../configuration.md).

### Package and dependency ownership

- `packages/mcp-client` owns the package-private dual-era Client lifecycle and closed modern/
  legacy version negotiation (`2026-07-28` and `2025-11-25`), capability projection, request
  correlation, pagination collectors, Server primitive normalization, and all imports from the
  official MCP TypeScript SDK. Its public entry point exposes only CtrlZebra-owned interfaces,
  strict plain values, stable errors, and injected ports.
- The first implementation pins `@modelcontextprotocol/client` to exactly `2.0.0`. Floating ranges,
  `latest`, SDK deep imports outside its documented public subpaths, and direct imports of
  `@modelcontextprotocol/core` are forbidden. The package root publicly exports the `Client`,
  `Transport`, JSON-RPC message types, and framing helpers required by a package-private adapter. A
  documented `@modelcontextprotocol/client/validators/ajv` subpath supplies the T1404 validator;
  other SDK subpaths are forbidden. A version change requires a compatibility review and committed
  lockfile evidence before code changes.
- `apps/extension` owns user configuration, Workspace Trust, selected-workspace cwd resolution,
  approval workflows, process creation, stdin/stdout/stderr pipes, complete process-tree
  termination, VS Code lifecycle integration, and mapping MCP values to Protocol DTOs and Core
  contracts. It injects a byte-bounded stdio/process port; it does not expose a process or VS Code
  object to `packages/mcp-client`.
- `packages/core` continues to own the Tool Registry, Tool Executor, Approval Policy, Agent Loop,
  context budgets, cancellation outcome, and Session state machine. It never imports an MCP package
  or SDK type. MCP Tools enter Core only through the existing `AgentTool` and Tool Call/Result
  contracts; Resources and Prompts enter only through explicit Host-controlled context inputs.
- `packages/protocol` owns Webview DTOs and Schemas. `packages/mcp-client` does not make SDK schemas
  wire contracts, and the Webview never sees JSON-RPC IDs, methods, SDK enums, capability objects,
  transport values, or Server process details.
- Production does not instantiate the SDK `StdioClientTransport` because that class spawns and
  terminates its own child process, bypassing Extension-owned trust, approval, environment, and
  process-tree confirmation. A package-private custom SDK `Transport` wraps the injected
  Extension-owned stdio/process port; SDK types stop on the inside of that wrapper.

The additional allowed dependency is:

```text
extension ─────────────→ mcp-client
mcp-client ────────────→ core contracts (only for the T1404 Tool adapter)
```

`mcp-client` has no dependency on VS Code, React, Webview code, Extension adapters, persistence, or
a concrete process implementation. A future HTTP transport, Client primitive, or multimodal
projection requires a separately approved boundary; it is not added behind the existing stdio
port.

### Connection ownership and lifecycle

- One Extension-owned `McpConnectionController` owns at most one configured Server connection and
  one monotonically increasing connection generation. Concurrent connect callers for the same
  normalized effective configuration share one in-flight attempt; a different configuration cannot
  replace it while it is live. The normalized effective configuration includes the closed
  `protocolMode` (`version: 1` without a mode normalizes to `modern-only`), Server identity,
  executable, ordered arguments, and selected cwd. Raw configuration version is not an additional
  operation identity field: version `1` implicit `modern-only` and version `2` explicit
  `modern-only` are equivalent when all other fields match.
- Activation, module import, Webview creation, Session recovery, model output, Tool discovery, and
  background timers never connect or reconnect MCP. The only connection trigger is the
  user's explicit connect operation after configuration, trust, cwd, and startup approval checks.
- The lifecycle is `disconnected → connecting → connected → disconnecting → disconnected`, with
  `connecting | connected | disconnecting → failed` for an unexpected process or protocol failure.
  `failed` owns no usable Client and requires a new explicit connect action; there is no automatic
  retry, health polling, silent restart, or Session-owned connection.
- The connection controller is the single owner of the SDK Client, process port, request registry,
  list snapshots, notification handlers, stderr collector, and cleanup promise. For the modern
  `2026-07-28` era it completes `server/discover`; for the legacy `2025-11-25` era it completes
  `initialize` / `notifications/initialized`. The controller publishes no capabilities or
  negotiated-era projection until the complete selected handshake succeeds.
- Disconnect, Server exit, failed connection negotiation, cancellation of connection setup,
  Extension disposal, or loss of Workspace Trust first closes the delivery gate and increments the
  generation, then aborts requests, closes stdin, and awaits bounded process-tree cleanup. Cleanup
  is idempotent; failure to confirm termination remains a distinct terminal error.
- Every request, notification refresh, Tool definition, approval, Resource read, Prompt preview,
  and result is bound to the current Server identity and generation. After the gate closes, late
  responses, notifications, stderr, process events, and promise settlements are discarded before
  Core, persistence, Protocol, or presentation side effects.

### Protocol and capability negotiation

- The Extension validates one strict machine-scoped configuration before startup. Version `1`
  settings are interpreted as `protocolMode: "modern-only"`; version `2` requires the explicit
  closed mode `"modern-only" | "dual"`. Unknown versions, modes, fields, transports, or malformed
  values fail with `configuration-invalid` and cannot start a process.
- The normalized configuration selects the mode before workspace binding and startup approval.
  `apps/extension` passes `modern-only` or `dual` to the controlled Client; it never silently
  coerces `dual` to modern-only. Version `1` remains an implicit modern-only operation, while an
  effective mode change invalidates approval and requires a fresh exact operation. The lifecycle
  and integration tests cover modern, legacy, malformed, and cleanup paths without network or
  credentials.
- `modern-only` sends one bounded modern `server/discover` probe and accepts only `2026-07-28`.
  `dual` sends the same probe first and may enter exactly one legacy `initialize` /
  `notifications/initialized` exchange only after a specification-classified non-modern response or
  a bounded probe timeout. A well-formed `DiscoverResult` locks modern: an advertised
  `2026-07-28` continues modern, while a missing/unsupported advertised version fails
  `protocol-incompatible` without fallback. A recognized modern JSON-RPC error also locks modern:
  a bounded advertised `2026-07-28` continues/selects modern, while a missing/unsupported version
  fails `protocol-incompatible` without fallback. After independent overflow checks, a syntactically
  or structurally malformed, or shape-validation-failing, response/error maps to `malformed-message`;
  a structurally valid response/error outside the closed recognized-modern or defined non-modern
  classifications (including unknown future or otherwise unclassified values) maps to
  `protocol-incompatible`. Neither classification authorizes fallback. Cancellation, process exit,
  trust loss, or cleanup failure is terminal and never authorizes fallback. Probe correlation is
  closed before an eligible fallback; late results are discarded by the generation gate. See the
  closed decision matrix below.
- The connected projection contains a CtrlZebra-owned `{ era, version }` pair: modern/
  `2026-07-28` or legacy/`2025-11-25`. Before this projection is valid, status may expose the
  configured mode but no selected era, version, capability, probe result, fallback result, timing,
  SDK value, or Server claim. Public failures remain the small stable error union; the Host may use
  the closed internal classifications `modern-version-unsupported`, `legacy-version-unsupported`,
  `probe-timeout-legacy-failed`, `malformed-protocol`, and `capability-rejected`, but never exposes
  their raw protocol data or fallback-attempt state.
- Startup approval and every pre-spawn revalidation compare the normalized effective operation,
  including `protocolMode`, Server identity, executable, ordered arguments, and canonical cwd.
  Version `1` implicit `modern-only` and version `2` explicit `modern-only` therefore reuse the
  same operation identity when every effective field matches; `dual` is a different operation.
  A mode change, any other effective configuration change, trust/cwd change, or an explicit retry
  invalidates pending or approved-but-unconsumed startup approval, closes the affected generation,
  and requires a fresh approval before a new process attempt. The Extension owns this comparison;
  SDK and Server values cannot replace it.
- The Client declares none of Roots, Sampling, Elicitation, Tasks, experimental capabilities, or
  other Server-to-Client primitives. It installs no handler for them. A Server request for an
  undeclared Client capability receives a bounded stable unsupported response and cannot reach
  Core, the Provider, Workspace adapters, approval, or persistence.
- SDK multi-round `input_required` auto-fulfilment is explicitly disabled with
  `inputRequired: { autoFulfill: false }`; individual calls never opt into manual
  `input_required`. Such a result is mapped to `capability-unsupported`, is never retried with
  opaque request state, and cannot invoke a hidden Roots, Sampling, or Elicitation handler.
- Server capabilities are untrusted availability claims. CtrlZebra projects only Tools,
  Resources (including Resource Templates), and Prompts. Logging, completions, Tasks,
  subscriptions, experimental capabilities, icons, and other advertised features are ignored for
  availability and never grant an operation.
- List-changed handlers are installed only when the corresponding projected Server capability
  advertises them. Notifications schedule one serialized, generation-bound full refresh; they do
  not patch the trusted snapshot from notification content.

### T1804–T1807 dual-era contract and migration

T1804 changes the protocol-era/version boundary only; it does not add a second runtime, process,
approval scope, capability set, or persistence authority. Both eras use the same selected workspace,
immutable executable and ordered arguments, startup approval, minimal environment, process-tree
cleanup, cancellation, resource limits, generation fence, Tool approval, and Server-to-Client
request rejection rules. Negotiated era is evidence of a completed handshake, not authorization.

- The public status is a strict discriminated union. Every state includes the configured mode; only
  `connected` includes the negotiated era/version pair and projected capabilities. `connecting`,
  `disconnecting`, `disconnected`, and `failed` expose no usable capability or selected era. A
  failed connection exposes a stable bounded error and fixed next step, never a raw SDK/JSON-RPC
  value or an assertion that fallback succeeded.
- The modern-first algorithm owns one probe and at most one legacy initialization per explicit
  connection attempt. It never retries, respawns, switches era after `connected`, or uses probe
  timing as a user-visible compatibility result. Cancellation and closed generations accept no late
  probe, initialization, notification, capability, catalog, persistence, or Webview effect.
- The allowed capability projection remains Tools, Resources, Resource Templates, Prompts, and
  already reviewed list-change behavior. Roots, Sampling, Elicitation, Tasks, logging, completions,
  subscriptions, experimental values, and unknown Server requests are rejected before Core,
  Provider, Workspace, approval, or persistence. Legacy annotations cannot lower Tool risk.
- Completed Tool/Resource/Prompt events may carry bounded `{ configuredMode, negotiatedEra,
  negotiatedVersion }` provenance. The provenance is historical and cannot reconnect, renegotiate,
  replay, approve, or seed a live generation. Probe/fallback attempts, timing, process data,
  credentials, raw errors, and configuration objects remain non-persistent.
