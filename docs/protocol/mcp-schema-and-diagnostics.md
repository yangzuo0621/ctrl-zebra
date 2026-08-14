
### Tool acceptance and rejection projection

Tool discovery is a per-descriptor decision, but the wire projection is still one complete atomic
snapshot. The accepted `extension/mcp-tools` catalog contains only Tools whose descriptor and
compiled schema passed the MCP boundary. A schema rejection never removes an accepted sibling;
malformed pages, duplicate identities, duplicate/reserved Registry names, and other identity or
envelope failures reject the complete snapshot. A non-empty list in which every Tool is rejected
remains the stable `invalid-schema` discovery failure; an actually empty Server list is valid.

`McpToolRejectionReason` is a strict closed enum:

```text
"forbidden-keyword" | "unknown-keyword" | "invalid-reference" |
"non-object-root" | "schema-invalid" | "limit-exceeded"
```

The reason is selected by CtrlZebra and never contains an external keyword, JSON Pointer, SDK
message, numeric JSON-RPC code, or exception text. `McpRejectedToolDto` is the strict object
`{ mcpToolName, reason }`, where `mcpToolName` uses the same well-formed Unicode and length bound as
the accepted Tool descriptor. The sequence-bearing combined catalog is:

```text
{
  server: McpServerIdentityDto,
  generation: positive safe integer,
  tools: McpToolDescriptorDto[0..1000],
  rejectedTools: McpRejectedToolDto[0..256],
  rejectedToolsTruncated: boolean
}
```

The Extension sends this strict additive version `1` message:

```text
{
  protocolVersion: 1,
  type: "extension/mcp-tool-catalog",
  requestId,
  catalogSequence: positive safe integer,
  catalog: McpToolCatalogProjectionDto
}
```

All five outer properties are required, their types are the bounded types stated above, and no
additional outer or catalog properties are accepted. The unchanged legacy `extension/mcp-tools`
message for the same publication carries the same `requestId`, Server identity, generation, and
accepted `tools` projection, but it is a compatibility projection rather than a second half of the
combined envelope; neither message is staged or required to arrive for the other.

The complete strict wrapper and its `catalog` payload are counted together as UTF-8 serialized JSON
bytes against the existing 1,048,576-byte ceiling. The Host enforces that bound during bounded
construction and before sequence allocation or sending. A candidate over the ceiling follows the
stable `limit-exceeded` whole-operation path: it retains the prior complete catalog, emits neither
the combined nor legacy catalog, and consumes no sequence. No partial envelope or mismatched old/new
catalog may be published.

`catalogSequence` is allocated and owned by the Extension Host, not the MCP Server or Webview. It
is monotonic within the `(catalog.server.serverId, catalog.generation)` scope, starts at `1` for
each new connection generation, and is allocated exactly once immediately before a fully validated
catalog is emitted. Valid empty catalogs consume a sequence; failed, cancelled, and all-rejected
discoveries consume none. The value never wraps. If the next value would exceed the safe-integer
bound, the Host closes the current delivery gate and requires an explicit reconnect; the new
generation resets the sequence. `requestId` remains an opaque correlation identifier and is not a
freshness or ordering signal.

The combined catalog contains no schema, command, environment, raw error, or arbitrary metadata.
When more than 256 Tools are rejected in a mixed snapshot, entries are first sorted by exact
`mcpToolName` in lexicographic Unicode scalar-value order (not UTF-16 code units or Server page
order), then the deterministic bounded prefix is retained and `rejectedToolsTruncated` is `true`;
accepted Tools are never truncated. An empty rejection list sets the flag to `false`.

