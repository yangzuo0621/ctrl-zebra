# Architecture Guidelines

This document defines the initial runtime boundaries for the CtrlZebra desktop VS Code extension. It complements the dependency rules in `AGENTS.md` and is intentionally limited to decisions required before T0101.

## Extension Lifecycle

- `activate(context)` is the composition root. It registers VS Code-facing resources, wires adapters to internal contracts, and returns only after registrations required for activation are usable.
- Activation must remain cheap and deterministic. It must not scan a workspace, access the network, initialize a model client, restore sessions, or perform other work that can wait for an explicit user action.
- Registration and composition belong in `extension.ts`; business workflows belong in controllers or host-independent packages introduced by later tasks.
- `deactivate()` is reserved for asynchronous cleanup that VS Code must await. Synchronous VS Code registrations should be owned by `ExtensionContext.subscriptions` instead of being disposed a second time from `deactivate()`.
- Cleanup must be idempotent. A partially initialized resource must either never become reachable or have an owner that can safely dispose it.

## Disposable Ownership

- Every command, provider, event listener, watcher, timer, stream, child process, and other long-lived resource has exactly one lifecycle owner.
- Extension-lifetime VS Code registrations are added to `context.subscriptions` immediately after creation.
- A controller or adapter that creates child resources owns a composite `Disposable` and releases its children in reverse dependency order.
- Ownership transfer must be explicit. A factory must not retain a resource after returning ownership to its caller.
- Asynchronous cleanup is tracked separately because VS Code does not await asynchronous functions placed in `context.subscriptions`.

## Command Naming

- Public command IDs use the stable `ctrlZebra.<action>` namespace, for example `ctrlZebra.openAgent`.
- Action names describe user intent, not the implementing class or UI location.
- Renaming a contributed command is a public-contract change and requires an implementation-plan update before code changes.
- Internal commands use the same namespace and remain unlisted in `contributes.commands` unless users or keybindings need to invoke them.

## URI Boundary

- VS Code-facing code accepts and returns `vscode.Uri`; it must not reduce a URI to `fsPath` before entering an adapter that explicitly requires an operating-system path.
- Host-independent packages use JSON-serializable URI DTOs or their own validated identifiers and never import `vscode.Uri`.
- URI scheme, authority, query, and fragment are preserved across boundaries unless a documented adapter contract intentionally rejects them.
- Workspace containment and path normalization are security policy decisions owned by the workspace adapter layer. They must not be implemented with string-prefix comparisons.

## Adapter Responsibilities

- `apps/extension` adapters are the only modules that translate VS Code APIs and host values into internal contracts.
- Adapters handle host-specific registration, URI conversion, cancellation, errors, and resource disposal. They do not own Agent business decisions.
- Controllers coordinate a user interaction through internal ports. They must not leak VS Code types into Core or Protocol contracts.
- `extension.ts` may construct adapters and controllers but must not become an alternate location for their behavior.

## Lazy Initialization

- Activation creates only the registrations and lightweight state required to make the extension available.
- Model clients, session stores, workspace indexing, Webviews, and other costly resources are initialized on first use by the module that owns them.
- Lazy initialization must be concurrency-safe: simultaneous callers share one initialization attempt and receive the same success or failure outcome.
- Failed initialization must leave no partially registered or unowned resources. A later retry is allowed only when the owning contract defines it.
- Background work must have an explicit trigger, cancellation path, and lifecycle owner; module import must never start work as a side effect.

## Model Provider Boundary

- `packages/core` owns the host- and vendor-independent `ModelGateway` contract and all values that cross it. Core code depends only on these internal types and never imports a model SDK.
- `packages/providers` implements `ModelGateway`. A provider adapter is limited to translating Core requests into SDK calls and normalizing the resulting text deltas, tool calls, token usage, finish reasons, and failures into Core values in source order.
- SDK output and failures are untrusted adapter-boundary input. Adapters narrow or validate them before creating Core values. Unsupported or malformed SDK data becomes a stable Core provider error rather than leaking an SDK object or relying on SDK error-message text.
- Core defines a closed set of provider error categories suitable for runtime decisions. Adapter
  diagnostics may retain a non-enumerable cause privately for host-side classification, but SDK
  error classes, status objects, response bodies, headers, and credentials never become ModelGateway
  data, events, Protocol values, persistence, or user-facing content.
