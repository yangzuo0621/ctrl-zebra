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

## Workspace Tool Scope

- A workspace tool operates relative to exactly one Extension-selected workspace folder. In a
  multi-root window, the other roots are outside that operation's scope until the user explicitly
  selects one of them. The model, Webview, persisted state, and tool arguments cannot broaden or
  replace the selected root.
- The Extension workspace adapter retains `vscode.Uri` values through scope validation. It compares
  scheme, authority, and decoded URI path segments; it does not compare `fsPath` strings or use
  string-prefix containment. Query strings and fragments are invalid for filesystem tool targets.
- Tool-supplied paths are untrusted. After URI parsing and before normalization, the adapter rejects
  `..` segments, backslashes, non-absolute URI paths, and other ambiguous path forms. Normalization
  must not silently turn an escaping input into an accepted descendant.
- Scheme and authority must match the selected root. URI schemes and host authorities are compared
  case-insensitively. On Windows, drive letters and path segments are compared case-insensitively;
  a different drive is outside scope. UNC targets must retain the exact selected server authority
  and share path; another server or share is outside scope.
- Lexical containment is checked before filesystem canonicalization so an obvious outside target is
  rejected without probing it. The selected root and candidate are then canonicalized by the
  host-owned adapter, following symbolic links, junctions, and equivalent aliases, and containment
  is checked again by URI path segments. A descendant whose canonical target leaves the selected
  root is rejected. The operation must use the validated canonical target or revalidate immediately
  before access so a path swap cannot bypass the decision.
- Filesystem providers that cannot provide a trustworthy canonical identity must reject the access;
  they must not fall back to lexical-only acceptance. Canonicalization failures use a safe stable
  error and do not reveal the outside target or host exception.
- `read_file` and `search_files` accept text only. Binary detection occurs before returning content;
  a NUL byte, invalid required text decoding, or another positive binary classification is rejected
  with a structured error. Binary bytes are never lossy-decoded into model context.
- Directory enumeration, file reads, and search collect into bounded buffers and stop at their
  tool-specific count or byte limit. The serialized Tool Result remains subject to the global
  1,048,576-byte UTF-8 ceiling, and successful truncation keeps its marker through later context
  budgeting. Cancellation stops traversal, reads, canonicalization, and output production.

## Approval Boundary

Approval is an authorization for one exact, user-visible operation. It is not a capability token,
session-wide grant, tool-wide grant, path-wide grant, or reusable confirmation. The trusted host
constructs the request from the registered tool definition and validated operation; model output
and Webview input cannot assign risk, broaden scope, extend lifetime, or replace the operation.

### Risk Matrix

| Risk | Meaning | Baseline disposition |
|---|---|---|
| `read` | Observes bounded workspace data without changing external state. | May be allowed without prompting by the policy introduced in T0502. |
| `write` | Creates, changes, renames, or deletes workspace state. | Requires an explicit approval bound to the exact operation. |
| `execute` | Starts a process, task, command, or other executable behavior. | Denied by default; a later task must define any narrower approved case. |
| `network` | Sends data or initiates a request outside the local trusted boundary. | Denied by default; a later task must define any narrower approved case. |

Risk comes only from the trusted registered tool definition. If an operation has multiple effects,
its risk is the most restrictive applicable category. Splitting one semantic operation into lower-
risk calls to avoid the matrix is forbidden.

### Exact Operation Binding

- An Approval Request has a host-generated identifier and binds the Session, exact Tool Call ID and
  name, trusted risk, validated JSON input, selected workspace root when applicable, affected
  resource identities and revisions when known, user-visible presentation, creation time, and
  expiration time.
- The bound operation is compared structurally from validated values, not from display text or raw
  JSON spelling. Any change to the tool name, input, selected root, target URI, resource set,
  expected version or content hash, effect, or risk creates a different operation and requires a
  new request.
- File targets retain URI identity at the Extension boundary. A request for a file mutation binds
  the canonical target and the exact pre-operation version or content hash. Canonicalization or
  revision checks are repeated immediately before consumption.
- The Approval UI is a projection of the same immutable request that execution consumes. It shows
  the exact tool/effect, target resources, selected workspace, risk, material arguments, expiration,
  and proposed diff or equivalent effect description. Hidden or changed effects invalidate the
  request; execution must never rely on information omitted from or inconsistent with the UI.
- Secrets and unrestricted file contents are excluded from Approval Requests and display text.
  Presentation contains only the bounded information needed for an informed decision.

### Lifecycle and One-Time Consumption

- A request starts as `pending`. An explicit user response changes it once to `approved` or
  `denied`. Cancellation changes a pending or approved-but-unconsumed request to `cancelled`.
- Reaching the expiration time changes a pending or approved-but-unconsumed request to `expired`.
  Expiration is evaluated by a host-owned clock before accepting a response and again immediately
  before consumption; client timestamps cannot extend or revive a request.
- A changed, missing, replaced, or no-longer-canonical target, a changed resource revision, a scope
  mismatch, or a presentation/operation mismatch changes a pending or approved-but-unconsumed
  request to `invalidated`.
- Only `approved` may transition to `consumed`, and the transition is atomic with claiming the
  authorization for execution. A consumed request can authorize exactly one attempt of the bound
  operation; retries and modified operations require a new request.
