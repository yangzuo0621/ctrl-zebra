# ADR 0001: Controlled MCP Client Boundary

- Status: Accepted
- Date: 2026-08-03
- Task: T1401
- Superseded in part: [ADR 0002](0002-mcp-dual-era-stdio-compatibility.md) replaces the protocol-era/version
  compatibility decision for T1804–T1807; all other module, capability, process, approval and content boundaries
  remain accepted.

## Context

CtrlZebra already has one Core-owned Agent Loop, Tool Registry, Approval Policy, cancellation path,
context budget, persistence contract, and Session state machine. Stage 14 must add one explicitly
configured local MCP Server without letting an external protocol, SDK, process, or Server-provided
metadata become a second runtime or weaken those controls.

The stage was initially planned against MCP `2025-11-25`. During T1401 review, the official
TypeScript SDK v2 became the stable line and declared MCP `2026-07-28` as its implemented
specification. Continuing on the v1 SDK line would start the feature on a maintenance-only branch
and create an early migration. Change control therefore updated the product foundation and active
phase specification to the current protocol baseline before implementation.

MCP `2026-07-28` includes more protocol surface than this stage authorizes. Availability in the
specification or SDK does not require a Client to declare or implement every optional capability.
The product still needs only local stdio plus Server Tools, Resources (including Resource
Templates), and Prompts.

## Decision

### Protocol and SDK

- CtrlZebra targets and accepts only protocol version `2026-07-28` in stage 14. Older versions and
  unknown future versions fail connection negotiation rather than automatically changing behavior.
- The implementation adopts the official `@modelcontextprotocol/client` package and initially pins
  it to exactly `2.0.0`, with its transitive `@modelcontextprotocol/core` remaining private to the
  SDK. Dependency declarations use no caret, tilde, or `latest` tag.
- Runtime Client/transport code imports the `@modelcontextprotocol/client` package root. Its public `Client`,
  `Transport`, JSON-RPC message types, and framing helpers support a package-private custom transport
  over the Extension-owned process port. The SDK `@modelcontextprotocol/client/stdio` transport is
  not used in production because it owns spawn and direct-child signal cleanup instead of the
  required Host approval and complete process-tree lifecycle. SDK availability of Streamable HTTP,
  OAuth, Tasks, Sampling, Elicitation, Roots, multimodal content, or experimental features does not
  authorize importing, registering, or exposing them. T1404 may additionally import only the
  documented `@modelcontextprotocol/client/validators/ajv` subpath from the same pinned SDK.
- Each SDK update requires a new Context7 review of current official documentation and errata,
  protocol compatibility evidence, lockfile review, tests for every supported primitive and
  excluded Client capability, and a VSIX bundle audit. A protocol-version change also requires
  product-foundation, phase, Architecture, Security, Protocol, Persistence, UX, and ADR review.

### Module boundary

Create an independent `packages/mcp-client` deep module. It owns SDK interaction, exact protocol
negotiation, capability projection, request correlation, pagination, notification refresh,
cancellation propagation, normalization, and stable errors. Its public API is CtrlZebra-owned and
contains no SDK, JSON-RPC, process, VS Code, persistence, or Webview types.

The Extension owns user configuration, Workspace Trust, approval, selected-workspace cwd,
process/pipes, minimum environment, process-tree termination, lifecycle composition, and mapping to
Protocol/Core. It injects a narrow bounded stdio/process port. Core continues to own all Agent and
Tool policy. The Webview receives only strict Protocol projections.

One Extension controller owns at most one connection and one generation. The SDK Client uses
`versionNegotiation: { mode: { pin: "2026-07-28" } }` and
`inputRequired: { autoFulfill: false }`; calls never enable manual `input_required`. The user
explicitly starts and disconnects it. Activation, restore, model output, list notifications, and
background work cannot connect or retry. Closing a generation shuts the result gate before abort
and cleanup, so late data has no Core, persistence, Protocol, or UI effect.

The pinned modern era connects through `server/discover`. It does not send the legacy
`initialize` / `notifications/initialized` exchange, which the SDK reserves for pre-`2026-07-28`
protocols. Capabilities remain unavailable until discovery completes and the exact pinned version
is accepted.

### Capabilities and content

The Client declares no Roots, Sampling, Elicitation, Tasks, experimental, or other Server-to-Client
capability and installs no handler for them. It projects only Server Tools, Resources, Resource
Templates, Prompts, and the corresponding list-changed support. Other Server capability claims are
ignored for availability and confer no authority. An `input_required` result is rejected as an
unsupported capability and never triggers SDK auto-fulfilment, opaque request-state echo, or retry.

