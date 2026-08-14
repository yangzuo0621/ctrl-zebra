
### MCP diagnostic and recovery projection (T1803)

T1803 adds a separate, additive diagnostic projection for failures that are not a usable Tool
catalog. It does not change the authority or success semantics of `extension/mcp-connection`,
`extension/mcp-tool-catalog`, or the legacy `extension/mcp-tools` message. The Extension owns the
projection and the Webview treats it as bounded display state only; it never becomes a Tool,
approval, capability, connection, or retry grant.

- `packages/mcp-client` classifies a rejected descriptor with the existing closed
  `McpToolRejectionReason` set. Mixed snapshots continue to publish accepted siblings atomically.
  The client also retains a bounded, generation-bound diagnostic outcome for a failed or rejected
  refresh: schema-only rejection details may contain only the already-validated MCP Tool name and
  reason; whole-operation failures contain only their stable error code and no descriptor name.
  A non-empty all-rejected list remains the `invalid-schema` discovery failure and retains the
  previous complete snapshot, but its validated rejection prefix is available to the Extension
  for the separate diagnostic projection before a failed initial connection is cleaned up.
- The Extension maps each outcome to a strict `McpDiagnosticsProjectionDto`. The projection has a
  Host-owned positive-safe-integer `diagnosticSequence` scoped to `(server.serverId, generation)`;
  it starts at `1`, is allocated once for every emitted replacement (including an explicit clear),
  never wraps, and closes the generation on overflow. A request ID is correlation only and never a
  freshness signal. Diagnostics are de-duplicated by exact `(boundedToolName, reason)` (the
  bounded `mcpToolName` value) before sorting by MCP Tool name in Unicode scalar-value order and
  applying the independent 256-entry
  prefix. The projection sets `skippedToolsTruncated: true` whenever entries are omitted by the
  count or the serialized-message ceiling; accepted Tool descriptors are never truncated to fit
  diagnostics.
- A successful Tool refresh always replaces the diagnostic projection, including with an explicit
  `clear` value when no Tool is skipped. A failed refresh leaves the last complete catalog intact
  but replaces diagnostics with its bounded failure/recovery outcome. Disconnect, generation
  change, cancellation, trust loss, and disposal synchronously close the diagnostic delivery gate
  and clear Webview diagnostics; late pages, errors, and timer settlements cannot recreate them.
  The Webview independently clears diagnostics, pending refresh, recovery controls, sequence
  watermarks, and diagnostic live-region text whenever it receives an authoritative
  `extension/mcp-connection` state of `disconnecting`, `disconnected`, or `failed`, or a connected
  state for a different Server/generation. It never waits for `kind: "clear"`; that variant is only
  the connected-success replacement. A cancelled refresh that leaves the connection connected
  emits `kind: "clear"` and invalidates the pending refresh request.
  Exact duplicate publications at a committed or pending sequence are no-ops. A same-sequence
  candidate with a different request ID or payload is discarded as a local diagnostic sequence
  conflict, without changing the rendered state.
- A protocol-incompatible connection diagnostic contains only the configured mode (`modern-only` or
  `dual`), the corresponding closed supported version set (`["2026-07-28"]` or
  `["2026-07-28", "2025-11-25"]`), and a fixed next action. It is emitted with the failed
  connection state and explicitly records that no connection was established. It never reports a
  probe, fallback attempt, timing, version selection, or compatibility success before the connection
  handshake has completed. The negotiated era/version is available only on a successful connected
  projection.
- Recovery actions are closed Host-owned intents (`refresh-tools`, `reconnect`, or `open-settings`).
  They do not carry a command, environment, URI, credentials, raw schema, SDK/JSON-RPC error,
  stderr, stack, schema path, or Server metadata. A recovery action only requests the normal
  generation/trust/approval checks; it cannot authorize a Tool, reconnect silently, or retry after
  cancellation or disposal. The Webview displays fixed localized text selected from the stable
  reason/code and action, never third-party prose.

The strict union constrains recovery combinations: `degraded` is connected plus
`refresh-tools`; initial `all-rejected` is failed plus `reconnect`; refresh `all-rejected` is
connected plus `refresh-tools`; initial whole-operation failure is failed plus `reconnect`; refresh
whole-operation failure is connected plus `refresh-tools`; protocol incompatibility is failed with
the configured mode, its closed version set, `connectionEstablished: false`, and `open-settings`;
and `clear` has no recovery action. The Webview does not infer a legal combination from independent
fields.

The diagnostic message is additive and ignored by older clients. It is sent after the authoritative
connection/catalog state for the same request and generation, but it is never a second half of a
catalog publication. T1803 tests must cover each rejection classification, all-rejected and mixed
outcomes, deterministic Unicode ordering, duplicate suppression, count/byte truncation, explicit
clear after a successful refresh, stale sequence and generation races, disconnect cleanup and
Server-identity transitions,
protocol-incompatible messaging without probe/fallback claims, connection-driven clear on
disconnect/generation/cancel/trust/disposal, secret/raw-error exclusion, the normal connected path
with no diagnostics, and keyboard/screen-reader recovery behavior.
