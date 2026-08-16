
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
- `webview/regenerate` is the strict object `{ protocolVersion, type: "webview/regenerate",
  requestId, sessionId, messageId }`. `sessionId` must be the selected, idle/restored Session and
  `messageId` must identify its latest completed assistant projection. The Host validates both
  against the immutable event log before allocating a fresh Run; an unknown, stale, non-latest,
  active, or failed target is rejected through the ordinary correlated `extension/run-error` path.
  Regeneration reuses the target user prompt and only the completed history before that Run. It
  never replays the target Run's Tool Call/Result, external attachment, Provider request, or
  approval. The old answer remains visible until a replacement emits an accepted event and reaches
  `completed`; cancellation, failure, truncation, rapid duplicate intents, and late events leave it
  unchanged. Every accepted request receives a fresh Run identity and cancellation gate.
- `webview/edit-message` is the strict object `{ protocolVersion, type: "webview/edit-message",
  requestId, sessionId, messageId, content }`. `sessionId` must be the selected, idle/restored
  Session, `messageId` must identify a completed user projection, and `content` uses the existing
  non-empty, one-million-character bound. The Host validates the exact target and appends the new
  user event plus additive `session.edit` relation before allocating a fresh Run. The model input
  contains only the validated prefix before the target and the edited content; later old-branch
  messages, Tool Call/Result pairs, attachments, Provider requests, and approvals are not replayed.
  The Webview keeps the old branch visible until accepted replacement output completes; cancellation,
  failure, truncation, duplicate intent, Session mismatch, and late events restore or retain the old
  branch. The original target identity remains valid for retry and successive edits; the latest
  completed relation projects, while an incomplete latest attempt falls back to the prior completed
  branch. The relation stores IDs only and cannot rewrite source events.
- `webview/delete-session` is the strict object `{ protocolVersion, type: "webview/delete-session",
  requestId, sessionId }`. The Host validates the exact Session identity and, when it owns an active
  Run for that Session, closes the Run gate, cancels once, and waits for settlement before deleting
  the Session directory and its attributable Checkpoints. The operation is idempotent for an already
  absent Session. Success emits `extension/session-deleted`; a corruption or storage problem emits
  the bounded `extension/session-deletion-error` with `partial` or `unavailable`, never a false
  success. A deleted Session cannot be restored or remain selected in the Webview.
- `webview/select-session` is the strict selection intent `{ protocolVersion, type:
  "webview/select-session", requestId, sessionId? }`. The Host accepts a Session ID only after it
  appeared in the latest Host-owned Session list (or is the Host-owned active Session), records that
  selection, and clears it when omitted. A deletion request is authorized only for this Host-selected
  identity or the Host-owned Session; a schema-valid but mismatched identity is rejected before
  cancellation or storage cleanup.
- `webview/clear-sessions` is the strict object `{ protocolVersion, type: "webview/clear-sessions",
  requestId, confirm: true }`. It is an explicit clear-all-local-history intent, not `new-chat` and
  not T2106's all-data reset. After active Runs are deterministically cancelled and settled, the Host
  removes every Session directory and committed/temporary Checkpoint record under the CtrlZebra
  persistence root. It emits `extension/sessions-cleared` only when all categories finish; otherwise
  it emits `extension/session-deletion-error` with a retryable `partial` or `unavailable` outcome.
- `webview/clear-local-data` is the strict high-risk intent `{ protocolVersion, type:
  "webview/clear-local-data", requestId, confirm: true }`. The Host must show its own modal warning
  before accepting the intent; `confirm` is not Webview authority. It is distinct from
  `webview/clear-sessions` and covers these fixed categories in order: `running-operations`,
  `sessions`, `checkpoints`, `temporary-files`, `caches`, `provider-secret`,
  `provider-configuration`, `mcp-configuration`, and `other-local-state`. The Host cancels and settles
  live work before the first durable category and ignores other Webview intents while this request is
  running. Concurrent clear requests share the in-flight result.
- The correlated `extension/local-data-clear-result` is the strict object `{ protocolVersion, type:
  "extension/local-data-clear-result", requestId, outcome, categories, message }`. `outcome` is
  `completed`, `partial`, or `cancelled`; cancellation has no category entries. A non-cancelled result
  contains at most one bounded entry for each category, with `outcome: "cleared" | "failed"` and
  non-negative bounded `deleted`/`failed` counts. Fixed safe text describes completion or retry; raw
  paths, configuration values, SecretStorage values, process output, and exception text are excluded.
  `partial` is retryable and is never converted into success. The Webview clears/fences its local
  projection after `completed` or `partial`, retains it on `cancelled`, and ignores a result for any
  other request ID.
