# Protocol Guidelines

This document defines the Webview/Extension message boundary established before T0105. It applies to messages in both directions and complements the architecture and security rules in `AGENTS.md`.

## Envelope

- Every message is a strict JSON object with `protocolVersion`, `type`, and `requestId` fields.
- `protocolVersion` identifies the complete wire contract. T0105 starts at version `1`; an unsupported version is invalid rather than silently coerced.
- `type` is a stable, namespaced string in `<sender>/<action>` form. T0105 defines `webview/ping` and `extension/pong`.
- `requestId` is an opaque, non-empty string of at most 128 characters. A response copies the request identifier exactly from its request.
- Unknown properties are rejected. Payload fields are added only when a concrete message requires them.

## Direction and Naming

- Webview-to-Extension commands use the `webview/` namespace. Extension-to-Webview responses and events use the `extension/` namespace.
- Message names describe protocol intent rather than component names, DOM events, command IDs, or implementation functions.
- A message type is never repurposed with incompatible semantics. Breaking wire changes require a new protocol version and an explicit compatibility decision.

## Request Correlation

- The sender creates a fresh request identifier before posting a request and owns any pending UI state for that request.
- A direct response uses the same `requestId`. Consumers ignore responses that do not match an active request.
- T0105 established the envelope only. Session continuation, cancellation, persistence, and restoration
  are governed by the multi-turn rules below; they do not change the meaning of `requestId`.

## Provider Model Selection Boundary

T1602's `ctrlZebra.selectModel` flow is Extension-host only. It is intentionally not a Webview
message, Session command, Run event, or persisted Session record: the Host reads the active Provider
configuration, performs the narrowly approved model-list request when eligible, presents the VS Code
Quick Pick or manual input, and writes only the existing `ctrlZebra.provider.model` setting after an
explicit user choice.

- No API key, authorization header, endpoint URL, workspace or Session identity, message, Tool data,
  provider response body, or SDK value crosses this protocol boundary. The list result is consumed
  and discarded in the Extension Host; it is not echoed to the Webview or stored in a message,
  checkpoint, or Session.
- Provider and model identifiers used by a future Webview presentation remain bounded, validated
  configuration values rather than arbitrary response objects. A later task that invokes this flow
  from the Webview must add a separate strict, additive request/response Schema with explicit
  cancellation and stable error categories; it must not reuse `webview/submit`, `extension/run-error`,
  or an open metadata bag.
- Cancellation, missing credentials, an unavailable or empty list, and configuration-write failure
  are host outcomes. They do not create a Run error or terminal Session event. If a future protocol
  projection reports one of them, it must preserve cancellation as distinct from failure and expose
  only bounded user-safe status, never raw provider text.

## Provider Onboarding Display and Actions (T1603)

T1603 adds a small, additive Provider onboarding contract for the empty Webview state. The Host
remains authoritative for Provider settings, model selection, and SecretStorage. The Webview receives
only a validated display projection and sends intent-only actions; it never receives or supplies a
command ID, endpoint, model ID, Secret reference, credential value, authorization header, workspace
or Session content.

- `webview/provider-status` is the strict status request `{ protocolVersion, type:
  "webview/provider-status", requestId }`. It has no payload. The Host reads the active Provider
  configuration and returns the bounded `extension/provider-status` response; opening the Webview,
  restoring a Session, and starting a Run do not perform a Provider request.
- `webview/provider-save-key`, `webview/provider-select-model`, and
  `webview/provider-open-settings` are separate strict intent messages containing only the common
  envelope. The Host resolves the active Provider itself, then invokes the existing T1601/T1602
  host workflow (or the VS Code settings command for the last intent). A stale Webview projection
  cannot select a different Provider or Secret name.