- `context-overflow` is the stable Provider-neutral category for a structured provider response that
  rejects the request because the model context is too large. Adapters may classify only bounded,
  structured error fields; response text and third-party wording never control this decision. Other
  invalid requests remain `invalid-request`.
- The caller owns cancellation and passes an `AbortSignal` to `ModelGateway.stream`. An adapter passes that same signal to the underlying SDK operation, observes cancellation while consuming the stream, emits no later events, and preserves cancellation as distinct from provider failure.
- Provider adapters do not decide session transitions, retry policy, tool approval or execution, persistence, or presentation. Those decisions remain with the owning Core runtime or host adapter introduced by their roadmap tasks.
- A normalized `FinishReason` of `length` is a terminal truncated response. Core preserves any
  bounded text already emitted, does not execute a Tool Call observed in that response, and never
  reports the Run as normally completed.

### Reasoning summary event boundary

- A reasoning summary is optional, user-visible model output carried by a Provider's documented
  reasoning stream events. It is not raw, hidden, or complete chain of thought. An adapter must not
  create it from prompts, ordinary answer text, Tool activity, host inference, opaque encrypted
  payloads, or a second model request.
- Core extends `ModelEvent` with the closed Provider-neutral lifecycle
  `reasoning.start → reasoning.delta* → reasoning.end`. Every event carries a non-empty opaque
  `blockId` of at most 128 characters. An adapter maps any SDK association to a CtrlZebra-owned
  identifier; raw SDK IDs and their semantics do not cross the Provider boundary.
- Within one `ModelGateway.stream` invocation, a `blockId` starts exactly once, accepts deltas only
  while open, and ends at most once. Blocks do not nest. More than one block may occur sequentially,
  and reasoning events may interleave with text, Tool Call, Usage, and Finish events exactly where
  the source stream placed them. A new model invocation after Tool use is a new step; its block IDs
  cannot reopen or append to an earlier step.
- Provider adapters preserve well-formed whitespace because it can carry formatting, but discard
  zero-length deltas. They split an oversized source delta at Unicode code-point boundaries into
  ordered normalized deltas. Each normalized delta is at most 8,192 Unicode code points and 32,768
  UTF-8 bytes. Ill-formed Unicode, a delta for an unopened or ended block, a duplicate start or end,
  a nested start, or Finish with an open block is a `malformed-response` Provider failure.
- The Agent Runtime republishes the accepted lifecycle as
  `agent.reasoning-start`, `agent.reasoning-delta`, and `agent.reasoning-end` with a run-scoped
  CtrlZebra block ID. It preserves the relative order of every reasoning, text, Tool, Usage, and
  Finish event and never inserts reasoning into the model message history used by a later Tool step.
- A start/end pair with no retained text is a valid empty block. Runtime events may preserve its
  ordering, but persistence recovery and the Webview do not create a visible card for it. Whitespace-
  only retained text is not treated as an Agent's required final answer and does not satisfy the
  existing non-empty answer rule.
- If a stream fails or is cancelled while a block is open, no synthetic delta or end is emitted.
  Already emitted text remains an explicitly partial block. Completion, failure, and cancellation
  close the owning run for delivery purposes, so late reasoning events are ignored and cannot cause
  persistence, protocol, Tool, retry, or UI side effects.
- Reasoning output is user-observable. Once any reasoning start, non-empty reasoning delta, answer
  delta, or Tool event has been emitted, Provider retry policy must not restart that stream and risk
  duplicating visible content. A stream with no reasoning events follows the existing text and Tool
  behavior without a placeholder, error, or capability assumption.
- Reasoning support is detected only from actual events. It is not added to the version `1`
  Provider capability declaration, and Core does not reject a request because reasoning is absent.

### Provider token usage event boundary

- A Provider may emit a `usage` event with actual input, output, and/or total token counts. Each
  present count is an integer from `0` through `2,000,000`; an empty object means that the Provider
  supplied no usable count. Prices, billing data, estimates, and SDK metadata are not Core values.