- `webview/list-sessions` remains the strict existing list intent and `extension/session-list` keeps its
  existing Session summary shape. On that explicit history request, the Host may perform T2105's
  bounded local retention pass before emitting the list; removed Sessions are omitted from that
  response. The request is ignored while a Run is active or settling; once accepted, a Host lifecycle
  lock blocks a new Run until retention and list projection finish. Retention feedback is a Host-local
  fixed notification rather than a new Protocol message or raw storage error.
- `extension/session-started` is a strict Host-to-Webview event containing `{ protocolVersion,
  type: "extension/session-started", requestId, sessionId }`. The Host emits it once, after the
  requested Session has been validated or a new Session has been allocated and the Run has produced
  its first accepted event. The Webview accepts it only for the active request and stores the
  confirmed Session identity; it never derives an identity from `requestId`, display state, or model
  output. A stale, duplicate, or mismatched event has no UI or ownership effect.
- `extension/session-restored` keeps its existing strict restored-message shape and may carry the
  additive optional boolean `session.readOnly`. The Host sets it only for a recognized pre-multiturn
  `v1` Session whose history has a user message but no `session.status-changed` event. The Webview
  renders that history without modifying it and disables submit, edit, and regeneration until the
  user chooses explicit `webview/new-chat`; the marker never authorizes continuation or changes the
  persistence format/version.
- `extension/session-deleted` contains the envelope and the exact deleted `sessionId`.
  `extension/sessions-cleared` contains the envelope and a bounded `deletedCount`. The correlated
  `extension/session-deletion-error` contains `code: "not-found" | "partial" | "unavailable"`
  and fixed safe text. The Webview clears the deleted projection and invalidates pending list/restore
  state before accepting a success; stale restore, reasoning, or run messages cannot recreate it.
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

## Run Token Budget Messages

The Core may emit a dedicated `extension/run-budget` message when a Run reaches its configured
warning or hard token limit. Its strict snapshot contains bounded `estimatedTokens`, optional
`actualTokens`, `effectiveTokens`, `warningTokens`, and `maxTokens`, plus `source: "estimate" | "actual"`.
Estimates are the Stage 15 local heuristic safety signal; `actual` values are Provider Usage. Neither
value is a price, cost estimate, or Provider bill.

`ctrlZebra.runBudget.maxTokens` and `ctrlZebra.runBudget.warningTokens` are read by the Extension at
Run start. The warning is emitted once when the effective count reaches the warning threshold. At
the hard limit the Core emits source-specific exceeded state and transitions the Session to the
independent terminal status `budget-exceeded`. The Runtime checks cancellation immediately before
and after budget observation, so a user cancellation wins a simultaneous boundary. No subsequent
model request or Tool step is started after the exceeded transition; a required Tool result may be
persisted before the boundary is observed.

The terminal status is recoverable only through the normal explicit `beginRun` reset gate. The
latest valid run-budget event is projected in `extension/session-restored`; malformed, non-monotonic,
or post-exceeded events within a Run make the Session corrupt rather than being guessed or reordered.

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
  `budget`, `tool`, and `internal`. The Extension maps trusted error types to these categories;
  unknown failures use `internal`. The normal budget boundary is represented by the terminal
  `budget-exceeded` status and does not require a run-error message.
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
  truncation, cancellation, budget exhaustion, failure, interruption, Session replacement, or
  disposal, the Extension closes the event gate: no later Host-to-Webview or Webview-to-Host
  message, text delta, reasoning
  event, Tool Result, retry, approval response, or side effect is delivered. If a user presses a
  cancel control, its handler first updates only local interaction state synchronously, then attempts
  one cancel intent in that same event turn; if the gate is already closed, it posts no intent. It
  must not wait for or synthesize a Host outcome. A failed, budget-exceeded, or interrupted Run
  may display its retained partial answer, but that partial answer is not model history; the next Run
  receives the user prompt and only complete, validated Tool pairs from the ordered persisted
  projection.

## Serializable Boundary

- Protocol values must survive `JSON.stringify` followed by `JSON.parse` without semantic change.
- Allowed values are JSON objects, arrays, strings, finite numbers, booleans, and `null` as explicitly admitted by a Schema.
- `undefined`, `bigint`, functions, symbols, class instances, errors, DOM objects, VS Code objects, typed arrays, and cyclic structures are forbidden.
- `vscode.Uri`, dates, binary data, and host-specific values require an explicit serializable DTO in a later task; raw instances never cross the boundary.
