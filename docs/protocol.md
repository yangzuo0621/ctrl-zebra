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
  truncation, cancellation, failure, interruption, Session replacement, or disposal, the Extension
  closes the event gate: no later Host-to-Webview or Webview-to-Host message, text delta, reasoning
  event, Tool Result, retry, approval response, or side effect is delivered. If a user presses a
  cancel control, its handler first updates only local interaction state synchronously, then attempts
  one cancel intent in that same event turn; if the gate is already closed, it posts no intent. It
  must not wait for or synthesize a Host outcome. A failed or interrupted Run
  may display its retained partial answer, but that partial answer is not model history; the next Run
  receives the user prompt and only complete, validated Tool pairs from the ordered persisted
  projection.

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

## IDE context and read-only Tool DTOs (T1901)

T1901 reserves a strict, additive DTO family for the IDE surface. It does not add runtime schemas or
message handlers; T1902–T1904 may implement the DTOs only after this contract is merged. Every value
enters the Protocol boundary as `unknown`, is validated with a strict Schema, and is rejected when an
unknown property, invalid Unicode value, unsupported URI, or bound is encountered. The DTOs use the
same closed/discriminated-union model as the existing Tool contracts: a variant is selected by its
`kind`/`operation`, and no variant accepts extra properties.

All code-point counts below mean well-formed Unicode scalar values after Unicode validation; UTF-8
counts are the exact encoded bytes without a byte-order mark. A producer measures both counters while
collecting and never converts a code-point limit into a UTF-16 code-unit limit. `IdePositionDto.character`
is the deliberate numeric exception: it preserves VS Code's 0-based UTF-16 code-unit offset and is
never reinterpreted as a scalar count.

### Shared source and range values

- `IdeUriDto` is the redacted workspace URI `{ scheme, authority, path }`. `scheme` is a canonical
  string of at most 32 Unicode code points/128 UTF-8 bytes and `authority` is empty or the fixed
  non-host label `workspace` (at most 9 code points/32 bytes); the actual VS Code authority remains
  Host-private. `path` is a canonical forward-slash workspace-relative path of at most 4,096 Unicode
  code points/16,384 UTF-8 bytes, with no leading slash, backslash, query, fragment, or dot segment.
  The Host keeps the complete `vscode.Uri` private and maps it to this DTO only after selected-root
  and canonical-identity checks. `fsPath`, `untitled:` documents, external files, and raw URI
  instances never cross the boundary.
- `IdePositionDto` uses zero-based `{ line, character }` values. `line` is an integer from `0` through
  `1,999` (`line < 2,000`) and `character` is an integer from `0` through `131,072` inclusive in
  VS Code UTF-16 code units. The Host preserves that offset, rejects an endpoint inside a surrogate
  pair or beyond the actual UTF-16 length of its line, and permits the exclusive end at that exact
  length; `IdeRangeDto` contains `start` and an exclusive `end` in the same document. A line made of
  65,536 astral scalars therefore has an exclusive end of `131,072`, while a shorter line cannot use
  that value. Reversed, non-finite, or out-of-document ranges are rejected. `documentVersion` is a
  non-negative safe integer. Positions and ranges are bounded by the text and line limits in
  [Security](security.md), but their numeric offsets are not Unicode scalar counts.
- `IdeSourceDto` contains `{ uri, range?, languageId?, documentVersion?, stale, truncated,
  truncationReasons? }`. `languageId` is a bounded display hint of at most 128 Unicode code points/
  512 UTF-8 bytes, `documentVersion` is a non-negative Host-observed revision, and `stale` means the
  source changed after capture. A stale value is data, not permission to refresh or overwrite the
  current editor. `truncationReasons` is a closed set of `code-points`, `utf8-bytes`, `lines`,
  `entries`, `tokens`, and `out-of-workspace`, and is present whenever `truncated` is true.
