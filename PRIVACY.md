# CtrlZebra Privacy Notice

Effective date: 2026-08-12

This notice describes the data behavior of the Phase 1 CtrlZebra desktop VS Code extension. It does
not replace the privacy terms of Visual Studio Code, the operating system, a model provider, or a
service that a user chooses to run through a command.

## Data controller and contact

CtrlZebra is an open-source project maintained by Zuo Yang. Privacy questions and security reports
can be submitted through the repository's GitHub issue tracker. Do not include API keys, private
source code, prompts, logs, or other sensitive data in a public issue.

## Data CtrlZebra does not collect

CtrlZebra has no project-operated account service, advertising, analytics, telemetry, cloud sync, or
remote logging backend. The project does not receive an automatic copy of prompts, model responses,
workspace files, Sessions, Checkpoints, diagnostics, or credentials.

## Data stored locally

The Extension Host stores data using VS Code-owned facilities on the user's machine:

- Provider API keys are stored in VS Code SecretStorage. They are excluded from settings, Webview
  state, Session persistence, Checkpoints, logs, tests, and model-visible content.
- The selected Provider model ID is stored in the existing VS Code machine setting. A model list
  fetched for an explicit selection command is transient; list responses are not persisted, cached,
  or copied into Session data, Webview state, diagnostics, or logs.
- Session manifests, messages, and lifecycle events are stored in the extension storage directory.
- Checkpoints are stored in extension storage before approved file changes. They contain the exact
  pre-edit UTF-8 workspace text needed for conflict-safe restoration.
- Bounded structured diagnostics are written to the local CtrlZebra VS Code log channel. They contain
  event categories, outcomes, durations, process RSS samples, and correlation identifiers; they
  exclude prompts, responses, file contents, command output, paths, credentials, and raw third-party
  errors.
- Active editor text, selections, document versions, VS Code diagnostic messages, language-service
  results, and their URI identities are not collected automatically. They remain in the Extension Host
  only while a user-controlled capture or read-only Tool call is active.
- The optional MCP Server configuration remains in VS Code machine settings. Live MCP catalogs,
  executable details, environment values, raw protocol messages, stderr, Server errors, and process
  handles are not copied into Session storage, Webview state, model context, or logs.

Session and Checkpoint data remain local to VS Code extension storage. Automatic local cleanup is
enabled by default for 30 days and is configurable or disableable with the machine-scoped
`ctrlZebra.sessionRetention.enabled` and `ctrlZebra.sessionRetention.days` settings. It runs only
after an explicit Session history list/refresh, removes expired Sessions and safely attributable owned
Checkpoints, and never removes workspace files. Explicit local delete and clear-all controls remain
available; neither automatic nor explicit cleanup sends data to CtrlZebra or a remote service.

## Data sent to a configured model provider

Starting a chat sends data directly from the Extension Host to the provider endpoint selected in VS
Code settings. Depending on the conversation, this can include:

- the user's prompt and relevant prior conversation messages;
- tool definitions and bounded tool results;
- model responses needed to continue a tool loop; and
- workspace source text returned by an approved read operation or other tool result;
- bounded text from an explicitly attached active editor or selection, when the user has enabled
  `Editor context` and sends the current submission; and
- bounded diagnostic, definition, reference, or symbol results returned by a read-only IDE Tool that
  the user permitted in that Run.
- bounded text from an MCP Resource that the user explicitly previews and attaches, a Prompt that
  the user explicitly previews and confirms, and results from individually approved MCP Tool calls.

The provider may process and retain this data under its own terms and privacy policy. CtrlZebra does
not proxy provider traffic or receive a copy. Users are responsible for selecting an appropriate
provider and must not send confidential data unless that provider and account are authorized for it.
A loopback OpenAI-compatible endpoint keeps the network destination local, but the behavior of that
local service remains outside CtrlZebra's control.

## User-triggered model discovery

