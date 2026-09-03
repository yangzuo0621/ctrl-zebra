# MCP

This document is the current-state owner for CtrlZebra's Model Context Protocol (MCP)
integration. It defines the product and runtime contract for one explicitly configured local
`stdio` Server, including process ownership, negotiation, capability projection, catalog behavior,
Resources, Prompts, diagnostics, and compatibility. The [security contract](security.md) owns the
general approval and trust invariants; the [configuration contract](configuration.md) owns the
setting registration and scope; the [protocol guide](protocol.md) indexes the public DTO family.

MCP is an external protocol adapter, not a second Agent Runtime. The accepted design rationale is
preserved in [ADR 0001](adr/0001-controlled-mcp-client-boundary.md) and the explicit dual-era
compatibility decision in [ADR 0002](adr/0002-mcp-dual-era-stdio-compatibility.md).

## Scope

CtrlZebra supports exactly one user-configured local `stdio` MCP Server. The supported Server
features are Tools, Resources, Resource Templates, Prompts, and their reviewed list-change
notifications. Streamable HTTP, legacy HTTP+SSE, remote Servers, OAuth, Server authentication,
Roots, Sampling, Elicitation, Tasks, subscriptions, logging, completions, multimodal content,
experimental capabilities, and arbitrary Server metadata are outside this contract.

The Server runs with the user's operating-system authority. Local stdio is a transport boundary,
not a sandbox; the Server may have local or network side effects independent of its declarations.
CtrlZebra does not download, install, authenticate, auto-start, auto-reconnect, or resume a Server
from persisted data.

## Trust model

MCP configuration, process startup, Server messages, descriptors, schemas, content, notifications,
stderr, and errors are untrusted. Only the Extension Host may read the machine-scoped setting,
resolve the selected trusted workspace root, start or terminate the process, and publish validated
CtrlZebra projections.

The Webview never receives JSON-RPC IDs or methods, SDK values, capability maps, process details,
commands, arguments, environment values, credentials, raw errors, or arbitrary metadata. Server
claims never grant authority. Tool calls remain external `execute` operations and require the same
exact, single-use approval boundary as other side-effecting operations. Resource and Prompt content
is ordinary untrusted context and cannot authorize another operation.

## Configuration

`ctrlZebra.mcp.server` is either `null` or one strict, machine-scoped object. Its only authority is
the Extension Host. It contains one executable and ordered arguments; it has no cwd, environment,
shell command line, endpoint, headers, credentials, transport, or Client capability fields.

The common fields are bounded as follows: `serverId` is lower `snake_case`, begins with a letter,
and is at most 64 ASCII characters; `displayName` is non-empty well-formed Unicode, at most 128
code points and 512 UTF-8 bytes; `command` is non-empty, contains no NUL or newline, and is at most
4,096 UTF-8 bytes; `args` has at most 64 strings, each at most 4,096 bytes, and the serialized
array is at most 32,768 UTF-8 bytes. Unknown fields, versions, modes, duplicate values, malformed
strings, and out-of-bound values fail closed as `configuration-invalid` and cannot start or
reconfigure a process. See [configuration.md](configuration.md) for the setting declaration and
scope semantics.

Version `1` has the shape `{ version, serverId, displayName, command, args }` and normalizes to
`protocolMode: "modern-only"`. It accepts only MCP `2026-07-28`; reading it never writes a new
value or silently broadens behavior. Version `2` requires the closed mode
`"modern-only" | "dual"`:

```json
{
  "version": 2,
  "protocolMode": "dual",
  "serverId": "local_docs",
  "displayName": "Local docs",
  "command": "/absolute/path/to/the-server",
  "args": ["--stdio"]
}
```

Migration from version 1 and selection of `dual` are separate explicit user actions. Version 1
implicit `modern-only` and version 2 explicit `modern-only` have the same normalized operation
identity when all other fields match. Editing an effective setting while connected marks the
configuration stale; it does not mutate the live process or reuse approval.

## Process ownership