- `extension/provider-status` is strict and contains only `{ protocolVersion, type:
  "extension/provider-status", requestId, provider, apiKeyConfigured, modelConfigured }`, where
  `provider` is the closed enum `"openai" | "gemini" | "openai-compatible"` and both status fields
  are booleans. `apiKeyConfigured` means the active Provider's credential requirement is satisfied;
  a validated loopback OpenAI-Compatible endpoint may therefore report `true` without a stored key.
  `modelConfigured` means that a valid non-empty model setting exists; the model ID itself never
  crosses this boundary. No endpoint or capability state is included. This projection is not a
  configuration instruction and is ignored when its `requestId` is stale or unrelated.
- `extension/provider-action` reports one bounded outcome for a matching action request. The
  strict `action` enum is `"save-key" | "select-model" | "open-settings"`; `status` is
  `"completed" | "cancelled" | "failed"`. A failed response carries only one stable code from
  `"configuration" | "storage" | "unavailable" | "internal"` and a fixed, user-safe message of
  at most 256 characters; completed and cancelled responses carry no error details. Cancellation
  is distinct from failure and performs no configuration or SecretStorage side effect. The Host
  sends a fresh `extension/provider-status` snapshot after an action settles, reusing that action's
  `requestId`. The Webview accepts that snapshot only after the matching terminal action outcome for
  its pending action; a normal status request is correlated only to its own `requestId`. Neither
  response exposes the action's input or a third-party response.
- A malformed, unknown, unsupported-version, or wrong-direction envelope is ignored during Schema
  validation and never produces a Provider action outcome. Only a strictly validated and dispatched
  intent whose Host workflow fails is mapped to `configuration`, `storage`, `unavailable`, or
  `internal`. Raw Provider responses, SDK errors, endpoint URLs, settings values, credentials, and
  authorization material are never copied into a message. These messages do not create a Run error
  or Session event.

## Restricted Markdown and external-link intent (T1702)

Answer text is a bounded, untrusted display projection. The Webview parser uses the approved
`markdown-it` 14.3.0 configuration (`html: false`, `linkify: false`, `breaks: true`, no images or
unreviewed plugins) and maps tokens to fixed React elements. Parser HTML is never placed on the wire
or passed to an HTML sink. Raw HTML, unsupported constructs, and dangerous destinations remain text.

- `webview/open-external-link` is a strict Webview-to-Extension intent with the shape `{ protocolVersion,
  type: "webview/open-external-link", requestId, href }`. `href` is at most 2,048 characters,
  contains no control characters or spaces, and must be an absolute `http` or `https` URL. The
  Schema rejects `javascript:`, `data:`, `file:`, `vscode:`, relative, protocol-relative, malformed,
  and overlong values.
- The Webview creates a fresh request ID for each user link activation, prevents default Webview
  navigation, and does not wait for or display a response. The Host validates the same allowlist a
  second time, then calls `vscode.env.openExternal` with the parsed URI. Missing Host capability,
  stale/unknown envelopes, rejected schemes, and open failures produce no Webview navigation or
  model/Session/Tool side effect.
- Markdown rendering is bounded to a 262,144-code-point and 1,048,576-byte complete prefix before
  tokenization. Streaming deltas may update the current display tree while a structure is unfinished,
  but cancellation, terminal status, or Session replacement closes the display gate and accepts no
  later delta or link action. Code-copy operations remain Webview-local and are not protocol messages.

## Session and Run Commands

The multi-turn contract is additive within protocol version `1`. The Extension and Webview are shipped
in lockstep, and an older consumer that does not recognize `webview/new-chat` ignores that command under
the existing unknown-message rule. Existing `webview/submit` messages without `sessionId` retain their
new-Session behavior.

- `webview/submit` is the strict object `{ protocolVersion, type: "webview/submit", requestId, content,
  sessionId? }`. `content` keeps the existing non-empty, one-million-character bound. Omitting
  `sessionId` asks the Extension to allocate a new Session; providing it asks for an exact continuation
  of that Session. `sessionId: null`, malformed identifiers, unknown Sessions, and identifiers that do
  not match the selected/owned Session are rejected. The Extension never silently creates a different
  Session when continuation fails.
