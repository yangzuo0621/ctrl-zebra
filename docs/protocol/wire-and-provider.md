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
