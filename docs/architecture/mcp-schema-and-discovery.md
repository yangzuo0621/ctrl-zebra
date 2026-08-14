
#### Closed modern-first fallback decision matrix (T1804)

The probe decision is a closed classification, not a generic “try the other handshake” rule. A
recognized modern JSON-RPC error is modern evidence just like a `DiscoverResult`; it is never treated
as an eligible legacy signal. The advertised-version value below means only a bounded, validated list
from the recognized result/error, never an open Server field. After independent overflow checks,
syntactically/structurally malformed or shape-validation-failing response/error values map only to
`malformed-message`; structurally valid values outside the closed recognized-modern or defined
non-modern classifications (including unknown future or otherwise unclassified values) map only to
`protocol-incompatible`. Both are terminal and never authorize fallback.

| Probe or handshake observation | `modern-only` | `dual` | Stable outcome / projection |
|---|---|---|---|
| Well-formed `DiscoverResult` advertises `2026-07-28` | Continue modern; never fallback | Continue modern; never fallback | After the modern handshake completes, connected `modern / 2026-07-28` |
| Well-formed `DiscoverResult` is modern evidence but its advertised list omits `2026-07-28` or contains only an unknown future version | Do not fallback | Do not fallback | Failed `protocol-incompatible`; no selected era or capability |
| Recognized modern JSON-RPC error advertises controlled `2026-07-28` | Lock modern and continue/select `2026-07-28`; never fallback | Lock modern and continue/select `2026-07-28`; never fallback | After the modern handshake completes, connected `modern / 2026-07-28` |
| Recognized modern JSON-RPC error has no controlled supported version or omits `2026-07-28` | Lock modern; do not fallback | Lock modern; do not fallback | Failed `protocol-incompatible`; the error is not a legacy signal |
| Specification-defined non-modern probe response | Fail; legacy is not allowed | Close probe, then run exactly one legacy `initialize` / `notifications/initialized` | Connected `legacy / 2025-11-25` only after the complete legacy handshake; otherwise stable `protocol-incompatible` |
| Bounded probe timeout | Fail; legacy is not allowed | Close probe, then run exactly one legacy handshake | Connected legacy only after exact version validation; failed fallback is stable `protocol-incompatible` |
| Syntactically/structurally malformed or shape-validation-failing response/error | Do not fallback | Do not fallback | Stable `malformed-message`; no downgrade |
| Structurally valid response/error outside the closed recognized-modern or defined non-modern classifications (including unknown future or otherwise unclassified values) | Do not fallback | Do not fallback | Stable `protocol-incompatible`; no downgrade |
| Message/stream/descriptor overflow | Do not fallback | Do not fallback | Stable `limit-exceeded`; generation closes |
| Cancellation, trust loss, process exit, or cleanup failure | Do not fallback | Do not fallback | Cancellation/non-connected status, `workspace-untrusted`, `server-exited`, or `termination-unconfirmed` as applicable |
| Legacy initialization advertises an unsupported/unknown version | No second lifecycle | No second lifecycle or modern retry | Failed `protocol-incompatible`; one attempt only |
| Legacy initialization is syntactically/structurally malformed or shape-validation-failing | No second lifecycle | No second lifecycle or modern retry | Failed `malformed-message`; one attempt only |

`DiscoverResult` and a recognized modern error therefore have distinct modern success/error branches,
but share the same no-fallback lock. Only the two explicitly eligible rows (defined non-modern
response and bounded timeout) can enter legacy in `dual`; unknown future versions, unclassified
responses, malformed data, oversize data, cancellation, process exit, trust loss, and cleanup failure
are never fallback oracles. The T1804–T1807 verification set includes deterministic, no-network/no-secret
fixtures and tests for each closed classification, including malformed/validation-failing to
`malformed-message`, structurally valid unknown/unclassified to `protocol-incompatible`, recognized
modern error version selection, defined non-modern fallback, and bounded timeout fallback.
The matrix is mirrored by Protocol’s closed DTOs and Security’s stable error classification. The
Webview receives only the configured mode, closed supported-version list on failure, or negotiated
era/version after success; it never receives the decision reason or fallback state.