- `webview/new-chat` is the strict object `{ protocolVersion, type: "webview/new-chat", requestId }`.
  It is an explicit reset intent, not a delete operation and not a model request. When no Run or
  restore owns the Webview, the Host invalidates unconsumed Resource/Prompt attachments and pending
  restore state; the Webview clears its transcript and selected Session. The next submit omits
  `sessionId`. A command racing an active Run, restore, or Session switch is ignored or rejected
  without changing the active owner, and stale replies remain ignored by request correlation.
- `extension/session-started` is a strict Host-to-Webview event containing `{ protocolVersion,
  type: "extension/session-started", requestId, sessionId }`. The Host emits it once, after the
  requested Session has been validated or a new Session has been allocated and the Run has produced
  its first accepted event. The Webview accepts it only for the active request and stores the
  confirmed Session identity; it never derives an identity from `requestId`, display state, or model
  output. A stale, duplicate, or mismatched event has no UI or ownership effect.
- A Session accepts one active Run at a time. The Host allocates a fresh opaque Run identity for each
  submit, distinct from `sessionId`, message IDs, and `requestId`; Webview and model data never choose
  this identity. Run identity is required for Core ownership, exact approvals, checkpoints, diagnostics,
  and cancellation/resource fencing even when the live wire projection is correlated by `requestId`.
- A continuation response never replays an approval, Tool, Provider request, or side effect from a
  prior Run. All accepted live events preserve source order and are ignored after the matching Run's
  terminal status or after Session replacement.
- The existing bounds remain authoritative: Session IDs are at most 128 characters, persisted IDs
  are at most 100 UTF-8 bytes, submitted content is at most 1,000,000 characters, restored message
  projections contain at most 10,000 messages, and normalized Tool Results remain within the
  one-mebibyte serialized ceiling. Producers enforce limits incrementally before constructing a
  complete history or payload.

An unknown or mismatched Session is a Session error, not a new Run. A damaged or corrupt Session is
isolated and cannot start a model request. A recovered `interrupted` Session may begin only after an
explicit new submit allocates a fresh Run; recovery itself never resumes work.

## Reasoning Summary Messages

Reasoning summaries use dedicated Extension-to-Webview messages. They never reuse
`extension/text-delta`, and the Webview never sends reasoning content or lifecycle messages back to
the Extension.

- `extension/reasoning-start` contains only the envelope and `blockId`.
- `extension/reasoning-delta` contains the envelope, the same `blockId`, and `text`.
- `extension/reasoning-end` contains the envelope, the same `blockId`, and `truncated`.
- `extension/reasoning-limit` is a strict union. Block-scoped variants contain `scope: "block"`,
  `blockId`, and `reason: "code-points" | "utf8-bytes"`; run-scoped variants contain
  `scope: "run"` and `reason: "code-points" | "utf8-bytes" | "block-count"`. It is emitted at
  most once for each affected block and once for the run, respectively.

`blockId` is a non-empty opaque CtrlZebra identifier of at most 128 characters. It correlates one
start/delta/end lifecycle inside the active `requestId`; it is not a Provider ID and conveys no
vendor, model, step, token, or security semantics. A consumer requires both the active `requestId`
and block ID to match. It ignores duplicate starts or ends, deltas for unopened or ended blocks,
events for another request, and every event received after a terminal run status.

Live message delivery preserves the exact accepted Runtime event order relative to
`extension/text-delta`, `extension/tool-state`, and run status messages. More than one reasoning
block may occur in a run, including across Tool steps. An empty start/end lifecycle remains
protocol-valid but does not create visible Webview content.

## Token Usage Messages

Provider Usage is delivered as a dedicated Extension-to-Webview event and never as text or Tool
content. `extension/token-usage` is the strict object `{ protocolVersion, type:
"extension/token-usage", requestId, usage }`; `usage` may contain any subset of non-negative integer
`inputTokens`, `outputTokens`, and `totalTokens`, each bounded to `2,000,000`. An empty object is a
valid explicit indication that no count was supplied. The values are actual Provider-reported usage
only; prices, billing, and client estimates are not represented.

