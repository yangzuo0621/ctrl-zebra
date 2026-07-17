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

## Runtime Validation and Unknown Messages

- Boundary inputs are accepted as `unknown` and validated with the direction-specific Zod Schema before dispatch or state updates.
- Schemas use strict objects so extra fields cannot smuggle unreviewed data across the boundary.
- The Extension ignores malformed input, unsupported protocol versions, unknown message types, and messages sent in the wrong direction. It does not echo invalid content or branch on validation error text.
- The Webview likewise ignores invalid Extension messages and responses that do not correlate to its active request.
- TypeScript types are inferred from the authoritative Schemas. Handwritten duplicate wire types are forbidden.

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