`packages/mcp-client` owns the SDK interaction, protocol classification, capability projection,
request correlation, pagination, notification refresh, normalization, and stable errors. Its
public API contains only CtrlZebra-owned plain values, interfaces, and injected ports. SDK Clients,
transports, JSON-RPC envelopes and IDs, SDK errors, schemas, content objects, capability values,
progress tokens, task values, and cancellation notifications stop inside this package.

The package initially pins `@modelcontextprotocol/client` to exactly `2.0.0`. The production path
uses a package-private custom SDK `Transport` over an injected Extension-owned stdio/process port;
it does not instantiate the SDK's process-spawning `StdioClientTransport`. A version change requires
compatibility review, current official documentation review, lockfile evidence, tests, and a bundle
audit.

`apps/extension` owns configuration, Workspace Trust, selected-workspace cwd resolution, startup
and Tool approvals, process creation, stdin/stdout/stderr pipes, the allowlisted environment,
complete process-tree termination, VS Code lifecycle integration, and mapping to Protocol/Core.
`packages/core` owns the Tool Registry, Tool Executor, Approval Policy, Agent Loop, context budgets,
cancellation outcome, and Session state machine. MCP Tools enter Core only through existing
`AgentTool` and Tool Call/Result contracts; Resources and Prompts enter only through explicit
Host-controlled context inputs. `packages/protocol` owns strict public schemas and DTO types.

The dependency direction is:

```text
extension ─────────────→ mcp-client
mcp-client ────────────→ core contracts (only for the external Tool adapter)
```

The MCP package has no dependency on VS Code, React, Webview code, persistence, concrete process
implementations, or Extension adapters.

## Connection lifecycle

One Extension-owned `McpConnectionController` owns at most one configured Server connection and one
monotonically increasing generation. Concurrent connects for the same normalized effective
configuration share one in-flight attempt; a different configuration cannot replace a live one.
The normalized identity includes `protocolMode`, Server identity, executable, ordered arguments,
and selected canonical cwd.

The states are `disconnected → connecting → connected → disconnecting → disconnected`, with
`connecting | connected | disconnecting → failed` for unexpected process or protocol failure.
`failed` owns no usable Client and requires a new explicit connect. Activation, import, Webview
creation, Session recovery, model output, Tool discovery, notifications, and timers never connect
or reconnect MCP.

The controller is the single owner of the SDK Client, process port, request registry, list
snapshots, notification handlers, bounded stderr collector, and cleanup promise. A complete modern
or legacy handshake is required before capabilities or negotiated era are published.

Disconnect, Server exit, failed negotiation, cancellation, Extension disposal, or loss of
Workspace Trust first closes the delivery gate and increments the generation, then aborts requests,
closes stdin, and awaits bounded process-tree cleanup. Cleanup is idempotent; failure to confirm
termination is the distinct `termination-unconfirmed` outcome. Every request, notification,
descriptor, approval, Resource read, Prompt preview, and result is bound to the active Server
identity and generation. Late responses, notifications, stderr, process events, and settlements
are discarded before Core, persistence, Protocol, or Webview side effects.

## Protocol negotiation

`modern-only` sends one bounded modern `server/discover` probe and accepts only `2026-07-28`.
`dual` sends the same probe first and may enter exactly one legacy `initialize` /
`notifications/initialized` exchange only after a specification-defined non-modern response or a
bounded probe timeout. Both paths use the same workspace, approval, process, cancellation, limits,
generation fence, and cleanup rules.

The effective mode is selected before workspace binding and startup approval. The Extension passes
the normalized mode to the controlled Client and never silently coerces `dual` to modern-only. An
effective mode or other operation change invalidates pending or approved-but-unconsumed startup
approval and requires a fresh exact approval.

### Closed decision matrix

The fallback rule is a closed classification, not a generic retry rule. A recognized modern
JSON-RPC error is modern evidence and never authorizes legacy fallback.