The Extension preserves accepted source order and emits at most one Usage message per model step;
an empty Provider report is consumed as no usable count and produces no live or persisted Usage
event.
The Webview accumulates each present field independently for the active Session projection, keeps
missing fields unknown, and labels a partial projection as partial. A cumulative addition above
`2,000,000` is rejected by the shared merge rule: the live projection becomes explicitly unavailable
for that Session, including continuations, instead of being clamped. A terminal response with no
Usage shows an explicit unavailable state instead of an estimate or fabricated zero. Duplicate,
stale, mismatched, malformed, or post-terminal Usage messages are ignored without persistence or UI
side effects.

Reasoning text is well-formed Unicode and each delta contains 1–8,192 Unicode code points and at
most 32,768 UTF-8 bytes. The Extension collector also enforces these cumulative ceilings without
first constructing the complete value:

| Scope | Unicode code points | UTF-8 bytes | Blocks |
|---|---:|---:|---:|
| One block | 32,768 | 131,072 | — |
| One run | 65,536 | 262,144 | 32 |

When a delta crosses the remaining block or run budget, the Extension may send only the largest
prefix that fits both ceilings, split on a Unicode code-point boundary, then emits the structured
limit message and discards later reasoning text in that scope while continuing to consume lifecycle
control events. A block end reports `truncated: true` when any of that block's text was omitted.
After 32 accepted blocks, later starts, deltas, and ends are replaced by one run-scoped
`block-count` limit indication. Truncation is a successful bounded display outcome, not a Provider
or run error.

Limit reporting is deterministic. UTF-8 bytes are measured from the exact well-formed string
without a byte-order mark. If code-point and byte ceilings are reached by the same accepted prefix,
the reason is `utf8-bytes`; if block and run ceilings are crossed by the same delta, the block marker
is delivered first and the run marker second. Counters saturate at their ceilings and do not grow
with discarded content.

Reasoning restoration does not add fields to the existing strict `extension/session-restored`
message. The additive optional `usage` field carries the validated cumulative Provider counts when
available and is absent for legacy Sessions or responses without usable counts. For every successful
restore, the Extension first sends one correlated
`extension/reasoning-restored` message containing:

- the restored `sessionId`;
- at most 32 strict block records with `blockId`, positive `startSequence`, optional positive
  `endSequence`, bounded non-empty `content`, `state: "complete" | "partial"`, and `truncated`;
- `runTruncated`, which preserves a persisted run-level limit marker.

Block records use the same per-block and aggregate ceilings as live delivery.
`state: "complete"` requires a matching persisted end; cancellation, failure, interruption, tail
damage, or an otherwise missing end produces `partial` and never causes a synthetic end. Sequence
fields preserve the block's position in the ordered event log relative to answer and Tool events.
The Webview stages this bounded message by `requestId` and `sessionId`; the immediately following
matching `extension/session-restored` atomically commits both projections and completes the restore
request. A session error, mismatch, Session switch, or disposal discards the staged reasoning.
Sessions without retained reasoning use an empty `blocks` array and `runTruncated: false`, which
creates no visible UI. Restoration never emits live start/delta/end messages, resumes a request, or
asks the Webview to infer content from display order.

These message types are additive protocol version `1` messages: existing message meanings and
shapes do not change. A version `1` consumer that does not know them ignores them under the existing
unknown-message rule and continues to render answer and Tool state. Provider metadata, SDK event
names or enum values, opaque or encrypted reasoning, signatures, raw responses, and arbitrary
metadata bags are forbidden.

## Runtime Validation and Unknown Messages