The sequence-aware Webview validates the strict envelope and catalog before state mutation and keeps
the committed publication record plus a transient pending candidate for the current Server/generation.
The committed record includes the request ID and validated catalog payload; the pending candidate
exists only during synchronous validation and is never rendered or exposed as partial state. A
message for a different Server or generation is ignored before watermark handling. A lower sequence
than either watermark is a stale no-op. At an equal committed or pending sequence, an exact duplicate
(same Server, generation, sequence, request ID, and equivalent validated catalog payload) is an
idempotent no-op: it is ignored and never re-staged or committed. A same-scope, same-sequence
candidate with a differing request ID or payload is discarded with the stable local
`conflicting-catalog-sequence` classification, leaving pending, committed, and rendered state
unchanged. A higher sequence sets the pending candidate; only after strict validation succeeds does
it atomically replace the complete catalog and advance the committed watermark. Invalid validation
clears only the pending candidate. Generation change or disconnect clears both records and closes the
delivery gate, so late messages from the previous scope cannot commit. There is no two-half staging
slot, timer, retry, or arrival-order dependency.

The Host emits the sequence-bearing combined message before the unchanged legacy
`extension/mcp-tools` message for the same publication. A version `1` client that does not know
`extension/mcp-tool-catalog` ignores that additive message and continues rendering accepted Tools
from the legacy catalog; it loses only rejection details. The superseded
`extension/mcp-tool-rejections` message is no longer authoritative and the amended Host does not
emit it. Sequence-aware clients ignore legacy tools-only messages for catalog state so a delayed
legacy message cannot overwrite a newer combined projection.

When the complete non-empty Server list rejects every Tool, the Host returns the existing bounded
`invalid-schema` discovery outcome, retains the prior complete catalog, and emits neither an empty
combined catalog nor a legacy tools-only catalog for that failed refresh. T1803 exposes the separately
reviewed, bounded skipped-name/reason projection defined below; it does not reuse this success-catalog
message or expose raw schema data. The user-safe `invalid-schema` connection outcome remains the
authoritative failure state.

The T1801 implementation tests must cover a fully accepted catalog, mixed accepted/rejected
descriptors, schema-policy failure isolated to one Tool, invalid descriptor envelope/identity as a
whole-operation failure, all-rejected retention with no catalog emission, duplicate-name and
malformed-page failure, deterministic rejection-prefix selection independent of pagination order,
combined-envelope UTF-8 serialization at and above the one-mebibyte ceiling, refresh and
disconnect/generation stale races, overflow/reconnect reset, exact duplicate no-op at both pending
and committed watermarks, same-sequence conflicting discard at either watermark, atomic combined
publication without partial state, and an older client that ignores the additive message while
continuing to render the unchanged legacy catalog.

### Tool Schema keyword classes and reference normalization (T1802)

The schema policy is evaluated in the Extension/MCP boundary before any Core Tool or catalog
projection is constructed. It is a closed, versioned policy and is not a Webview responsibility:

- Allowed keywords are the retained Draft 2020-12 subset already listed by Architecture. Known
  annotation or unsupported-assertion keywords (`format`, `$id`, `$comment`, `readOnly`,
  `writeOnly`, `deprecated`, `nullable`, `if`, `then`, `else`, `dependentSchemas`,
  `dependentRequired`, `propertyNames`, `contains`, `minContains`, `maxContains`,
  `unevaluatedProperties`, `unevaluatedItems`, `contentEncoding`, `contentMediaType`, and
  `contentSchema`) are safely stripped after their bounded values and nested schemas are walked.
  Stripped keywords never appear in a rejected-tool reason or a wire schema because schemas are
  not part of the Webview DTO.
- A legacy `definitions` object is converted to `$defs`; a local `#/definitions/...` JSON Pointer
  is rewritten to `#/$defs/...` with RFC 6901 escaping preserved. Native and converted definition
  names must not collide (`schema-invalid`); a successful conversion itself produces no rejection
  entry. The allowed `$ref` keyword accepts only a local, well-formed, resolvable pointer to an
  exact top-level `#/$defs/<name>` anchor (or a rewritten legacy `#/definitions/<name>` target). A
  bare `#`, a root/non-anchor target, a nested pointer below an anchor, a malformed/remote target,
  or a multi-anchor cycle is an
  `invalid-reference` rejection. A direct recursive reference from a `$defs` anchor to that same
  anchor is valid; every other cyclic form, including root self-reference and nested/non-anchor
  mutual cycles, is an `invalid-reference`. This permits bounded tree/AST arguments while keeping reference
  resolution local and finite.
