# CtrlZebra configuration contract

This document defines the user-facing MCP setting that is shared by the Extension, Protocol,
Security, Persistence, UX, and Webview contracts. The strict v1/v2 parser, normalized Protocol
Schemas, mode-aware lifecycle, negotiated projection, bounded provenance, and deterministic local
fixtures are implemented. Migration remains explicit and live recovery never reconnects implicitly.

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

The Host validates both values before use. A Session is expired when its manifest `updatedAt` is at or
before `now - days * 86,400,000` milliseconds; the comparison is timestamp-based and independent of the
user's local timezone. The exact boundary is therefore predictable and testable. The clock is injected by
the lifecycle owner for deterministic tests.

Cleanup is lazy and bounded: it runs after the user explicitly requests Session history, never during
activation, and examines at most 10,000 manifest metadata records without loading event logs. Disabled
cleanup performs no candidate or Checkpoint scan. Sessions in `idle`, `preparing`, `streaming`,
`awaiting_approval`, or `executing_tool` are protected while recovery or a Run may still own them; a list
request is also blocked while a Run is active or settling. An expired Session and only its safely
attributable local Checkpoints are removed. Malformed or unattributable Checkpoints remain for retry.

The cleanup result is surfaced with fixed safe feedback: a successful removal reports the number of
Sessions and owned Checkpoints removed, while partial storage failures report that cleanup could not
remove all expired local data and can be retried by refreshing Session history. Cleanup changes no
Protocol wire shape and requires no persisted-format migration.

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
Client lifecycle. Version `1` and explicit version `2` `modern-only` perform only the bounded modern
probe; version `2` `dual` may perform one legacy handshake after the closed modern-first decision
matrix authorizes it. The controller never silently downgrades a mode, probes more than once per
explicit connection, or reconnects after recovery. Effective mode changes invalidate pending
approval and require a fresh exact approval before process creation.

The implementation test matrix covers both mode-change directions between the approval's first read
and its pre-spawn second read, explicit retry, stale approval and generation invalidation,
v1-implicit-modern-only versus v2-explicit-modern-only equivalence after normalization, modern and
legacy negotiated fixtures, malformed no-fallback cleanup, bounded provenance, and Webview
projection. Existing executable, argument, identity, cwd, trust, scope, and exact-operation
comparisons remain required.

## Negotiation and visible result

Every explicit connection has one configured mode. `modern-only` performs only the modern
`server/discover` exchange. `dual` performs one bounded modern probe first; only a specification-
classified non-modern response or a bounded probe timeout may enter one legacy `initialize` /
`notifications/initialized` exchange. A well-formed `DiscoverResult` locks modern: if its bounded
advertised list contains `2026-07-28`, the client continues modern; if the list omits that version or
contains only unsupported/unknown future versions, the result is stable `protocol-incompatible` and
never fallback. A recognized modern JSON-RPC error follows the same lock: a controlled advertised
`2026-07-28` continues/selects modern, while a missing/unsupported advertised version is
`protocol-incompatible` and never fallback. After independent overflow checks, a syntactically or
structurally malformed, or shape-validation-failing, response/error is `malformed-message`; a
structurally valid response/error outside the closed recognized-modern or defined non-modern
classifications (including unknown future or otherwise unclassified values) is
`protocol-incompatible`. Neither outcome authorizes fallback. Cancellation, trust loss, process exit,
or cleanup failure is terminal and never authorizes fallback. Late probe data is discarded by the
connection generation gate. The complete eligible/forbidden matrix is authoritative in
[Architecture](architecture/mcp-schema-and-discovery.md#closed-modern-first-fallback-decision-matrix-t1804).

The connected Protocol projection carries a CtrlZebra-owned negotiated value:

```text
negotiated: {
  era: "modern",
  version: "2026-07-28"
}
|
{
  era: "legacy",
  version: "2025-11-25"
}
```

`negotiated` is present only after the complete handshake succeeds. Before that point the projection
may show the configured mode, but it exposes no selected era, version, capability, probe result,
fallback result, timing, or SDK value. The Webview never displays a fallback attempt as success.

The Host keeps a closed, non-sensitive negotiation classification for diagnostics and logs:
`modern-version-unsupported`, `legacy-version-unsupported`, `probe-timeout-legacy-failed`,
`malformed-protocol`, and `capability-rejected`. These classifications map to the existing stable
public error codes (`protocol-incompatible`, `malformed-message`, `capability-unsupported`, or the
appropriate process/cleanup code) and fixed user-safe messages. They never carry a JSON-RPC code,
Server text, probe timing, or a fallback-attempt flag across Protocol, Webview, persistence, or Core.
For this negotiation boundary, shape-invalid response/error values use `malformed-message`, while
structurally valid but closed-set-unrecognized values (including unknown future or unclassified
values) use `protocol-incompatible`; both are no-fallback outcomes.

## Security and persistence boundaries

Both eras use the same trusted workspace, immutable executable operation, startup approval, minimal
environment, process-tree cleanup, generation fence, cancellation, Tool approval, and content
limits. Era selection is not a new authorization scope and cannot add Roots, Sampling, Elicitation,
Tasks, logging, completion, subscriptions, or other Client capabilities.

Successful Tool, Resource, and Prompt events may record bounded historical provenance
`{ configuredMode, negotiatedEra, negotiatedVersion }`. This is evidence for the completed
operation only; it is never a reconnect instruction, approval, capability claim, configuration copy,
or fallback log. Failed attempts, probe timing, raw errors, process data, credentials, and config
values are not persisted. Recovery never starts, reconnects, probes, renegotiates, or replays a
Server operation.

The complete wire shape and status combinations live in [Protocol](protocol.md); lifecycle and
security ownership live in [Architecture](architecture.md) and [Security](security.md). The
Extension, Webview, persistence, and local stdio fixture paths now consume the same negotiated
projection; recovery remains an explicit user action and never starts a hidden reconnect.