- `IdeTextContextDto` contains one `source` and plain-text `text` of at most 65,536 Unicode code
  points, 2,000 logical lines, and 262,144 UTF-8 bytes. Empty text is one logical line; LF ends a
  line, CRLF is one delimiter, and a terminal delimiter creates the following empty line. The producer
  scans Unicode scalars and delimiters incrementally and stops before the candidate that would create
  line 2,001 (or exceed either scalar/byte limit), evaluating CRLF atomically so no dangling CR is
  retained. `IdeDiagnosticDto` contains a source/range, closed `severity` (`error |
  warning | information | hint`), an untrusted `message` of at most 4,096 code points/16,384 bytes,
  and optional `code`/`origin` display text of at most 1,024 code points/4,096 bytes. A provider's
  numeric diagnostic code is converted to its bounded decimal display text; malformed code/origin
  values are invalid output. `IdeLanguageLocationDto`
  contains a validated source and target range plus a closed `kind` (`definition | reference`);
  `IdeSymbolDto` is flat and contains required `name` plus optional properties `containerName`, `detail`,
  and `selectionRange`; each present string is at most 1,024 code points/4,096 bytes. It contains an
  `IdeSymbolKind`, ranges, and no recursive provider object. Closed
  severity/kind labels are fixed literals, never provider strings, and accept no other value.
- The Host maps both supported VS Code provider shapes without leaking their SDK objects: each
  `DocumentSymbol` node becomes one flat entry in deterministic depth-first order, with its optional
  `detail`; a child receives its immediate parent `name` as `containerName` when present. Each
  `SymbolInformation` maps its required
  `name`, `kind`, and `location.range` plus optional `containerName`, while `detail` and unsupported
  fields are omitted. Missing optional fields are omitted (never `null`); an explicit empty provider
  string remains an empty bounded value. Children are never serialized recursively, and all mapped
  entries still obey the 256-entry/aggregate limits. Unsupported provider fields are discarded before
  DTO construction; once constructed, strict Schemas still reject every unknown DTO property.
- `IdeSymbolKind` is a closed CtrlZebra mapping, not a VS Code enum: `file | module | namespace |
  package | class | method | property | field | constructor | enum | interface | function | variable |
  constant | string | number | boolean | array | object | key | null | enum-member | struct | event |
  operator | type-parameter | unknown`. An SDK kind not in this set maps to `unknown`; the numeric or
  string SDK value never crosses the boundary. The Host owns the explicit conceptual mapping
  `File→file`, `Module→module`, `Namespace→namespace`, `Package→package`, `Class→class`,
  `Method→method`, `Property→property`, `Field→field`, `Constructor→constructor`, `Enum→enum`,
  `Interface→interface`, `Function→function`, `Variable→variable`, `Constant→constant`,
  `String→string`, `Number→number`, `Boolean→boolean`, `Array→array`, `Object→object`, `Key→key`,
  `Null→null`, `EnumMember→enum-member`, `Struct→struct`, `Event→event`, `Operator→operator`, and
  `TypeParameter→type-parameter`; future or unmappable values map to `unknown`.
- A successful diagnostics, language-location, or symbol result contains at most 256 entries and at
  most 131,072 aggregate Unicode code points/524,288 aggregate UTF-8 bytes across its projected
  strings, in addition to the complete 1,048,576-byte serialized Tool Result ceiling. The Host counts
  Unicode scalar values and UTF-8 bytes incrementally before retaining each field or entry; an
  over-limit field is cut at a scalar boundary and marks `truncated` with `code-points` or
  `utf8-bytes`, while an aggregate/entry limit stops before the next field or entry and marks the
  corresponding closed reason. The Host never constructs an unbounded provider string, range list, or
  result merely to reject it; malformed or non-mappable values are `invalid-output` instead (except a
  symbol kind, for which an unmappable value is the closed `unknown` label).

### Tool names, inputs, and outputs

The reserved read-only Tool names and strict input shapes are:

