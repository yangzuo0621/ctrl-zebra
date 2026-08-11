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

## Restricted Markdown Boundary (T1702)

- Answer messages use the pinned `markdown-it` 14.3.0 parser with `html: false`, `linkify: false`,
  `breaks: true`, and `typographer: false`. The image rule is disabled, so model output cannot
  create a remote image, media, or font request. No Markdown plugin may add a resource, HTML, or
  executable surface without a new task-specific security review.
- The Webview consumes parser tokens and creates a fixed React element tree. It never calls
  `render()`, `dangerouslySetInnerHTML`, `innerHTML`, or an equivalent HTML sink. Raw HTML and
  unsupported tokens remain escaped text; the supported presentation set is headings, ordered and
  unordered lists, fenced/indented code, inline code, emphasis, block quotes, tables, and links.
- A link is actionable only when its parsed destination is an absolute `http` or `https` URL within
  the 2,048-character protocol bound and contains no control characters or spaces. `javascript:`,
  `data:`, `file:`, `vscode:`, protocol-relative, relative, and malformed destinations are rendered
  as non-actionable text. Bare URLs are not auto-linked. Link clicks never navigate the Webview:
  the Webview sends a validated `webview/open-external-link` intent and the Extension re-validates
  the destination before calling `vscode.env.openExternal`.
- The renderer parses at most 262,144 Unicode code points and 1,048,576 UTF-8 bytes from one
  message. It keeps the largest complete prefix, marks the visible projection as shortened, and
  never builds a larger parsed tree merely to truncate it afterward. A streaming message may be
  reparsed while a fence or inline construct is unfinished; cancellation, terminal status, or
  Session replacement prevents further deltas and link actions from reaching the renderer.
- Code-copy controls copy only the bounded code text through the Webview clipboard API. Copying
  does not move focus, announce token fragments, or grant any host capability; failures remain a
  local UI state. Reasoning, MCP Resource, Prompt, and Tool projections remain plain text and never
  enter this answer Markdown renderer.

## Reasoning Summary Boundary

- Reasoning summaries are untrusted model output with the same confidentiality and injection risk
  as answer text. The label “推理摘要” describes a Provider-supplied user-visible summary; it does
  not make the content authoritative, safe to execute, or evidence of the model's hidden process.
- Only text from a Provider's documented reasoning stream events is eligible. Ordinary answer text,
  System Prompt output, Tool activity, host-generated explanations, raw chain of thought, signatures,
  Provider metadata, SDK values, request/response bodies, and opaque or encrypted reasoning payloads
  are rejected rather than displayed or persisted.
- Reasoning text must be well-formed Unicode. Producers split normalized deltas to at most 8,192
  Unicode code points and 32,768 UTF-8 bytes. The Extension collector retains at most 32,768 code
  points and 131,072 bytes per block, 32 blocks per run, and 65,536 code points and 262,144 bytes
  across the run. It counts while collecting, cuts only at code-point boundaries, and never builds
  the unbounded block or run before applying the limit.
- Limit exhaustion keeps only the largest prefix that fits every applicable ceiling, discards later
  reasoning text in that scope, and records structured block/run truncation. The collector continues
  only far enough to validate lifecycle and reach the normal run outcome; omitted content cannot be
  recovered from logs, temporary files, diagnostics, raw response retention, or another model call.
- The Extension forwards and persists only reasoning events associated with the exact active
  request, Session, run, and open block. Duplicate, malformed, mismatched, late, or terminal-following
  events cause no protocol, persistence, Tool, retry, or UI side effect. Cancellation stops
  collection immediately and invalidates every open block for further delivery.
- Reasoning is rendered only through React text interpolation or equivalent DOM text APIs. It never
  reaches an HTML sink, a Markdown/HTML renderer, a command or URI parser, an approval request,
  Tool input, workspace operation, diagnostic field, notification template, or executable surface.
- Reasoning is excluded from System instructions, model request history, context summaries, retry
  prompts, Tool Call/Result pairs, and subsequent turns. A user may copy it and later submit it as
  ordinary user text, but the product does not perform that promotion automatically.
- User-visible bounded reasoning may be stored in the versioned Session event log under the
  persistence contract. It remains forbidden from `LogOutputChannel`, telemetry, snapshots, crash
  reports, raw debug dumps, and test fixtures containing real model output. Logs may record only
  existing allowlisted operational facts such as a stable event name, correlation IDs, and outcome;
  they never record block text, Provider block IDs, truncation details, or content-derived values.

## Session, Run, and history boundary

- A Session ID is an opaque, validated identifier used for exact repository lookup; it is never a
  path, workspace authority, approval grant, or instruction. Omitting a Session ID on `webview/submit`
  creates a new Session; providing one requests that exact Session. Unknown, corrupt, active, or
  mismatched Sessions fail closed and never fall through to a different Session.
- Each submission receives a fresh Host/Core-generated Run ID, distinct from Session ID, message ID,
  and transport `requestId`. Webview input, model output, persisted content, and MCP metadata cannot
  choose or replace it. The Run ID scopes cancellation, event delivery, Tool state, approvals,
  Checkpoints, diagnostics, and transient resources. A later Run never inherits a prior Run's
  `AbortSignal`, pending operation, approval, or delivery gate.
- History reconstructed from a validated local Session is untrusted model context. It may contain
  bounded user text and complete Tool Call/Result pairs, but it is never authorization, a command,
  a workspace target, or evidence to replay a side effect. Failed, cancelled, and interrupted partial
  assistant output is display-only and is not injected into the next Run; an unfinished Tool Call is
  discarded rather than given a synthetic Result.
- Cancellation and Session replacement close the Run's event gate before cleanup. No later delta,
  Tool Result, retry, approval response, persistence mutation, or side effect is accepted. Explicit
  `webview/new-chat` clears unconsumed user-context attachments and staged restore state but does not
  delete persisted Sessions or resume an active Run.

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