When a user explicitly runs the model-selection command, the Extension Host may send a metadata-only
HTTPS `GET` request to the fixed official OpenAI or Gemini model-list endpoint. The request uses the
selected Provider's API key as an authorization header and contains no prompt, workspace path or
source text, Session, message, Tool definition, Tool input, or Tool result. The provider can observe
and retain this request under its own terms, just as it can observe other authenticated API traffic.
CtrlZebra does not proxy or receive a copy of the response beyond the local selection flow.

No model-list request is made during activation, Webview creation, Session recovery, or chat execution.
OpenAI-Compatible and custom endpoints are not queried automatically because their list behavior and
data handling are not covered by the official Provider guarantees; users enter those model IDs
manually. Cancelling or failing discovery leaves the existing model setting unchanged.

## User-triggered Provider connection checks

When a user explicitly runs the Provider connection-check command, the Extension Host may send one
bounded, metadata-only request to the documented model-metadata endpoint for the active OpenAI or
Gemini configuration. OpenAI uses `GET /v1/models/{model}` with `Authorization: Bearer <key>`;
Gemini uses `GET /v1beta/models/{model}` with `x-goog-api-key: <key>`. The selected model is one
strictly validated path segment encoded exactly once; the request has an empty body, only `Accept`
and the required authorization header, and never places a key in a query string. It contains no
prompt or instructions, workspace path or source text, Session/messages, Tool definition, Tool
input/result, or other model context, and it does not ask the model to generate output or execute a
Tool. The response is used transiently to classify authentication and model existence and only
explicitly documented capability fields; unsupported or ambiguous capability facts are shown as
unknown rather than inferred. OpenAI retrieve metadata has no Tool Calling or streaming fields;
Gemini streaming is supported only from a strict complete `supportedGenerationMethods` list containing
`streamGenerateContent`, with no Tool Calling inference from `generateContent` or HTTP 200.

OpenAI-Compatible endpoints use the validated normalized configured base URL and an explicitly bounded
`GET` path formed by preserving its base path and appending exactly one `models/{encodedModelId}`
segment. Remote endpoints receive one `Authorization: Bearer <key>` header; explicit loopback
endpoints may omit that header when no key is configured and use it when a key is present. No query
or cookie credential is sent, and the minimal response must contain a matching bounded `id` fact;
capabilities remain unknown. Dedicated Provider custom endpoints are not assumed to implement an
official metadata route and are not probed. The request has a fixed timeout, no retry,
and cancellation stops the local flow without changing configuration. Response bodies, headers,
authorization material, SDK errors, and endpoint details are not persisted, logged, sent to the
Webview, or retained by CtrlZebra. The configured provider service may observe and retain the
metadata request under its own terms and privacy policy.

## IDE context and language-service data

The `Editor context` control is off by default. Even when enabled, CtrlZebra captures only the active
editor or selection that the user explicitly attaches to the current Composer or that a user-permitted
read-only IDE Tool requests. Moving the cursor, opening a file, receiving a diagnostic, or changing
focus does not send source text to a model. The user can remove an attachment, refresh a stale snapshot,
or close the control before sending.

Before any transmission the Extension Host validates the selected workspace, canonical URI, Trust
state, supported text encoding, document revision, and character/byte/Token limits. Unsubmitted or
cancelled captures never leave the Host. A read-only language-service call may return bounded results
from the VS Code provider, but it cannot execute a Code Action, write a file, run a command, or grant
permission. VS Code or a provider may independently process the document locally under its own terms.

When the user sends an attachment or permits a read-only Tool during a Run, the configured model
provider receives only the bounded text or structured result and a workspace-relative source label
needed for context. CtrlZebra does not send absolute host paths, query/fragment URI data, credentials,
provider objects, raw errors, or a background editor stream. The provider may process or retain this
content under its own privacy terms; users must choose a provider authorized for the source.