- `read_editor_context`: `{ scope: "active-editor" | "selection" }`; the model cannot supply a
  URI, absolute path, document version, or replacement text. The Host resolves the current editor
  and selection only after the user setting and ownership checks pass. `selection` always uses the
  exact selected range: a collapsed selection is a valid empty snapshot with `text: ""` and an exact
  collapsed source range, never an automatic active-line/file fallback. With no active editor, either
  scope returns the fixed unavailable `failed` Tool outcome.
- `get_diagnostics`: the only legal combinations are `{ scope: "active-file" }` (no `path`, resolving
  the current active text document) and `{ scope: "workspace" }` (selected-root collection) or
  `{ scope: "workspace", path }` (one validated workspace-relative text document). A path with
  `active-file`, an absent/unknown scope, an invalid or empty path, or any second/unknown field is
  `invalid-input`; no URI or host path is accepted. The workspace scope is still the selected root
  only and is bounded by the collection limit.
- `find_definition` and `find_references`: `{ path, position }`, where `path` is a validated
  workspace-relative path and `position` is an `IdePositionDto`. They call only the corresponding
  VS Code provider command and return validated locations.
- `list_symbols`: `{ path }` for one validated workspace-relative text document. Results are a flat,
  bounded list and do not create an index or cache.

Providers may return an empty list, which is a valid successful empty result. For a non-empty provider
response, the Host filters locations whose canonical URI is outside the selected root. If at least one
valid in-scope item remains, the successful result carries `truncated: true` and the closed omission
reason `out-of-workspace` (combined with any other limit reasons); it never claims that the returned
subset is complete. A malformed item or invalid range makes the whole operation `invalid-output`, even
when siblings are valid. If every provider item is outside the selected root, the operation likewise
returns the stable `invalid-output` Tool error with no path, provider text, or partial success payload.
It never silently converts an all-filtered response into an empty success or invokes a hidden fallback.

Conformance fixtures for this contract cover the cancellation race (local cancel state before one
intent, gate already closed suppressing the intent, and gate closure suppressing every later message),
the code-point/UTF-8 boundary at limit and limit+1 for every free-form field, the 2,000/2,001 logical
line boundary with LF/CRLF/terminal-newline cases, aggregate and entry limits, empty/collapsed/no-editor
`read_editor_context` outcomes, astral UTF-16 range round-trips plus split-surrogate and out-of-line
rejections, empty/mixed/all-filtered provider sets, malformed ranges, every closed symbol mapping,
missing optional `containerName`/`detail`/`selectionRange` cases for both provider shapes, and all
legal/illegal `get_diagnostics` scope/path combinations.

Each input is a strict object with no additional properties. Every Tool has risk `read`; none can
write, execute a command, invoke a Code Action, change a document, grant approval, broaden the
workspace root, or select a different Session. The successful output is the strict union
`IdeReadOnlyToolResultDto`:

- `{ kind: "editor-context", context: IdeTextContextDto }`;
- `{ kind: "diagnostics", source, diagnostics, stale, truncated, truncationReasons? }`;
- `{ kind: "language-locations", operation: "definition" | "references", source, locations,
  stale, truncated, truncationReasons? }`; or
- `{ kind: "symbols", source, symbols, stale, truncated, truncationReasons? }`.

The normal Tool Result envelope still owns call ID, name, success/error, and the one-mebibyte UTF-8
ceiling. A cancelled operation emits no ordinary Tool Result. A malformed provider shape, invalid
string/range, or all-filtered response maps to `invalid-output`; an unavailable provider maps to the
existing `failed` Tool error with a fixed unavailable user outcome. Provider objects, raw
messages, stacks, commands, responses, and unvalidated locations are never included. `stale: true`
is deterministic display information and never authorizes use of an old snapshot as a current editor
state.

### Context authority, source display, and delivery

