
## Ownership

- `packages/protocol` owns Schemas, inferred types, protocol constants, and public message names. It has no dependency on React, VS Code, Node.js host APIs, or model SDKs.
- The Extension Controller owns validated dispatch and response construction. VS Code adapters own `onDidReceiveMessage`, `postMessage`, failure reporting, and Disposable lifetimes.
- One Webview-local adapter owns the single `acquireVsCodeApi()` call and validates Extension messages before notifying presentation code.

## MCP Cross-Boundary Contract

MCP Protocol and SDK values terminate before this boundary. The DTOs below are CtrlZebra-owned,
strict, JSON-serializable projections planned as additive protocol version `1` messages. They never
contain JSON-RPC IDs or methods, SDK types or enum values, process handles, executable or environment
values, raw capability objects, arbitrary metadata, Server error data, or unbounded content.

### Shared identity, status, and errors

`McpServerIdentityDto` is the strict object `{ serverId, displayName }`. `serverId` is the configured
lower `snake_case` identity and `displayName` is its bounded user label. It does not contain command,
arguments, cwd, configuration scope, credentials, or transport details.

`McpConnectionProjectionDto` is the strict object used by `extension/mcp-connection`:

```text
{
  server?: McpServerIdentityDto,
  generation: non-negative safe integer,
  status: "disconnected" | "connecting" | "connected" | "disconnecting" | "failed",
  configuredMode: "modern-only" | "dual",
  negotiated?:
    { era: "modern", version: "2026-07-28" }
    | { era: "legacy", version: "2025-11-25" },
  capabilities: {
    tools: boolean,
    toolsListChanged: boolean,
    resources: boolean,
    resourceTemplates: boolean,
    resourcesListChanged: boolean,
    prompts: boolean,
    promptsListChanged: boolean
  },
  configurationStale: boolean,
  error?: McpErrorDto
}
```

`configuredMode` is present in every status and reflects the effective setting (the safe default is
`modern-only`). The initial unconfigured boot projection, and a configuration failure before an
identity exists, may omit `server` and use generation `0`; once a configuration has been validated,
failed and connected projections carry the selected Server identity, and connected uses a positive
generation. `negotiated` is
present only in `connected`; it is the exact mutually supported era/version pair and never a
user-selected or SDK enum value. Projected capabilities are all false before the complete selected
handshake. Extra advertised Server capabilities are absent rather than copied into an open map. The
Schema refines this object by status: `connected` requires one exact `negotiated` pair and forbids
`error`; `failed` requires `error`, omits `negotiated`, and has all capabilities false; all other
states omit both `negotiated` and `error` and expose no usable capability. `generation` is an opaque
freshness fence for consumers, not authorization. The modern-only `protocolVersion` field from the
T1803 contract is replaced by this mode-aware negotiated DTO. The active Extension/Webview path
accepts the negotiated projection only; it does not accept both shapes or silently infer an era.

`McpErrorDto` contains only `{ code, message }`. `message` is a fixed user-safe string of at most
1,024 code points. The stable closed code set is:

```text
configuration-invalid | workspace-untrusted | approval-denied | approval-expired |
approval-invalidated | spawn-failed | connect-failed | protocol-incompatible |
capability-unsupported | malformed-message | invalid-schema | limit-exceeded |
server-exited | disconnected | termination-unconfirmed | tool-unavailable |
tool-invalid-input | tool-failed | tool-invalid-output | resource-unavailable |
resource-unsupported | prompt-unavailable | prompt-unsupported | internal
```

Cancellation is represented by the owning connection, request, or Run status and is never an MCP
error code. Raw JSON-RPC numeric codes, messages, `data`, SDK errors, process exit details, stdout,
stderr, stack traces, and causes are forbidden.

### Message directions and correlation

