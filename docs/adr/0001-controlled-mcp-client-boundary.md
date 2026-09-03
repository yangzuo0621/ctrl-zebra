# ADR 0001: Controlled MCP Client Boundary

- Status: Accepted; protocol-era compatibility is amended by [ADR 0002](0002-mcp-dual-era-stdio-compatibility.md)

## Context

CtrlZebra already owns one Agent Loop, Tool Registry, approval policy, cancellation path, persistence
contract, and Session state machine. An external MCP Server must not create a second runtime, bypass
Workspace Trust or approvals, or expose SDK and Server values through product boundaries.

The supported scope is one explicitly configured local stdio Server with Tools, Resources, Resource
Templates, and Prompts. SDK availability of other transports, capabilities, or content types does not
authorize their use.

## Decision

Create an independent `packages/mcp-client` boundary. It owns SDK interaction, closed negotiation,
capability projection, request correlation, pagination, notification refresh, normalization,
cancellation propagation, and stable errors. Its public API exposes only CtrlZebra-owned values,
interfaces, and injected ports.

The Extension owns configuration, Workspace Trust, exact approvals, workspace cwd, process creation,
pipes, environment, termination, and lifecycle composition. Core retains Tool, approval, Agent,
Session, and cancellation ownership. Protocol owns strict JSON-serializable DTOs and schemas. The
Webview sees only those projections. The SDK transport remains private to the client boundary and
process spawning remains Extension-owned.

## Alternatives

- Put MCP in Core: rejected because SDK and protocol details would contaminate the host-independent
  runtime.
- Let the SDK start the process: rejected because trust, approval, environment, and cleanup would
  no longer be Extension-owned.
- Expose SDK or JSON-RPC values: rejected because external data must be validated, bounded, and
  projected into a closed product contract.

## Consequences

MCP lifecycle and compatibility remain independently testable while Core and Webview stay vendor
independent. A new transport, capability, content type, SDK version, or credential path requires a
separate product, architecture, security, protocol, persistence, UX, and compatibility review.

See [MCP](../mcp.md) for the current contract; this ADR records the boundary rationale, not its
implementation specification.