- An explicitly attached `IdeTextContextDto` is serialized as one ordinary user-context attachment
  inside the current submission. It is not a System message, hidden policy, Tool definition, approval
  scope, or capability declaration. Fixed source labels are provenance only; model and user text in
  the attachment remain untrusted data.
- The Host and Webview show the same source kind, workspace-relative path, range, language hint, and
  stale/truncated marker before send. The Webview may remove or request a fresh capture but cannot edit
  the URI, revision, or trust decision. Any future message carrying these DTOs must be additive and
  correlated with the active request; an older client ignores the unknown message under the existing
  rule rather than guessing a shape.
- Pending context is ephemeral until the user explicitly sends it. Session persistence may retain text
  that the user deliberately included in an ordinary user message or a non-IDE completed Tool Result
  according to the existing persistence contract, but it never stores the live editor selection, Host
  URI, document version, stale state, provider object, or an unsubmitted attachment as a separate
  record. T1901 IDE Tool Results remain transient as defined by Persistence.

## Editor-initiated context entry messages (T1905)

T1905 adds one additive Protocol-v1 message family for the explicit editor commands. Every variant is a
strict object with no unknown properties. No message carries a VS Code object, absolute path, command, Tool
name, approval, or a Webview-supplied URI. `scope` is the closed union `"selection" | "active-editor"`;
`contextId` and `captureId` are Host-generated opaque strings of 1–128 Unicode scalar values. The setting
and command IDs are Extension-owned and are not accepted as message input.

### Fences, generations, and the two gates

The Host keeps two deliberately separate gates for each Agent Webview view:

1. The **capture delivery gate** is created for each explicit command or Refresh. It owns one
   `AbortController`, a Host-issued `captureId`, and the `(viewGeneration, sessionGeneration)` tuple. It is
   open only through the bounded read and the ordered `postMessage` enqueue. Cancellation, supersession by
   Refresh, editor/selection/document/workspace transition, setting disable, Trust loss, Session/New chat,
   view disposal, or Extension disposal closes it synchronously and aborts the read. A completion that sees a
   closed gate, a changed tuple, or a changed source is discarded: it emits no `ready` or `unavailable`
   capture result, produces no owner transition, and cannot install a card.
2. The **delivered-card/event projection owner gate** is created only when a `ready` projection is enqueued
   for the current view and remains the current owner after that enqueue. Its immutable owner tuple is
   `(viewGeneration, sessionGeneration, cardGeneration, contextId)`. It accepts only Host-serialized,
   bounded `stale` or Host-driven `cleared` transition events for that exact tuple after all affected capture
   gates have been closed. A `stale` event retains the card and marks its source stale; a Host-driven `cleared`
   event removes it and closes the owner gate. Accepted `New chat` is a Webview-local clear: the Webview
   clears its editor store synchronously, then posts the one action; the Host closes capture and owner gates
   and emits no `cleared` editor event after that boundary. Host-driven Session restore/switch is transactional:
   the Host closes both gates, the Webview clears its editor store, and only then is the new session generation
   committed; this boundary also emits no editor `cleared` event. View disposal clears the local store as the
   Webview disappears, closes both Host gates, and emits no editor event. A Remove acknowledgement is optional
   and ignored; no acknowledgement is required for correctness. If the ready enqueue is rejected or the view
   is disposed before enqueue, no owner gate exists and no transition event is emitted. A card gate never
   reopens a capture gate or produces a late capture result.

`viewGeneration` is a Host-issued non-negative safe integer. The first Agent view in an Extension Host
lifetime starts at `1`; every new `resolveWebviewView` allocates the next value, and disposal permanently
closes the old value. A new Extension activation starts a new counter at `1`; values are never reused within
one activation. `sessionGeneration` starts at `0` for each view and increments on every Host-accepted
Session owner replacement (restore/selection commit, Session switch, or accepted New chat). It resets only
with a new `viewGeneration`. `cardGeneration` starts at `0` for each `(viewGeneration, sessionGeneration)`
and is incremented for every new delivered card and every owner invalidation; it is never reused for another
card. `eventSequence` starts at `1` for the first outbound editor event in a view and increments for every
later outbound editor event; it resets only with a new view generation. `requestId` on an
`extension/editor-context` event is a Host-issued unique event ID (not an echoed Webview intent ID), and is
allocated together with `eventSequence`. Webview intent `requestId` values are direction-specific IDs
generated by the Webview and are deduplicated by the Host.

