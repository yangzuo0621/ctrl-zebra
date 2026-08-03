# ADR 0001: Controlled MCP Client Boundary

- Status: Accepted
- Date: 2026-08-03
- Task: T1401

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
  unknown future versions fail initialization rather than automatically changing behavior.
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
- Core and existing built-in Tools keep their contracts and control flow. MCP cannot mutate Session
  state, approve itself, continue the model loop, or bypass cancellation and budgets.
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

## Reviewed primary references

- [MCP specification `2026-07-28`](https://modelcontextprotocol.io/specification/2026-07-28)
- [Official TypeScript SDK v2 repository and package layout](https://github.com/modelcontextprotocol/typescript-sdk)
- [SDK `2026-07-28` migration and version negotiation](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md)
- [SDK custom Transport contract](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/advanced/custom-transports.md)

These sources were resolved and reviewed through Context7 during T1401. The npm registry reported
`@modelcontextprotocol/client` `2.0.0` as the `latest` stable release on 2026-08-03; the dependency
contract records the exact version rather than retaining the mutable tag.
