# ADR 0002: MCP Dual-Era stdio Compatibility

- Status: Accepted; T1804 parser/schema/fixture implementation pending merge, live dual activation pending T1805–T1807
- Date: 2026-08-09
- Decision: Roadmap change control before T1804
- Supersedes: ADR 0001 only for protocol-era/version negotiation and compatibility

## Context

ADR 0001 deliberately fixed the first MCP implementation to the modern `2026-07-28` protocol and rejected
older versions. That decision produced a small, testable lifecycle but prevents CtrlZebra from connecting to the
large installed base of Servers that still use the legacy `initialize` / `notifications/initialized` lifecycle.

The current MCP `2026-07-28` stdio specification defines an official dual-era compatibility algorithm. A client
first probes `server/discover`. A successful `DiscoverResult` identifies a modern Server. A recognized modern
JSON-RPC error also identifies a modern Server and must not cause legacy fallback; the client instead selects a
mutually supported advertised modern version or disconnects. Only a response explicitly classified by the
specification as non-modern or a bounded timeout may identify the legacy compatibility path, where the client may
use `initialize` and then `notifications/initialized`; structurally valid responses/errors outside the closed
modern/non-modern classifications are `protocol-incompatible`, while syntactically/structurally malformed or
validation-failing responses/errors are `malformed-message`. Neither class authorizes fallback.

Supporting both eras expands protocol behavior, error classification, state ownership and security testing. In
particular, timeout must not become an unrestricted downgrade oracle, a legacy Server must not acquire Client
capabilities that CtrlZebra does not authorize, and results from the probe cannot leak into the fallback lifecycle.

## Decision

### Supported modes and versions

- CtrlZebra will support a user-visible per-Server protocol mode with the closed values `modern-only` and `dual`.
- Existing version `1` Server configurations remain `modern-only`. Dual-era behavior requires a new reviewed
  configuration representation and an explicit user selection; an upgrade does not silently broaden an existing
  Server's protocol behavior.
- `modern-only` accepts only modern MCP `2026-07-28` and never sends legacy `initialize`.
- `dual` supports exactly modern `2026-07-28` and legacy `2025-11-25`. Older legacy revisions and unknown future
  modern revisions remain `protocol-incompatible` until separately reviewed and added to the closed set.
- This decision covers local `stdio` only. Streamable HTTP, legacy HTTP+SSE, OAuth and remote Servers remain
  excluded.

### Normalized startup identity and activation gate

- The normalized effective `protocolMode` is part of the immutable startup operation and configuration
  identity, alongside Server identity, executable, ordered arguments, and canonical selected cwd. Version `1`
  without a mode normalizes to `modern-only`; it is therefore operation-equivalent to version `2` with explicit
  `modern-only` when all other effective fields match. `dual` is a different operation.
- The T1804 pure parser, Protocol Schemas, and deterministic fixtures may recognize `dual` for strict migration
  validation, but the current Extension startup owner remains modern-only until the dual lifecycle is wired. The
  owner must fail closed with stable `configuration-invalid` guidance before workspace binding, generation,
  startup approval, process spawn, or probing; it must never reinterpret `dual` as modern-only. T1807 removes
  this guard only with the mode-aware connection, Webview, persistence, and integration evidence.
- A mode change or any other effective operation change between approval wait and pre-spawn revalidation, or on
  an explicit retry, invalidates the old approval and generation. A fresh exact approval is required. The
  Extension owns this normalized comparison; SDK/Server data cannot replace it.

### Probe and fallback

- Every `dual` connection starts one bounded modern `server/discover` probe before any other protocol operation.
- `DiscoverResult` selects modern behavior only after the response advertises `2026-07-28` as mutually supported.
- A recognized modern JSON-RPC error proves the Server is modern. CtrlZebra does not fall back; it accepts the
  closed supported modern version if advertised, otherwise disconnects with `protocol-incompatible`.
- Only a bounded probe timeout or a response classified by the official SDK/specification as non-modern may enter
  the legacy path. After independent output/resource overflow checks, syntactically/structurally malformed or
  validation-failing responses/errors map to `malformed-message`; structurally valid responses/errors outside the
  closed recognized-modern or defined non-modern classifications (including unknown future or otherwise
  unclassified values) map to `protocol-incompatible`. Neither maps to legacy or authorizes fallback. Overflow
  remains `limit-exceeded`; process exit, cancellation, trust loss and cleanup failure are terminal and never
  authorize fallback.
- Before fallback, the probe request and its correlation state are closed. Any late probe response is discarded by
  the current connection-generation gate and cannot mutate capabilities, catalogs, Protocol or UI.