Every numeric fence is a non-negative safe integer. Before incrementing, the owner checks that the next value
is at most `Number.MAX_SAFE_INTEGER`. On overflow it fails closed: it emits no event, does not wrap, reuse, or
reset the value, closes the affected capture/owner gate, and rejects further editor entry for that scope.
`sessionGeneration`, `cardGeneration`, and `eventSequence` overflow require a new Webview view generation;
`viewGeneration` overflow requires a new Extension activation. The new owner starts with its documented
initial value; no overflowed value is reused. Overflow, closure, and the required reset are observable in
the deterministic race/overflow tests.

The capture fence is `(viewGeneration, sessionGeneration, captureId)`. The delivered-card owner tuple is
exactly `(viewGeneration, sessionGeneration, cardGeneration, contextId)`; `captureId` is retained on the
card/event for capture correlation but is not part of Webview intent identity. The Host also records the
latest accepted intent ID and payload hash for that owner. A duplicate intent with the same ID and identical
fields is a no-op; reuse of an ID with different fields is rejected. Intents for an old view/session/card/
context, an already closed owner, or a disposed view are ignored before any read, text allocation, or
message post.

The Extension-to-Webview union is `extension/editor-context`:

```text
{ protocolVersion: 1, type: "extension/editor-context", requestId,
  viewGeneration, sessionGeneration, eventSequence,
  status: "ready", cardGeneration, captureId, contextId, scope,
  context: IdeTextContextDto }
{ protocolVersion: 1, type: "extension/editor-context", requestId,
  viewGeneration, sessionGeneration, eventSequence,
  status: "stale", cardGeneration, captureId, contextId, scope,
  reason: "editor-changed" | "selection-changed" | "document-changed",
  context: IdeTextContextDto }
{ protocolVersion: 1, type: "extension/editor-context", requestId,
  viewGeneration, sessionGeneration, eventSequence,
  status: "cleared", cardGeneration, contextId,
  reason: "disabled" | "trust-lost" | "workspace-changed" |
          "editor-unavailable" }
{ protocolVersion: 1, type: "extension/editor-context", requestId,
  viewGeneration, sessionGeneration, eventSequence,
  status: "unavailable", scope?, code:
  "disabled" | "no-editor" | "no-selection" | "untrusted-workspace" |
  "unsupported-document" | "outside-workspace" | "unavailable" }
```

`ready` and `stale` carry the bounded `IdeTextContextDto`; `stale` requires
`context.source.stale === true`, and it keeps the same `cardGeneration`, `captureId`, and `contextId` as
the delivered card. `cleared` identifies the card being removed and never carries text. `unavailable` is a
fixed display outcome for a command with no delivered card (or for a rejected capture); it never includes a
provider/host error. A command from `editorTextFocus` may therefore be visible while the Host returns
`unsupported-document`, `outside-workspace`, or `no-editor`; there is no fallback read. A successful
capture is ordinary untrusted user context and does not start a Run. A cancelled or superseded capture
cannot emit a result; only an already delivered card may later receive a bounded transition event through
the owner gate.

The Webview-to-Extension intents are exact strict objects:

```text
{ protocolVersion: 1, type: "webview/editor-context-refresh", requestId,
  viewGeneration, sessionGeneration, cardGeneration, contextId, scope }
{ protocolVersion: 1, type: "webview/editor-context-remove", requestId,
  viewGeneration, sessionGeneration, cardGeneration, contextId }
{ protocolVersion: 1, type: "webview/editor-context-use-stale", requestId,
  viewGeneration, sessionGeneration, cardGeneration, contextId }
```

