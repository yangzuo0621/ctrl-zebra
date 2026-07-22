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

## Install from VSIX

1. Obtain a verified `ctrl-zebra-*.vsix` artifact.
2. In VS Code, open **Extensions: Install from VSIX...** from the Command Palette.
3. Select the VSIX and reload VS Code if prompted.
4. Open exactly one workspace folder.
5. Select the CtrlZebra icon in the Activity Bar to open the **Agent** view.

Repository maintainers can create a verified local artifact with `pnpm package:vsix`. See
[the packaging contract](docs/packaging.md) for provenance and content checks.

## Quick start with Gemini

Gemini is the complete credential-onboarding path in this Phase 1 build.

1. Open VS Code Settings and set **CtrlZebra › Provider: Id** to `gemini`.
2. Set **CtrlZebra › Provider: Model** to an exact Gemini model ID available to your account.
3. Run **CtrlZebra: Save Gemini API Key** from the Command Palette and enter the key in the
   password-masked prompt. The key is stored in VS Code SecretStorage.
4. Open the CtrlZebra Agent view, enter a request, and select **Send**.
5. Review every file-change or command approval. The displayed operation is the operation that will
   execute; denying it causes no write or command side effect.
6. Use **Saved sessions** to inspect interrupted history and **Agent changes** to restore a
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

## Configuration

All settings have machine scope.

| Setting | Default | Description |
|---|---|---|
| `ctrlZebra.provider.id` | `openai` | `openai`, `gemini`, or `openai-compatible`. |
| `ctrlZebra.provider.model` | empty | Required exact model ID. Surrounding whitespace is rejected. |
| `ctrlZebra.provider.endpoint` | empty | Optional override for OpenAI/Gemini; required for OpenAI-compatible. Remote URLs must use HTTPS. Plain HTTP is allowed only for `localhost`, `127.0.0.0/8`, or `::1`. User info, query strings, and fragments are rejected. |
| `ctrlZebra.provider.capabilities` | `["text-streaming"]` | Used only by OpenAI-compatible endpoints. Values are `text-streaming` and `tool-calling`, without duplicates. CtrlZebra currently requires both to start an Agent run. |

OpenAI and Gemini always use their adapter-declared text-streaming and tool-calling capabilities.
Remote providers require a corresponding API key. This release exposes a user-facing save command
only for Gemini; see [known limitations](#known-limitations).

## Workspace tools and approvals

CtrlZebra provides these tools within the single selected workspace:

- `list_files`, `read_file`, and `search_files` are read-only.
- `propose_file_edit` shows the exact proposed change and requires a fresh approval before applying
  it. A Checkpoint is committed before the workspace write.
- `run_command` displays the executable, ordered arguments, canonical working directory, and timeout.
  It uses direct process spawn with shell interpretation disabled and requires a fresh approval.

Paths are canonicalized and constrained to the selected workspace. File edits and commands are
disabled when the workspace is untrusted. Approval is single-use; a changed operation or retry
requires a new approval.

## Local data and privacy

CtrlZebra has no accounts, cloud sync, advertising, or telemetry backend. It stores:

- provider keys in VS Code SecretStorage;
- Session messages and lifecycle events in VS Code extension storage;
- recovery Checkpoints, including pre-edit workspace text, in VS Code extension storage; and
- bounded structured diagnostics in the local CtrlZebra VS Code log channel.

When you send a request, the configured model provider receives the prompt, relevant conversation
context, tool definitions, and tool results. Tool results can contain workspace source text. File
writes and commands remain local unless the approved command itself communicates externally.

Read the full [Privacy Notice](PRIVACY.md) and [security contract](docs/security.md).

## Known limitations

- Desktop VS Code only; Web Extensions are not supported.
- Exactly one workspace folder is supported. Empty windows and multi-root workspaces cannot start an
  Agent run.
- Gemini is the only remote provider with a user-facing API-key save command. OpenAI and authenticated
  remote OpenAI-compatible onboarding are not complete in this build.
- Provider and model configuration is manual; there is no model discovery or account sign-in.
- A model can request only the five built-in workspace tools. There is no MCP, browser automation,
  sub-agent/multi-agent execution, Git commit/PR automation, or cloud service integration.
- Sessions interrupted by an Extension Host restart are restored as `interrupted`; model requests,
  approvals, and tools are never resumed automatically.
- Session and Checkpoint retention has no automatic pruning policy or in-product delete control.
- Checkpoint restore is conflict-safe, not a merge system: changed or non-canonical targets block the
  entire restore.
- Large files, binary files, command output, tool output, event logs, and model context are bounded
  and may be rejected or truncated.
- The extension is not published automatically by this repository workflow. VSIX generation is
  local and Marketplace publication remains a separate release action.

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