The cross-boundary constraint and implementation now include strict v1/v2 parsing, normalized
Protocol Schemas, bounded provenance, deterministic local fixtures, runtime dual selection,
probe/fallback lifecycle, and Extension/Webview wiring. Explicit user migration remains a settings
action; recovery never reconnects, probes, or renegotiates from persisted state.

### SDK and JSON Schema isolation

- SDK Clients, transports, JSON-RPC envelopes and IDs, errors, schemas, content objects,
  capabilities, progress tokens, task values, and cancellation notifications are private to
  `packages/mcp-client`. Boundary code accepts SDK output as `unknown`, applies hard collection
  limits, and constructs new CtrlZebra values field by field.
- Static CtrlZebra configuration, Protocol, persistence, and lifecycle objects continue to use
  strict Zod schemas. Server-supplied Tool input/output schemas are JSON Schema and are not
  translated into Zod or executed as code.
- The Core Tool declaration contract distinguishes the existing statically typed built-in schema
  from a CtrlZebra-owned `external_json_schema_2020_12` wrapper. Only the MCP boundary may create
  that wrapper, and only for an individual accepted Tool after that Tool's complete schema has
  passed the structural and compiled validation below. A replacement snapshot may contain accepted
  entries alongside bounded rejection records; no wrapper or Core Tool is created for a rejected
  descriptor. Provider adapters unwrap the already-validated plain JSON value without narrowing it
  to the built-in schema subset; SDK JSON Schema types never enter Core.
- T1404 must wrap the pinned SDK's documented `AjvJsonSchemaValidator` export behind an injected
  `ExternalJsonSchemaValidator` contract. Before compilation, a bounded structural normalizer
  accepts only the Draft 2020-12 baseline (an omitted `$schema` is treated as that baseline) and
  applies four closed keyword outcomes (allowed, safely stripped, known-dangerous rejection, and
  unknown-keyword rejection). The legacy `definitions` spelling is normalized in a deterministic
  conversion pass before reference analysis:
  - **Allowed and retained**: `$schema`, `$defs`, local `$ref`, `type`, `properties`, `required`,
    `additionalProperties`, `items`, `prefixItems`, `minItems`, `maxItems`, `uniqueItems`,
    `minProperties`, `maxProperties`, `minimum`, `maximum`, `exclusiveMinimum`,
    `exclusiveMaximum`, `multipleOf`, `minLength`, `maxLength`, `enum`, `const`, `allOf`, `anyOf`,
    `oneOf`, `not`, `title`, `description`, `default`, and `examples`. Their values are narrowed,
    recursively walked, and retained in the normalized schema.
  - **Known and safely stripped**: `format`, `$id`, `$comment`, `readOnly`, `writeOnly`,
    `deprecated`, `nullable`, `if`, `then`, `else`, `dependentSchemas`, `dependentRequired`,
    `propertyNames`, `contains`, `minContains`, `maxContains`, `unevaluatedProperties`,
    `unevaluatedItems`, `contentEncoding`, `contentMediaType`, and `contentSchema`. Their values
    are still recursively walked and bounded (so a dangerous or unknown nested keyword cannot be
    hidden), then omitted from the normalized schema. Stripping is a deliberate loss of annotation
    or unsupported assertion semantics, not an admission of those keywords to Ajv.
  - **Definitions conversion**: a `definitions` object is normalized into `$defs`. If both names
    are present, entries are merged only when their decoded definition names do not collide; a
    collision is `schema-invalid`; a successful conversion itself produces no rejection entry.
    Every `#/definitions/<name>` local JSON Pointer is rewritten to
    `#/$defs/<name>` while preserving RFC 6901 escaping. Reference targets are restricted to an
    exact top-level `$defs` anchor: a bare `#`, a root/non-anchor pointer, or a nested pointer below
    an anchor is not in the accepted scope. Missing targets, malformed pointers, and remote
    references are rejected as `invalid-reference`.
  - **Must reject (known dangerous keywords)**: `pattern`, `patternProperties`, `$dynamicRef`,
    `$dynamicAnchor`, `$recursiveRef`, and `$recursiveAnchor`. These keywords are known but
    unreviewed by this boundary and map to `forbidden-keyword`; no vendor extension is silently
    ignored. Any keyword not listed in the allowed, stripped, conversion, or must-reject sets is an
    **unknown keyword** and maps to `unknown-keyword`. The allowed `$ref` keyword is separately checked for a
    local target: remote/malformed/unresolved targets and multi-anchor cycles map to
    `invalid-reference`; structural or compilation failures map to `schema-invalid`; limits remain
    `limit-exceeded`.
  Local references are resolved after normalization. The reference graph has one vertex for each
  top-level `$defs` anchor and one edge from the containing anchor to each referenced anchor; a
  reference from the root schema is checked for target existence but is not a graph cycle source.
  A direct recursive reference means a `$ref` anywhere below `#/$defs/name` whose exact target is
  `#/$defs/name`; that self-edge is supported by the pinned Ajv validator. Every other cyclic form
  is rejected as `invalid-reference`, including cycles through two or more distinct anchors
  (`A -> B -> A`), a root self-reference (`$ref: "#"`), and cycles involving nested or non-anchor
  pointers (which are outside the accepted target scope in any case). This is the real recursion
  contract and replaces the earlier blanket prohibition on cyclic references.
  Validation does not coerce types, insert defaults, remove properties, or return all errors.
  The normalized schema must compile through the injected Ajv validator, and that same compiled
  validator must validate arguments immediately before approval construction and again before
  execution. Compiled validators are cached only for the immutable current-generation Tool
  snapshot and disposed with it.
