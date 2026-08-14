
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
