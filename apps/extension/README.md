# CtrlZebra

CtrlZebra is a local-first workspace agent for desktop Visual Studio Code. It streams model responses,
can inspect a selected workspace, proposes file edits with reviewable approval, runs commands only
after an exact single-use approval, and keeps local Sessions and recovery Checkpoints.

Phase 1 is intended for evaluation. Read the [known limitations](#known-limitations) before using it
on important work.

## Requirements

- Desktop Visual Studio Code 1.125.0 or later.
- Exactly one open workspace folder.
- A supported model and exact model ID.
- A trusted workspace for file changes and command execution. Untrusted workspaces expose read-only
  tools only.

CtrlZebra supports OpenAI, Google Gemini, and explicitly configured OpenAI-compatible endpoints.
Provider usage, availability, pricing, and data handling remain subject to the provider you choose.

## Reasoning summaries

When the configured Provider and model actually return a documented, user-visible reasoning
summary, CtrlZebra shows it in a separate, collapsible **推理摘要** region beside the answer. This
content is a Provider-supplied summary, not raw, hidden, or complete chain of thought. Support
depends on the Provider, model, endpoint, and request; runs without a returned summary continue
normally and show no placeholder. Retained summaries are bounded, may be visibly truncated, and can
be restored with their local Session.

## Install from VSIX

1. Obtain a verified `ctrl-zebra-*.vsix` artifact.
2. In VS Code, open **Extensions: Install from VSIX...** from the Command Palette.
3. Select the VSIX and reload VS Code if prompted.
4. Open exactly one workspace folder.
5. Select the CtrlZebra icon in the Activity Bar to open the **Agent** view.

Repository maintainers can create a verified local artifact with `pnpm package:vsix`. See
[the packaging contract](docs/packaging.md) for provenance and content checks.

## Quick start with a Provider

1. Open VS Code Settings and set **CtrlZebra › Provider: Id** to `openai`, `gemini`, or
   `openai-compatible`.
2. For OpenAI or Gemini, run **CtrlZebra: Select Model** to choose from the official model list. For
   OpenAI-Compatible or custom endpoints, enter the exact model ID in **CtrlZebra › Provider: Model**.
3. For a remote Provider, run the matching command from the Command Palette and enter the key in
   the password-masked prompt. The key is stored in VS Code SecretStorage:
   - **CtrlZebra: Save OpenAI API Key**
   - **CtrlZebra: Save Gemini API Key**
   - **CtrlZebra: Save OpenAI-Compatible API Key**
   - **CtrlZebra: Rotate OpenAI API Key**
   - **CtrlZebra: Rotate Gemini API Key**
   - **CtrlZebra: Rotate OpenAI-Compatible API Key**
   - **CtrlZebra: Delete OpenAI API Key**
   - **CtrlZebra: Delete Gemini API Key**
   - **CtrlZebra: Delete OpenAI-Compatible API Key**
   Rotation always asks for a fresh password-masked key and replaces the stable SecretStorage value
   only after the save operation settles successfully. Delete commands confirm the Provider identity
   and never display the key. These lifecycle commands are Host-only Command Palette actions; the
   onboarding view continues to offer save, model selection, and settings actions only.
4. For an explicit loopback OpenAI-compatible endpoint, a key is optional.
5. Open the CtrlZebra Agent view, enter a request, and select **Send**.
6. Review every file-change or command approval. The displayed operation is the operation that will
   execute; denying it causes no write or command side effect.
7. Use **Saved sessions** to inspect interrupted history and **Agent changes** to restore a
   conflict-free Checkpoint.

Do not paste API keys into chat, workspace files, settings, logs, or command arguments.

## Local OpenAI-compatible setup

A service on an explicit loopback address can be used without an API key. For example, configure:

```json
{
  "ctrlZebra.provider.id": "openai-compatible",
  "ctrlZebra.provider.model": "your-exact-local-model-id",
  "ctrlZebra.provider.endpoint": "http://127.0.0.1:11434/v1",
  "ctrlZebra.provider.capabilities": ["text-streaming", "tool-calling"]
}
```

The endpoint and model must match the local service. Declaring `tool-calling` does not add that
capability to a model; the selected service and model must actually support the OpenAI-compatible
tool-call format.

## Local MCP Server

CtrlZebra can connect to one explicitly configured local `stdio` MCP Server. The Server runs with
your operating-system authority and may access local files or networks independently of CtrlZebra,
so configure only an executable you trust. CtrlZebra does not download, install, authenticate, or
start a Server automatically.

Configure the exact executable and ordered arguments in machine-scoped settings. Shell command
lines, environment overrides, credentials, and workspace-scoped MCP configuration are rejected:

```json
{
  "ctrlZebra.mcp.server": {
    "version": 1,
    "serverId": "local_docs",
    "displayName": "Local docs",
    "command": "/absolute/path/to/the-server",
    "args": ["--stdio"]
  }
}
```

Open one trusted workspace, review the exact executable, arguments, and canonical working directory,
then run **CtrlZebra: Connect MCP Server** or select **Connect** in the Agent view. After connection:

- **Tools** are available to the model, but every call has trusted `execute` risk and requires a new
  exact single-use approval showing the Server, Tool, arguments, and external-side-effect warning.
- **Resources** and **Resource Templates** are read only after you select them. Previewed bounded text
  enters model context only after you select **Attach**.
- **Prompts** are fetched only after you select one and provide its required arguments. They remain
  ordinary untrusted text and enter the input flow only after preview and confirmation.

Use **CtrlZebra: Disconnect MCP Server** when finished. Disconnecting, cancelling a Run, losing
workspace trust, or closing the Extension Host invalidates live catalogs and pending operations;
CtrlZebra never reconnects or resumes them from a saved Session.

## Configuration

All settings have machine scope.

| Setting | Default | Description |
|---|---|---|
| `ctrlZebra.provider.id` | `openai` | `openai`, `gemini`, or `openai-compatible`. |
| `ctrlZebra.provider.model` | empty | Required exact model ID. Surrounding whitespace is rejected. |
| `ctrlZebra.provider.endpoint` | empty | Optional override for OpenAI/Gemini; required for OpenAI-compatible. Remote URLs must use HTTPS. Plain HTTP is allowed only for `localhost`, `127.0.0.0/8`, or `::1`. User info, query strings, and fragments are rejected. |
| `ctrlZebra.provider.capabilities` | `["text-streaming"]` | Used only by OpenAI-compatible endpoints. Values are `text-streaming` and `tool-calling`, without duplicates. CtrlZebra currently requires both to start an Agent run. |
| `ctrlZebra.mcp.server` | `null` | One local stdio Server object with `version: 1`, stable lower-snake-case `serverId`, bounded `displayName`, exact `command`, and ordered `args`. Credentials and shell command lines are forbidden. A trusted single-folder workspace and fresh startup approval are required. |

OpenAI and Gemini always use their adapter-declared text-streaming and tool-calling capabilities.
Remote providers require a corresponding API key. Save, rotate, and delete commands are available
for all three supported Providers. SecretStorage failures or an unavailable presence check produce a
safe retry/settings message without claiming whether the previous value remains.

## Workspace tools and approvals

CtrlZebra provides these tools within the single selected workspace:

- `list_files`, `read_file`, and `search_files` are read-only.
- `propose_file_edit` shows the exact proposed change and requires a fresh approval before applying
  it. A Checkpoint is committed before the workspace write.
- `run_command` displays the executable, ordered arguments, canonical working directory, and timeout.
  It uses direct process spawn with shell interpretation disabled and requires a fresh approval.
- Every MCP Tool is treated as an external `execute` operation even if its Server claims it is
  read-only or idempotent. Server metadata never lowers the approval requirement.

Paths are canonicalized and constrained to the selected workspace. File edits and commands are
disabled when the workspace is untrusted. Approval is single-use; a changed operation or retry
requires a new approval.

## Local data and privacy

CtrlZebra has no accounts, cloud sync, advertising, or telemetry backend. It stores:

- provider keys in VS Code SecretStorage;
- Session messages and lifecycle events in VS Code extension storage;
- bounded Provider-supplied reasoning summaries in the corresponding Session event log;
- recovery Checkpoints, including pre-edit workspace text, in VS Code extension storage; and
- bounded structured diagnostics in the local CtrlZebra VS Code log channel.

MCP configuration remains in VS Code machine settings and is not copied into Sessions. Live Server
catalogs, raw protocol messages, stderr, and process details are not persisted. Attached Resource
text, confirmed Prompt text, and bounded Tool outcomes can become conversation context and may be
sent to the configured model provider. The external Server itself runs outside CtrlZebra's privacy
boundary and may perform local or network activity under its own behavior.

When you send a request, the configured model provider receives the prompt, relevant conversation
context, tool definitions, and tool results. Tool results can contain workspace source text. File
writes and commands remain local unless the approved command itself communicates externally.

Read the full [Privacy Notice](PRIVACY.md) and [security contract](docs/security.md).

## Known limitations

- Desktop VS Code only; Web Extensions are not supported.
- Exactly one workspace folder is supported. Empty windows and multi-root workspaces cannot start an
  Agent run.
- Model discovery is user-triggered for the official OpenAI and Gemini endpoints only. OpenAI-Compatible
  and custom endpoints use manual model IDs; there is no account sign-in.
- MCP supports exactly one user-configured local stdio Server and exact protocol version
  `2026-07-28`. There is no HTTP transport, OAuth, credential injection, multi-server operation,
  automatic install, automatic connection, retry, or restart recovery.
- MCP supports Tools, bounded text Resources/Resource Templates, and bounded text Prompts only.
  Sampling, Elicitation, Roots, Tasks, subscriptions, binary or multimodal content, and
  `input_required` continuation are unsupported.
- There is no browser automation, sub-agent/multi-agent execution, Git commit/PR automation, or
  cloud service integration.
- Sessions interrupted by an Extension Host restart are restored as `interrupted`; model requests,
  approvals, and tools are never resumed automatically.
- Session and Checkpoint retention has no automatic pruning policy or in-product delete control.
- Checkpoint restore is conflict-safe, not a merge system: changed or non-canonical targets block the
  entire restore.
- Large files, binary files, command output, tool output, event logs, and model context are bounded
  and may be rejected or truncated.
- The extension is not published automatically by this repository workflow. VSIX generation is
  local and Marketplace publication remains a separate release action.

## MCP troubleshooting

- **Configure one valid MCP Server**: check that the setting is machine-scoped, contains no unknown
  fields, uses an absolute or otherwise directly executable command, and separates every argument.
- **Workspace must be trusted**: open exactly one local folder and grant VS Code Workspace Trust;
  MCP process startup is disabled in untrusted, empty, remote-only, or multi-root windows.
- **Protocol or capability failure**: update the Server to exact MCP `2026-07-28`. CtrlZebra does not
  negotiate down to an older version or enable undeclared Client capabilities.
- **Server exited or malformed output**: disconnect, inspect the Server outside CtrlZebra without
  sharing secrets, correct its stdout protocol behavior, then reconnect explicitly. CtrlZebra never
  treats stderr or raw protocol data as user-visible content.
- **Configuration changed**: disconnect the current generation before reconnecting. A live Server is
  never silently reconfigured or restarted.
- **Cancellation or restart**: retry from a new explicit user action. Pending Tools, Resource reads,
  Prompt previews, approvals, and catalogs are intentionally not resumed.

## Development

This repository uses pnpm 11 and Node.js 22 or later.

```text
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

Create and inspect an official local VSIX only from a clean branch whose HEAD is present on its
upstream:

```text
pnpm package:vsix
pnpm smoke:vsix -- .artifacts/<artifact-name>.vsix
```

Architecture, security, persistence, testing, performance, and packaging contracts live in
[docs](docs/).

## License

CtrlZebra is licensed under the [MIT License](LICENSE). Copyright (c) 2026 Zuo Yang.
