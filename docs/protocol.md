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
- T0105 does not introduce timeouts, retries, cancellation, persistence, or restoration of in-flight requests. Those behaviors require later task contracts.

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

Session restoration does not add fields to the existing strict `extension/session-restored`
message. For every successful restore, the Extension first sends one correlated
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
  `extension/run-status` message. Cancellation emits only `cancelled` and never an error message.
- The run error category is a closed set: `authentication`, `network`, `rate-limit`, `context`,
  `tool`, and `internal`. The Extension maps trusted error types to these categories; unknown
  failures use `internal`.
- Each category has one fixed, user-safe message that explains the failure and a reasonable next
  action. Raw error messages, stacks, SDK objects, response bodies, Tool input/output, workspace
  content, and nested causes are forbidden.
- `requestId` associates the error with the active run. The Webview ignores stale or unrelated run
  errors and clears the previous error when a new run begins.
- Tool Result errors remain attached to their exact Tool Call through `extension/tool-state`.
  `extension/run-error` represents only a terminal run failure and does not replace Tool Result
  details or turn a recoverable Tool failure into a failed run.

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