- Boundary inputs are accepted as `unknown` and validated with the direction-specific Zod Schema before dispatch or state updates.
- Schemas use strict objects so extra fields cannot smuggle unreviewed data across the boundary.
- The Extension ignores malformed input, unsupported protocol versions, unknown message types, and messages sent in the wrong direction. It does not echo invalid content or branch on validation error text.
- The Webview likewise ignores invalid Extension messages and responses that do not correlate to its active request.
- TypeScript types are inferred from the authoritative Schemas. Handwritten duplicate wire types are forbidden.

## Run Errors

- A failed chat run emits one correlated `extension/run-error` message before its terminal
  `extension/run-status` message. A response that ends with Provider finish reason `length` emits
  terminal `truncated` without a run error; the Webview labels the retained text as incomplete.
  Cancellation emits only `cancelled` and never an error message.
- The run error category is a closed set: `authentication`, `network`, `rate-limit`, `context`,
  `tool`, and `internal`. The Extension maps trusted error types to these categories; unknown
  failures use `internal`.
- A structured Provider context-window rejection is normalized as `context-overflow`, mapped to the
  safe `context` UI category, and may trigger at most one Core-owned reduced-context retry. A second
  overflow or an unreducible protected message is terminal; ordinary `invalid-request` never enters
  this recovery path.
- Each category has one fixed, user-safe message that explains the failure and a reasonable next
  action. Raw error messages, stacks, SDK objects, response bodies, Tool input/output, workspace
  content, and nested causes are forbidden.
- `requestId` associates the error with the active run. The Webview ignores stale or unrelated run
  errors and clears the previous error when a new run begins.
- Tool Result errors remain attached to their exact Tool Call through `extension/tool-state`.
  `extension/run-error` represents only a terminal run failure and does not replace Tool Result
  details or turn a recoverable Tool failure into a failed run.
- Cancellation emits only the correlated `cancelled` terminal status and never a run error. After
  truncation, cancellation, failure, interruption, Session replacement, or disposal, the Extension closes the
  event gate: no later text delta, reasoning event, Tool Result, retry, approval response, or side
  effect is delivered. A failed or interrupted Run may display its retained partial answer, but that
  partial answer is not model history; the next Run receives the user prompt and only complete,
  validated Tool pairs from the ordered persisted projection.

## Serializable Boundary

- Protocol values must survive `JSON.stringify` followed by `JSON.parse` without semantic change.
- Allowed values are JSON objects, arrays, strings, finite numbers, booleans, and `null` as explicitly admitted by a Schema.
- `undefined`, `bigint`, functions, symbols, class instances, errors, DOM objects, VS Code objects, typed arrays, and cyclic structures are forbidden.
- `vscode.Uri`, dates, binary data, and host-specific values require an explicit serializable DTO in a later task; raw instances never cross the boundary.

## Tool Data Contracts

- Tool names are lower `snake_case`, start with a letter, contain only lowercase ASCII letters,
  digits, and underscores, and are at most 64 characters. A published name is stable: renaming it,
  reusing it for incompatible behavior, or changing its input/result meaning requires an explicit
  public-contract and compatibility decision.
- Tool Call IDs are opaque, non-empty strings of at most 128 characters. A Tool Result copies both
  the call ID and tool name exactly so consumers can preserve complete Call/Result pairs without
  inferring correlation from array position or display text.
- Generic Tool Call input is a JSON value: string, finite number, boolean, null, array of JSON
  values, or object with JSON values. It excludes `undefined`, non-finite numbers, `bigint`, sparse
  arrays, class instances, functions, symbols, cycles, and host objects. Passing this generic Schema
  does not imply that a specific tool accepts the input.
- Tool Result is a strict union discriminated by `status`. A `success` result contains JSON output
  and `truncated`; an `error` result contains one structured error and no success output. Unknown
  properties are rejected in both variants.
- Structured tool error codes form a stable closed set: `invalid-input`, `unknown-tool`, `denied`,
  `failed`, and `invalid-output`. The message is non-empty, at most 1,024 characters, and user-safe.
  It must not contain raw exception messages, stack traces, credentials, authorization material, or
  unrestricted host or provider diagnostics.