Active editor snapshots, selection state, document versions, stale/truncation metadata, diagnostics,
language-service results, and source URI identities are not written to Session persistence, Webview
restoration, logs, telemetry, fixtures, or a cross-session memory store. Text that the user explicitly
sends as ordinary user content follows the existing Session storage and deletion rules, without carrying
the live source metadata. A future durable IDE provenance feature requires a separately reviewed
privacy, persistence, and user-control contract.

The `@` workspace-file picker is also explicit and local to the current Webview. Search returns bounded
workspace-relative names; the Host performs the canonical, bounded UTF-8 read only after the user selects
a result. Binary, outside-workspace, missing, or changed files are rejected or shown as stale. Pending
file cards, fingerprints, URI identity, stale decisions, and unsubmitted file text are discarded on
removal, New chat, Session switch/restore, workspace-boundary change, cancellation, or disposal. When
the user sends a file card, the configured model provider receives only its bounded text and redacted
workspace-relative source label as ordinary untrusted context; the file reference itself is not stored
as a separate Session record.

## Workspace access and commands

Read tools access only canonical UTF-8 text inside the single selected workspace. File changes and
commands require a trusted workspace and a fresh operation-bound approval. An approved command runs
locally with a minimal environment allowlist and shell interpretation disabled. The command itself
may transmit data if its executable and arguments request network or external-system access;
CtrlZebra does not add a second consent or privacy layer beyond the exact command approval.

An explicitly configured local MCP Server is a separate external process running with the user's
operating-system authority. It may independently access local files, network services, or other
data according to its own implementation. CtrlZebra starts it only in a trusted single-folder
workspace after an exact startup approval, supplies only a minimal environment allowlist, and does
not inject credentials. Every MCP Tool call requires a separate exact single-use approval, but
Resource reads and Prompt retrieval are user-selected context operations rather than operating-system
sandbox controls. Users must review the Server software and any privacy terms before configuring it.

## File lifecycle mutations

The file lifecycle Tools (`propose_file_create`, `propose_file_delete`, `propose_file_rename`, and
`propose_workspace_edit`, alongside the existing `propose_file_edit`) operate only on bounded UTF-8
text inside the selected workspace. They require a fresh, exact `write` approval. Before approval,
the Host may show the complete bounded proposed/create/delete Diff in a temporary VS Code Diff
editor; it does not send that preview to a remote service merely to render it. The Webview receives
only the bounded operation summary and cannot supply a path outside the selected root, a hash,
replacement content, a force flag, or a mutation Checkpoint ID. The existing explicit
`webview/restore-checkpoint` intent may carry a separately validated `checkpointId` to select a
Host-owned recovery record; that identifier is restore intent, not mutation approval data or
authority to alter the record.

The Extension stores one immutable Checkpoint before an approved mutation. A Checkpoint may contain
the bounded pre-operation workspace text required for explicit conflict-safe restoration, including
the full text of a deleted file. It never contains proposed after-content, approval UI text, Diff
previews, raw URI authority, credentials, or command data. Checkpoints and temporary Diff documents
remain local to VS Code storage/Host memory, are not model context, and are not logged or sent to the
Webview as unrestricted content. A create/delete/rename restore is explicit and hash/scope checked;
there is no automatic rollback. T2105 separately provides settings-controlled local retention for
expired Sessions and safely attributable Checkpoints.

`search_files` remains literal substring search by default. A user/model must explicitly select
`mode: "regex"` to request the bounded RE2-compatible dialect. Patterns and scanned text stay
within the existing file/result limits; unsupported syntax, complexity, cancellation, or engine
failure returns a bounded local outcome rather than running an untrusted backtracking expression.
The product contract does not promise a particular regex dependency or transmit patterns/files to a
third-party service.

## Security and disclosure

Credentials must be entered only through a supported password-masked command. Users should not paste
credentials, private source, prompts, or logs into public issues. Security-sensitive reports should
be shared privately with the maintainer when a private reporting channel is available on the
repository.

## Changes to this notice

Material changes to collection, external transmission, persistence, telemetry, accounts, or cloud
services require an implementation-plan and security review before code changes. The effective date
above will be updated when this notice materially changes.