- The known-dangerous keyword set is exactly `pattern`, `patternProperties`, `$dynamicRef`,
  `$dynamicAnchor`, `$recursiveRef`, and `$recursiveAnchor`; each is forbidden (`forbidden-keyword`)
  because its behavior is not reviewed at this boundary (and Server-supplied regular expressions
  are not compiled or executed here). Any byte, node, depth, or property limit breach is
  `limit-exceeded`. A key outside the allowed, stripped, conversion, and known-dangerous sets is
  `unknown-keyword`; malformed values, conversion collisions, and Ajv compile failures are
  `schema-invalid`. These classifications are selected by CtrlZebra and the wire reason stays the
  closed enum above; no
  external keyword, path, raw Schema, SDK error, or exception text is exposed.
- The normalized schema must compile through the pinned Ajv adapter. The same compiled validator
  validates Tool arguments immediately before approval construction and again before execution;
  validation is shape-only and performs no coercion, default insertion, or property removal.
  Compilation and runtime validation are mandatory even when a keyword was stripped or renamed;
  compatibility handling must never bypass either stage.

### MCP diagnostic and recovery projection (T1803)

T1803 adds one additive Extension-to-Webview message for bounded failure details that do not belong
in the success catalog. Older clients ignore the unknown message and keep the existing connection and
Tool projections. The diagnostic is advisory display state: it never grants a capability, changes
connection status, authorizes a Tool, or instructs the Webview to reconnect by itself.

`McpDiagnosticRecoveryAction` is the closed union:

```text
"refresh-tools" | "reconnect" | "open-settings"
```

`refresh-tools` is an explicit `webview/mcp-refresh-tools` intent bound to the active Server and
generation. It requests one bounded current-generation Tool-list refresh and does not restart the
process or bypass the normal delivery gate. `reconnect` reuses the existing explicit connect flow
after a failed connection, and `open-settings` reuses the existing user-scoped settings action.
Neither action carries a command, environment, URI, credential, schema, approval, or Server error.

`McpDiagnosticToolEntry` reuses the strict `{ mcpToolName, reason }` shape from the rejection
projection. The name has the existing bounded, well-formed Unicode constraint and `reason` is the
closed `McpToolRejectionReason` union; no keyword, schema path, or raw cause is included.

`McpDiagnosticsProjectionDto` is a strict discriminated union. The `outcome`,
`connectionStatus`, and `recoveryAction` combinations are closed rather than inferred by the
Webview:

```text
{
  kind: "tool-rejections",
  outcome: "degraded",
  server: McpServerIdentityDto,
  generation: positive safe integer,
  connectionStatus: "connected",
  skippedTools: McpDiagnosticToolEntry[0..256],
  skippedToolsTruncated: boolean,
  recoveryAction: "refresh-tools"
}
|
{
  kind: "tool-rejections",
  outcome: "all-rejected",
  server: McpServerIdentityDto,
  generation: positive safe integer,
  connectionStatus: "failed",
  skippedTools: McpDiagnosticToolEntry[0..256],
  skippedToolsTruncated: boolean,
  recoveryAction: "reconnect"
}
|
{
  kind: "tool-rejections",
  outcome: "refresh-all-rejected",
  server: McpServerIdentityDto,
  generation: positive safe integer,
  connectionStatus: "connected",
  skippedTools: McpDiagnosticToolEntry[0..256],
  skippedToolsTruncated: boolean,
  recoveryAction: "refresh-tools"
}
|
{
  kind: "tool-discovery-failure",
  outcome: "initial",
  server: McpServerIdentityDto,
  generation: positive safe integer,
  connectionStatus: "failed",
  code: "invalid-schema" | "limit-exceeded" | "malformed-message",
  recoveryAction: "reconnect"
}
|
{
  kind: "tool-discovery-failure",
  outcome: "refresh",
  server: McpServerIdentityDto,
  generation: positive safe integer,
  connectionStatus: "connected",
  code: "invalid-schema" | "limit-exceeded" | "malformed-message",
  recoveryAction: "refresh-tools"
}
|
{
  kind: "protocol-incompatible",
  server: McpServerIdentityDto,
  generation: positive safe integer,
  connectionStatus: "failed",
  configuredMode: "modern-only" | "dual",
  supportedVersions: ["2026-07-28"] | ["2026-07-28", "2025-11-25"],
  connectionEstablished: false,
  nextStep: "open-settings"
}
|
{
  kind: "clear",
  server: McpServerIdentityDto,
  generation: positive safe integer
}
```

