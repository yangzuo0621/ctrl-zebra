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

## Scope and ownership

`ctrlZebra.mcp.server` is one optional, machine-scoped VS Code setting. The Extension Host is the
only authority that reads it or starts a process. Workspace settings, Webview messages, model text,
MCP messages, persisted Sessions, and Server metadata cannot create, merge, or replace this value.
The setting describes one local `stdio` executable and ordered arguments. It never contains a cwd,
environment override, shell command line, endpoint, headers, credentials, or Client capability.

The object is strict: unknown properties, unknown versions, duplicate values, malformed strings,
and values outside the existing identifier, argument, and serialized-size limits fail closed with
the stable `configuration-invalid` classification. A rejected value does not start or reconfigure
a live process.

## Versioned representation

The setting remains `null` or one of these closed objects. The common fields keep their existing
machine-scoped contract and bounds:

```json
{
  "version": 1,
  "serverId": "local_docs",
  "displayName": "Local docs",
  "command": "/absolute/path/to/the-server",
  "args": ["--stdio"]
}
```

Version `1` has no mode field. It is interpreted as `protocolMode: "modern-only"` and accepts only
MCP `2026-07-28`. Reading an existing version `1` setting never writes a new value, adds a field,
or silently broadens its protocol behavior. For operation identity, this normalized effective mode
is equivalent to version `2` with explicit `protocolMode: "modern-only"`; the raw configuration
version is not a second startup-operation identity field.

The reviewed version `2` representation makes the user choice explicit:

```json
{
  "version": 2,
  "protocolMode": "modern-only",
  "serverId": "local_docs",
  "displayName": "Local docs",
  "command": "/absolute/path/to/the-server",
  "args": ["--stdio"]
}
```

`protocolMode` is the closed union `"modern-only" | "dual"`. Version `2` requires it; it cannot be
omitted, set to another string, or supplied on version `1`. `modern-only` accepts only
`2026-07-28`. `dual` accepts exactly `2026-07-28` (modern) and `2025-11-25` (legacy). Older
revisions, unknown future versions, and every non-stdio transport remain unsupported.

## Explicit migration and change behavior

- An existing version `1` setting remains valid and modern-only after an extension upgrade. The
  user may explicitly choose **Migrate to version 2**; that action writes the same executable,
  arguments, identity, and label with `version: 2` and `protocolMode: "modern-only"`.
- Selecting `dual` is a separate explicit user action after migration. There is no automatic
  migration, implicit dual mode, or inference from a Server response. If the user does not migrate,
  the old setting continues to have modern-only behavior.
- Editing any effective setting while a connection is live marks it stale. The Host does not mutate
  the process, reuse an approval, or switch era in place. The user must disconnect and explicitly
  connect again, with a new startup approval and generation.
- A missing setting, invalid version/mode, unknown property, or unsupported transport remains a
  bounded configuration error. It cannot trigger a probe, legacy fallback, process start, retry, or
  automatic recovery.

## Runtime activation and change behavior

The Extension selects the normalized mode before workspace binding and passes it to the controlled
Client lifecycle. Effective mode changes invalidate pending approval and require a fresh exact
approval before process creation. The closed modern-first decision matrix is owned by
[Architecture](architecture/mcp-schema-and-discovery.md#closed-modern-first-fallback-decision-matrix-t1804);
wire shapes and negotiated projection by
[Protocol](protocol/mcp-configuration-and-resources.md#dual-era-configuration-and-negotiated-projection-t1804);
security and no-fallback behavior by [Security](security.md#controlled-mcp-security-boundary); and
historical provenance by [Persistence](persistence.md#mcp-persistence-projection).

The Extension, Webview, persistence, and local stdio fixture paths consume the normalized configured
mode and negotiated projection through those owning contracts. Recovery remains an explicit user
action and never starts a hidden reconnect.

## Diagnostics export does not add configuration (T2205)

The user-triggered diagnostics export reads the existing non-sensitive Provider onboarding projection
and MCP connection snapshot only when the user requests a preview. It adds no setting, endpoint,
credential, SecretStorage entry, or telemetry switch. Missing or malformed configuration is rendered
as a closed `unknown`/`unconfigured` diagnostic fact; keys, authorization material, endpoint values,
command arguments, paths, workspace content, conversation content, and raw configuration/Provider
errors are never copied into the export.