- An Approval Request has a host-generated identifier and binds the exact Session and Run, Tool Call
  ID and name, trusted risk, validated JSON input, selected workspace root when applicable, affected
  resource identities and revisions when known, user-visible presentation, creation time, and
  expiration time. Built-in and external Tool approvals both require this Run binding; an approval
  without an owning Run is invalid.
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
- Run completion, failure, cancellation, interruption, Session switch, explicit New chat, or disposal
  invalidates every unconsumed approval owned by that Run. A new Run must create a new exact request;
  no Session-wide, Tool-wide, remembered, or retry approval exists.
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

## Structured Diagnostic Logging

CtrlZebra diagnostic logs are local, bounded operational records written by the Extension Host to
the VS Code `LogOutputChannel`. They are not telemetry, model context, persisted Session data, or a
user-facing error surface. Core and provider code may describe an event through host-independent
values, but only the Extension adapter formats and writes a log entry.

### Entry shape and correlation

- Every entry is one structured object with a stable `event` name in lower `snake_case`, a
  `component`, and an `outcome` when the operation has completed. The channel's log level and VS
  Code timestamp remain transport metadata rather than duplicated fields.
- Optional diagnostic fields are limited to bounded primitive values: `errorCode`, `durationMs`,
  `memoryBytes`, `provider`, `attempt`, and identifiers needed to correlate an operation. Memory
  values describe only the Extension Host process and never contain heap snapshots or object data.
  Arbitrary objects and free-form metadata bags are forbidden.
- Correlation identifiers use explicit keys: `sessionId`, `runId`, `requestId`, `toolCallId`, and
  `approvalId`. An entry includes only identifiers already owned by the logged operation. Logging
  must not create a second identity or derive an identifier from content, paths, or secrets.
- Identifiers are diagnostic labels, not authorization. They cannot be used to approve, resume, or
  locate an operation without the normal ownership and validation checks.
- Field order is deterministic so tests and human inspection remain useful. Unknown fields are
  rejected or dropped before formatting, and each serialized entry has a fixed byte ceiling.

### Sensitive data and default exclusions

The following values are sensitive and must never enter a diagnostic entry, including as a field
name, nested value, interpolated message, error message, stack, URL query, or serialized object:

- API keys, bearer tokens, OAuth tokens, cookies, authorization and proxy-authorization headers,
  SecretStorage values, passwords, client secrets, signing material, and credential-helper data.
- Environment names and values, command environment blocks, request and response headers, and
  third-party request or response bodies.
- User prompts, model input or output, tool input or output, command stdout or stderr, file contents,
  diffs, checkpoint before-content, persisted messages, and workspace source text.
- Absolute workspace paths, user-directory paths, URIs containing user-controlled query or fragment
  data, and filenames or identifiers derived from source content.

User source and model content are excluded by default rather than inspected and selectively
retained. A future exception requires an explicit security review, a documented bounded schema and
retention rule, user-visible control where appropriate, and tests proving that unrelated content
remains excluded.

Before formatting, the logging adapter recursively treats input as `unknown`, accepts only the
documented fields and primitive types, and replaces sensitive key names and recognized credential
forms with a constant redaction marker. Redaction is defense in depth; callers still must not pass
sensitive values. Tests use synthetic conspicuous secrets and assert against the final rendered
entry, not only the intermediate object.

### Errors and third-party causes

- Raw `Error` objects, stacks, SDK response objects, host exceptions, and arbitrary `cause` chains
  are never serialized or interpolated into logs.
- A trusted boundary maps a failure to a stable internal `errorCode` and safe `outcome`. The logger
  may record an allowlisted error `name` only when it is assigned by CtrlZebra; third-party names,
  messages, status text, response bodies, headers, and stacks are excluded.
- A third-party `cause` may be inspected only to classify it through documented type guards or
  stable SDK properties. The resulting stable category may be logged, but the original cause and
  its recursively nested causes are discarded from diagnostic entries. A Provider `ModelGatewayError`
  may retain a non-enumerable in-memory cause for the owning host to preserve failure causality;
  that cause is never serialized, logged directly, persisted, or projected to the user.
- Core approval-preparation and Tool-execution diagnostics use a separate injected local sink. The
  Extension may inspect the in-memory cause only long enough to classify it into an allowlisted
  error code; the raw cause is never emitted as a Runtime event or retained in Protocol, Session
  persistence, model history, Tool Results, or Webview state.
- Cancellation, timeout, provider failure, tool failure, and cleanup failure remain distinct
  outcomes. Logging must not convert one into another or replace the primary result.

### User prompts versus diagnostics

- User-facing messages answer what failed and what the user can safely do next. They use stable,
  localized-safe text and never ask the user to inspect raw secrets or paste credentials into logs.
- Diagnostic entries identify where and in which correlated operation the failure occurred. They do
  not contain the user-facing prose, user content, or raw exception message.
- Showing a user notification and writing a diagnostic entry are independent decisions. A routine
  cancellation may need neither; a recoverable setup error may need a user prompt but no error log;
  an internal failure may need both, with only a stable error code linking the two surfaces.
- The logger must never be used as a fallback store for data omitted from Tool Results, protocol
  DTOs, persistence, approval presentation, or user notifications.

## API Key Secret Storage

- The OpenAI API key is stored under the stable, Extension-owned name
  `ctrlZebra.provider.openai.apiKey`. Secret names are implementation contracts and must not be
  derived from Webview input, workspace content, model output, or the secret value itself.
- Saving stores the supplied value exactly and replaces any value already held under that name.
  Reading returns `undefined` when no value exists. The VS Code API does not promise idempotent
  deletion or a compare-and-swap/transaction boundary; the Host therefore checks presence before a
  delete and does not call the adapter delete operation when the key is absent.
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

## Provider API Key Entry

- The stable user-facing commands are `ctrlZebra.saveOpenAIApiKey`,
  `ctrlZebra.saveGeminiApiKey`, and `ctrlZebra.saveOpenAICompatibleApiKey`. Renaming one is a
  public-contract change. Each command is contributed to the Command Palette and its registration
  is owned by `ExtensionContext.subscriptions`.
