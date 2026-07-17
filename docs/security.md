# Security Guidelines

This document defines the Webview security constraints established before T0104. It complements the trust boundaries in `AGENTS.md` and applies to every HTML document produced by the desktop Extension.

## Content Security Policy

- Every Webview document starts from `default-src 'none'` and opens only the resource types required by the current UI.
- Styles may load only from the current Webview resource origin exposed by `webview.cspSource`.
- Scripts require a fresh, cryptographically random nonce for each generated document. The same nonce appears in the `script-src` directive and on the intended script element.
- `unsafe-inline`, `unsafe-eval`, wildcard sources, unrestricted `https:` sources, remote frames, and network connections are forbidden by default.
- A new resource type or origin requires a concrete current-task use case, the narrowest possible CSP directive, and tests that prove unrelated sources remain denied.

## Nonce Ownership

- The Extension Host generates at least 128 bits of randomness for every HTML document and never reuses a nonce intentionally.
- Nonces are document-local implementation details. They are not persisted, sent through the Webview message protocol, logged, or exposed to Webview application state.
- Dynamic or untrusted content never receives a nonce. A nonce authorizes only static script elements emitted by the Extension-owned HTML builder.

## Local Resource Boundary

- `localResourceRoots` is set explicitly and contains only the Extension directory that holds the built Webview assets required by the page.
- Workspace folders, the complete Extension installation directory, user directories, and temporary directories are not Webview resource roots.
- Every local script, stylesheet, image, or font URI is built from an Extension-owned `vscode.Uri` and converted with `webview.asWebviewUri`.
- URI strings from Webview messages, model output, persisted content, or workspace files are never passed directly to `asWebviewUri`.

## Remote Resources

- Remote scripts, stylesheets, images, fonts, frames, media, and connections are denied unless a later approved task documents an explicit requirement.
- When remote access is introduced, allowlists use exact schemes and origins. Wildcards, redirects to unlisted origins, and user-controlled origins remain forbidden.
- Secrets, authorization headers, workspace content, and identifiers must not be sent to remote origins from the Webview.

## Untrusted Content