- The Agent Runtime validates Usage at the Provider boundary, republishes at most one
  `agent.usage` event for each model stream step, and preserves its source order relative to text,
  reasoning, Tool, and terminal events. Duplicate Usage events in one step are consumed but do not
  create duplicate display or persistence records. A malformed or out-of-range count fails the
  Provider operation rather than crossing the Core boundary.
- Usage is display and recovery metadata only. It is never inserted into model history, does not
  alter context-budget decisions, and does not authorize a retry or Tool action. Once cancellation
  or another terminal outcome closes a Run, late Usage events are ignored and cannot cause protocol,
  persistence, or UI side effects.
- Session-cumulative Usage uses the shared Protocol merge rule: every field is added independently
  and a cumulative value above `2,000,000` is an explicit overflow, never a saturated count. Live
  presentation downgrades to unavailable and ignores further Usage for that Session, including
  continuations; recovery rejects the Session as corrupt, so neither path fabricates a Provider value.

## Provider Configuration Boundary

- `apps/extension` owns Provider configuration. It accepts VS Code configuration values as
  `unknown`, validates them at the host boundary, resolves credentials through Extension-owned
  SecretStorage adapters, and selects a `ModelGateway` through an injected Provider factory.
  `packages/core` and `apps/webview` never receive authoritative Provider configuration, endpoint
  URLs, Secret references, SDK options, model IDs, or other vendor-specific values. T1603 adds one
  deliberately bounded display projection: the Extension may send the closed Provider identifier
  and two configuration booleans (`apiKeyConfigured` and `modelConfigured`) to the Webview. This
  projection is presentation-only, is validated at the Protocol boundary, and never becomes a
  Provider selection, credential, model, or runtime configuration owned by the Webview.
- The supported Provider identifiers are the closed set `openai`, `gemini`, and
  `openai-compatible`. Unknown identifiers fail before Secret access or model client creation.
  Provider identifiers are public configuration values; renaming one requires an implementation
  plan update and an explicit migration.
- Every normalized Provider configuration has version `1`, a non-empty model ID, an effective
  endpoint policy, and a declared capability set. Version `1` capabilities are `text-streaming`
  and `tool-calling`. A caller supplies the capabilities required by the operation, and selection
  fails before creating a gateway when the declaration does not satisfy them.
- OpenAI and Gemini use their adapter-owned official HTTPS endpoints by default and declare the
  capabilities supported by their dedicated adapters. OpenAI-Compatible requires an explicit
  endpoint and an explicit capability declaration because compatibility servers cannot be assumed
  to implement every OpenAI feature. Its default capability declaration is `text-streaming` only.
- The active Provider defaults to `openai`. Model IDs have no implicit default because changing a
  vendor's recommended model would silently change cost and behavior; a missing model produces an
  actionable configuration error. OpenAI-Compatible has no endpoint default.

- Model gateways are initialized lazily on the user operation that needs them. Activation may
  register configuration and compose factories, but it must not read a Secret, initialize an SDK
  client, or contact an endpoint. Concurrent lazy callers share an in-flight initialization only
  when the owner can prove that the effective configuration is identical.
- Provider factories receive only validated, normalized values and the credential required for
  that invocation. A factory does not read VS Code configuration or SecretStorage. Dedicated
  OpenAI, Gemini, and OpenAI-Compatible adapters are composed by the Extension and remain isolated
  from Core and Webview code; selection tests may use injected factories without initializing an
  SDK client.
- Provider credential entry is an Extension-owned host workflow. User-facing credential commands
  collect values through password-masked VS Code input, write only through an injected
  SecretStorage adapter, and expose no credential through Core, Protocol, Webview state, settings,
  command arguments, logs, or diagnostics. Command handlers remain thin composition points and do
  not initialize a model client or contact a Provider endpoint.