| Probe or handshake observation | `modern-only` | `dual` | Result |
|---|---|---|---|
| Well-formed modern result advertises `2026-07-28` | Continue modern | Continue modern | Connected `modern / 2026-07-28` after handshake |
| Modern result omits the supported version | No fallback | No fallback | Failed `protocol-incompatible` |
| Recognized modern error advertises `2026-07-28` | Continue/select modern | Continue/select modern | Connected `modern / 2026-07-28` after handshake |
| Recognized modern error omits the supported version | No fallback | No fallback | Failed `protocol-incompatible` |
| Specification-defined non-modern response | Fail | One legacy handshake | Connected `legacy / 2025-11-25` only after complete success |
| Bounded probe timeout | Fail | One legacy handshake | Legacy only after exact version validation |
| Malformed or shape-invalid response/error | No fallback | No fallback | `malformed-message` |
| Structurally valid unknown/unclassified response/error | No fallback | No fallback | `protocol-incompatible` |
| Message, stream, or descriptor overflow | No fallback | No fallback | `limit-exceeded`; generation closes |
| Cancellation, trust loss, process exit, cleanup failure | No fallback | No fallback | Terminal cancellation/trust/exit/cleanup outcome |
| Unsupported or malformed legacy initialization | No second lifecycle | No second lifecycle | `protocol-incompatible` or `malformed-message` |

Independent overflow checks happen before classification. Unknown future versions, unclassified
values, malformed data, cancellation, process exit, trust loss, and cleanup failure are never
fallback oracles. There is at most one modern probe and one legacy initialization per explicit
attempt; no path respawns, retries an era, or switches after `connected`.

Connected state exposes only the CtrlZebra-owned pair `{ era, version }`, exactly
`{ era: "modern", version: "2026-07-28" }` or
`{ era: "legacy", version: "2025-11-25" }`. Before a complete handshake, no selected era,
version, probe result, fallback result, timing, SDK value, or Server claim is projected.

## Capability projection

The Client declares no Roots, Sampling, Elicitation, Tasks, experimental, or other Server-to-Client
capability and installs no handler for them. A request for an undeclared capability receives a
bounded stable unsupported response and cannot reach Core, a Provider, Workspace adapters,
approval, or persistence. SDK `input_required` auto-fulfilment is disabled; such a result is
`capability-unsupported` and is never retried with opaque request state.

Server capabilities are untrusted availability claims. CtrlZebra projects only Tools, Resources,
Resource Templates, and Prompts, plus the corresponding list-changed behavior. A list-changed
notification schedules one serialized, generation-bound full refresh; notification content never
patches the trusted snapshot.

## Tool discovery and schemas

Tool discovery evaluates each bounded descriptor independently, then publishes one complete atomic
snapshot. A descriptor with a valid identity but an unsafe, unsupported, malformed, or over-limit
schema becomes a rejected entry; accepted siblings remain eligible. Invalid envelopes, duplicate
identities, duplicate or reserved Registry names, malformed pages, and aggregate-limit failures
reject the complete operation. A non-empty list with no accepted Tool is the `invalid-schema`
failure; an actually empty list is valid.

The closed rejection reasons are:

```text
"forbidden-keyword" | "unknown-keyword" | "invalid-reference" |
"non-object-root" | "schema-invalid" | "limit-exceeded"
```

The reason is selected by CtrlZebra and contains no external keyword, JSON Pointer, raw schema,
SDK/JSON-RPC error, or exception text. The dynamic schema path accepts the reviewed Draft 2020-12
subset, treats an omitted `$schema` as that baseline, safely strips reviewed annotation or
unsupported-assertion keywords, rejects the known-dangerous set
`pattern`, `patternProperties`, `$dynamicRef`, `$dynamicAnchor`, `$recursiveRef`, and
`$recursiveAnchor`, and rejects unknown keywords. Legacy `definitions` is deterministically
converted to `$defs`; local references must resolve to an exact top-level `$defs` anchor. A direct
recursive anchor reference is valid; root, nested/non-anchor, remote, malformed, and multi-anchor
cycles are invalid.