- Webview intents use `webview/mcp-connect`, `webview/mcp-disconnect`, `webview/mcp-refresh-tools`,
  `webview/mcp-resource-read`, `webview/mcp-resource-attach`,
  `webview/mcp-prompt-preview`, `webview/mcp-prompt-confirm`, and
  `webview/mcp-prompt-cancel`. T1408 additively defines `webview/mcp-open-settings`,
  `webview/mcp-resource-detach`, and `webview/mcp-prompt-detach` so the user can open the exact
  user-scoped setting or remove an immutable draft attachment before send. They carry only the
  active `serverId`, `generation` where a live
  connection is required, bounded projected identities/arguments required by that action, and the
  normal envelope. They cannot carry configuration, command, cwd, risk, approval state, Tool
  schema, Resource content, Prompt result, or capability declarations.
- Extension state uses `extension/mcp-connection`, the additive `extension/mcp-diagnostics`, the unchanged legacy `extension/mcp-tools`, the
  additive atomic `extension/mcp-tool-catalog`, `extension/mcp-resources`, `extension/mcp-prompts`,
  `extension/mcp-resource-preview`, and `extension/mcp-prompt-preview`. The combined catalog is
  authoritative for sequence-aware clients; legacy tools-only state is retained only for older
  clients. The superseded `extension/mcp-tool-rejections` message is non-authoritative and is not
  emitted by the amended Host. No catalog message is interpreted as an incremental patch.
- MCP Tool Calls continue to use the existing Core Tool Call/Result correlation. Their Webview
  projection adds a strict `source` object to the Tool-state contract only when the originating
  registered Tool is external: `{ kind: "mcp", server, generation, mcpToolName }`. Built-in Tools
  retain `{ kind: "builtin" }`. No generic Server metadata bag is allowed.
- Every live intent and response must match the active `requestId`, `serverId`, and generation.
  Resource and Prompt intents additionally match the exact projected URI/template/Prompt identity;
  Prompt confirmation matches a Host-generated preview ID. Stale or mismatched messages are
  ignored without operation, persistence, or user-visible state mutation.

The three T1408 intents are strict and do not broaden Server authority. Open-settings contains no
Server data and asks the Extension to reveal `ctrlZebra.mcp.server` in user settings. Resource
detach carries only the Host-generated `snapshotId`; Prompt detach carries only the Host-generated
`previewId` retained for the confirmed draft projection. Detach removes only the matching current
Composer attachment, performs no Server request, and cannot delete a Resource, revoke persisted
history, cancel a Run, or affect another attachment.

`webview/mcp-refresh-tools` is the T1803 refresh intent `{ protocolVersion, type, requestId,
serverId, generation }` with no additional properties. It is accepted only while the matching
generation is connected, runs one bounded Tool-list refresh under the existing generation and
cancellation gates, and cannot start a process, reuse approval, or mutate the Session. Stale,
cancelled, or mismatched refresh intents are ignored without state mutation.

### Tool projection and deterministic names

`McpToolDescriptorDto` contains only `{ registryName, mcpToolName, title?, description? }` plus the
shared Server identity and generation. Names are non-empty and bounded; title and description are
plain untrusted text. Input/output schemas and annotations stay outside the Webview protocol.

The Registry mapping is deterministic and independent of list order:

1. Compute SHA-256 over the UTF-8 sequence `serverId`, one NUL byte, and the exact MCP Tool name;
   retain the first 12 lowercase hexadecimal characters.
2. Convert the MCP Tool name to a lowercase ASCII slug by retaining `[a-z0-9]`, replacing each run
   of other characters with one underscore, trimming underscores, and using `tool` when empty.
3. Retain at most 47 slug characters and publish `mcp_<slug>_<hash>`, which satisfies the existing
   64-character lower `snake_case` Tool contract and always begins with a letter.

The exact MCP name remains the external identity and is never recovered from the slug. The Registry
reserves the `mcp_` prefix for this mapping. A duplicate external identity, a hash collision, or a
collision with any registered name rejects the complete incoming snapshot; no order-dependent
suffix or partial registration is allowed. A rename is removal plus addition. Tool calls and
approvals bind both names, Server ID, generation, and immutable schema identity.