- T1604 extends that same Host-only boundary with per-Provider delete and rotate commands. Delete
  confirmation projects only the closed Provider display label and a generic consequence; it does
  not read or display a Secret. Rotation collects a fresh password-masked value and invokes exactly
  one `ApiKeySecretStorage.save` for the stable key without clearing the old value first, including
  when no prior key exists (rotation is equivalent to a first save in that case). A fulfilled adapter
  save is the replacement commit boundary; a rejected call is indeterminate because the VS Code API
  exposes no transaction, compare-and-swap, or rollback guarantee.
  Delete first asks the
  existing Host-owned presence adapter; an `absent` result is a fixed no-op and does not invoke
  `ApiKeySecretStorage.delete`, while a `present` result permits exactly one adapter delete call. A
  presence `unavailable` result (including a rejected `get`) is never treated as absent: a delete
  preflight invokes no delete and returns fixed safe indeterminate retry/settings guidance. Rotation
  has no presence preflight; an unavailable post-save reconciliation makes the observed outcome
  indeterminate. A fulfilled adapter delete is a completed command outcome; a rejected call is
  indeterminate. After either mutation settles, the Host performs a presence-only reconciliation and
  reports fixed safe retry/settings guidance when the state cannot be determined; it never reads or
  compensates with a Secret value. Save, delete, rotate, and presence handlers for one Provider are
  serialized by a Host-owned coordinator through mutation settlement and reconciliation; queue state
  contains no credential material and different Providers do not block one another. A separate
  presence projection returns only a boolean and never exposes length, prefix, suffix, hash, or other
  Secret-derived data.
- The presence adapter is the only place allowed to receive a `SecretStorage.get` string for status.
  It returns an internal tri-state (`present` for fulfilled non-`undefined`, `absent` for fulfilled
  `undefined`, `unavailable` for rejection), compares the value only with `=== undefined`, and
  immediately discards it; no caller receives or inspects the value. The public T1603 Webview status
  remains Boolean-only: `unavailable` takes the existing safe status-failure path and retains the last
  valid projection (or emits no replacement), never publishing `false` as a fact. Controller disposal
  and generation changes close a notification gate: late settlements remain observed for queue cleanup
  but cannot emit notifications, Webview status, or diagnostics/logs. The underlying SecretStorage
  Thenable is not cancellable, so cancellation can only prevent a not-yet-started adapter call.
- T1603 Webview onboarding intents remain host-owned. The Extension maps the strict save-key,
  select-model, and open-settings messages to existing Provider workflows or the VS Code settings
  command; command IDs, VS Code objects, endpoint values, and credential material never cross the
  Webview boundary. Completion, cancellation, and failure are returned as bounded user-safe action
  outcomes, while the Host remains the only source of configuration truth.
- T1605 adds a Host-only, user-triggered connection-check command. The command is discoverable from
  the Command Palette and is never started by activation, Webview creation, Session recovery, chat,
  or a Tool. It reads the already validated active Provider and model configuration, obtains the
  matching credential only for the check, and sends at most one metadata-only request to an endpoint
  whose request shape is covered by the current official Provider contract. The request contains no
  prompt, instructions, workspace URI or text, Session/message history, Tool declaration, Tool input
  or result, and it cannot execute a model generation or Tool side effect. The dedicated routes are
  OpenAI `GET /v1/models/{model}` with `Authorization: Bearer <key>` and Gemini
  `GET /v1beta/models/{model}` with `x-goog-api-key: <key>`; both use one strictly validated model
  path segment encoded exactly once, an empty body, `Accept` plus the required authorization header,
  and no credential in a query string. For OpenAI-Compatible, the validated normalized endpoint is
  the base URL owned by the existing configuration contract; the check appends exactly one
  `models/{encodedModelId}` path segment (preserving the base path and adding one separator). The
  request is `GET` with an empty body, `Accept: application/json`, redirects disabled, and no query
  or cookie credential. A remote endpoint (`requiresApiKey`) receives exactly one
  `Authorization: Bearer <key>` header; an explicit loopback endpoint may omit the header when no
  key is configured and uses it when a key is present. No other auth form is accepted. The Provider
  name never supplies an undocumented OpenAI assumption; a dedicated Provider custom endpoint has
  no official route and reports unknown without a request.