- The same compiled input schema validates Tool arguments immediately before approval construction
  and again before execution. An advertised output schema, when present, validates normalized
  structured output. Validation proves shape only; it never proves safety, read-only behavior,
  idempotence, or authorization.

### Tool discovery acceptance and snapshot isolation (T1801)

- A bounded `tools/list` collection is evaluated one descriptor at a time. Each descriptor produces
  exactly one internal result: `accepted` carries the immutable descriptor and compiled input/output
  validators; `rejected` carries only the bounded MCP Tool name and one value from the closed
  `McpToolRejectionReason` set (`forbidden-keyword`, `unknown-keyword`, `invalid-reference`,
  `non-object-root`, `schema-invalid`, or `limit-exceeded`). A reason is a CtrlZebra classification,
  never a Server keyword, JSON Pointer, SDK error, or exception message.
  The result is a discriminated value (`{ kind: "accepted", ... } | { kind: "rejected", ... }`),
  not a thrown per-Tool exception that can abort sibling evaluation.
- A schema rejection is local to that Tool. It must not abort, remove, or invalidate any sibling
  Tool whose descriptor and schema were accepted. Descriptor-envelope failures that make identity or
  trust impossible (`malformed-message`, an invalid or duplicate MCP name, a duplicate or reserved
  Registry name, or an unknown descriptor property) remain whole-operation failures rather than
  becoming a rejection entry. The existing list, descriptor, schema, and serialized snapshot limits
  remain hard limits.
- The adapter builds the complete replacement off to the side, including accepted Tools, immutable
  schema identities, validators, and the bounded rejection projection. It publishes one atomic
  current-generation snapshot only after every input descriptor has produced a result. A non-empty
  list with no accepted Tool is an `invalid-schema` discovery failure and publishes no empty snapshot;
  an empty Server list is a valid empty snapshot. Any malformed page, duplicate identity, aggregate
  limit breach, or other whole-operation failure likewise leaves the last complete snapshot intact.
- Snapshot publication is fenced by Server identity, connection generation, and the discovery
  context object. A refresh or list-changed notification may be coalesced, but a late response from
  an older context, a closed generation, a disconnected Client, or a cancelled refresh can never
  revoke or replace a newer snapshot. On a successful replacement the previous snapshot is revoked
  only after the new snapshot is fully constructed; approvals and Tool Calls remain bound to the
  immutable snapshot and schema identity that created them.