- The complete normalized Tool Result, measured as its JSON serialization encoded as UTF-8, is at
  most 1,048,576 bytes. Output producers enforce the limit while collecting data; the shared Schema
  repeats the check as defense in depth. A result must not first build an unbounded value merely to
  discover that serialization rejects it.
- `truncated: true` means content was intentionally omitted to satisfy a hard output limit. Once
  true, later serialization, persistence, context construction, and UI mapping must preserve it.
  T0401 establishes the one-mebibyte serialized ceiling and marker; T0702 implements narrower,
  type-specific character, line, and entry truncation before context insertion.
- Cancellation is not a Tool Result status or error code. A cancelled run stops the tool through its
  `AbortSignal`, emits no later result, and is represented by the owning Agent lifecycle contract.

## Ownership

- `packages/protocol` owns Schemas, inferred types, protocol constants, and public message names. It has no dependency on React, VS Code, Node.js host APIs, or model SDKs.
- The Extension Controller owns validated dispatch and response construction. VS Code adapters own `onDidReceiveMessage`, `postMessage`, failure reporting, and Disposable lifetimes.
- One Webview-local adapter owns the single `acquireVsCodeApi()` call and validates Extension messages before notifying presentation code.

## MCP Cross-Boundary Contract

MCP Protocol and SDK values terminate before this boundary. The DTOs below are CtrlZebra-owned,
strict, JSON-serializable projections planned as additive protocol version `1` messages. They never
contain JSON-RPC IDs or methods, SDK types or enum values, process handles, executable or environment
values, raw capability objects, arbitrary metadata, Server error data, or unbounded content.

### Shared identity, status, and errors

`McpServerIdentityDto` is the strict object `{ serverId, displayName }`. `serverId` is the configured
lower `snake_case` identity and `displayName` is its bounded user label. It does not contain command,
arguments, cwd, configuration scope, credentials, or transport details.

`McpConnectionDto` is the strict object:

```text
{
  server: McpServerIdentityDto,
  generation: positive safe integer,
  status: "disconnected" | "connecting" | "connected" | "disconnecting" | "failed",
  protocolVersion?: "2026-07-28",
  capabilities: {
    tools: boolean,
    toolsListChanged: boolean,
    resources: boolean,
    resourceTemplates: boolean,
    resourcesListChanged: boolean,
    prompts: boolean,
    promptsListChanged: boolean
  },
  configurationStale: boolean,
  error?: McpErrorDto
}
```

`protocolVersion` exists only in `connected`; projected capabilities are all false before a
successful modern `server/discover` exchange. Extra advertised Server capabilities are absent
rather than copied into an open map. The Schema refines this object by status: `connected` requires
the exact protocol version and forbids `error`; `failed` requires `error`, omits the protocol
version, and has all capabilities false; all other states omit both protocol version and error and
expose no usable capability. `generation` is an opaque freshness fence for consumers, not
authorization.

`McpErrorDto` contains only `{ code, message }`. `message` is a fixed user-safe string of at most
1,024 code points. The stable closed code set is:

```text
configuration-invalid | workspace-untrusted | approval-denied | approval-expired |
approval-invalidated | spawn-failed | connect-failed | protocol-incompatible |
capability-unsupported | malformed-message | invalid-schema | limit-exceeded |
server-exited | disconnected | termination-unconfirmed | tool-unavailable |
tool-invalid-input | tool-failed | tool-invalid-output | resource-unavailable |
resource-unsupported | prompt-unavailable | prompt-unsupported | internal
```

Cancellation is represented by the owning connection, request, or Run status and is never an MCP
error code. Raw JSON-RPC numeric codes, messages, `data`, SDK errors, process exit details, stdout,
stderr, stack traces, and causes are forbidden.

### Message directions and correlation