The allowed and retained keyword set is `$schema`, `$defs`, local `$ref`, `type`, `properties`,
`required`, `additionalProperties`, `items`, `prefixItems`, `minItems`, `maxItems`, `uniqueItems`,
`minProperties`, `maxProperties`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`,
`multipleOf`, `minLength`, `maxLength`, `enum`, `const`, `allOf`, `anyOf`, `oneOf`, `not`, `title`,
`description`, `default`, and `examples`. The known safely stripped set is `format`, `$id`,
`$comment`, `readOnly`, `writeOnly`, `deprecated`, `nullable`, `if`, `then`, `else`,
`dependentSchemas`, `dependentRequired`, `propertyNames`, `contains`, `minContains`, `maxContains`,
`unevaluatedProperties`, `unevaluatedItems`, `contentEncoding`, `contentMediaType`, and
`contentSchema`. Stripped values are still recursively walked and bounded.

The normalized schema is compiled through the injected pinned Ajv adapter. The same compiled
validator validates arguments immediately before approval construction and again before execution;
validation performs no coercion, default insertion, or property removal. Validators are retained
only for the immutable current-generation snapshot.

The Registry mapping is deterministic and independent of list order: hash the UTF-8 sequence
`serverId`, one NUL byte, and the exact MCP Tool name, retain 12 lowercase hexadecimal characters,
slug the name to lowercase ASCII, retain at most 47 slug characters, and publish
`mcp_<slug>_<hash>`. The exact external name is retained separately. A duplicate external identity,
hash collision, or registered-name collision rejects the complete snapshot; no order-dependent
suffix or partial registration is allowed.

## Protocol projections

MCP values crossing the Extension/Webview boundary are strict, JSON-serializable, CtrlZebra-owned
projections. They contain no JSON-RPC IDs or methods, SDK types, process handles, executable or
environment values, raw capabilities, arbitrary metadata, Server error data, or unbounded content.

`McpServerIdentityDto` is `{ serverId, displayName }`. `McpConnectionProjectionDto` contains:

```text
{
  server?: { serverId, displayName },
  generation: non-negative safe integer,
  status: "disconnected" | "connecting" | "connected" | "disconnecting" | "failed",
  configuredMode: "modern-only" | "dual",
  negotiated?: { era: "modern", version: "2026-07-28" }
             | { era: "legacy", version: "2025-11-25" },
  capabilities: {
    tools, toolsListChanged, resources, resourceTemplates,
    resourcesListChanged, prompts, promptsListChanged
  },
  configurationStale: boolean,
  error?: { code, message }
}
```

Only `connected` has `negotiated` and usable capabilities; `failed` has a stable `error` and no
capabilities. `McpErrorDto` is `{ code, message }`, with a fixed user-safe message of at most
1,024 code points. Its closed `code` set is:

```text
configuration-invalid | workspace-untrusted | approval-denied | approval-expired |
approval-invalidated | spawn-failed | connect-failed | protocol-incompatible |
capability-unsupported | malformed-message | invalid-schema | limit-exceeded |
server-exited | disconnected | termination-unconfirmed | tool-unavailable |
tool-invalid-input | tool-failed | tool-invalid-output | resource-unavailable |
resource-unsupported | prompt-unavailable | prompt-unsupported | internal
```

Raw JSON-RPC codes, messages, data, SDK errors, process details, stdout, stderr, stacks, and
causes are forbidden. Cancellation is represented by the owning connection, request, or Run
status and is not an MCP error code.

Webview intents include connect, disconnect, refresh-tools, Resource read/attach/detach, Prompt
preview/confirm/cancel/detach, and open-settings. They carry only the active identity, generation
where required, and bounded values required by the action; they cannot carry configuration,
commands, cwd, risk, approval state, schemas, Resource content, Prompt results, or capabilities.
Extension state includes `extension/mcp-connection`, additive diagnostics, the unchanged legacy
`extension/mcp-tools`, sequence-bearing `extension/mcp-tool-catalog`, Resources, Prompts, and their
previews. No catalog message is an incremental patch; sequence-aware clients treat the combined
catalog as authoritative and ignore delayed legacy messages for catalog state.

An external Tool source is `{ kind: "mcp", server, generation, mcpToolName }`; built-in Tools retain
`{ kind: "builtin" }`. Every live intent and response must match the active request ID, Server,
generation, and exact projected Resource/Prompt identity. Stale or mismatched messages are ignored
without operation, persistence, or UI mutation.

The combined catalog contains the Server identity, generation, accepted Tool descriptors, at most
256 bounded rejected entries, and a truncation flag. The Host owns a positive-safe-integer
`catalogSequence` per Server/generation, starts at 1, allocates it only immediately before a
fully validated publication, and never wraps. The complete envelope must fit the 1,048,576-byte
UTF-8 message ceiling. Accepted Tools are never truncated to fit rejection details. Older clients
ignore the additive combined message and continue using accepted Tools from the legacy projection.

## Resources and Resource Templates

`McpResourceDescriptorDto` is `{ server, generation, uri, name, title?, description?, mimeType? }`.
`McpResourceTemplateDescriptorDto` replaces `uri` with `uriTemplate` and includes at most 32 strict
argument descriptors `{ name, description?, required }`. Template argument names are derived
deterministically from the validated URI Template; every variable is required in version 1.
Icons, annotations, sizes, arbitrary metadata, and Workspace URI authority are excluded.

An explicit successful read creates `McpResourceSnapshotDto` with bounded text items and a
`truncated` flag. Blob, image, audio, embedded Resource, Resource Link, unknown content, and
nested SDK values are rejected. A user-selected Attach creates an immutable Host-generated
`snapshotId` projection containing the exact bounded text already read. It is ordinary untrusted
context, never System, Tool, approval, Workspace authorization, HTML, Markdown, or a live URI.
Disconnect, refresh, or generation change cannot mutate an attached snapshot; detach affects only
the matching current Composer attachment.

## Prompts

`McpPromptDescriptorDto` contains `{ server, generation, name, title?, description?, arguments }`
with at most 32 strict arguments. Server defaults, schemas, icons, metadata, and executable actions
are excluded. Submitted values are strict objects with exactly the advertised argument names and
the Security key/value/aggregate limits.

`McpPromptPreviewDto` contains `{ previewId, server, generation, promptName, arguments, messages }`
with 1–32 bounded text messages `{ sourceRole: "user" | "assistant", text }`. Roles are provenance
only and never become trusted model roles. Confirmation consumes the exact preview once and creates
one ordinary user-controlled input attachment with Server, Prompt, argument, and source-role
labels. It never creates a System or Assistant message, sends automatically, calls a Tool, reads a
Resource, grants approval, or retains template capability. Cancellation, disconnect, generation or
Session change, list replacement, send, or disposal invalidates an unconfirmed preview.

## Catalog refresh and diagnostics

Tool and diagnostic snapshots are constructed off to the side and published atomically only after
strict validation. A mixed catalog may retain accepted siblings while exposing bounded rejection
details. A successful refresh always replaces diagnostics, including with an explicit `clear`; a
failed refresh retains the last complete catalog and replaces diagnostics with a bounded failure
outcome. Disconnect, generation change, cancellation, trust loss, and disposal clear the delivery
gate and prevent late data from recreating diagnostics.

The recovery actions are the closed set `refresh-tools`, `reconnect`, and `open-settings`. They
carry no command, environment, URI, credential, schema, raw error, stderr, stack, or Server
metadata. Diagnostic entries contain only a validated Tool name and one closed rejection reason.
The legal combinations are:

```text
degraded              = connected + tool rejections + refresh-tools
all-rejected          = failed + tool rejections + reconnect
refresh-all-rejected  = connected + tool rejections + refresh-tools
tool-discovery-failure (initial) = failed + stable code + reconnect
tool-discovery-failure (refresh) = connected + stable code + refresh-tools
protocol-incompatible = failed + configured mode + closed supported versions + open-settings
clear                 = successful connected refresh with no diagnostic
```

`diagnosticSequence` is Host-owned, monotonic per Server/generation, starts at 1, is allocated for
every replacement including `clear`, and is bounded by the same serialized message ceiling. Tool
names are de-duplicated and sorted by Unicode scalar value before the 256-entry prefix is selected.
The Webview clears diagnostics synchronously for authoritative disconnecting, disconnected, failed,
or changed-generation state; it never waits for `clear`. Exact duplicates are no-ops, lower
sequences are stale, and same-sequence conflicts are discarded without state mutation.

## Limits and validation

All external values are accepted as `unknown`, validated strictly, and bounded incrementally before
constructing complete values. The principal limits are:

| Scope | Limit |
|---|---:|
| One inbound/outbound JSON-RPC message | 1,048,576 UTF-8 bytes |
| Retained stderr per connection | 65,536 UTF-8 bytes, prefix only |
| One list operation | 100 pages and 1,000 entries |
| One descriptor | 65,536 serialized UTF-8 bytes |
| One complete list snapshot | 1,048,576 serialized UTF-8 bytes |
| One Tool schema | 65,536 bytes, depth 32, 4,096 nodes, 1,024 properties |
| All schemas in one Tool snapshot | 524,288 serialized UTF-8 bytes |
| Tool arguments before approval | 262,144 serialized UTF-8 bytes |
| Normalized Tool text | 262,144 code points and 524,288 UTF-8 bytes |
| Resource URI | 2,048 code points and 8,192 UTF-8 bytes |
| One Resource read | 32 text items, 131,072 code points and 524,288 UTF-8 bytes |
| Prompt arguments | 32 entries; 65,536 bytes total |
| One Prompt result | 32 text messages, 65,536 code points and 262,144 UTF-8 bytes |

List collectors reject duplicate cursors, non-advancing cursors, duplicate identities, malformed
pages, and limit overflow without retaining partial replacements. Resource text may retain a largest
well-formed prefix only when `truncated: true`; Tool and Prompt data over their limits are rejected.
All message objects use strict Zod schemas and reject unknown fields.

## Security and approvals

MCP Server startup is a distinct `execute` operation. It requires a fresh single-use approval that
binds the normalized mode, Server identity, complete executable, ordered arguments, canonical
trusted-workspace cwd, external-process warning, and current trust decision. The Extension
revalidates configuration, trust, approval, operation equality, and cwd immediately before direct
spawn with shell interpretation disabled and a new allowlisted environment.

Every MCP Tool has trusted `execute` risk regardless of Server annotations or read-only claims. Each
call requires a fresh exact approval binding Session, Run, Tool Call, registry name, Server,
generation, immutable schema identity, validated arguments, presentation, and expiry. Validation is
not authorization; a failure, cancellation, disconnect, or lost response creates no retry grant.
Resource reads and Prompt gets require explicit current-generation user actions but are not Tool
approvals. See the [controlled MCP security boundary](security.md#controlled-mcp-security-boundary).

## Persistence and recovery exclusions

Completed Tool, Resource, and Prompt events may retain bounded historical provenance
`{ configuredMode, negotiatedEra, negotiatedVersion }` after a successful connection. It is not a
connection snapshot, capability claim, approval, retry token, or reconnection instruction.
Configuration, probe/fallback state, timing, process data, credentials, raw errors, SDK values,
Server output, and live connection state are not persisted.

Recovery reads historical bounded projections only. It never reads MCP configuration for side
effects, starts or reconnects a Server, lists or reads a Resource, gets a Prompt, resubmits content,
or resumes an incomplete request. A live or incomplete MCP operation is represented as incomplete,
not replayed.

## Current compatibility matrix

| Setting | Supported protocol | Lifecycle |
|---|---|---|
| Version 1 | `2026-07-28` | One modern `server/discover`; no fallback |
| Version 2 `modern-only` | `2026-07-28` | One modern `server/discover`; no fallback |
| Version 2 `dual` | `2026-07-28`, `2025-11-25` | Modern probe first; one legacy initialize only for the closed non-modern/timeout cases |

No setting enables a second runtime, remote transport, authentication, automatic recovery, or an
open-ended version fallback. Any new protocol version, transport, capability, or credential path
requires a separately reviewed product, architecture, security, protocol, persistence, UX, and
compatibility decision.