`degraded` retains accepted siblings in a connected catalog. `all-rejected` is the initial
`invalid-schema` outcome: no usable connection was established and the only recovery is explicit
`reconnect`. `refresh-all-rejected` retains the prior complete connected catalog and offers only a
new explicit `refresh-tools`. `tool-discovery-failure` contains no `skippedTools` field; its
`initial` variant uses `reconnect`, and its `refresh` variant retains the connected catalog and uses
`refresh-tools`. Malformed envelopes, duplicate identities, aggregate limits, and other
whole-operation failures therefore reveal no untrusted name. The `clear` variant is the explicit
replacement for a successful refresh with no diagnostic.

The `protocol-incompatible` variant is emitted only with a failed `extension/mcp-connection`. Its
`configuredMode` and `supportedVersions` are closed facts derived from the validated setting, not
from Server output. It intentionally has no probe, fallback, selected-era, capability, timing, or
success field: before the handshake completes, the UI must not describe detection or fallback as
successful. A connected message carries the negotiated era/version separately; the diagnostic never
claims one.

The Extension-to-Webview envelope is strict and accepts no additional properties:

```text
{
  protocolVersion: 1,
  type: "extension/mcp-diagnostics",
  requestId: opaque request identifier,
  diagnosticSequence: positive safe integer,
  diagnostic: McpDiagnosticsProjectionDto
}
```

`diagnosticSequence` is Host-owned and monotonic within `(server.serverId, generation)`, starts at
`1`, is allocated exactly once for every emitted replacement including `clear`, and never wraps.
The complete strict wrapper is measured incrementally as UTF-8 and must fit the existing
1,048,576-byte message ceiling. Before the count/byte prefix is selected, `skippedTools` entries are
de-duplicated by exact `(boundedToolName, reason)` (where `boundedToolName` is the bounded
`mcpToolName` value) and sorted by `mcpToolName` in lexicographic Unicode
scalar-value order; the deterministic prefix is at most 256 entries. Any omitted entry sets
`skippedToolsTruncated: true`. A successful refresh always emits a replacement (often `clear`), so
stale rejection details cannot survive a refresh. A disconnect, generation change, cancellation,
Trust loss, or disposal clears the delivery gate before late diagnostic messages are considered.

The Webview also clears diagnostics synchronously from the authoritative
`extension/mcp-connection` projection; it does not wait for a `kind: "clear"` message. A
`disconnecting`, `disconnected`, or `failed` state, or any connected projection whose Server or
generation differs from the current scope, clears the diagnostic payload, pending diagnostic
sequence, pending refresh request, recovery controls, and diagnostic live-region text before
rendering the new connection state. Host cancellation, Workspace Trust loss, and disposal are
represented by that same non-connected/failed projection; a cancelled refresh that leaves the
connection connected emits `kind: "clear"` and also invalidates the pending refresh request. Late
responses cannot restore either diagnostics or recovery controls.

The Webview ignores a wrong Server/generation, a lower sequence, an exact duplicate, or a
same-sequence conflicting payload without state mutation; sequence conflicts are local and never
shown as Server errors. Diagnostics are sent after the authoritative connection/catalog message for
the same request and generation, but are not a second half of that publication. The implementation
must test each reason/code, deterministic de-duplication and truncation, all-rejected retention,
refresh-to-clear recovery, connection-driven clear on disconnect/generation/cancel/trust/disposal
and Server-identity transitions,
stale races, protocol-incompatible no-success claims, no secrets/raw errors, and the ordinary
connected path with no diagnostics.
