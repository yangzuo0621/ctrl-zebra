# CtrlZebra configuration contract

This document defines the user-facing MCP setting that is shared by the Extension, Protocol,
Security, Persistence, UX, and Webview contracts. It is the T1804 compatibility gate; runtime
configuration parsing and migration are implemented only after this document has been reviewed and
merged.

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
or silently broadens its protocol behavior.

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

## Negotiation and visible result

Every explicit connection has one configured mode. `modern-only` performs only the modern
`server/discover` exchange. `dual` performs one bounded modern probe first; only a specification-
classified non-modern response or a bounded probe timeout may enter one legacy `initialize` /
`notifications/initialized` exchange. A recognized modern response, malformed framing, overflow,
cancellation, trust loss, process exit, or cleanup failure is terminal and never authorizes
fallback. Late probe data is discarded by the connection generation gate.

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
security ownership live in [Architecture](architecture.md) and [Security](security.md). T1804
defines this contract only. T1805–T1807 implement parsing, negotiation, schemas, fixtures, and
user-facing integration after the constraint PR is merged.
