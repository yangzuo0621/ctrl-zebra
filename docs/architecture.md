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