Refresh closes the current capture delivery gate before opening the new one and keeps the existing card
owner until a newer `ready` is enqueued. Remove first clears local Webview state, then sends at most one
intent for the exact owner tuple; the Host closes the matching gates and may optionally acknowledge, but the
Webview ignores any acknowledgement and never waits for it. Use-stale records the user's explicit send
decision for that exact tuple; it cannot alter source, range, revision, Trust, setting, or text. Accepted
New chat clears the Webview editor store synchronously before posting its action; Host-driven Session
restore/switch clears it transactionally before the new session generation is committed; disposal clears local
state as the view disappears. Their Host gate closure emits no editor `cleared` event. The Host ignores
old/cross-view/cross-session/cross-card IDs, duplicate intents, and intents after a view/session/setting/Trust
gate closes.

### Ordering and acceptance rules

The Host serializes capture completion, user intents, and spontaneous editor/setting/Trust events in one
owner queue. The deterministic order is:

1. Allocate the capture tuple and open its capture delivery gate.
2. On Refresh or a transition, close affected capture gates first. No completion from a closed gate may post.
3. If an open capture completes with unchanged source and tuple, allocate the next `cardGeneration`, enqueue
   exactly one `ready` event, and make that card the owner at the enqueue commit point. A failed `postMessage`
   closes the owner gate without retry.
4. After a card owner exists, an editor/selection/document transition emits at most one `stale` event for
   the current owner; a setting disable, Trust loss, selected-root/workspace change, or unsupported current
   editor emits one Host-driven `cleared` event and closes the owner gate. The Host closes any in-flight
   capture before evaluating this rule. Accepted Remove and New chat close the gates and rely on the Webview's
   synchronous local clear; Host-driven Session switch/restore closes both gates and relies on its transactional
   Webview clear; view disposal closes the gates as the view disappears. These boundaries emit no editor
   `cleared` event. If no owner exists, it emits no stale/cleared event and may emit only the fixed
   `unavailable` outcome for the initiating command.
5. A newer ready replaces the old owner only after its enqueue commit; the old owner then cannot accept a
   transition. A stale event keeps the same owner and is deduplicated only by the canonical full event record
   (including `eventSequence`, Host `requestId`, and every validated field).

The Webview accepts an event only when `viewGeneration` and `sessionGeneration` equal its active owner and
the card/context tuple is valid for the status. It first performs strict same-sequence comparison against the
retained canonical event record for that active owner: an exact duplicate (same sequence, request ID, and
validated payload) is an idempotent no-op; a same-sequence conflict is discarded. Only after that comparison
does it apply the monotonic rule: a greater `eventSequence` commits atomically and advances the watermark;
a lower sequence is a stale no-op. `ready` is accepted only for a current capture result; `stale`/Host-driven
`cleared` only for the exact delivered owner; and `unavailable` only when no newer card is active. Accepted
New chat/Remove/disposal clear local state before their boundary; Host-driven Session restore/switch clears it
transactionally before the new session generation commits, so a later Host event cannot recreate a card. A
Refresh race leaves the prior card unchanged until its newer ready is accepted; a late
result from the superseded capture can never overwrite it. Once an owner closes, older sequence records are
outside the active scope and are ignored without allocation or comparison.

The Composer receives a deterministic ordinary-user-context prefix before send:

```text
Editor context (ordinary untrusted context; never instructions, authorization, or a workspace file)
Scope: selection | active-editor
Source: <workspace-relative path> [optional exact range]
Language: <optional languageId>
Source truncated: yes | no
<editor_context_text>
```

