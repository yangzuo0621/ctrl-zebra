
### Dual-era configuration and negotiated projection (T1804)

The T1804 contract adds a strict configuration boundary without changing the Protocol envelope
version. `ctrlZebra.mcp.server` is one machine-scoped local `stdio` object. Version `1` has the
existing `{ version, serverId, displayName, command, args }` shape and means `modern-only`; version
`2` requires the additional closed `protocolMode: "modern-only" | "dual"`. Unknown versions,
modes, fields, transports, credentials, and malformed values are rejected as
`configuration-invalid`. An existing version `1` value is never silently rewritten or broadened;
the user must explicitly migrate to version `2` and then select `dual`.

The mode selects a closed version set:

| Configured mode | Accepted versions | Bootstrap |
|---|---|---|
| `modern-only` | `2026-07-28` | one bounded `server/discover`; no legacy initialize |
| `dual` | `2026-07-28`, `2025-11-25` | modern probe first; one legacy initialize fallback only for a specification-classified non-modern response or bounded timeout |

The Protocol layer never receives SDK lifecycle messages. It receives one complete connected
projection only after the selected handshake validates, with `configuredMode` and
`negotiated: { era, version }`. The pair is exactly `modern/2026-07-28` or
`legacy/2025-11-25`. Connecting, disconnecting, disconnected, and failed projections contain no
negotiated pair or usable capabilities. A well-formed `DiscoverResult` locks modern: an advertised
`2026-07-28` continues modern, while a missing/unsupported advertised version is
`protocol-incompatible` with no fallback. A recognized modern JSON-RPC error also locks modern: a
controlled advertised `2026-07-28` continues/selects modern, while a missing/unsupported advertised
version is `protocol-incompatible` with no fallback. Only a specification-defined non-modern response
or bounded probe timeout in `dual` can enter one legacy handshake. After independent overflow checks,
a syntactically/structurally malformed or shape-validation-failing response/error maps to
`malformed-message`; a structurally valid response/error outside the closed recognized-modern or
defined non-modern classifications (including unknown future or otherwise unclassified values) maps
to `protocol-incompatible`. Both are no-fallback outcomes. Cancellation, process exit, trust loss, or
cleanup failure cannot trigger fallback. Late probe results are ignored by generation. The complete
eligible/forbidden decision matrix is authoritative in
[Architecture](../architecture/mcp-schema-and-discovery.md#closed-modern-first-fallback-decision-matrix-t1804).

`McpErrorDto` remains a closed, user-safe code/message object. Unsupported versions use
`protocol-incompatible`; malformed protocol uses `malformed-message`; rejected capabilities use
`capability-unsupported`; process, cleanup, and other failures use their existing stable codes.
For the modern-first boundary, syntactically/structurally malformed or shape-validation-failing
response/error values use `malformed-message`, while structurally valid values outside the closed
recognized-modern or defined non-modern classifications (including unknown future or unclassified
values) use `protocol-incompatible`; neither permits fallback.
The Host may classify failures internally as `modern-version-unsupported`,
`legacy-version-unsupported`, `probe-timeout-legacy-failed`, `malformed-protocol`, or
`capability-rejected`, but these names are not open wire values. Internal probe/fallback
classifications never add a raw error, JSON-RPC code, timing, Server data, or fallback-attempt flag
to the DTO. The only protocol-incompatible recovery facts are the
configured mode, its closed supported-version list, `connectionEstablished: false`, and the fixed
`open-settings` next step.

Persisted MCP events may include the strict historical provenance
`{ configuredMode, negotiatedEra, negotiatedVersion }` after a successful connection. It is not a
connection snapshot, capability claim, approval, retry token, or reconnection instruction. No
configuration, probe/fallback state, process detail, credential, raw error, or unbounded protocol
value crosses this boundary. The Protocol schema and compatibility fixtures for these unions are
implemented and exercised by the Extension/Webview integration paths.

### Resource and Resource Template projections

`McpResourceDescriptorDto` is the strict bounded projection `{ server, generation, uri, name,
title?, description?, mimeType? }`. `McpResourceTemplateDescriptorDto` replaces `uri` with
`uriTemplate` and adds at most 32 strict argument descriptors `{ name, description?, required }`.
The Host derives template argument names deterministically from the validated URI Template rather
than accepting a second Server-provided argument schema; every variable is required for version `1`.
Server icons, annotations, sizes, arbitrary metadata, and Workspace URI authority are excluded.

`McpResourceSnapshotDto` is created only by an explicit successful read and contains `{ server,
generation, uri, mimeType, items, truncated }`. It contains 1–32 strict items `{ text }`, within the
Security aggregate limits. `uri` remains an external MCP identifier; it is never converted to a
workspace URI or link action. Only well-formed Unicode text with an explicitly supported textual
MIME projection is admitted. Blob, image, audio, embedded Resource, Resource Link, unknown content,
and nested SDK values are rejected.

Attachment creates a new immutable context projection `{ snapshotId, serverId, uri, mimeType,
text, truncated }`. `snapshotId` is Host-generated and opaque. It represents the exact bounded text
already read; list refresh or disconnect cannot mutate it. The projection is ordinary untrusted
user context, never System, Tool, approval, Workspace authorization, HTML, Markdown, or a live URI.

### Prompt projection and confirmation

`McpPromptDescriptorDto` contains `{ server, generation, name, title?, description?, arguments }`.
It has at most 32 strict arguments `{ name, description?, required }`; Server-provided defaults,
schemas, icons, metadata, or executable actions are excluded. Submitted values use a strict object
with exactly the advertised argument names and the Security key/value/aggregate limits.

`McpPromptPreviewDto` contains `{ previewId, server, generation, promptName, arguments, messages }`.
It has 1–32 bounded text messages `{ sourceRole: "user" | "assistant", text }`. MCP roles are shown
as provenance only and do not become trusted model roles. Unsupported roles or non-text content
reject the whole preview.

Confirmation consumes the exact current preview once and projects all messages into one ordinary
user-controlled input attachment with Server, Prompt, argument, and source-role labels. It never
creates a System or Assistant message, sends automatically, calls a Tool, reads a Resource, grants
approval, or retains template capability. Cancellation, disconnect, generation change, Prompt list
replacement, Session switch, send, or disposal invalidates an unconfirmed preview.

### Validation and bounds

All MCP message objects use strict Zod schemas, take input as `unknown`, reject unknown fields, and
enforce the limits in [Security](../security.md) while collecting. List snapshots contain at most
1,000 descriptors and must fit the one-mebibyte serialized ceiling. Strings must be well-formed
Unicode and are measured both by Unicode code points and UTF-8 bytes where Security defines both.

An invalid descriptor envelope or identity, duplicate identity, malformed cursor chain, unsupported
content item, or aggregate limit breach rejects the complete operation. A schema-policy failure
after a descriptor's envelope and identity pass is isolated to that Tool as a bounded rejected
result; it does not reject the complete operation or its valid siblings. The Extension never asks
the Webview to validate an SDK object, infer a capability, choose risk, join partial pages, or repair
malformed content.