- The check returns an internal bounded report with tri-state facts for authentication, model
  existence, text streaming, Tool Calling, and the required capabilities. OpenAI's documented model
  retrieve metadata has no Tool Calling or streaming fields, so a successful response proves neither
  and both remain unknown. Gemini may report streaming as supported only when a strictly validated
  complete `supportedGenerationMethods` list contains `streamGenerateContent`; a documented complete
  list that omits it proves unsupported, while an absent, malformed, or non-complete field remains
  unknown. Neither `generateContent` nor a successful status proves Tool Calling; absent Tool Calling
  metadata remains unknown. The OpenAI-Compatible response contract is deliberately minimal: a
  bounded JSON object must contain an `id` string exactly equal to the configured model ID; unknown
  fields are discarded and no capability field is recognized, so all compatible capabilities remain
  unknown. Missing/mismatched `id` is malformed rather than evidence of model absence. The aggregate
  required-capability fact is unsupported when any required capability is unsupported, supported only
  when all are supported, and unknown otherwise. These
  rules apply only to official metadata or a documented, side-effect-free probe; the check never
  infers a capability from a model name or HTTP 200. It does not mutate Provider, endpoint, model,
  capabilities, or SecretStorage configuration. Cancellation and timeout close the operation and
  prevent late notifications or follow-up requests; the check has no automatic retry.
- Version `1` is the first Provider configuration format, so there is no legacy data to migrate.
  Future changes to identifiers, setting names, normalized shapes, defaults, or Secret names must
  define an explicit version transition. Migration reads exact prior keys through VS Code
  configuration inspection, never guesses from model IDs or endpoints, and never copies a Secret
  into ordinary settings.

## Tool Contract Boundary

- `packages/protocol` owns the strict, JSON-serializable Schemas and inferred types for Tool Call,
  Tool Result, tool risk, and structured tool errors. `packages/core` consumes and may re-export
  those contracts for the Provider boundary; it must not define a second Tool Call shape.
- A Tool Call contains an opaque call ID, a stable lower `snake_case` tool name, and generic JSON
  input. Provider adapters validate that generic envelope before emitting it. This validation does
  not authorize execution or replace the selected tool's input Schema, which parses from `unknown`
  immediately before execution in T0403.
- The risk set is the closed union `read`, `write`, `execute`, and `network`. Risk belongs to the
  registered tool definition and policy, not to model-supplied Tool Call input; model output cannot
  lower or choose a tool's risk.
- A Tool Result is a strict discriminated union tied to the exact call ID and tool name. Success
  carries JSON output and an explicit truncation flag. Failure carries a stable error code and a
  user-safe message; raw exceptions, SDK failures, host values, and arbitrary diagnostic objects do
  not cross this boundary.
- The normalized result has a 1,048,576-byte UTF-8 serialized ceiling. Producers apply the limit
  before constructing the result so the boundary never needs to retain an unbounded value merely to
  reject it; the shared Schema enforces the ceiling as defense in depth.
- The executor converts expected tool failures into structured error results. Cancellation remains
  a separate run outcome, propagates through the run-owned `AbortSignal`, and produces no ordinary
  Tool Result after cancellation.
- Tools do not own Agent control flow. A tool can return data or a structured failure, but cannot
  mutate Session status, emit lifecycle transitions, continue the model loop, approve an operation,
  or choose presentation state. Those responsibilities remain in the Core runtime and its injected
  services.
- Core may report an approval-preparation or Tool-execution failure through an injected, local-only
  diagnostic sink. The diagnostic carries the owning Session, Run, and Tool Call identities plus the
  internal cause for host logging; it is not an `AgentRuntimeEvent` and therefore cannot enter the
  Webview, Protocol, persistence, model history, or Tool Result.

## Context Budget and Recovery Boundary

- Core owns context budgeting, history pruning, summarization policy, repetition detection, and
  Provider retry decisions. Provider adapters report normalized events and stable errors but do not
  spend budgets, retry themselves, or choose content to discard.
- A declared model context window must be a positive safe integer no greater than 2,000,000 tokens.
  The default budget allocator assigns the whole declared window with integer weights of 10% System,
  50% History, 25% Files, and 15% Tools. Integer division rounds each share down, then assigns the
  remainder one token at a time in the fixed order System, Tools, History, Files. The calculation is
  deterministic, uses no floating-point ratios, and the four categories always sum to the declared
  window without exceeding any category's weighted ceiling by more than one token.
- Token counts entering a budget decision are conservative estimates supplied through a Core-owned
  counter contract. A missing, negative, fractional, unsafe, or over-limit count is invalid input;
  the runtime never treats an unknown count as zero or continues with an unbounded value.
- Context construction treats a Tool Call and its matching Tool Result as one indivisible history
  unit. Pruning, summarization, and retry recovery may retain or remove the pair together but must
  never create an orphan Tool Result or a Tool Call whose completed result was discarded.