- The Webview receives one additive, sequence-bearing `extension/mcp-tool-catalog` projection that
  contains the accepted Tools and bounded rejection details together. Rejection details remain
  bounded independently to at most 256 entries and carry an explicit truncation marker; before
  truncation, entries are sorted by exact MCP Tool name using lexicographic Unicode scalar-value
  order (not UTF-16 code units or Server page order), so pagination and refresh order cannot change
  which prefix is shown. Truncating diagnostics never truncates the accepted Tool catalog. The
  projection contains no schema, keyword path, raw error, command, environment, or Server-provided
  metadata. The legacy tools-only `extension/mcp-tools` message remains unchanged and is sent for
  older clients, but a sequence-aware client ignores it for catalog state and treats the combined
  message as authoritative. The superseded `extension/mcp-tool-rejections` message is not an
  authority for sequence-aware clients and is not emitted by the Host after this amendment.
- The Extension Host owns a monotonic `catalogSequence` for each `(server.serverId,
  connection.generation)` scope. It starts at `1` for a new generation and is allocated exactly
  once immediately before each complete valid catalog projection is emitted, including a valid
  empty catalog; failed, cancelled, or all-rejected discovery allocates no sequence and emits no
  projection. The complete strict wrapper plus catalog is measured as UTF-8 serialized JSON bytes
  during bounded construction and before sequence allocation or sending; it must be at most
  1,048,576 bytes. An over-limit candidate follows the stable `limit-exceeded` whole-operation
  failure path, retains the previous complete snapshot, emits neither combined nor legacy catalog,
  and consumes no sequence. Both the request correlation and sequence are Host-owned values; the
  MCP Server and Webview never choose or increment them. The value is a positive safe integer and
  never wraps. If the next value would overflow, the Host closes the delivery gate and requires a
  later explicit reconnect, which creates a new generation and resets the sequence to `1`.
- A sequence-aware Webview validates the strict combined envelope before any state mutation and
  keeps the committed publication record and a transient pending candidate for the current
  Server/generation. The committed record includes its request ID and validated catalog payload;
  the pending candidate exists only during synchronous validation and is never rendered or exposed
  as partial state. A message for a different Server or generation is ignored before watermark
  handling. Within the active scope, a lower sequence than either watermark is a stale no-op. At an
  equal committed or pending sequence, an exact duplicate (same Server, generation, sequence,
  request ID, and equivalent validated catalog payload) is an idempotent no-op: it is ignored and
  never re-staged or committed. A same-scope, same-sequence candidate with a differing request ID
  or payload is discarded with the stable local `conflicting-catalog-sequence` classification,
  leaving both watermarks and the current snapshot unchanged. A higher sequence sets the pending
  candidate, and only after strict
  validation succeeds does it atomically replace the complete catalog and advance the committed
  watermark; invalid validation clears only the pending candidate. A generation change/disconnect
  clears pending and committed records; late messages from the prior scope cannot cross that fence.
  There is no two-half slot, timer, retry, or receipt-order dependency for the combined message.
- The Host emits the sequence-bearing combined projection before the unchanged legacy
  `extension/mcp-tools` projection for the same request, correlation ID, Server identity, and
  generation; this compatibility projection is not a second half and is never jointly staged.
  Older clients reject/ignore the unknown combined type and continue rendering accepted Tools from
  the legacy message; they lose only the optional rejection details. A non-empty list with zero
  accepted Tools returns the stable
  `invalid-schema` outcome and publishes neither an empty catalog nor a rejection projection.
  T1803 exposes any already-validated names/reasons for that all-rejected case only through its
  separate failure diagnostic, never through the success-catalog projection.
- The T1801 implementation gate tests a fully accepted catalog, a mixed catalog with one or more
  rejected siblings, an all-rejected refresh retaining the prior snapshot with no catalog emission,
  duplicate-name and malformed-page whole-operation failures, deterministic rejection-prefix
  selection across pagination order, combined-envelope UTF-8 serialization at and above the
  one-mebibyte ceiling, refresh and disconnect/generation races, sequence overflow and reconnect
  reset, exact duplicate no-op at both pending and committed watermarks, same-sequence conflicting
  discard at either watermark, atomic combined publication without partial state, and an older
  client that ignores the additive message while still rendering the unchanged legacy catalog.