Only bounded well-formed text and strict JSON structured Tool content are supported. Images, audio,
Blob, embedded Resources, Resource Links, Tasks, subscription updates, remote icons, arbitrary
metadata, and unknown content produce stable unsupported results. Resource text becomes ordinary
untrusted user context only after explicit attachment. Prompt text becomes one ordinary user input
attachment only after a full preview and explicit confirmation; Server roles remain provenance and
never become System authority.

### Tool schemas and policy

Static CtrlZebra boundary values use strict Zod schemas. Dynamic Server-supplied Tool schemas wrap
the pinned SDK's public Ajv validator behind a CtrlZebra interface. Before compilation, a structural
pass accepts only Draft 2020-12 and the closed non-regex keyword subset defined in Architecture,
then applies byte, node, depth, property, and local-reference limits. Remote/cyclic references,
patterns, formats, custom behavior, data coercion/defaulting/removal, and unknown keywords are
forbidden. Compiled validators live only with the current immutable Tool snapshot.

Core represents the result with a CtrlZebra-owned `external_json_schema_2020_12` Tool input-schema
wrapper, distinct from the existing statically typed built-in Tool schema. The MCP adapter is the
only producer and may construct it only for an individual accepted Tool after that Tool's complete
schema passes structural and compiled validation. A replacement snapshot may contain accepted
Tools alongside bounded rejection records, but rejected descriptors never produce a Core Tool or
wrapper. Provider adapters unwrap the bounded plain JSON value without translating it into, or
silently narrowing it to, the built-in schema subset; no MCP SDK or Ajv type crosses the package
boundary.

Every MCP Tool is a trusted CtrlZebra `execute`-risk Tool with an additional unknown local/network
side-effect warning. Server annotations cannot lower it. Each invocation uses a fresh single-use
approval bound to Server identity, generation, both Tool names, schema identity, validated arguments,
Session, Run, Tool Call, display, and expiry.

## Compatibility matrix

| Surface | Stage 14 decision |
|---|---|
| MCP `2026-07-28` | Supported; exact negotiated version required |
| Older or future protocol versions | Rejected with `protocol-incompatible` |
| Local stdio | Supported after explicit startup approval |
| Tools/list, list-changed, call | Supported within capability, generation, approval, and limits |
| Resources/list, templates/list, read | Supported for explicit bounded text workflows |
| Prompts/list, get | Supported for explicit preview and confirmation workflows |
| Streamable HTTP and legacy HTTP+SSE | Excluded |
| OAuth and remote credentials | Excluded |
| Roots, Sampling, Elicitation, Tasks | Not declared; no handlers; excluded |
| Resource subscriptions/updated | Excluded |
| Images, audio, Blob, embedded Resource, Resource Link | Rejected as unsupported |
| Logging, completions, experimental capabilities | Not projected or exposed |
| Multiple Servers, auto-connect, restart, retry | Excluded |

## Alternatives considered

### Keep all MCP code inside `apps/extension`

Rejected. It would shorten initial wiring but combine SDK protocol state, process ownership, VS Code
composition, Tool adaptation, normalization, and presentation mapping in one shallow module. That
would make deterministic transport tests harder, enlarge the Extension seam, and increase the risk
that SDK values or Server decisions leak into Core and Protocol.

### Use an independent `packages/mcp-client`

Accepted. It creates one narrow, testable SDK isolation boundary while leaving Host-specific process
and security authority in the Extension. The cost is a new declared package direction and explicit
mapping types, which are intentional because they prevent a third-party protocol from becoming a
cross-repository type system.

### Implement JSON-RPC without the official SDK

Rejected for the initial stage. It would reduce third-party package surface but make CtrlZebra own
framing, negotiation, correlation, cancellation, notification, and schema compatibility behavior.
That duplicate protocol implementation has a larger correctness and maintenance burden than a
pinned SDK isolated behind internal contracts.

### Remain on SDK v1 and MCP `2025-11-25`

Rejected after change control. It matched the original plan but would begin on the superseded SDK
line and force a near-term protocol/package migration. Pinning SDK v2 and narrowing capabilities
gives a current maintained base without admitting its entire feature surface.

### Add HTTP, Client primitives, or multimodal content now

Rejected. Each adds a distinct attack surface and ownership model: remote endpoint and OAuth
security, Server-to-Client access to models/users/workspaces, or binary rendering and CSP expansion.
They require separately approved roadmap tasks and cannot be hidden behind the stdio or text
interfaces decided here.

## Consequences

- T1402 can test lifecycle and protocol behavior without VS Code or a real child process, while the
  production Extension retains the actual process and trust boundary.
- Existing built-in Tools keep their schema representation and control flow. Core's declaration
  contract adds one explicit external-schema variant so valid MCP Draft 2020-12 constraints are not
  silently lost. MCP still cannot mutate Session state, approve itself, continue the model loop, or
  bypass cancellation and budgets.
