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
- Core defines a closed set of provider error categories suitable for runtime decisions. Adapter diagnostics may retain a redacted cause privately, but SDK error classes, status objects, response bodies, headers, and credentials never cross the `ModelGateway` boundary.
- The caller owns cancellation and passes an `AbortSignal` to `ModelGateway.stream`. An adapter passes that same signal to the underlying SDK operation, observes cancellation while consuming the stream, emits no later events, and preserves cancellation as distinct from provider failure.
- Provider adapters do not decide session transitions, retry policy, tool approval or execution, persistence, or presentation. Those decisions remain with the owning Core runtime or host adapter introduced by their roadmap tasks.

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

## Provider Configuration Boundary

- `apps/extension` owns Provider configuration. It accepts VS Code configuration values as
  `unknown`, validates them at the host boundary, resolves credentials through Extension-owned
  SecretStorage adapters, and selects a `ModelGateway` through an injected Provider factory.
  `packages/core` and `apps/webview` never receive Provider identifiers, endpoint URLs, Secret
  references, SDK options, or other vendor-specific configuration.
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
- One model turn may perform at most two context-overflow recovery attempts and at most one summary
  generation. Each attempt must strictly reduce estimated input tokens; otherwise recovery stops.
  Provider retry policy may perform at most two retries after the initial attempt, and tool
  repetition detection must pause at a configured threshold no greater than 10 consecutive matching
  calls. Cancellation ends every recovery, retry, delay, summary, and tool-loop action immediately.

## Session State Machine

- Session status changes go through the Core state machine; callers and tools do not mutate or
  bypass the current status.
- Legal live transitions are `idle → preparing`; `preparing → streaming | cancelled | failed`;
  `streaming → awaiting_approval | executing_tool | completed | cancelled | failed`;
  `awaiting_approval → streaming | executing_tool | cancelled | failed`; and
  `executing_tool → streaming | cancelled | failed`.
- `completed`, `cancelled`, and `failed` are distinct live terminal states with no outgoing
  transitions. A terminal Session is never restarted by changing its status.
- `interrupted` is a recovery-only terminal state with no incoming or outgoing live transition.
  Recovery normalizes `idle`, `preparing`, `streaming`, `awaiting_approval`, and `executing_tool` to
  `interrupted`; it never resumes persisted model, approval, or Tool operations.
- An illegal transition fails with a domain error without changing state or emitting an event.
- A legal transition commits the new status before synchronously emitting exactly one status-change
  event. Event-sink failures propagate and do not roll back the committed status.

## Controlled MCP Client Boundary

The long-term decision and rejected alternatives are recorded in
[ADR 0001](adr/0001-controlled-mcp-client-boundary.md). MCP is an external protocol adapter, not a
second Agent Runtime.

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
- T1404 must wrap the pinned SDK's documented `AjvJsonSchemaValidator` export behind an injected
  `ExternalJsonSchemaValidator` contract. A structural walker first accepts only JSON Schema Draft
  2020-12 and the closed keyword set `$schema`, `$defs`, local `$ref`, `type`, `properties`,
  `required`, `additionalProperties`, `items`, `prefixItems`, `minItems`, `maxItems`,
  `uniqueItems`, `minProperties`, `maxProperties`, `minimum`, `maximum`, `exclusiveMinimum`,
  `exclusiveMaximum`, `multipleOf`, `minLength`, `maxLength`, `enum`, `const`, `allOf`, `anyOf`,
  `oneOf`, `not`, `title`, `description`, `default`, and `examples`. It rejects remote or cyclic
  references, unknown dialects/keywords, `pattern`, `patternProperties`, `format`, content and
  unevaluated keywords, custom formats/keywords, excessive bytes, nodes, depth, and properties.
  Validation does not coerce types, insert defaults, remove properties, or return all errors.
  Compiled validators are cached only for the immutable current-generation Tool snapshot and
  disposed with it.
- The same compiled input schema validates Tool arguments immediately before approval construction
  and again before execution. An advertised output schema, when present, validates normalized
  structured output. Validation proves shape only; it never proves safety, read-only behavior,
  idempotence, or authorization.