- Each command collects the value with VS Code's password-masked input. It does not prefill an
  existing credential, does not reveal whether a prior value exists, and keeps the prompt open on
  focus loss so the value is not accidentally submitted to another UI surface.
- Canceling the prompt or the credential-free overwrite confirmation performs no SecretStorage
  write and shows no success message. An empty value is rejected before storage. A non-empty value
  is stored exactly as entered under the Provider's Extension-owned SecretStorage name, replacing
  any prior value according to the existing SecretStorage contract.
- The submitted value remains local to the command invocation and SecretStorage adapter. It must
  not enter configuration, command arguments, Webview messages or state, persistence, logs,
  diagnostics, snapshots, fixtures, or error text.
- Save success uses a credential-free confirmation. Input and storage failures use fixed,
  user-safe text and never include the submitted value, stored value, Secret name, or original
  backend error. The command does not initialize a Gemini client or make a network request.

## Provider API Key Lifecycle (T1604)

- Credential deletion and rotation are Extension Host-only Command Palette workflows. The stable
  commands are `ctrlZebra.deleteOpenAIApiKey`, `ctrlZebra.deleteGeminiApiKey`,
  `ctrlZebra.deleteOpenAICompatibleApiKey`, `ctrlZebra.rotateOpenAIApiKey`,
  `ctrlZebra.rotateGeminiApiKey`, and `ctrlZebra.rotateOpenAICompatibleApiKey`. They are not
  Webview actions, Protocol messages, Onboarding actions, model Tools, or settings values. T1603
  onboarding remains limited to save-key, select-model, and open-settings.
- A delete command shows a modal confirmation that names the Provider and explains that its saved
  API key will be removed. It never reads or displays the Secret to construct the confirmation and
  never reveals whether a value exists. Cancellation before any storage call performs no
  SecretStorage operation and therefore leaves the state unchanged. After confirmation, the command
  asks the existing Host-owned presence adapter once. An `absent` result performs a fixed safe no-op
  and does not call the delete adapter; a `present` result permits exactly one existing
  `ApiKeySecretStorage.delete` call; an `unavailable` result performs no mutation and returns fixed
  safe indeterminate retry/settings guidance. A fulfilled adapter delete is a completed command
  outcome, while a rejected call has an indeterminate state. The command must not claim that the old
  value remains or that a rejected call removed it, perform a compensating mutation, or expose
  backend details; it performs a fresh presence-only reconciliation and offers fixed safe
  retry/settings guidance.
- A rotation command always opens a new password-masked input with no prefilled value. It keeps the
  input open across focus loss, rejects an empty submitted value before storage, and treats dismissal
  as cancellation. After validation it invokes exactly one existing `ApiKeySecretStorage.save`,
  including when no prior key exists; rotation is equivalent to a first save in that case. The adapter
  delegates to the Provider's stable-key `SecretStorage.store`; it does not read, delete, or clear the
  old value first. A fulfilled adapter save is the replacement commit boundary. A rejected write has an
  indeterminate state because the VS Code API provides no
  transaction, compare-and-swap, or rollback guarantee; the command must not read the Secret for
  rollback or compensation, or claim that the old value remains. Only after the adapter call settles
  may the dedicated presence adapter perform reconciliation; it compares the `get` result only with
  `undefined` and immediately discards it. An unavailable reconciliation is indeterminate and gives
  fixed safe retry/settings guidance. Cancellation before the store call guarantees no
  storage side effect; once the call starts, cancellation is not reported as a reversible outcome.
- Delete, rotation, existing save commands, and presence reads for one Provider share a Host-owned
  serial coordinator. It covers the prompt, confirmation, adapter mutation settlement, presence-only
  reconciliation, and result notification. The queue is released only after settlement and
  reconciliation, preventing overlapping commands from observing or reporting an interleaved
  lifecycle; this includes T1603 onboarding status reads. Operations for different Providers may
  proceed independently. Queue state contains only operation promises, never Secret values.
- Any credential presence/status projection uses a dedicated Host-owned presence adapter with an
  internal tri-state result: `present` only when `get` fulfills with a non-`undefined` value, `absent`
  only when `get` fulfills with `undefined`, and `unavailable` when `get` rejects. `unavailable` is
  never converted to `absent`/`false`; a delete preflight does not invoke delete in that case and
  instead returns a fixed safe indeterminate retry/settings outcome. Rotation has no presence
  preflight; an unavailable post-save reconciliation makes its observed outcome indeterminate. The unavoidable
  VS Code `SecretStorage.get` result is accepted inside the adapter, compared only with
  `=== undefined`, and immediately discarded; the adapter never checks length, prefix, suffix, hash,
  or content and never returns the string to its caller.
- The public T1603 Webview projection remains Boolean-only. A fulfilled tri-state result may map to
  `true`/`false`; an `unavailable` result uses the existing safe status-failure path and retains the
  last valid projection (or emits no replacement), never publishing `false` as a fact. A rejected
  post-mutation reconciliation is likewise indeterminate and cannot be used to claim the old/new
  value state.
- Controller disposal and generation changes close a notification gate. An awaited adapter operation
  that settles after disposal or an obsolete generation is still observed by its owning coordinator,
  but emits no user notification, Webview status, or diagnostic/log side effect. Queue cleanup is
  idempotent. The underlying VS Code SecretStorage Thenable is not cancellable; cancellation only
  prevents a not-yet-started call.
- User-facing success and failure messages may name the Provider and operation, but never include a
  Secret value, Secret name, authorization material, submitted input, or original SecretStorage
  error. The commands do not initialize a model client or contact a Provider endpoint.

## Provider Model Selection Network Boundary

- Model selection is an explicit Extension Host workflow. The `ctrlZebra.selectModel` command may
  open a Quick Pick after the user invokes it, but activation, Webview creation, Session restore,
  and chat execution never fetch a model list. The command is not a Tool or a model Run and does
  not create an approval request.