- Webview intents use `webview/mcp-connect`, `webview/mcp-disconnect`,
  `webview/mcp-resource-read`, `webview/mcp-resource-attach`,
  `webview/mcp-prompt-preview`, `webview/mcp-prompt-confirm`, and
  `webview/mcp-prompt-cancel`. T1408 additively defines `webview/mcp-open-settings`,
  `webview/mcp-resource-detach`, and `webview/mcp-prompt-detach` so the user can open the exact
  user-scoped setting or remove an immutable draft attachment before send. They carry only the
  active `serverId`, `generation` where a live
  connection is required, bounded projected identities/arguments required by that action, and the
  normal envelope. They cannot carry configuration, command, cwd, risk, approval state, Tool
  schema, Resource content, Prompt result, or capability declarations.
- Extension state uses `extension/mcp-connection`, `extension/mcp-tools`,
  `extension/mcp-tool-rejections`, `extension/mcp-resources`, `extension/mcp-prompts`,
  `extension/mcp-resource-preview`, and `extension/mcp-prompt-preview`. The tools message retains
  its strict accepted-catalog shape; the additive rejection message carries the matching bounded
  rejection projection. A matching pair atomically replaces the Server/generation view; neither
  message is interpreted as an incremental patch.
- MCP Tool Calls continue to use the existing Core Tool Call/Result correlation. Their Webview
  projection adds a strict `source` object to the Tool-state contract only when the originating
  registered Tool is external: `{ kind: "mcp", server, generation, mcpToolName }`. Built-in Tools
  retain `{ kind: "builtin" }`. No generic Server metadata bag is allowed.
- Every live intent and response must match the active `requestId`, `serverId`, and generation.
  Resource and Prompt intents additionally match the exact projected URI/template/Prompt identity;
  Prompt confirmation matches a Host-generated preview ID. Stale or mismatched messages are
  ignored without operation, persistence, or user-visible state mutation.

The three T1408 intents are strict and do not broaden Server authority. Open-settings contains no
Server data and asks the Extension to reveal `ctrlZebra.mcp.server` in user settings. Resource
detach carries only the Host-generated `snapshotId`; Prompt detach carries only the Host-generated
`previewId` retained for the confirmed draft projection. Detach removes only the matching current
Composer attachment, performs no Server request, and cannot delete a Resource, revoke persisted
history, cancel a Run, or affect another attachment.

### Tool projection and deterministic names

`McpToolDescriptorDto` contains only `{ registryName, mcpToolName, title?, description? }` plus the
shared Server identity and generation. Names are non-empty and bounded; title and description are
plain untrusted text. Input/output schemas and annotations stay outside the Webview protocol.

The Registry mapping is deterministic and independent of list order:

1. Compute SHA-256 over the UTF-8 sequence `serverId`, one NUL byte, and the exact MCP Tool name;
   retain the first 12 lowercase hexadecimal characters.
2. Convert the MCP Tool name to a lowercase ASCII slug by retaining `[a-z0-9]`, replacing each run
   of other characters with one underscore, trimming underscores, and using `tool` when empty.
3. Retain at most 47 slug characters and publish `mcp_<slug>_<hash>`, which satisfies the existing
   64-character lower `snake_case` Tool contract and always begins with a letter.

The exact MCP name remains the external identity and is never recovered from the slug. The Registry
reserves the `mcp_` prefix for this mapping. A duplicate external identity, a hash collision, or a
collision with any registered name rejects the complete incoming snapshot; no order-dependent
suffix or partial registration is allowed. A rename is removal plus addition. Tool calls and
approvals bind both names, Server ID, generation, and immutable schema identity.

### Tool acceptance and rejection projection

Tool discovery is a per-descriptor decision, but the wire projection is still a complete atomic
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
the accepted Tool descriptor. `McpToolRejectionCatalogDto` is:

```text
{
  server: McpServerIdentityDto,
  generation: positive safe integer,
  rejectedTools: McpRejectedToolDto[0..256],
  rejectedToolsTruncated: boolean
}
```

