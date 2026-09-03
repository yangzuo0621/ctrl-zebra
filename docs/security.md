# Security Guidelines

This document is the current security contract for the desktop VS Code Extension. It covers trust
boundaries, untrusted data, authorization, workspace access, credentials, persistence, and external
processes. Protocol and persistence documents own their schemas and durable layouts; this document
owns the security constraints that those contracts must preserve.

## Webview document security

### Content Security Policy

- Every Webview document starts with `default-src 'none'` and allows only resources required by the
  current UI. Styles use the current `webview.cspSource`; scripts use a fresh cryptographically
  random nonce.
- `unsafe-inline`, `unsafe-eval`, wildcard sources, unrestricted `https:` sources, remote frames,
  and network connections are denied by default. A new resource type or origin requires a narrow,
  documented use case and verification that unrelated sources remain denied.
- The Extension Host generates at least 128 bits of nonce randomness for each document. Nonces are
  document-local: they are not persisted, sent through Protocol, logged, or exposed to Webview
  state, and never authorize dynamic or untrusted content.

### Local and remote resources

- `localResourceRoots` contains only the Extension directory holding the built Webview assets.
  Workspace folders, user directories, temporary directories, and the complete installation
  directory are not resource roots.
- Local resource URIs are built from Extension-owned `vscode.Uri` values and passed through
  `webview.asWebviewUri`. URI strings from Webview messages, model output, persisted data, or
  workspace files are never passed directly to it.
- Remote scripts, styles, images, fonts, frames, media, and connections remain denied unless an
  explicit security decision adds them. Any allowlist uses exact schemes and origins, with no
  wildcard, redirect, or user-controlled origin. Secrets, authorization headers, workspace data,
  and identifiers are never sent to a remote origin from the Webview.

### Untrusted content and Markdown