- T1602 permits a narrow network exception for bounded model metadata only. The only automatic list
  requests are HTTPS `GET` requests to the fixed official endpoints documented by the providers:
  [OpenAI `GET /v1/models`](https://developers.openai.com/api/reference/resources/models/methods/list)
  and Gemini's OpenAI-compatible
  [`GET /v1beta/openai/models`](https://ai.google.dev/gemini-api/docs/openai). The request has an
  `Accept: application/json` header and an `Authorization: Bearer <API key>` header, no body, no
  query or fragment, and redirects disabled. The API key is read from the matching SecretStorage
  entry for this operation only; it is never placed in a URL, persisted, logged, or returned to a
  caller.
- A configured custom endpoint is not covered by those official guarantees. OpenAI-Compatible
  endpoints, and custom endpoints configured for a dedicated Provider, never receive an automatic
  list request in this task; the command must offer manual model-ID entry instead. Endpoint
  validation remains structural and must complete before any SecretStorage read or network access.
- A list request contains no workspace URI or text, Session, message, Tool definition, Tool input or
  result, prompt, or other model context. It is a metadata-only request initiated by the user's
  command. No provider response body, headers, authorization material, or SDK error text may enter
  Webview state, Session persistence, diagnostics, or logs.
- The response is untrusted third-party input. Before parsing, the Extension enforces a fixed body
  limit of 256 KiB. It accepts only a bounded JSON object with a `data` array; for each array entry it
  validates a required `id` string (at most 256 Unicode code points and at most 256 entries total),
  extracts only `data[].id`, removes exact duplicates, and discards all top-level, entry-level, and
  provider metadata or unknown fields. A missing/non-array `data`, invalid entry, malformed JSON, or
  oversized response is a safe unavailable-list failure; no other field becomes a configuration value.
- Missing credentials, authentication failures, network/timeout failures, malformed or over-limit
  responses, empty lists, and cancellation are distinct outcomes. Missing credentials, an unavailable
  list, or an empty list offer manual model-ID entry. Cancellation performs no write and shows no
  success message. A failed request or a cancelled manual prompt leaves the existing model setting
  untouched.
- The user must explicitly choose a Quick Pick item or submit a validated manual model ID before the
  Extension updates `ctrlZebra.provider.model`. The update changes only that setting; it never
  clears or rewrites Provider, endpoint, capability, or SecretStorage values. A configuration write
  failure reports fixed user-safe text and preserves the prior model value.

## Provider Connection Check Boundary (T1605)

- Connection checks are Extension Host-only Command Palette workflows. The stable command is
  `ctrlZebra.checkProviderConnection`; it runs only after an explicit user invocation and is not a
  Webview action, Protocol message, Session/Run operation, model Tool, activation hook, or background
  health poll. A check reads the active, validated Provider configuration and model identifier, then
  reads the matching SecretStorage value only for the one request. It never writes Provider,
  endpoint, model, capability, or SecretStorage configuration.
- The request is metadata-only and contains only the active Provider/model identifier plus the
  required authorization material in the Provider-defined header. It has no body containing a prompt
  or instructions, no workspace URI or text, Session/message history, Tool declaration, Tool input or
  result, and it cannot trigger model generation or a Tool side effect. Dedicated OpenAI and Gemini
  checks use only their documented [OpenAI model retrieve](https://developers.openai.com/api/reference/resources/models/methods/retrieve)
  route (`GET /v1/models/{model}`, `Authorization: Bearer <key>`) and
  [Gemini `models.get`](https://ai.google.dev/api/models#method:-models.get) route
  (`GET /v1beta/models/{model}`, `x-goog-api-key: <key>`). The model is one strictly validated path
  segment encoded exactly once; both requests have an empty body, only `Accept` plus the required
  authorization header, no query credential, and redirects disabled. For OpenAI-Compatible, the
  validated normalized endpoint is the base URL from the existing configuration contract; the Host
  appends exactly one `models/{encodedModelId}` segment after preserving the base path and adding one
  separator. The request is `GET` with an empty body, `Accept: application/json`, redirects disabled,
  and no query or cookie credential. A remote endpoint (`requiresApiKey`) receives exactly one
  `Authorization: Bearer <key>` header. An explicit loopback endpoint may omit that header when no
  key is configured and uses it when a key is present. No other auth form is accepted. A dedicated
  Provider custom endpoint has no official route and reports unknown without a request; the Provider
  name never grants an undocumented OpenAI assumption.
- The Host bounds the response before parsing (64 KiB maximum body, with a declared length rejected
  above that limit), accepts only the documented model identity and explicitly documented capability
  fields, and discards all other metadata. It uses one operation-wide `AbortSignal`, a fixed 10-second
  timeout, and no retry. Cancellation is distinct from timeout and provider failure; after any
  terminal result no late message, notification, retry, or other side effect is allowed.
- Authentication, model existence, text streaming, Tool Calling, and the required capabilities are
  represented as `supported`, `unsupported`, or `unknown`. `supported` or `unsupported` is allowed
  only when official metadata or an explicitly documented, side-effect-free probe proves the fact;
  missing metadata, custom endpoints, and ambiguous responses remain `unknown`. OpenAI retrieve
  metadata has no Tool Calling or streaming fields, so a successful response leaves both unknown.
  Gemini streaming is supported only for a strict, bounded, complete `supportedGenerationMethods`
  list containing `streamGenerateContent`; omission proves unsupported only when the official
  complete-list semantics are valid, otherwise it remains unknown. No `generateContent` field or
  HTTP 200 may be used to infer Tool Calling. The aggregate required-capability fact is unsupported
  when any required capability is unsupported, supported only when all are supported, and unknown
  otherwise. The OpenAI-Compatible response contract is a bounded JSON object with a required `id`
  string exactly equal to the configured model ID. Unknown fields are discarded, no capability field
  is recognized, and all compatible capability facts remain unknown; missing or mismatched `id` is a
  malformed response, not evidence of model absence. A successful metadata response proves
  authentication and model existence only when the Provider contract says so; it does not imply
  streaming or Tool Calling support.
- HTTP status classification is structural and allowlisted: `401`/`403` are authentication failure,
  `404` is model not found, `429` is rate limited, `408`/`504` are timeout, other `5xx` and transport
  failures are network/unavailable, and other statuses are unknown or invalid response according to
  the documented route. The classifier never branches on response text, headers, URL, or SDK error
  messages.
- User-facing outcomes and diagnostics use fixed safe categories: authentication failure, model not
  found, rate limited, timeout, cancelled, network/unavailable, malformed response, configuration,
  and unknown. Raw response bodies, headers, authorization values, endpoint URLs (including query or
  fragment), SDK errors, stack traces, and SecretStorage values never enter Webview state, messages,
  persistence, fixtures, logs, diagnostics, or notifications. Logs may retain only the stable
  Provider identifier, outcome category, and bounded duration.

## Controlled MCP Security Boundary

This boundary applies to the stage 14 MCP surface and the T1804 dual-era contract. MCP Servers,
descriptors, schemas, annotations, content, results, notifications, stderr, logs, and
errors are untrusted external process input. A local stdio transport is not a sandbox: the Server
runs with the Extension user's operating-system authority and can have unknown local or network
side effects independent of what it advertises.

### User configuration and Server identity

- The source is the user-scoped VS Code setting `ctrlZebra.mcp.server`. The Host reads its
  inspected global value as `unknown`; workspace, workspace-folder, language override, Webview,
  model, Prompt, Resource, persistence, environment, and Server-provided values cannot create,
  replace, or merge configuration.
- The setting is either absent or one strict versioned object. Version `1` is
  `{ version: 1, serverId, displayName, command, args }` and means
  `protocolMode: "modern-only"`. Version `2` adds required
  `protocolMode: "modern-only" | "dual"`. Unknown fields, versions, and modes are rejected.
  `serverId` is lower `snake_case`, begins with a letter, and is at most 64 ASCII characters.
  `displayName` is well-formed Unicode, non-empty, and at most 128 code points and 512 UTF-8 bytes.
  `command` is non-empty, contains no NUL or newline, and is at most 4,096 UTF-8 bytes. `args`
  contains at most 64 strings; each is at most 4,096 bytes and the array is at most 32,768
  serialized UTF-8 bytes.
- Reading a version `1` object never writes a version `2` object or silently enables dual behavior.
  Migration and selection of `protocolMode: "dual"` are explicit user actions. A change while
  connected marks the configuration stale and requires disconnect, a new generation, and fresh
  startup approval; it cannot mutate the live process or switch era in place.
- Configuration has no cwd, environment, shell, transport, endpoint, headers, credential,
  SecretStorage name, auto-start, retry, or capability fields. The canonical cwd is the exact
  Extension-selected trusted workspace root at connect time. Version, identity, command, args, and
  cwd form the effective immutable configuration for one connection attempt.
- API keys, bearer tokens, passwords, authorization headers, cookies, proxy credentials, and other
  secrets are forbidden in `command`, `args`, display values, or future ordinary settings. Stage 14
  provides no MCP Secret injection. A Server that requires credentials is unsupported until a
  separately approved SecretStorage contract exists.
- `serverId` is the stable external identity used in approvals and persisted provenance. Changing
  any effective configuration while connected does not mutate the live Server; it marks the
  displayed configuration stale and requires explicit disconnect plus a new approved connect.

### Startup and process containment

- Server startup is a distinct `execute` operation, not `run_command` and not a Tool Call. It
  requires a fresh single-use approval that displays and binds Server identity, complete executable,
  ordered arguments, canonical selected-workspace cwd, the external-process warning, creation and
  expiry times, and the current trusted-workspace decision. It uses the existing host-owned
  five-minute approval lifetime; configuration or trust changes can invalidate it earlier.
- The Extension revalidates configuration scope, Workspace Trust, approval, executable/arguments,
  canonical cwd, and operation equality immediately before direct spawn. Shell interpretation,
  string command lines, profile loading, variable/glob expansion, aliases, pipes, redirects,
  command substitution, and model- or Server-selected executables are forbidden.
- The process receives a new allowlisted environment rather than the Host environment. Both
  configuration versions may copy only `PATH`; on Windows it may additionally copy `PATHEXT`, `SystemRoot`, `WINDIR`,
  `TEMP`, and `TMP`, and on POSIX `TMPDIR`. Missing optional values are omitted. Names and values
  are never shown, logged, persisted, sent to the Webview or model, or configurable by the Server.
- Stdout is exclusively the MCP framed message channel. Non-protocol stdout is a malformed-message
  failure, never a diagnostic log. Stderr is collected only into a bounded volatile diagnostic
  status and is never copied verbatim to logs, errors, persistence, Webview, model context, or Tool
  Results.
- Disconnect, cancellation, timeout, Server exit, connection-negotiation failure, trust loss, or
  Extension disposal closes the result gate before process cleanup. Cleanup closes stdin, aborts
  all owned requests, terminates the complete process tree, waits a bounded interval, escalates
  through the host process port when necessary, and confirms termination.
  `termination-unconfirmed` remains distinct from successful disconnect and blocks reuse of that
  connection.

### External Tool approval

- Every MCP Tool is assigned trusted CtrlZebra risk `execute`, regardless of Server annotations,
  name, description, input schema, or claims such as read-only, idempotent, open-world, or
  destructive. The approval UI also states “external Server; local and network side effects are
  unknown.” Server metadata can make this warning stricter but never remove or downgrade it.
- Each call requires a new exact Approval Request binding Session ID, Run ID, Tool Call ID,
  CtrlZebra registry name, Server ID, MCP Tool name, connection generation, the immutable compiled
  schema identity, structurally validated JSON arguments, display projection, trusted risk,
  creation time, and expiry time. No batch, Server-wide, Tool-wide, remembered, Session-wide, or
  argument-prefix approval exists. The approval uses the existing five-minute host-owned lifetime.
- Approval is invalidated by any configuration, identity, generation, Tool snapshot, schema,
  argument, workspace trust, presentation, or connection-state change. Consumption is atomic and
  permits exactly one `tools/call` request. A retry or changed call requires a new approval.
- Arguments are validated against the current-generation Tool schema before approval construction
  and immediately before consumption. Validation is not authorization. A Server error,
  cancellation, disconnect, invalid or unsupported result, or lost response never creates a retry
  grant or reusable approval.

Resource reads and Prompt gets are not Core Tools and never masquerade as Tool approval. They occur
only after an explicit user selection in the current connected generation. The UI identifies the
external Server and requested URI or Prompt; returned content remains ordinary untrusted content
and cannot authorize follow-up operations.

### Operation security matrix

| Operation | Required user action | Trust/approval | Persisted effect | Cancellation/close result |
|---|---|---|---|---|
| Read configuration | Open or change user setting | No Server action | Configuration remains VS Code-owned | No connection starts |
| Connect/start Server | Select Connect and inspect startup | Trusted workspace plus exact five-minute single-use startup approval | No connection or approval persistence | Close gate and terminate tree |
| List Tools/Resources/Prompts | Successful explicit connection | Current generation and advertised projected capability | Catalogs are not persisted | Discard partial/late snapshot |
| Call MCP Tool | Agent proposes exact call; user decides inline | Trusted `execute` risk plus fresh exact five-minute single-use call approval | Bounded Call/Result provenance only | No late Result, retry, or side effect acceptance |
| Read/attach Resource | User selects Read, then separately Attach | Current generation; no Tool approval or Workspace authority | Exact attached text snapshot only | No late preview/attachment |
| Get/confirm Prompt | User requests Preview, then separately confirms | Current generation and exact preview; no Tool approval | Exact confirmed ordinary user projection only | Invalidate preview; no auto-send |
| Disconnect/dispose | User disconnects or owning lifecycle ends | No approval required to reduce capability | No connection state persisted | Close gate, abort, terminate, confirm |
| Session recovery | User restores existing Session | Never reads config for side effects or reconnects | Reads historical bounded projections only | No replay or resumed request |

### Collection and content limits

All limits are enforced incrementally before constructing the complete value. A more specific
limit may reject or truncate earlier; none relaxes the existing 1,048,576-byte serialized Tool
Result ceiling.

| Scope | Version `1` hard limit |
|---|---:|
| One inbound or outbound JSON-RPC message | 1,048,576 UTF-8 bytes |
| Retained stderr per connection | 65,536 UTF-8 bytes, prefix only |
| One list operation | 100 pages and 1,000 entries |
| One descriptor | 65,536 serialized UTF-8 bytes |
| One complete list snapshot | 1,048,576 serialized UTF-8 bytes |
| Rejected Tool projection | 256 entries; the complete strict catalog envelope (wrapper plus catalog) is at most 1,048,576 UTF-8 bytes |
| MCP diagnostic projection | 256 skipped entries; the complete strict diagnostic envelope is at most 1,048,576 UTF-8 bytes |
| One Tool input or output schema | 65,536 bytes, depth 32, 4,096 nodes, 1,024 properties |
| All schemas in one Tool snapshot | 524,288 serialized UTF-8 bytes |
| Tool arguments before approval | 262,144 serialized UTF-8 bytes |
| Normalized Tool text content | 262,144 code points and 524,288 UTF-8 bytes |
| Normalized Tool structured content | 524,288 serialized UTF-8 bytes |
| Resource/Template URI | 2,048 code points and 8,192 UTF-8 bytes |
| One Resource read | 32 text items, 131,072 code points and 524,288 UTF-8 bytes total |
| Prompt arguments | 32 entries; key 64 code points, value 4,096 code points, 65,536 bytes total |
| One Prompt result | 32 text messages, 65,536 code points and 262,144 UTF-8 bytes total |

List collectors reject duplicate cursors, a cursor that does not advance, limit overflow, duplicate
identities, or a malformed page and retain no partial replacement snapshot. Resource text may keep
the largest well-formed prefix only when the Protocol projection records `truncated: true`; Tool
and Prompt data that exceed their applicable limit are rejected rather than silently omitted.

### Tool rejection projection and atomic replacement (T1801)

- Tool discovery classifies each bounded descriptor independently after the descriptor envelope and
  identity have passed validation. A schema that is unsafe, unsupported, malformed, or over its
  schema limit rejects only that Tool; accepted sibling Tools remain eligible for the replacement
  snapshot. The rejection projection contains only the well-formed MCP Tool name and a closed
  CtrlZebra reason (`forbidden-keyword`, `unknown-keyword`, `invalid-reference`, `non-object-root`,
  `schema-invalid`, or `limit-exceeded`). It never contains a Server keyword, schema path, raw
  schema, SDK/JSON-RPC error, stack, command, environment, or other untrusted diagnostic.
- `rejectedTools` is independently bounded to 256 entries. Before taking the prefix, entries are
  sorted by exact MCP Tool name using lexicographic Unicode scalar-value order (not UTF-16 code units
  or Server page order), so paging and refresh order cannot change the reported prefix. When more
  entries are rejected in a mixed snapshot, the adapter retains that deterministic prefix and sets
  `rejectedToolsTruncated: true`; accepted Tools are never dropped to satisfy this diagnostic bound.
  An empty rejection list has `rejectedToolsTruncated: false`. The complete strict
  `extension/mcp-tool-catalog` wrapper and catalog are then counted together as UTF-8 serialized
  JSON bytes and must fit the 1,048,576-byte ceiling. The Host applies this check during bounded
  construction and before sequence allocation or sending; an over-limit candidate follows the
  stable `limit-exceeded` whole-operation path, retains the prior complete snapshot, emits neither
  combined nor legacy catalog, and consumes no sequence.
  If a non-empty input list has no accepted Tool, discovery fails with the existing stable
  `invalid-schema` outcome instead of publishing a misleading empty catalog. A genuinely empty
  Server list remains a valid empty catalog.
- Malformed pages, malformed descriptor envelopes, duplicate MCP identities, duplicate or reserved
  Registry names, and aggregate list/snapshot limit breaches are whole-operation failures. They
  retain the last complete current-generation snapshot and never publish a partial mixture of new
  and old entries. A successful replacement is committed only after all descriptors have been
  classified and all accepted schemas compiled.
- Every replacement is bound to the Server identity, connection generation, and a Host-owned
  monotonic `catalogSequence`. Disconnect, cancellation, Trust loss, a newer generation, or a
  failed refresh closes the delivery gate; late pages, validators, and catalog projections are
  discarded before Core, Protocol, Webview, persistence, or approval state can observe them. The
  sequence is scoped to `(server.serverId, generation)`, starts at `1`, is allocated once immediately
  before emitting a fully validated, within-ceiling projection, and never wraps a positive safe
  integer. Failed, cancelled, all-rejected, and over-limit discoveries allocate no sequence. On
  overflow the Host closes the current generation and requires an explicit reconnect; the new
  generation resets the sequence and Webview committed watermark. A sequence-aware Webview keeps a
  committed publication record plus only a transient pending candidate during synchronous
  validation. A message for a different Server or generation is ignored before watermark handling. A
  lower sequence than either watermark is a stale no-op. At an equal committed or pending sequence,
  an exact duplicate (same Server, generation, sequence, request ID, and equivalent validated catalog
  payload) is an idempotent no-op: it is ignored and never re-staged or committed. A same-scope,
  same-sequence candidate with a differing request ID or payload is discarded with the stable local
  `conflicting-catalog-sequence` classification, leaving pending, committed, and rendered state
  unchanged. A higher sequence commits only as one complete atomic value after validation; invalid
  validation clears only pending. There is no unmatched-half timer, retry, or receipt-order dependency.

Unsupported image, audio, Blob, embedded Resource, Resource Link, unknown content, task,
`input_required`, progress, logging, completion, subscription, or experimental values produce
stable unsupported errors. They
are not fetched, stringified, rendered, persisted, remotely loaded, or passed to the model.

### Tool Schema normalization and reference policy (T1802)

- MCP Tool schemas remain untrusted JSON. The Host applies the byte, node, depth, and property
  limits while walking the original value, before any keyword is stripped or renamed. A known
  keyword is never dropped without inspecting its value: nested schemas under a stripped keyword
  are walked with the same policy, so `pattern`, a remote reference, an unknown keyword, or a
  limit breach cannot be hidden inside an annotation or conditional branch. The normalized schema
  is the only value sent to Ajv; the original value and raw policy details never enter Core,
  Protocol, Webview, persistence, approval display, or diagnostics.
- The policy has four closed outcomes: allowed/retained, safe-to-strip, known-dangerous rejection,
  and unknown-keyword rejection. Allowed keywords retain their bounded, recursively validated
  value. Safe-to-strip keywords are the known annotation/unsupported-assertion set `format`,
  `$id`, `$comment`, `readOnly`, `writeOnly`, `deprecated`, `nullable`, `if`, `then`, `else`,
  `dependentSchemas`, `dependentRequired`, `propertyNames`, `contains`, `minContains`,
  `maxContains`, `unevaluatedProperties`, `unevaluatedItems`, `contentEncoding`,
  `contentMediaType`, and `contentSchema`; their values are validated and then omitted. The
  legacy `definitions` map is not stripped: it is converted to `$defs`, and every local
  `#/definitions/...` reference is rewritten to `#/$defs/...` before reference resolution. A
  collision between converted and native `$defs` names is `schema-invalid`, rather than choosing
  an order-dependent meaning. A successful conversion itself produces no rejection entry. Any
  key outside the allowed, stripped, conversion, and known-dangerous sets is an unknown keyword
  and maps to `unknown-keyword`.
- The known-dangerous keyword set is exactly `pattern`, `patternProperties`, `$dynamicRef`,
  `$dynamicAnchor`, `$recursiveRef`, and `$recursiveAnchor`; each maps to `forbidden-keyword`.
  Compiling Server-provided regular expressions for model-generated arguments creates a ReDoS
  attack surface, while dynamic/recursive reference vocabularies have not been reviewed for this
  boundary. The allowed `$ref` keyword must carry a local, well-formed, resolvable pointer to an
  exact top-level `#/$defs/<name>` anchor (or a rewritten legacy `#/definitions/<name>` pointer).
  Bare `#`, root/non-anchor targets, nested pointers below an anchor, remote/malformed/unresolved
  targets, and every multi-anchor cycle map to `invalid-reference`. A direct self-reference is
  only a `$ref` from within one anchor to that exact same anchor; it is allowed. The graph has one
  vertex per `$defs` anchor and rejects every other cycle as `invalid-reference`, including root
  self and nested/non-anchor mutual cycles. These rules preserve useful tree/AST schemas without allowing remote loading or
  unbounded reference traversal. Limits remain hard `limit-exceeded` failures and are never relaxed
  by stripping or conversion.
- Stripping a known keyword can make CtrlZebra's local shape check less strict, but it does not
  grant authority. Draft 2020-12 `format` is annotation-only under the pinned validator unless a
  format-assertion vocabulary is explicitly enabled (which CtrlZebra does not enable), and the
  MCP Server remains responsible for validating its own tool arguments. More importantly, every
  invocation still validates the normalized arguments immediately before approval and execution,
  and the one-time approval displays and binds the exact values that will be sent. Schema
  normalization therefore cannot bypass the approval, Workspace Trust, risk, generation, or
  cancellation boundaries; the worst permitted outcome is a bounded validation retry.
- The normalized schema must compile through the pinned SDK Ajv adapter. Its compiled validator is
  reused for argument validation immediately before approval construction and again before the
  side-effecting Tool call, with coercion, default insertion, and property removal disabled. A
  compile or runtime failure is a stable bounded classification and never exposes Ajv errors,
  schema paths, Server keywords, or raw schema data.

### MCP diagnostics and secrets

- MCP logging adds only bounded allowlisted facts: `event`, `component: "mcp"`, stable outcome or
  error code, `serverId`, connection generation, and already-owned request/Tool correlation IDs.
  Command, arguments, cwd, environment, descriptors, schemas, annotations, JSON-RPC content,
  Resource/Prompt/Tool content, stdout, stderr, SDK errors, Server error data, and process details
  are excluded.
- Stable MCP errors are classified before logging or Webview projection. Raw SDK/JSON-RPC/process
  errors and nested causes never cross the adapter. Redaction is defense in depth and cannot justify
  accepting forbidden data.
- MCP configuration and persisted provenance contain no credentials. SecretStorage values are never
  injected into the Server process in stage 14, and Server output cannot name or request a Secret.

### MCP diagnostic projection and recovery (T1803)

The user-facing `extension/mcp-diagnostics` projection is a separate bounded display surface, not a
log, persisted record, Tool result, capability claim, or authorization artifact. It may carry only a
validated MCP Tool name plus one existing `McpToolRejectionReason`, a closed discovery error code,
or the fixed protocol-compatibility facts defined by Protocol. It never carries a schema, keyword,
JSON Pointer, raw SDK/JSON-RPC/process error, response data, stderr, stack, command, arguments, cwd,
environment, URI query/fragment, credentials, or arbitrary Server metadata.

- Diagnostic entries are de-duplicated by exact `(boundedToolName, reason)` (the bounded
  `mcpToolName` value) and sorted by the validated Tool name using Unicode scalar-value order before
  the independent 256-entry prefix is
  selected. The prefix and complete strict message are measured incrementally in UTF-8; omitted
  entries set `skippedToolsTruncated: true`. The empty projection is an explicit bounded clear value,
  not an absent/unknown state. A malformed or over-limit diagnostic is dropped as a stable local
  protocol failure and cannot be replaced with an unbounded raw value.
- Diagnostics are bound to the exact Server identity, connection generation, Host-owned
  `diagnosticSequence`, and delivery gate. A lower sequence, wrong scope, cancelled request,
  closed generation, or late refresh is ignored before Webview state mutation. Exact duplicates are
  idempotent no-ops; same-sequence conflicting payloads are discarded. Disconnect, Trust loss,
  disposal, and failed cleanup clear the delivery gate before cleanup and cannot leave a recovery
  action that would reconnect or approve work. Independently of the gate, the Webview clears
  diagnostics, pending refresh, recovery controls, sequence watermarks, and diagnostic live-region
  text as soon as it receives `extension/mcp-connection` with `disconnecting`, `disconnected`, or
  `failed`, or a connected Server/generation change. A connected cancelled refresh emits an explicit
  `clear`; cleanup does not depend on waiting for that value.
- `refresh-tools`, `reconnect`, and `open-settings` are display/recovery intents only. They must
  repeat the ordinary explicit connection, Workspace Trust, startup approval, generation, and
  cancellation checks. No diagnostic action can auto-connect, silently retry, downgrade protocol,
  reuse an approval, invoke a Tool, read a Resource, or mutate persistence.
- A protocol-incompatible diagnostic is emitted only alongside a failed connection projection and
  says the configured mode (`modern-only` or `dual`), its corresponding closed supported-version
  list, and the fixed next action. It has no probe result, fallback flag, selected-era claim, or
  capability data; those facts cannot be inferred before a successful handshake. The negotiated
  era/version is available only on a connected projection.
- A mixed accepted/rejected catalog may show the validated rejected names while retaining accepted
  siblings. An all-rejected or failed refresh may show only its bounded validated rejection prefix
  and stable recovery code while retaining the prior complete catalog. Whole-operation identity or
  envelope failures show no untrusted Tool name. A successful refresh replaces diagnostics with
  `clear`, and a disconnect/generation change clears them synchronously. The strict variants permit
  only connected+`refresh-tools` for degraded or refresh failures, failed+`reconnect` for initial
  all-rejected/whole-operation failure, failed+`open-settings` for protocol incompatibility, and no
  recovery action for `clear`.

### T1804 dual-era negotiation and information boundary

The configured mode is a user choice, not a Server capability. Version `1` settings remain
`modern-only`; version `2` requires an explicit `protocolMode`. `modern-only` accepts only
`2026-07-28`. `dual` accepts exactly `2026-07-28` and `2025-11-25`, always over the same local
`stdio` process port and with the same approved executable operation.

- A `dual` connection begins with one bounded `server/discover` probe. Only a specification-
  classified non-modern response or bounded timeout can enter one legacy `initialize` /
  `notifications/initialized` exchange. A DiscoverResult, recognized modern error, malformed
  framing, message/stream overflow, cancellation, process exit, trust loss, or cleanup failure is
  terminal and cannot become a downgrade oracle. The probe request and correlation state are closed
  before fallback, and the generation gate drops all late probe data.
- No capability, catalog, Tool, Resource, Prompt, approval, persistence, or Webview state is
  available until the selected handshake has validated its exact closed version. Both eras expose
  only the reviewed Tools, Resources, Resource Templates, Prompts, and list-change behavior. Roots,
  Sampling, Elicitation, Tasks, logging, completion, subscriptions, experimental values, and unknown
  Server requests are rejected before Core, Provider, Workspace, approval, or persistence.
- The connected projection may expose the configured mode and one negotiated `{ era, version }`
  pair. Before connection succeeds, failed/connecting projections expose no selected era, version,
  capability, probe result, fallback result, timing, or SDK value. Protocol diagnostics use the
  bounded configured mode, closed supported-version list, stable error code, and fixed next action;
  raw protocol data and whether a fallback was attempted never cross the boundary.
- Negotiated era is not authorization. The same Workspace Trust, startup approval, exact Tool
  approval, generation, cancellation, limits, and process-tree cleanup apply in both eras. Legacy
  annotations cannot lower `execute` risk or create remembered permission.
- Completed operations may persist bounded provenance `{ configuredMode, negotiatedEra,
  negotiatedVersion }`; failed attempts, probe timing, fallback state, command/args/cwd/environment,
  credentials, SDK/JSON-RPC errors, and Server output remain volatile. Recovery treats provenance as
  historical display data and never starts, reconnects, probes, renegotiates, retries, or authorizes
  an operation.

The T1804 constraint PR documents these rules only. Configuration parsing, Protocol schema changes,
negotiation lifecycle, and compatibility fixtures are gated on its reviewed merge and belong to the
subsequent phase tasks.
