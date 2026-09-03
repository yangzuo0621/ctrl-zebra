# CtrlZebra

CtrlZebra is a local-first workspace agent for desktop Visual Studio Code. It streams model
responses, reads a selected workspace, proposes reviewable file edits, runs commands only after an
exact single-use approval, and keeps local Sessions and recovery Checkpoints.

It is a preview extension. Read the [product scope](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/product.md) and [known limitations](#known-limitations)
before using it on important work.

## Requirements

- Desktop Visual Studio Code 1.125.0 or later.
- Exactly one open workspace folder.
- A supported model and exact model ID.
- Workspace Trust for file changes, commands, and MCP process startup. Untrusted workspaces expose
  read-only tools only.

## Features

- OpenAI, Google Gemini, and explicitly configured OpenAI-compatible Providers.
- Bounded workspace file tools, reviewable edits, direct command execution, and single-use approvals.
- Local Sessions, interruption-safe recovery, conflict-safe Checkpoints, and bounded diagnostics.
- Explicit editor-context actions that create an editable Composer draft; they never send a request
  automatically.
- Optional connection to one explicitly configured local stdio MCP Server.

## Install from VSIX

1. Obtain a verified `ctrl-zebra-*.vsix` artifact.
2. Run **Extensions: Install from VSIX...** in VS Code and select the artifact.
3. Open exactly one workspace folder and select the CtrlZebra icon in the Activity Bar.

Maintainers can create a local artifact with `pnpm package:vsix`. The [release policy](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/release.md)
and [packaging contract](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/packaging.md) define verification and content checks.

## Quick start with a Provider

1. Set **CtrlZebra › Provider: Id** to `openai`, `gemini`, or `openai-compatible`.
2. Select an official model with **CtrlZebra: Select Model**, or enter the exact model ID for a
   custom endpoint.
3. Save a remote Provider key through its password-masked Command Palette action. Keys are kept in
   VS Code SecretStorage; never paste them into chat, settings, files, logs, or command arguments.
4. Open the Agent view, enter a request, and select **Send**.
5. Review every file-change and command approval. Use **Saved sessions** and **Agent changes** for
   interrupted history and conflict-safe restore.

Provider connection checks are user-triggered and send only bounded model metadata. They do not send
prompts, workspace/session content, or Tool data, and do not change settings or credentials.

## Marketplace preview

The extension keeps model access, workspace tools, and approvals local to desktop VS Code. Listing
screenshots use invented values only:

![CtrlZebra Agent overview](https://raw.githubusercontent.com/yangzuo0621/ctrl-zebra/main/apps/extension/media/marketplace/agent-overview.png)

![Provider setup](https://raw.githubusercontent.com/yangzuo0621/ctrl-zebra/main/apps/extension/media/marketplace/provider-setup.png)

![Safe tools and approvals](https://raw.githubusercontent.com/yangzuo0621/ctrl-zebra/main/apps/extension/media/marketplace/safe-tools.png)

## MCP overview

CtrlZebra supports one explicitly configured local `stdio` MCP Server. The Server runs with your
operating-system authority and may have local or network side effects, so startup requires a trusted
single-folder workspace and an exact approval. CtrlZebra never downloads, installs, authenticates,
starts, reconnects, or resumes a Server automatically.

MCP Tools are external `execute` operations and require a fresh exact approval for every call.
Resources and Prompts are shown only after explicit user actions, and bounded results remain
ordinary untrusted text. Version 1 is modern-only; version 2 explicitly selects modern-only or dual
compatibility for the supported local protocol versions. See the [MCP contract](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/mcp.md).

## Safety and privacy

Workspace paths are canonicalized and confined to the selected workspace. File writes and commands
require Trust and an exact approval; commands use direct process spawning without shell interpretation.
Provider keys remain in SecretStorage. Prompts, relevant context, Tool definitions, and Tool results
may be sent to the selected Provider, while Sessions, Checkpoints, and diagnostics remain local.
See the [Privacy Notice](https://github.com/yangzuo0621/ctrl-zebra/blob/main/PRIVACY.md) and [security contract](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/security.md).

## Known limitations

- Desktop VS Code only; Web Extensions are not supported.
- Exactly one workspace folder and one user-configured local stdio MCP Server are supported.
- There is no browser automation, multi-agent execution, Git commit/PR automation, cloud sync, or
  automatic release behavior.
- MCP supports Tools, bounded text Resources/Resource Templates, and bounded text Prompts only. It
  does not support HTTP transport, OAuth, credential injection, sampling, elicitation, roots, tasks,
  subscriptions, binary content, or automatic reconnect/recovery.
- Sessions interrupted by an Extension Host restart are restored as `interrupted`; requests,
  approvals, and tools are never resumed automatically.
- Checkpoint restore is conflict-safe, not a merge system. Large files, output, logs, and model
  context are bounded and may be rejected or truncated.
- Local Session and Checkpoint retention defaults to 30 days and can be disabled or configured in
  settings. **CtrlZebra: Clear All Local Data** removes CtrlZebra-owned local state but never
  workspace files or VS Code data outside CtrlZebra.

## Documentation

- [Product scope](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/product.md)
- [Architecture](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/architecture.md)
- [Configuration](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/configuration.md)
- [Security](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/security.md)
- [Persistence](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/persistence.md)
- [Protocol](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/protocol.md)
- [MCP](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/mcp.md)
- [UX](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/ux.md)
- [Development](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/development.md)
- [Testing](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/testing.md)
- [CI](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/ci.md)
- [Release](https://github.com/yangzuo0621/ctrl-zebra/blob/main/docs/release.md)

## Privacy, support, and release links

- [Privacy Notice](https://github.com/yangzuo0621/ctrl-zebra/blob/main/PRIVACY.md)
- [Support and bug reports](https://github.com/yangzuo0621/ctrl-zebra/issues)
- [Security Policy](https://github.com/yangzuo0621/ctrl-zebra/blob/main/SECURITY.md)
- [Contributing](https://github.com/yangzuo0621/ctrl-zebra/blob/main/CONTRIBUTING.md)
- [Changelog](https://github.com/yangzuo0621/ctrl-zebra/blob/main/CHANGELOG.md)

Marketplace publication remains a separate release action.

## Development

This repository uses pnpm 11 and Node.js 22 or later.

```text
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

See the [contributor guide](https://github.com/yangzuo0621/ctrl-zebra/blob/main/CONTRIBUTING.md) for the development and pull-request workflow.

## License

CtrlZebra is licensed under the [MIT License](https://github.com/yangzuo0621/ctrl-zebra/blob/main/LICENSE). Copyright (c) 2026 Zuo Yang.