- Exact-version support deliberately rejects some otherwise compatible Servers. Expanding the
  matrix is an explicit product decision with fixtures rather than an accidental SDK fallback.
- The SDK package may contain dependencies used by excluded transports. Later implementation and
  packaging tasks must import only approved subpaths and inspect the emitted VSIX; dependency
  presence never creates a user-visible capability.
- Resource and Prompt snapshots can be recovered as historical untrusted context, but no persisted
  value can reconnect, replay, authorize, or refresh an external operation.
- Future Streamable HTTP/OAuth, Client primitives, Tasks, multimodal content, multiple Servers, or
  protocol upgrades must add their own security, Protocol, persistence, UX, testing, and lifecycle
  decisions rather than extending this contract implicitly.

## T1402 pre-implementation correction

The original T1401 wording described the T1402 lifecycle as
`initialize → initialized → operation → disconnect`. Inspection of the pinned stable
`@modelcontextprotocol/client` `2.0.0` package and current official SDK documentation confirmed that
the `2026-07-28` modern method registry removes `initialize` and `notifications/initialized`; pinned
version negotiation uses `server/discover` instead. The lifecycle contract is therefore corrected
to `server/discover → connected → operation → disconnect`, and the unimplemented stable error name
`initialize-failed` is corrected to `connect-failed`. This is a factual compatibility correction;
it does not change the accepted SDK version, protocol version, capability scope, transport, or
security boundary.

## T1801 supplement: per-Tool rejection and snapshot isolation

T1801 refines the accepted MCP boundary without changing the pinned `2026-07-28` protocol, SDK
version, package ownership, capability allowlist, process lifecycle, approval policy, or Core
contract. A `tools/list` result is collected within the existing byte, page, entry, descriptor,
schema, and snapshot limits and then evaluated one descriptor at a time.

- An accepted descriptor produces an immutable Tool descriptor, schema identity, and compiled
  validator. A rejected descriptor produces no Core Tool and only a bounded MCP Tool name plus one
  closed CtrlZebra reason: `forbidden-keyword`, `unknown-keyword`, `invalid-reference`,
  `non-object-root`, `schema-invalid`, or `limit-exceeded`. Reasons never echo Server keywords,
  schema paths, SDK/JSON-RPC errors, or exception text. T1802 may refine keyword-to-reason mapping
  within this closed boundary, but cannot admit unknown or dangerous schema behavior.
- Schema failure is isolated to that Tool. Invalid descriptor envelopes, malformed pages, duplicate
  MCP identities, duplicate or reserved Registry names, and aggregate limit breaches remain
  whole-operation failures because they prevent a trustworthy identity or complete snapshot. A
  non-empty list with no accepted Tool remains an `invalid-schema` discovery failure; an empty list
  is a valid empty catalog.
- The adapter constructs accepted Tools, validators, schema identities, and rejection details off
  to the side and publishes one complete current-generation snapshot atomically. It retains the
  previous complete snapshot on any whole-operation failure. Server identity, generation, and
  discovery context fence every refresh; a late or cancelled result cannot replace a newer
  snapshot or revive revoked approvals.
- The protocol adds `extension/mcp-tool-rejections` rather than changing the strict legacy
  `extension/mcp-tools` shape. The additive projection carries at most 256 rejected entries and a
  `rejectedToolsTruncated` marker, within the existing serialized snapshot ceiling. Entries are
  sorted by exact MCP Tool name in lexicographic Unicode scalar-value order before the first 256 are
  selected, independent of page order. New clients stage the matching tools and rejection messages
  atomically in one Host-owned slot that expires 1,000 ms after the first half arrives; a missing
  half, refresh, cancellation, disconnect, or generation change discards the slot without retry.
  Older clients ignore the unknown additive message and continue to receive accepted Tools, losing
  only the optional diagnostics.

This supplement records the single-Tool degradation and compatibility behavior required before
T1801 implementation. It does not authorize T1802 Schema keyword reinterpretation, T1803
diagnostic UX, or T1804–T1807 dual-era protocol behavior; those remain separate tasks and change
control surfaces.

## Reviewed primary references

- [MCP specification `2026-07-28`](https://modelcontextprotocol.io/specification/2026-07-28)
- [Official TypeScript SDK v2 repository and package layout](https://github.com/modelcontextprotocol/typescript-sdk)
- [SDK `2026-07-28` migration and version negotiation](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md)
- [SDK custom Transport contract](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/advanced/custom-transports.md)

These sources were resolved and reviewed through Context7 during T1401. The npm registry reported
`@modelcontextprotocol/client` `2.0.0` as the `latest` stable release on 2026-08-03; the dependency
contract records the exact version rather than retaining the mutable tag.