The Extension sends `extension/mcp-tool-rejections` as a strict additive version `1` message with
that catalog and the same `requestId` as the corresponding `extension/mcp-tools` snapshot. The
projection contains no schema, command, environment, raw error, or arbitrary metadata. When more
than 256 Tools are rejected in a mixed snapshot, the list is a deterministic prefix and
`rejectedToolsTruncated` is `true`; accepted Tools are never truncated. An empty list sets the flag
to `false` so a refresh can clear an earlier projection.

New clients stage the two matching messages by `requestId`, Server identity, and generation and
commit them together. A stale, mismatched, cancelled, or post-disconnect message is ignored. A
version `1` client that does not recognize `extension/mcp-tool-rejections` ignores that additive
message under the existing unknown-message rule and still receives the unchanged tools-only
`extension/mcp-tools` message; it renders accepted Tools without rejection details. The Host never
adds an unknown field to the strict legacy catalog to force an older client to parse it.

### Resource and Resource Template projections

`McpResourceDescriptorDto` is the strict bounded projection `{ server, generation, uri, name,
title?, description?, mimeType? }`. `McpResourceTemplateDescriptorDto` replaces `uri` with
`uriTemplate` and adds at most 32 strict argument descriptors `{ name, description?, required }`.
The Host derives template argument names deterministically from the validated URI Template rather
than accepting a second Server-provided argument schema; every variable is required for version `1`.
Server icons, annotations, sizes, arbitrary metadata, and Workspace URI authority are excluded.

`McpResourceSnapshotDto` is created only by an explicit successful read and contains `{ server,
generation, uri, mimeType, items, truncated }`. It contains 1–32 strict items `{ text }`, within the
Security aggregate limits. `uri` remains an external MCP identifier; it is never converted to a
workspace URI or link action. Only well-formed Unicode text with an explicitly supported textual
MIME projection is admitted. Blob, image, audio, embedded Resource, Resource Link, unknown content,
and nested SDK values are rejected.

Attachment creates a new immutable context projection `{ snapshotId, serverId, uri, mimeType,
text, truncated }`. `snapshotId` is Host-generated and opaque. It represents the exact bounded text
already read; list refresh or disconnect cannot mutate it. The projection is ordinary untrusted
user context, never System, Tool, approval, Workspace authorization, HTML, Markdown, or a live URI.

### Prompt projection and confirmation

`McpPromptDescriptorDto` contains `{ server, generation, name, title?, description?, arguments }`.
It has at most 32 strict arguments `{ name, description?, required }`; Server-provided defaults,
schemas, icons, metadata, or executable actions are excluded. Submitted values use a strict object
with exactly the advertised argument names and the Security key/value/aggregate limits.

`McpPromptPreviewDto` contains `{ previewId, server, generation, promptName, arguments, messages }`.
It has 1–32 bounded text messages `{ sourceRole: "user" | "assistant", text }`. MCP roles are shown
as provenance only and do not become trusted model roles. Unsupported roles or non-text content
reject the whole preview.

Confirmation consumes the exact current preview once and projects all messages into one ordinary
user-controlled input attachment with Server, Prompt, argument, and source-role labels. It never
creates a System or Assistant message, sends automatically, calls a Tool, reads a Resource, grants
approval, or retains template capability. Cancellation, disconnect, generation change, Prompt list
replacement, Session switch, send, or disposal invalidates an unconfirmed preview.

### Validation and bounds

All MCP message objects use strict Zod schemas, take input as `unknown`, reject unknown fields, and
enforce the limits in [Security](security.md) while collecting. List snapshots contain at most
1,000 descriptors and must fit the one-mebibyte serialized ceiling. Strings must be well-formed
Unicode and are measured both by Unicode code points and UTF-8 bytes where Security defines both.

An invalid descriptor, duplicate identity, malformed cursor chain, unsupported content item, or
limit breach rejects the complete operation. The Extension never asks the Webview to validate an
SDK object, infer a capability, choose risk, join partial pages, or repair malformed content.