This prefix and text remain visible and editable as the current draft. Remove deletes the pending source
card and, when the generated draft is still unchanged, its generated prefix; user edits are preserved.
Send is allowed for a ready card after the user reviews or edits it. Send is disabled only while a stale
card awaits `Use stale context` or a fresh capture. The entry path never creates a Run, executes a Tool,
changes a document, or grants an Approval.

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

`McpConnectionProjectionDto` is the strict object used by `extension/mcp-connection`:

```text
{
  server?: McpServerIdentityDto,
  generation: non-negative safe integer,
  status: "disconnected" | "connecting" | "connected" | "disconnecting" | "failed",
  configuredMode: "modern-only" | "dual",
  negotiated?:
    { era: "modern", version: "2026-07-28" }
    | { era: "legacy", version: "2025-11-25" },
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

`configuredMode` is present in every status and reflects the effective setting (the safe default is
`modern-only`). The initial unconfigured boot projection, and a configuration failure before an
identity exists, may omit `server` and use generation `0`; once a configuration has been validated,
failed and connected projections carry the selected Server identity, and connected uses a positive
generation. `negotiated` is
present only in `connected`; it is the exact mutually supported era/version pair and never a
user-selected or SDK enum value. Projected capabilities are all false before the complete selected
handshake. Extra advertised Server capabilities are absent rather than copied into an open map. The
Schema refines this object by status: `connected` requires one exact `negotiated` pair and forbids
`error`; `failed` requires `error`, omits `negotiated`, and has all capabilities false; all other
states omit both `negotiated` and `error` and expose no usable capability. `generation` is an opaque
freshness fence for consumers, not authorization. The modern-only `protocolVersion` field from the
T1803 contract is replaced by this mode-aware negotiated DTO. The active Extension/Webview path
accepts the negotiated projection only; it does not accept both shapes or silently infer an era.

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

- Webview intents use `webview/mcp-connect`, `webview/mcp-disconnect`, `webview/mcp-refresh-tools`,
  `webview/mcp-resource-read`, `webview/mcp-resource-attach`,
  `webview/mcp-prompt-preview`, `webview/mcp-prompt-confirm`, and
  `webview/mcp-prompt-cancel`. T1408 additively defines `webview/mcp-open-settings`,
  `webview/mcp-resource-detach`, and `webview/mcp-prompt-detach` so the user can open the exact
  user-scoped setting or remove an immutable draft attachment before send. They carry only the
  active `serverId`, `generation` where a live
  connection is required, bounded projected identities/arguments required by that action, and the
  normal envelope. They cannot carry configuration, command, cwd, risk, approval state, Tool
  schema, Resource content, Prompt result, or capability declarations.
- Extension state uses `extension/mcp-connection`, the additive `extension/mcp-diagnostics`, the unchanged legacy `extension/mcp-tools`, the
  additive atomic `extension/mcp-tool-catalog`, `extension/mcp-resources`, `extension/mcp-prompts`,
  `extension/mcp-resource-preview`, and `extension/mcp-prompt-preview`. The combined catalog is
  authoritative for sequence-aware clients; legacy tools-only state is retained only for older
  clients. The superseded `extension/mcp-tool-rejections` message is non-authoritative and is not
  emitted by the amended Host. No catalog message is interpreted as an incremental patch.
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

`webview/mcp-refresh-tools` is the T1803 refresh intent `{ protocolVersion, type, requestId,
serverId, generation }` with no additional properties. It is accepted only while the matching
generation is connected, runs one bounded Tool-list refresh under the existing generation and
cancellation gates, and cannot start a process, reuse approval, or mutate the Session. Stale,
cancelled, or mismatched refresh intents are ignored without state mutation.

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

### Dual-era configuration and negotiated projection (T1804)

The T1804 contract adds a strict configuration boundary without changing the Protocol envelope
version. `ctrlZebra.mcp.server` is one machine-scoped local `stdio` object. Version `1` has the
existing `{ version, serverId, displayName, command, args }` shape and means `modern-only`; version
`2` requires the additional closed `protocolMode: "modern-only" | "dual"`. Unknown versions,
modes, fields, transports, credentials, and malformed values are rejected as
`configuration-invalid`. An existing version `1` value is never silently rewritten or broadened;
the user must explicitly migrate to version `2` and then select `dual`.

The mode selects a closed version set:

| Configured mode | Accepted versions | Bootstrap |
|---|---|---|
| `modern-only` | `2026-07-28` | one bounded `server/discover`; no legacy initialize |
| `dual` | `2026-07-28`, `2025-11-25` | modern probe first; one legacy initialize fallback only for a specification-classified non-modern response or bounded timeout |

The Protocol layer never receives SDK lifecycle messages. It receives one complete connected
projection only after the selected handshake validates, with `configuredMode` and
`negotiated: { era, version }`. The pair is exactly `modern/2026-07-28` or
`legacy/2025-11-25`. Connecting, disconnecting, disconnected, and failed projections contain no
negotiated pair or usable capabilities. A well-formed `DiscoverResult` locks modern: an advertised
`2026-07-28` continues modern, while a missing/unsupported advertised version is
`protocol-incompatible` with no fallback. A recognized modern JSON-RPC error also locks modern: a
controlled advertised `2026-07-28` continues/selects modern, while a missing/unsupported advertised
version is `protocol-incompatible` with no fallback. Only a specification-defined non-modern response
or bounded probe timeout in `dual` can enter one legacy handshake. After independent overflow checks,
a syntactically/structurally malformed or shape-validation-failing response/error maps to
`malformed-message`; a structurally valid response/error outside the closed recognized-modern or
defined non-modern classifications (including unknown future or otherwise unclassified values) maps
to `protocol-incompatible`. Both are no-fallback outcomes. Cancellation, process exit, trust loss, or
cleanup failure cannot trigger fallback. Late probe results are ignored by generation. The complete
eligible/forbidden decision matrix is authoritative in
[Architecture](architecture.md#closed-modern-first-fallback-decision-matrix-t1804).

`McpErrorDto` remains a closed, user-safe code/message object. Unsupported versions use
`protocol-incompatible`; malformed protocol uses `malformed-message`; rejected capabilities use
`capability-unsupported`; process, cleanup, and other failures use their existing stable codes.
For the modern-first boundary, syntactically/structurally malformed or shape-validation-failing
response/error values use `malformed-message`, while structurally valid values outside the closed
recognized-modern or defined non-modern classifications (including unknown future or unclassified
values) use `protocol-incompatible`; neither permits fallback.
The Host may classify failures internally as `modern-version-unsupported`,
`legacy-version-unsupported`, `probe-timeout-legacy-failed`, `malformed-protocol`, or
`capability-rejected`, but these names are not open wire values. Internal probe/fallback
classifications never add a raw error, JSON-RPC code, timing, Server data, or fallback-attempt flag
to the DTO. The only protocol-incompatible recovery facts are the
configured mode, its closed supported-version list, `connectionEstablished: false`, and the fixed
`open-settings` next step.

Persisted MCP events may include the strict historical provenance
`{ configuredMode, negotiatedEra, negotiatedVersion }` after a successful connection. It is not a
connection snapshot, capability claim, approval, retry token, or reconnection instruction. No
configuration, probe/fallback state, process detail, credential, raw error, or unbounded protocol
value crosses this boundary. The Protocol schema and compatibility fixtures for these unions are
implemented and exercised by the Extension/Webview integration paths.

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

An invalid descriptor envelope or identity, duplicate identity, malformed cursor chain, unsupported
content item, or aggregate limit breach rejects the complete operation. A schema-policy failure
after a descriptor's envelope and identity pass is isolated to that Tool as a bounded rejected
result; it does not reject the complete operation or its valid siblings. The Extension never asks
the Webview to validate an SDK object, infer a capability, choose risk, join partial pages, or repair
malformed content.
