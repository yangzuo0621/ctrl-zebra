# CtrlZebra configuration contract

This document owns user-facing setting names, scopes, types, bounds, defaults, validation, and
explicit configuration migration/change behavior. The [Persistence Contract](persistence.md) owns
durable records and cleanup semantics; [Security](security.md), [Protocol](protocol.md), and the
applicable Architecture and Webview documents own their respective boundaries and projections.

## Editor context setting (T1905)

`ctrlZebra.editorContext.enabled` is a boolean, `window`-scoped VS Code setting and defaults to
`false`. It is the user's opt-in for the explicit editor entry commands; it is not a Trust grant and does
not authorize writes, commands, MCP, or model activity. When disabled, the Extension rejects captures,
clears pending Webview context, and never reads an editor in the background. The setting accepts no other
shape or value.

The only public entry commands are `ctrlZebra.askAboutSelection` and `ctrlZebra.askAboutFile`. They appear
in Command Palette and the editor context menu when the corresponding editor condition is true, but the
Extension repeats the setting, active-editor, selection, selected-root, Trust, text-identity, and revision
checks before each bounded capture. A direct command invocation therefore cannot bypass the setting or
Workspace Trust boundary. The captured context stays in a visible, editable Composer draft until the user
sends or removes it; opening the Agent view, changing focus, or model activity never captures implicitly.

## Session retention settings (T2105)

The Extension owns two machine-scoped settings for local Session and recovery Checkpoint retention:

| Setting | Type and bounds | Default | Effect |
|---|---|---:|---|
| `ctrlZebra.sessionRetention.enabled` | boolean | `true` | Enables automatic cleanup on an explicit Session history list/refresh. |
| `ctrlZebra.sessionRetention.days` | integer `1..3650` | `30` | Retains the last 24-hour UTC-day window. |

The Host validates both values before use. The [Session retention lifecycle](architecture/context-and-session.md#session-retention-lifecycle-t2105)
owns calculation, trigger, protected states, locking, and the cleanup result; [Persistence](persistence.md#automatic-session-retention-t2105)
owns the storage scan and exact Checkpoint attribution. The clock is injected by the lifecycle owner
for deterministic tests.

## Run token safety budget (T2204)

The Extension owns two machine-scoped settings for the per-Run token safety guardrail:

| Setting | Type and bounds | Default | Effect |
|---|---|---:|---|
| `ctrlZebra.runBudget.maxTokens` | integer `1..2,000,000` | `100,000` | Hard per-Run token safety limit. |
| `ctrlZebra.runBudget.warningTokens` | integer `1..maxTokens` | `80,000` | Emits one in-Run warning at this threshold. |

The values are validated before a Provider request starts. They count local estimates and accepted
Provider Usage in one Run; they do not represent a price or Provider bill. Runtime terminal behavior
is owned by [Session and Runtime Architecture](architecture/context-and-session.md) and
[Protocol](protocol/session-and-runtime.md); persisted warning/exceeded snapshots and recovery rules
are owned by [Persistence](persistence.md#run-token-budget-events). An invalid setting fails closed
with a configuration error and does not start the Provider.

## Complete local-data clearing (T2106)

The uninstall-before/device-handoff action clears the Extension's explicit values for these owned
settings, at every configured user, workspace, workspace-folder, and language override scope:

| Configuration group | Owned leaves cleared |
|---|---|
| `ctrlZebra.provider` | `id`, `model`, `endpoint`, `capabilities` |
| `ctrlZebra.mcp` | `server` |
| `ctrlZebra.sessionRetention` | `enabled`, `days` |
| `ctrlZebra.editorContext` | `enabled` |
| `ctrlZebra.runBudget` | `maxTokens`, `warningTokens` |

Clearing restores registered defaults rather than deleting unrelated VS Code settings. This section
owns the exact configuration leaves and scope semantics; storage, SecretStorage, process, ordering,
and retry behavior are defined by [Persistence](persistence.md#complete-local-data-clearing-t2106)
and [Security](security.md#complete-local-data-clearing-t2106). It is separate from Session retention
and does not run at activation or silently broaden the uninstall action.

## MCP Server setting

`ctrlZebra.mcp.server` is one optional, machine-scoped VS Code setting. The Extension Host is the
only authority that reads it or starts a process. It describes one local `stdio` executable and
ordered arguments and never contains a cwd, environment override, shell command line, endpoint,
headers, credentials, or Client capability.

The value is `null` or one strict versioned object. Unknown fields, versions, modes, duplicate
values, malformed strings, and out-of-bound values fail closed as `configuration-invalid` and
cannot start or reconfigure a live process. Version `1` means `protocolMode: "modern-only"` and
accepts only MCP `2026-07-28`; version `2` requires the closed mode `"modern-only" | "dual"`.
Migration and selection of `dual` are explicit user actions. Version 1 and version 2 explicit
modern-only normalize to the same effective operation when their other fields match.

The complete MCP configuration, bounds, migration behavior, and runtime contract are owned by
[MCP](mcp.md#configuration). This document owns the setting declaration, scope, defaults, and
configuration clearing; it does not duplicate MCP lifecycle or negotiation rules.

## Diagnostics export does not add configuration (T2205)

The user-triggered diagnostics export reads the existing non-sensitive Provider onboarding projection
and MCP connection snapshot only when the user requests a preview. It adds no setting, endpoint,
credential, SecretStorage entry, or telemetry switch. Missing or malformed configuration is rendered
as a closed `unknown`/`unconfigured` diagnostic fact; keys, authorization material, endpoint values,
command arguments, paths, workspace content, conversation content, and raw configuration/Provider
errors are never copied into the export.