- Legacy negotiation sends `initialize` for `2025-11-25`, validates the complete `InitializeResult`, requires the
  selected version to be exactly supported, then sends `notifications/initialized`. No usable capability is
  published before this completes.
- There is at most one modern probe and one legacy initialization per explicit connection attempt. Neither path
  automatically respawns, retries or switches era after reaching connected state.

### Capability and security boundary

- Both eras project only Tools, Resources, Resource Templates, Prompts and their already authorized list-change
  behavior. Era selection cannot add Roots, Sampling, Elicitation, Tasks, logging, completions, subscriptions,
  multimodal content or experimental capabilities.
- CtrlZebra declares no Server-to-Client capability and installs no privileged handler. A legacy Server request for
  Sampling, Roots, Elicitation or another excluded primitive receives a bounded unsupported response or closes the
  affected request according to the reviewed SDK contract; it never reaches Core, a Provider, workspace access,
  approval or persistence.
- The same startup approval, immutable normalized mode and Server identity, process command, arguments, cwd,
  Workspace Trust decision, minimal environment, generation fence and process-tree cleanup apply to both eras.
  Negotiated era is not a new authorization scope and cannot change the approved executable operation.
- MCP Tools remain CtrlZebra `execute`-risk operations requiring a fresh exact approval. Legacy annotations and
  capabilities cannot lower risk or make an operation automatic.
- Probe, fallback, initialization, normal requests, notifications and cleanup are all cancellable. After cancellation
  or a closed generation there are no accepted results, retries, model continuation, persistence or UI effects.

### Projection and diagnostics

- Connected state exposes a CtrlZebra-owned negotiated era and exact protocol version. Webview and persistence never
  receive SDK enums, JSON-RPC errors, raw discovery/initialize data or fallback timing details.
- Diagnostics distinguish unsupported modern version, unsupported legacy version, probe timeout followed by failed
  initialization, malformed protocol, capability rejection and process/cleanup failure without exposing raw Server
  output or command details. For negotiation, malformed/validation-failing response/error is the stable
  `malformed-message` code; a structurally valid but closed-set-unrecognized response/error is
  `protocol-incompatible`; both are no-fallback outcomes.
- The UI shows the configured mode and negotiated era. A legacy connection is never presented as modern, and a
  fallback is not described as a security guarantee or successful compatibility until initialization completes.

## Alternatives considered

### Remain modern-only

Rejected as the only product mode. It retains the smallest state machine but leaves most existing legacy Servers
unusable and prevents the completed MCP surface from delivering its intended interoperability value. It remains
available as the strict per-Server option.

### Enable dual mode silently for every existing configuration

Rejected. It would change the protocol behavior of an already approved Server configuration on upgrade and make
timeout-triggered fallback invisible to the user. Explicit mode selection provides compatibility without silently
expanding behavior.

### Support every historical legacy revision

Rejected. Each revision expands lifecycle, schema, notification and fixture obligations. The first dual-era scope is
the closed pair `2026-07-28` and `2025-11-25`; additional revisions require evidence and change control.

### Run separate modern and legacy Server processes

Rejected. A second spawn would repeat an approved executable operation, complicate process-tree cleanup and risk
duplicating Server side effects. One explicit connection attempt owns one process and one generation across the
bounded probe and fallback sequence.

## Consequences

- T1804 must update Architecture, Security, Protocol, Persistence, UX, Webview and configuration compatibility
  before implementation. Its parser/schema/fixture implementation is additive and does not activate dual on the
  live Extension path. It must also mark the affected ADR 0001 statements as superseded rather than rewriting
  history.
- T1805 owns the package-private dual-era lifecycle and version negotiation behind existing CtrlZebra interfaces.
- T1806 owns the legacy-specific security matrix, rejected Client requests, notification/cancellation races and
  complete fixtures.
- T1807 owns removal of the fail-closed dual guard, Extension configuration migration activation, user-visible
  mode/era, persisted provenance, documentation and VSIX smoke evidence.
- The implementation and test matrix approximately doubles for connection negotiation, but Core Agent, Tool approval,
  workspace and process ownership remain unchanged.

## Reviewed primary references

- [MCP `2026-07-28` versioning](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/versioning.mdx)
- [MCP `2026-07-28` stdio backward compatibility](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/stdio.mdx)
- [MCP `2025-11-25` lifecycle](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/lifecycle.mdx)

These official sources were resolved through Context7 on 2026-08-09. Implementation tasks must repeat the review for
the then-current SDK documentation and errata rather than assuming the present API surface remains unchanged.