- `denied`, `cancelled`, `expired`, `invalidated`, and `consumed` are terminal. They cannot return to
  pending or approved. An approved request is not reusable after cancellation, expiration,
  invalidation, or consumption.
- Duplicate, late, conflicting, or unknown responses are rejected without changing state or
  executing an operation. Concurrent responses and consumers must have one deterministic winner.
- Cancellation is not a denial, failure, or ordinary Tool Result. Once the owning run is cancelled,
  no later response, consumption, output, or side effect is accepted.

## Command execution boundary

- Every command is an `execute`-risk operation and requires a fresh, single-use approval for that
  exact invocation. Approval never applies to a Session, Run, executable, directory, prefix, retry,
  or later command. The immutable approval presentation and consumed operation both contain the
  complete executable, ordered argument vector, canonical selected-workspace cwd, and timeout.
- The command contract represents an executable and arguments as separate validated values. The
  Extension runner uses direct process spawning with shell interpretation disabled. It does not
  concatenate values into a command line, invoke a platform shell, parse quoting, expand variables
  or globs, follow aliases, or interpret operators such as pipes, redirects, command substitution,
  sequencing, or background execution. Shell execution would be a different public operation and
  requires a later security review and explicit protocol contract.
- The cwd is a canonical directory inside the one Extension-selected workspace root. It remains a
  URI through scope validation and must pass the same scheme, authority, segment, symlink, junction,
  and path-swap checks as workspace tools immediately before spawn. A missing cwd, a non-directory,
  an unselected root, or a target whose canonical identity cannot be established is rejected.
- The child receives only an explicit allowlist of environment variables required for baseline
  process operation. It does not inherit the host environment wholesale. API keys, authorization
  values, tokens, cookies, credential-helper settings, proxy credentials, arbitrary user variables,
  and model- or Webview-supplied environment entries are excluded. Environment names and values are
  treated as sensitive and redacted from approval text, logs, diagnostics, Tool Results, persistence,
  and model context.
- Command execution is disabled unless the selected workspace is trusted. Trust is rechecked after
  approval and immediately before spawn; a trust change invalidates unconsumed approval. A command
  cannot request a trust change or bypass the host-owned trust decision.
- Every invocation has a validated positive timeout within the protocol maximum. The runner owns a
  hard deadline independent of model or Webview activity. Timeout, caller cancellation, spawn
  failure, and a non-zero exit are distinct outcomes; none extends the deadline or silently retries.
- Stdout and stderr are collected independently into bounded buffers while streaming. The runner
  stops retaining bytes at the command-output ceiling without first constructing unbounded output,
  preserves a truncation marker, and remains subject to the global serialized Tool Result limit.
  Optional complete log persistence is disabled unless a later task defines its location, retention,
  permissions, redaction, size ceiling, approval implications, and cleanup ownership.
- Cancellation or timeout terminates the entire process tree, not only the direct child. No later
  output, tool continuation, or side effect is accepted after termination begins. Cleanup is
  idempotent, bounded, and awaited by an explicit owner; failure to confirm tree termination is
  reported separately and never represented as successful cancellation.
- Tests use fixed local fixture processes and fake environments; they never invoke a real shell,
  network client, package manager, developer command, or credential-bearing process. The suite
  covers Windows process-tree and argument behavior plus POSIX signal and argument behavior without
  assuming one platform's quoting, separators, executable lookup, exit codes, or termination model.

## Checkpoint and restore boundary

- Every Agent file mutation is bound to one immutable Checkpoint owned by the exact Session and Run
  that requested it. Model output, Webview input, and a later Run cannot choose an existing
  Checkpoint ID, change its ownership, replace its targets, or alter its before-content or hashes.
- The host computes lowercase SHA-256 hashes from the exact UTF-8 text at the workspace boundary.
  `beforeHash` covers the text captured immediately before the write and `afterHash` covers the
  exact proposed text. Persisted or client-supplied hashes are never trusted as proof of current
  workspace state; the host recomputes them for application and recovery checks.
- The complete Checkpoint is durably committed before any file in the bound operation is changed.
  If validation or persistence fails, no write is attempted. One Checkpoint covers all files in a
  semantic multi-file operation, and both application and restoration use one host-atomic workspace
  operation so a subset is never intentionally authorized or restored.
- Restore is allowed only for an explicit user request and only after every current target remains
  in the selected trusted workspace, resolves to the recorded canonical identity, and hashes to its
  `afterHash`. The host repeats those checks immediately before the atomic restore. Any mismatch,
  missing target, scope failure, canonicalization failure, binary content, or read failure produces
  a conflict and leaves every file unchanged.
- Restore writes only the bounded before-content already present in the selected Checkpoint. It does
  not accept replacement content, merge instructions, extra targets, or force flags from the model
  or Webview. Successful restoration is verified against every `beforeHash`; failures use safe
  diagnostics that do not disclose file contents.
- Before-content is sensitive local workspace data. It is excluded from model context, Webview
  state, approval presentation, logs, telemetry, diagnostics, snapshots, and fixtures except for
  deterministic fake test content. Checkpoints never contain credentials or other forbidden
  persistence data. No retention or automatic deletion policy is introduced by T0801.

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