- Treat Webview messages, model output, workspace text, persisted values, and URL-derived values as untrusted.
- Render untrusted text through DOM text APIs or React text interpolation. Do not inject it with `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, or equivalent sinks.
- If a future feature must render formatted untrusted markup, it requires a narrowly configured, maintained sanitizer and tests for script elements, event-handler attributes, dangerous URLs, SVG, MathML, and mutation-based bypasses.
- HTML attributes and CSP metadata assembled by the Extension are escaped before interpolation. Validation and sanitization complement CSP; CSP is not their replacement.

## Tool Input and Output

- Model-supplied Tool Call IDs, names, and input are untrusted. The generic protocol Schema rejects
  non-JSON values and malformed envelopes, but execution requires a second, tool-specific parse from
  `unknown`. A tool must reject missing fields, wrong types, unsupported values, and unreviewed extra
  fields before any side effect.
- Risk is assigned by the trusted registered tool definition as one of `read`, `write`, `execute`,
  or `network`. Model input cannot provide, override, or downgrade risk. Approval and
  workspace-trust policy introduced by later tasks operate on this trusted definition.
- Tool output is untrusted even when produced locally. It must be normalized to the shared JSON
  result contract before persistence, model context insertion, or Webview delivery. Raw `Error`,
  filesystem, process, SDK, VS Code, stream, or class instances are forbidden.
- A normalized Tool Result cannot exceed 1,048,576 UTF-8 bytes. Every output-producing layer must
  enforce that ceiling while collecting data and avoid building an unbounded intermediate value
  merely to truncate it afterward. Successful truncation is marked in the Tool Result and that
  marker is preserved downstream. T0702 adds narrower, type-specific context limits; it does not
  relax this boundary.
- Structured tool errors expose only a stable code and bounded safe message. Secrets, authorization
  headers, workspace contents not already approved for return, raw exception messages, stack traces,
  third-party response bodies, and unrestricted arguments are excluded.
- The run owns cancellation. A tool receives the same `AbortSignal`, observes it during long work,
  and performs no later output or side effect after cancellation. Cancellation is never converted to
  a normal error result, retry hint, approval, or successful partial result.
- Tools cannot directly mutate Agent or Session status, emit synthetic lifecycle events, continue the
  model loop, or approve their own operation. Keeping control flow in Core prevents model-selected
  tool code from bypassing policy and state-machine invariants.

## API Key Secret Storage

- The OpenAI API key is stored under the stable, Extension-owned name
  `ctrlZebra.provider.openai.apiKey`. Secret names are implementation contracts and must not be
  derived from Webview input, workspace content, model output, or the secret value itself.
- Saving stores the supplied value exactly and replaces any value already held under that name.
  Reading returns `undefined` when no value exists. Deleting is idempotent, including when the
  value is already absent.
- The Extension Host is the only owner of SecretStorage access. API keys must not enter Webview
  state, protocol messages, workspace or global state, persisted sessions, fixtures, snapshots,
  command arguments, environment variables, or model-visible content.
- The adapter does not cache API keys. A retrieved string remains in memory only for the lifetime
  of the operation that needs it; callers must not retain it in long-lived services, module state,
  closures, or diagnostic objects.
- Logs and telemetry must never contain an API key, a key prefix or suffix, authorization headers,
  SecretStorage values, or third-party errors that could embed them. Secret names may be used only
  when required for internal diagnosis and must not be presented as credential values.
- Read, save, and delete failures are reported as operation-specific, user-safe errors. User-facing
  text may explain that the saved API key could not be accessed or changed and suggest retrying, but
  must not include the submitted value, the stored value, or the original error message.
- Automated tests use conspicuously fake values such as `test-openai-api-key`, operate only on an
  in-memory fake, and never read or mutate a developer's real SecretStorage. A manual Extension Host
  smoke test must also use a fake value and delete it before the test ends.

## Provider Endpoints and Credentials

- Provider settings contain only Provider identifiers, model IDs, endpoint URLs, and capability
  declarations. Raw API keys, bearer tokens, authorization headers, and arbitrary SecretStorage
  names are invalid configuration values and must never be accepted from workspace settings.
- The Extension owns the stable Secret names `ctrlZebra.provider.openai.apiKey`,
  `ctrlZebra.provider.gemini.apiKey`, and `ctrlZebra.provider.openaiCompatible.apiKey`. The active
  Provider identifier selects the corresponding name; users and model output cannot supply or
  derive a Secret name.
- OpenAI and Gemini require their corresponding API key. A remote OpenAI-Compatible endpoint also
  requires its API key. An OpenAI-Compatible endpoint whose URL contains an explicit loopback host
  may omit a key so that a local service such as Ollama can be used. Missing required credentials
  fail before model client creation with a user-safe message that names the Provider but not the
  Secret name or value.
- Explicit endpoint URLs are parsed as URLs and must not contain user information, query strings,
  or fragments. Remote endpoints require `https:`. Plain `http:` is allowed only when the parsed
  hostname is explicitly `localhost`, an IPv4 address in `127.0.0.0/8`, or the IPv6 loopback
  address `::1`; lookalike names and DNS names that might resolve to loopback do not qualify.
- Endpoint validation is structural and does not perform DNS resolution, probing, redirects, or
  other network access. Provider adapters must not follow a redirect that weakens the validated
  transport policy or sends credentials to a different origin.
- Capability declarations are untrusted configuration. Only known capability identifiers are
  retained, duplicates are rejected, and an undeclared capability is treated as unsupported.
  Capability checks occur before Secret access and network activity.
- Configuration errors and Provider selection errors may identify the invalid setting and explain
  how to correct it, but must not include credential values, authorization material, third-party
  response bodies, or unredacted SDK errors.

## Gemini API Key Entry

- The stable command `ctrlZebra.saveGeminiApiKey` is the only T0308 user-facing entry point for a
  Gemini credential. Renaming it is a public-contract change. The command is contributed to the
  Command Palette and its registration is owned by `ExtensionContext.subscriptions`.
- The command collects the value with VS Code's password-masked input. It does not prefill an
  existing credential, does not reveal whether a prior value exists, and keeps the prompt open on
  focus loss so the value is not accidentally submitted to another UI surface.
- Canceling the prompt performs no SecretStorage write and shows no success message. An empty value
  is rejected before storage. A non-empty value is stored exactly as entered under
  `ctrlZebra.provider.gemini.apiKey`, replacing any prior value according to the existing
  SecretStorage contract.
- The submitted value remains local to the command invocation and SecretStorage adapter. It must
  not enter configuration, command arguments, Webview messages or state, persistence, logs,
  diagnostics, snapshots, fixtures, or error text.
- Save success uses a credential-free confirmation. Input and storage failures use fixed,
  user-safe text and never include the submitted value, stored value, Secret name, or original
  backend error. The command does not initialize a Gemini client or make a network request.