- Every bounded producer records truncation in structured metadata that survives later budgeting.
  Text-only ellipses are not sufficient. T0702 applies per-value hard limits of 65,536 Unicode code
  points, 2,000 lines, and 500 collection entries before the existing 1,048,576-byte serialized Tool
  Result ceiling; reaching any applicable limit sets the truncation marker.
- The newest user message is the protected recent-intent unit. History pruning and summarization do
  not remove or rewrite it. If that message alone exceeds its assigned hard budget, context building
  may include only a bounded prefix with an explicit structured truncation marker and must not spend
  another category's budget to conceal the overflow.
- A persisted summary is untrusted derived user content, never a System message or executable Tool
  Call. It is limited to 32,768 Unicode code points, records the covered message range, preserves
  unresolved user requests and material decisions, and must not claim facts absent from its source.
  Summary generation receives complete Tool Call/Result pairs and cannot authorize or replay tools.
- One model turn may perform at most one context-overflow recovery retry. The retry must strictly
  reduce estimated input tokens; otherwise recovery stops. A second overflow is terminal for that
  Run. Summary generation remains separately bounded to at most one operation where a later task
  supplies an approved summarizer. The exported Core recovery helper enforces the same one-retry
  bound and does not invoke a summarizer; summary recovery remains deferred until that contract is
  explicitly supplied.
  Provider retry policy may perform at most two retries after the initial attempt, and tool
  repetition detection must pause at a configured threshold no greater than 10 consecutive matching
  calls. Cancellation ends every recovery, retry, delay, summary, and tool-loop action immediately.

### Multi-turn history projection

- A Session is the durable owner of one ordered transcript and may contain multiple sequential Runs.
  A Run is one user submission, one model/Tool loop, and one terminal outcome; there is no separate
  Conversation aggregate in this phase.
- Extension recovery projects model history from the validated Session event log in committed
  sequence order. It includes every validated user message, complete assistant text only when its Run
  reached a normal `completed` outcome, and complete assistant Tool Call/Tool Result pairs whose call
  ID and name match. Reasoning, status, approval, usage, summary, attachment, and UI-source events
  never become model messages.
- A truncated, cancelled, failed, or recovery-interrupted Run keeps its user message for the next Run. Partial or
  unconfirmed assistant text is discarded. A Tool Call/Result pair committed before the terminal
  outcome may remain in order; an open call, orphan result, or mismatched pair is never injected and
  never receives a synthetic result.
- The newest user message is appended only after prior history has been validated. A continuation
  never replays a persisted approval, Tool, Provider request, or side effect. History remains
  untrusted model context and is bounded before constructing an unbounded array or string.

## Session State Machine

- Session status changes go through the Core state machine; callers and tools do not mutate or
  bypass the current status.
- Legal live transitions are `idle → preparing`; `preparing → streaming | cancelled | failed`;
  `streaming → awaiting_approval | executing_tool | completed | truncated | cancelled | failed`;
  `awaiting_approval → streaming | executing_tool | cancelled | failed`; and
  `executing_tool → streaming | cancelled | failed`.
- `completed`, `truncated`, `cancelled`, and `failed` are distinct terminal outcomes for the most recent Run.
  They have no ordinary outgoing transitions. An explicit Core-owned `beginRun` reset gate may move
  any of those outcomes to `preparing` for one newly allocated Run; it is not a status mutation that
  resumes the prior Run.
- `interrupted` is a recovery-only status. Recovery normalizes `idle`, `preparing`, `streaming`,
  `awaiting_approval`, and `executing_tool` to `interrupted`; it never resumes a persisted model,
  approval, or Tool operation. A later explicit `beginRun` may reset `interrupted` to `preparing`,
  with a fresh Run identity and fresh cancellation/resource ownership, but no automatic continuation
  is allowed.
- A Session accepts at most one active Run. Submitting while another Run, restore, or Session switch
  owns the Session fails closed and cannot be redirected to another Session.
- Every Run receives a host/Core-generated opaque Run identity distinct from Session ID, message ID,
  and transport request ID. The identity is carried into approval/checkpoint/diagnostic ownership and
  is never selected by Webview or model data. A Run owns its `AbortSignal`, event gate, Tool steps,
  and transient resources; none may be reused by a later Run.