- Webview messages, model output, workspace text, persisted values, MCP content, and URL-derived
  values are untrusted. Render them with DOM text APIs or React interpolation; never use
  `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, or equivalent sinks.
- The answer renderer uses the pinned `markdown-it` 14.3.0 configuration: `html: false`,
  `linkify: false`, `breaks: true`, and `typographer: false`. Images and resource-producing plugins
  are disabled. It renders parser tokens into a fixed React element tree rather than parser HTML.
- The supported presentation set is headings, ordered and unordered lists, fenced or indented code,
  inline code, emphasis, block quotes, tables, and links. Raw HTML and unsupported tokens remain
  escaped text.
- A link is actionable only when its parsed destination is an absolute `http` or `https` URL with
  no control characters or spaces and no more than 2,048 characters. Relative, protocol-relative,
  malformed, `javascript:`, `data:`, `file:`, and `vscode:` destinations are inert text. The Webview
  sends a validated `webview/open-external-link` intent; the Extension validates it again before
  calling `vscode.env.openExternal`.
- One answer message is bounded to 262,144 Unicode code points and 1,048,576 UTF-8 bytes before
  parsing. The renderer retains the largest complete prefix and marks it shortened. Streaming,
  cancellation, terminal state, and Session replacement cannot create late deltas or link actions.
  Code-copy controls copy only bounded code text and never grant host capability. Reasoning, MCP,
  Resource, Prompt, and Tool projections remain plain text.

## Reasoning summaries

- A reasoning summary is bounded Provider-supplied display text, not authoritative instruction,
  hidden chain of thought, or evidence of a model decision. Only documented reasoning-stream text is
  eligible; answer text, System output, Tool activity, metadata, signatures, opaque payloads, and
  raw request/response bodies are rejected.
- Producers bound each delta to 8,192 code points and 32,768 bytes, each block to 32,768 code
  points and 131,072 bytes, and each Run to 32 blocks, 65,536 code points, and 262,144 bytes.
  Limits are enforced while collecting, at code-point boundaries, before retaining an unbounded
  value. Omitted content cannot be recovered from logs or another model call.
- Events are accepted only for the exact active request, Session, Run, and open block. Duplicate,
  malformed, mismatched, late, or terminal-following events have no side effect; cancellation
  closes the collection gate. Reasoning is rendered as plain text and never enters HTML/Markdown,
  commands, URI parsing, approvals, Tool input, workspace operations, diagnostics, or later model
  history. Bounded user-visible text may be stored only under the Persistence Contract.
- Logs, telemetry, snapshots, crash reports, raw debug dumps, and fixtures contain only allowlisted
  operational facts, never reasoning text, Provider block IDs, or content-derived values.

## Session, Run, and history boundary

- Session IDs are opaque validated identities for exact repository lookup. They are never paths,
  workspace authority, approval grants, or instructions. An omitted ID creates a Session; an unknown,
  corrupt, active, or mismatched ID fails closed without fallback.
- Every submission receives a fresh Host/Core-generated Run ID, distinct from Session, message, and
  transport request IDs. It scopes cancellation, event delivery, Tool state, approvals, Checkpoints,
  diagnostics, and transient resources. A later Run never inherits an earlier Run's signal or gate.
- Reconstructed history is untrusted model context, never authorization, a command, a workspace
  target, or permission to replay a side effect. Failed, cancelled, budget-exceeded, and interrupted
  partial assistant output is display-only; unfinished Tool Calls are discarded rather than given a
  synthetic Result.
- Cancellation and Session replacement close the event gate before cleanup. No later delta, Tool
  Result, retry, approval response, persistence mutation, or side effect is accepted. `New chat`
  clears unsubmitted attachments and staged restore state but does not delete persisted Sessions.
- Regeneration and historical editing require the exact selected Session and target message identity.
  Each creates a fresh Run, cancellation scope, Tool lifecycle, and one-time approval scope from the
  validated history prefix. Old Tool operations, approvals, attachments, and side effects are never
  replayed. The old projection remains visible until a replacement completes successfully.

### Session deletion and local-history clearing

- Deletion is an explicit Host operation bound to one validated opaque Session ID, or to an explicit
  clear-all confirmation. The Webview cannot provide a path, storage URI, encoded directory,
  Checkpoint target, or wildcard. The Host revalidates the exact selected/owned Session immediately
  before cleanup and never falls back to another Session.
- Cleanup is limited to CtrlZebra persistence data. Workspace files, source code, unrelated VS Code
  storage, Provider secrets, MCP settings, and other Extensions' data are outside scope. Persistence
  owns the records removed and the representation of partial cleanup.
- If a Session owns an active Run, the Host closes its gate, issues exactly one cancellation, and
  waits for owned work and cleanup before deleting data. Storage, corruption, and attribution
  failures remain bounded `partial` or `unavailable` outcomes; successful categories remain deleted
  and the operation is safe to retry.

### Session retention

- Machine-scoped retention settings are untrusted configuration. [Configuration](configuration.md#session-retention-settings)
  owns names, scope, bounds, and defaults. Retention runs only from an explicit history list/refresh;
  it does not run during activation and cannot be triggered by Webview data, model output, or a
  persisted Session.
- [Architecture](architecture/context-and-session.md#session-retention-lifecycle) owns cutoff,
  protected states, locking, cancellation, and lifecycle results. [Persistence](persistence.md#session-retention)
  owns bounded scanning, exact Checkpoint attribution, and retryable storage behavior. Invalid,
  unreadable, or unattributable records are retained rather than guessed.
- Retention never targets workspace files, source code, settings, secrets, or other Extension data.
  Feedback contains only bounded counts and fixed safe text, never raw paths, content, exceptions,
  or persisted identifiers.

### Complete local-data clearing

- `ctrlZebra.clearLocalData` and the Agent view action use one Host controller. The Host presents a
  modal warning naming the permanent scope; Webview `confirm: true` is only an intent marker.
  Dismissal performs no mutation.
- The controller is single-flight and acquires operation locks before cleanup. It closes Run gates,
  cancels and settles active work, aborts MCP connection work, and invalidates Resource, Prompt,
  editor, workspace-reference, Checkpoint, and transient MCP projections before durable cleanup.
  Provider Secret operations remain excluded until other categories settle.
- [Configuration](configuration.md#complete-local-data-clearing) owns setting leaves and
  [Persistence](persistence.md#complete-local-data-clearing) owns Session, Checkpoint, and
  Extension-storage cleanup. The combined operation touches only CtrlZebra-owned data and never
  workspace files, user code, unrelated VS Code data, or another Extension's data.
- Results contain bounded category names, counts, and fixed text. Partial is never success;
  successful categories are retry-safe, and late Run, restore, MCP, or projection messages remain
  fenced. Raw SecretStorage, filesystem, configuration, and process errors never cross Protocol.

## Tool input, output, and workspace scope

- Model-supplied Tool names, IDs, and arguments are untrusted. The generic Protocol schema is followed
  by a Tool-specific parse from `unknown`; missing fields, wrong types, unsupported values, and
  unreviewed extra fields are rejected before side effects.
- Risk comes only from the trusted registered definition: `read`, `write`, `execute`, or `network`.
  Model input cannot assign, override, or downgrade it. Tool output is normalized to the shared JSON
  result contract before persistence, model context, or Webview delivery; raw Error, SDK, process,
  filesystem, stream, and VS Code objects are forbidden.
- A normalized Tool Result is at most 1,048,576 UTF-8 bytes. Producers enforce limits while collecting
  and preserve a truncation marker. Structured errors expose only stable codes and bounded safe
  messages; secrets, headers, unapproved workspace content, raw exceptions, stacks, and response
  bodies are excluded.
- The Run owns cancellation. Tools observe its signal, produce no later output or side effect after
  cancellation, and cannot mutate Session/Agent status, emit lifecycle events, continue the model
  loop, or approve their own operation.
- Workspace Tools operate relative to exactly one Extension-selected root. Paths are parsed as
  untrusted URI values; query/fragment data, `..`, backslashes, non-absolute paths, wrong scheme or
  authority, and ambiguous forms are rejected. Lexical containment is checked before host
  canonicalization, then symlinks/junctions and canonical URI path segments are checked again.
  `fsPath` string-prefix checks are forbidden. Failure to establish canonical identity fails closed.
- Text reads and searches reject NUL bytes, invalid decoding, and binary data. Enumeration, reads,
  searches, canonicalization, and serialized results are bounded and cancellation-aware.

## IDE context and file references

Editor, selection, diagnostic, language-service, and `@` file-reference values are untrusted,
read-only user context. Only the Extension reads VS Code state and emits strict Protocol projections.

- Every source URI is checked against the selected root with lexical and canonical containment;
  external/untitled documents, ambiguous paths, invalid text, and unsafe provider locations fail
  closed. Trust is checked at capture start and immediately before reading or delivering results.
- Text is bounded to 65,536 scalar values, 2,000 logical lines, and 262,144 UTF-8 bytes. Collections
  are bounded; results carry closed truncation or `out-of-workspace` reasons. Positions preserve
  VS Code UTF-16 semantics and reject split-surrogate or out-of-range offsets. The Files budget is
  at most 25% of the model window and never above the 2,000,000-token context ceiling.
- `read_editor_context`, `get_diagnostics`, `find_definition`, `find_references`, and `list_symbols`
  are read-only and require no approval. Provider failures become stable safe errors; source text,
  URI identity, stale state, diagnostics, provider objects, and pending attachments are not persisted,
  logged, restored, or used as hidden instructions.
- `@` references are user-initiated. The Webview sends only a bounded query or relative path; the
  Host reads through the same scope and text boundaries. Fingerprint changes make a snapshot stale;
  only an explicit refresh or use-stale decision permits submission. Duplicate canonical targets share
  one opaque reference ID, and only accepted text follows ordinary user-message persistence.
- Editor entry is opt-in through `ctrlZebra.editorContext.enabled` (default `false`) and explicit
  commands. The Host revalidates editor, selection, root, Trust, text type, and version before every
  capture. The Webview can refresh, remove, or explicitly use stale context, but cannot provide a
  URI, range, revision, Trust value, or text source. Capture and delivered-card gates are separate;
  cancellation, replacement, disposal, and stale/cross-view/session events cannot install a late card.

## Approval boundary

Approval authorizes one exact, user-visible operation. It is not a Session-wide, Tool-wide, path-wide,
or reusable grant. The Host builds it from the trusted Tool definition and validated operation.

| Risk | Meaning | Default |
|---|---|---|
| `read` | Observes bounded local data without external mutation. | May be allowed by policy. |
| `write` | Creates, changes, renames, or deletes workspace state. | Requires exact approval. |
| `execute` | Starts a process or executable behavior. | Denied unless explicitly defined. |
| `network` | Sends data outside the local trusted boundary. | Denied unless explicitly defined. |

- The request binds Host-generated identity, Session, Run, Tool Call, trusted risk, validated JSON
  input, selected root, resource identities/revisions, user-visible presentation, creation time, and
  expiration. MCP startup additionally binds normalized mode, Server identity, executable, arguments,
  and canonical cwd.
- Structural changes to tool name, input, target, root, revision/hash, effect, risk, or presentation
  create a new operation. The UI is a projection of the exact request consumed by execution; hidden or
  changed effects invalidate it. Secrets and unrestricted contents are excluded from presentation.
- A request moves from `pending` to exactly one of `approved`, `denied`, `cancelled`, `expired`, or
  `invalidated`. Host time checks expiration before response and consumption. Only `approved` can
  atomically become `consumed`, authorizing one attempt. Duplicate, late, conflicting, and unknown
  responses are rejected. Run completion, failure, cancellation, Session switch, New chat, or disposal
  invalidates all unconsumed approvals.

## Command execution

- Commands are `execute` risk and require fresh single-use approval for the exact invocation. The
  executable and ordered arguments remain separate validated values; the runner directly spawns with
  shell interpretation disabled. It does not concatenate a command line, invoke a shell, parse
  quoting, expand variables/globs, or interpret pipes, redirects, substitution, or sequencing.
- The cwd is a canonical directory inside the selected trusted root and is revalidated immediately
  before spawn. The child receives only an explicit baseline environment allowlist; credentials,
  tokens, cookies, proxy values, arbitrary variables, and model/Webview-supplied entries are excluded.
- Timeout, cancellation, spawn failure, and non-zero exit are distinct outcomes. Stdout/stderr are
  collected independently into bounded buffers with a truncation marker. Cancellation or timeout
  terminates the process tree; cleanup is idempotent and awaited, and uncertain termination is not
  reported as successful cancellation.

## Checkpoint and restore

[Persistence](persistence.md#checkpoint-durability-and-recovery) owns layout, record shape,
durable-before-side-effect ordering, compatibility, and retention. Security additionally requires
that a Checkpoint bind the exact Session/Run and immutable operation; model and Webview input cannot
choose its identity, targets, hashes, replacement content, extra targets, or force flag.

- Restore is explicit, all-target, scoped to the selected trusted workspace, and revalidates canonical
  identity and current hashes immediately before the atomic operation. Any conflict leaves every target
  unchanged. Checkpoint before-content is sensitive workspace data and never enters model context,
  Webview state, approval presentation, logs, telemetry, diagnostics, or ordinary fixtures.
- File mutation operations remain trusted `write` operations. Create, delete, rename, single-file edit,
  and multi-file WorkspaceEdit use the same root, Trust, approval, Diff, Checkpoint, cancellation, and
  result boundaries. Create/delete/rename are single-target; WorkspaceEdit is a bounded edit-only
  plan. A failed Checkpoint commit authorizes no workspace write.

## Diagnostic logging

- Logs are local, bounded operational records written by the Extension Host, not telemetry, model
  context, persisted Session data, or a user-facing error store. Entries use a stable event, component,
  outcome, and bounded allowlisted primitive fields/correlation IDs.
- Never log keys, tokens, cookies, headers, SecretStorage values, environment blocks, prompts, model
  or Tool data, command output, file contents, diffs, Checkpoint content, editor data, source URIs,
  paths, raw errors, stacks, SDK objects, or arbitrary causes. A boundary maps failures to stable safe
  categories before logging; cancellation, timeout, provider, tool, and cleanup outcomes remain distinct.
- User notifications and diagnostics are separate surfaces. A notification may explain a safe next
  step; a log may identify a bounded operation category, but neither is a fallback store for omitted data.

## Credentials and Provider boundaries

- The Extension Host alone accesses SecretStorage. Keys never enter Webview state, Protocol messages,
  workspace/global state, Sessions, fixtures, snapshots, command arguments, environments, logs, or
  model-visible content. Secret names are stable Extension-owned constants, not user input.
- Provider settings contain only validated Provider IDs, model IDs, endpoint URLs, and known capability
  declarations. Credentials, arbitrary SecretStorage names, user information, query strings, and
  fragments are invalid settings. Remote endpoints require `https:`; plain `http:` is limited to
  explicit localhost, `127.0.0.0/8`, or `::1` loopback.
- Provider save, delete, rotate, model selection, and connection-check workflows are explicit
  Host-owned commands. Empty/cancelled input has no mutation; adapter failures become fixed safe
  outcomes. Delete uses presence-only tri-state reconciliation; rotation performs one direct save;
  neither exposes or rolls back a Secret after an indeterminate backend failure.
- Model lists and connection checks are metadata-only, bounded, no-retry requests. They never include
  workspace/session/model context beyond the validated model identity, and responses are parsed from
  bounded JSON into closed projections. Raw bodies, headers, endpoint details, SDK errors, and auth
  material never reach UI, persistence, diagnostics, or logs. Unsupported or ambiguous capabilities
  remain `unknown`.

## Controlled MCP security boundary

MCP is an independent boundary because a configured local Server is an external process with the
user's operating-system authority. Server descriptors, schemas, annotations, content, results,
notifications, stderr, and errors are untrusted. The complete MCP lifecycle, protocol, projection,
and compatibility contract is owned by [MCP](mcp.md).

- Only the Extension Host reads the machine-scoped local stdio configuration and starts a Server.
  The setting has no cwd, environment, shell command line, endpoint, headers, credentials, Secret name,
  auto-start, retry, or capability fields. Connect requires a trusted single-folder workspace, the
  selected canonical root as cwd, and fresh exact startup approval.
- A Server is not a sandbox. Startup is a distinct approved `execute` operation; Server claims never
  grant CtrlZebra authority. External content is validated and bounded before projection, and raw
  process details are excluded from UI, logs, and persistence.
- Every MCP Tool is trusted `execute` risk regardless of Server annotations. Each call needs a fresh
  exact approval bound to Session, Run, Tool Call, Server identity, generation, schema identity,
  arguments, presentation, and expiry. Resource reads and Prompt previews require explicit current-
  generation user actions but are not Tool approvals and cannot authorize follow-up operations.
- Recovery displays bounded historical projections only. It never starts or reconnects a Server,
  resumes a request, replays an operation, consumes an approval, or reads current MCP configuration
  for a side effect.

## User-triggered redacted diagnostics export

Diagnostics export is an explicit local action, never automatic upload, telemetry, persistence, model
input, or authorization. The Host builds an allowlisted, Protocol-validated document containing only
format/extension/VS Code versions, closed platform and Provider IDs, aggregated stable error categories,
bounded MCP status facts, and bounded runtime measurements. It is at most 64 KiB and is shown in full
before confirmation.

- Keys, headers, endpoints, commands, paths, workspace/editor/conversation content, Server output,
  stacks, causes, and raw third-party errors are excluded. Malformed or out-of-range values become
  closed `unknown`/`[REDACTED]` values rather than copying arbitrary properties.
- The save target is a bounded UI label only and is not included in the artifact. Cancel, disposal,
  or closing the dialog performs no write. After explicit confirmation, bytes are written once through
  the local VS Code file API; write failure exposes only fixed local status.
