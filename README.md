# CtrlZebra

CtrlZebra is a local-first workspace agent for desktop Visual Studio Code. It streams model responses,
can inspect a selected workspace, proposes file edits with reviewable approval, runs commands only
after an exact single-use approval, and keeps local Sessions and recovery Checkpoints.

CtrlZebra is a local-first preview extension. Read the [product and technical baseline](docs/product.md)
and [known limitations](#known-limitations) before using it on important work.

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

## Marketplace preview

CtrlZebra keeps model access, workspace tools, and approvals local to the desktop VS Code
Extension. The listing screenshots use invented values only and show the reviewable Agent surface:

![CtrlZebra Agent overview](https://raw.githubusercontent.com/yangzuo0621/ctrl-zebra/main/apps/extension/media/marketplace/agent-overview.png)

![Provider setup](https://raw.githubusercontent.com/yangzuo0621/ctrl-zebra/main/apps/extension/media/marketplace/provider-setup.png)

![Safe tools and approvals](https://raw.githubusercontent.com/yangzuo0621/ctrl-zebra/main/apps/extension/media/marketplace/safe-tools.png)

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
5. Run **CtrlZebra: Check Provider Connection** when you want to verify the active Provider and model.
   The check is user-triggered, sends only bounded model metadata, and reports authentication, model
   existence, streaming, Tool Calling, and required capabilities as supported, unsupported, or unknown.
   It never sends prompts, workspace/session content, or Tool data, and does not change settings or
   credentials. Custom Provider endpoints are only checked under the bounded OpenAI-compatible
   metadata contract; otherwise capabilities remain unknown.
6. Open the CtrlZebra Agent view, enter a request, and select **Send**.
7. Review every file-change or command approval. The displayed operation is the operation that will
   execute; denying it causes no write or command side effect.
8. Use **Saved sessions** to inspect interrupted history and **Agent changes** to restore a
   conflict-free Checkpoint.

To ask about the current editor explicitly, enable **CtrlZebra › Editor Context: Enabled** in
Settings, then use **CtrlZebra: Ask about Selection** or **CtrlZebra: Ask about Active File** from
the Command Palette or editor context menu. CtrlZebra fills a visible, editable Composer draft with
bounded workspace-relative context; it never runs a model automatically. Review and edit the draft
before sending. If the source becomes stale, choose **Refresh** or explicitly **Use stale context**;
choose **Remove** whenever the context should not be included.

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

CtrlZebra supports one explicitly configured local `stdio` MCP Server. It requires a trusted
single-folder workspace, an exact startup approval, and an executable you trust; the Server runs
with your operating-system authority and may have local or network side effects. CtrlZebra never
downloads, installs, authenticates, starts, reconnects, or resumes a Server automatically.

Tools are external `execute` operations and require a fresh exact approval for every call. Resources
and Prompts are shown only after explicit user actions, and their bounded results remain ordinary
untrusted text. Version 1 settings remain modern-only; version 2 can explicitly select modern-only
or dual compatibility for the supported local protocol versions.

See the [MCP contract](docs/mcp.md) for configuration, lifecycle, compatibility, safety, and
protocol details.
## Configuration

Provider and MCP settings have machine scope. Editor context is explicitly window scoped.

| Setting | Default | Description |
|---|---|---|
| `ctrlZebra.provider.id` | `openai` | `openai`, `gemini`, or `openai-compatible`. |
| `ctrlZebra.provider.model` | empty | Required exact model ID. Surrounding whitespace is rejected. |
| `ctrlZebra.provider.endpoint` | empty | Optional override for OpenAI/Gemini; required for OpenAI-compatible. Remote URLs must use HTTPS. Plain HTTP is allowed only for `localhost`, `127.0.0.0/8`, or `::1`. User info, query strings, and fragments are rejected. |
| `ctrlZebra.provider.capabilities` | `["text-streaming"]` | Used only by OpenAI-compatible endpoints. Values are `text-streaming` and `tool-calling`, without duplicates. CtrlZebra currently requires both to start an Agent run. |
| `ctrlZebra.mcp.server` | `null` | One explicitly configured local stdio Server. Version 1 is modern-only; version 2 explicitly selects modern-only or dual. See the [MCP contract](docs/mcp.md#configuration). |
| `ctrlZebra.editorContext.enabled` | `false` | Window-scoped opt-in for the explicit editor entry commands. It captures no text in the background and does not grant Trust or side-effecting permissions. |

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
catalogs, raw protocol messages, stderr, process details, and negotiation attempts are not persisted.
Completed MCP outcomes may retain bounded configured-mode and negotiated-era/version provenance only;
that provenance cannot reconnect or authorize a Server. Attached Resource
text, confirmed Prompt text, and bounded Tool outcomes can become conversation context and may be
sent to the configured model provider. The external Server itself runs outside CtrlZebra's privacy
boundary and may perform local or network activity under its own behavior.

When you send a request, the configured model provider receives the prompt, relevant conversation
context, tool definitions, and tool results. Tool results can contain workspace source text. File
writes and commands remain local unless the approved command itself communicates externally.

Read the full [Privacy Notice](PRIVACY.md) and [security contract](docs/security.md).

## Privacy, support, and release links

- [Product and technical baseline](docs/product.md) defines the supported product scope and module
  boundaries.
- [Privacy Notice](PRIVACY.md) explains local storage, Provider data flow, and the external MCP boundary.
- [Support and bug reports](https://github.com/yangzuo0621/ctrl-zebra/issues) are handled in the public issue tracker.
- [Security Policy](SECURITY.md) describes private vulnerability reporting.
- [Contributing](CONTRIBUTING.md) documents the development and pull-request workflow.
- [Changelog](CHANGELOG.md) records repository changes and release notes.

## Known limitations

- Desktop VS Code only; Web Extensions are not supported.
- Exactly one workspace folder is supported. Empty windows and multi-root workspaces cannot start an
  Agent run.
- Model discovery is user-triggered for the official OpenAI and Gemini endpoints only. OpenAI-Compatible
  and custom endpoints use manual model IDs; there is no account sign-in.
- MCP supports exactly one user-configured local stdio Server. Version `1` settings remain
  modern-only (`2026-07-28`); explicit version `2` dual mode additionally supports legacy
  `2025-11-25`. There is no HTTP transport, OAuth, credential injection, multi-server operation,
  automatic install, automatic connection, retry, or restart recovery.
- MCP supports Tools, bounded text Resources/Resource Templates, and bounded text Prompts only.
  Sampling, Elicitation, Roots, Tasks, subscriptions, binary or multimodal content, and
  `input_required` continuation are unsupported.
- There is no browser automation, sub-agent/multi-agent execution, Git commit/PR automation, or
  cloud service integration.
- Sessions interrupted by an Extension Host restart are restored as `interrupted`; model requests,
  approvals, and tools are never resumed automatically.
- Local Session and Checkpoint retention defaults to 30 days, is configurable or disableable through
  `ctrlZebra.sessionRetention.enabled` and `ctrlZebra.sessionRetention.days`, and runs only when
  Session history is explicitly listed/refreshed. T2104 also provides explicit local delete controls;
  retention never removes workspace files. Before uninstall or device handoff, run `CtrlZebra: Clear
  All Local Data` (or the Agent view action) and accept the modal high-risk confirmation. It clears
  CtrlZebra-owned Sessions, Checkpoints, temporary/cache state, Provider keys, MCP/Provider settings,
  and other local state; it never removes workspace files, user code, VS Code data outside CtrlZebra,
  or other extensions. Partial failures are reported by category and can be retried safely.
- Checkpoint restore is conflict-safe, not a merge system: changed or non-canonical targets block the
  entire restore.
- Large files, binary files, command output, tool output, event logs, and model context are bounded
  and may be rejected or truncated.
- The extension is not published automatically by this repository workflow. VSIX generation is
  local and Marketplace publication remains a separate release action.

## MCP troubleshooting

- **Configuration or trust**: verify the machine-scoped setting, trusted single-folder workspace,
  exact executable, and fresh startup approval.
- **Protocol or capability failure**: verify the selected mode and consult the
  [MCP contract](docs/mcp.md#protocol-negotiation); CtrlZebra never enables undeclared capabilities
  or reconnects automatically.
- **Server or cancellation failure**: inspect the Server outside CtrlZebra without sharing secrets,
  then disconnect and reconnect explicitly. Pending operations are not resumed.
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

## Contributing and security

See the [contributor guide](CONTRIBUTING.md) for local development and pull-request workflow. Use
the [Security Policy](SECURITY.md) to report a suspected vulnerability privately, and see the
[Changelog](CHANGELOG.md) for repository changes.

## License

CtrlZebra is licensed under the [MIT License](LICENSE). Copyright (c) 2026 Zuo Yang.