- An illegal transition fails with a domain error without changing state or emitting an event.
- A legal transition commits the new status before synchronously emitting exactly one status-change
  event. Event-sink failures propagate and do not roll back the committed status.

## Controlled MCP Client Boundary

The long-term decision and rejected alternatives are recorded in
[ADR 0001](adr/0001-controlled-mcp-client-boundary.md). MCP is an external protocol adapter, not a
second Agent Runtime.

[ADR 0002](adr/0002-mcp-dual-era-stdio-compatibility.md) approves a later stage 18 extension for
explicit modern-only/dual stdio compatibility. Until T1804–T1807 complete, the production contract
in this section remains the stage 14 modern-only `2026-07-28` implementation; the dual-era tasks
must update this document before changing runtime behavior.

### Package and dependency ownership

- `packages/mcp-client` owns the MCP `2026-07-28` Client lifecycle, capability projection,
  request correlation, pagination collectors, Server primitive normalization, and all imports from
  the official MCP TypeScript SDK. Its public entry point exposes only CtrlZebra-owned interfaces,
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
  validated configuration share one in-flight attempt; a different configuration cannot replace
  it while it is live.
- Activation, module import, Webview creation, Session recovery, model output, Tool discovery, and
  background timers never connect or reconnect MCP. The only connection trigger is the
  user's explicit connect operation after configuration, trust, cwd, and startup approval checks.
- The lifecycle is `disconnected → connecting → connected → disconnecting → disconnected`, with
  `connecting | connected | disconnecting → failed` for an unexpected process or protocol failure.
  `failed` owns no usable Client and requires a new explicit connect action; there is no automatic
  retry, health polling, silent restart, or Session-owned connection.
- The connection controller is the single owner of the SDK Client, process port, request registry,
  list snapshots, notification handlers, stderr collector, and cleanup promise. For the pinned
  modern `2026-07-28` era, the SDK completes `server/discover` instead of the legacy
  `initialize` / `notifications/initialized` exchange. The controller publishes no capabilities
  until discovery completes and the exact protocol version is accepted.
- Disconnect, Server exit, failed connection negotiation, cancellation of connection setup,
  Extension disposal, or loss of Workspace Trust first closes the delivery gate and increments the
  generation, then aborts requests, closes stdin, and awaits bounded process-tree cleanup. Cleanup
  is idempotent; failure to confirm termination remains a distinct terminal error.
- Every request, notification refresh, Tool definition, approval, Resource read, Prompt preview,
  and result is bound to the current Server identity and generation. After the gate closes, late
  responses, notifications, stderr, process events, and promise settlements are discarded before
  Core, persistence, Protocol, or presentation side effects.

### Protocol and capability negotiation

- CtrlZebra constructs the SDK Client with
  `versionNegotiation: { mode: { pin: "2026-07-28" } }` and accepts only that result. A Server
  selecting an older version or an unknown future version fails connection negotiation with
  `protocol-incompatible`; SDK automatic legacy behavior is not a product compatibility promise.
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
- A protocol-incompatible connection diagnostic contains only the configured mode
  (`modern-only` in the T1803 contract), the closed supported version set (`2026-07-28`), and a
  fixed next action. It is emitted with the failed connection state and explicitly records that no
  connection was established. It never reports a probe, fallback, version selection, or
  compatibility success before the connection handshake has completed; T1804 may extend the mode
  and version union only through its own reviewed contract.
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
`modern-only`, `2026-07-28`, `connectionEstablished: false`, and `open-settings`; and `clear` has no
recovery action. The Webview does not infer a legal combination from independent fields.

The diagnostic message is additive and ignored by older clients. It is sent after the authoritative
connection/catalog state for the same request and generation, but it is never a second half of a
catalog publication. T1803 tests must cover each rejection classification, all-rejected and mixed
outcomes, deterministic Unicode ordering, duplicate suppression, count/byte truncation, explicit
clear after a successful refresh, stale sequence and generation races, disconnect cleanup,
protocol-incompatible messaging without probe/fallback claims, connection-driven clear on
disconnect/generation/cancel/trust/disposal, secret/raw-error exclusion, the normal connected path
with no diagnostics, and keyboard/screen-reader recovery behavior.
