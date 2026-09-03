# ADR 0001: Controlled MCP Client Boundary

- Status: Accepted; protocol-era compatibility is amended by [ADR 0002](0002-mcp-dual-era-stdio-compatibility.md)
- Date: 2026-08-03

## Context

CtrlZebra already has one Core-owned Agent Loop, Tool Registry, Approval Policy, cancellation path,
context budget, persistence contract, and Session state machine. Adding an external MCP Server must
not create a second runtime, bypass Workspace Trust or approvals, or allow SDK and Server metadata
to cross the product's public boundaries.

The product scope is intentionally narrow: one explicitly configured local stdio Server, with
Tools, Resources, Resource Templates, and Prompts. SDK availability of other transports,
capabilities, or content types does not authorize their use.

## Decision

Create an independent `packages/mcp-client` boundary. It owns SDK interaction, closed protocol
negotiation, capability projection, request correlation, pagination, notification refresh,
normalization, cancellation propagation, and stable errors. Its public API contains only
CtrlZebra-owned plain values, interfaces, and injected ports.

The Extension owns configuration, Workspace Trust, exact approvals, selected-workspace cwd,
process creation and pipes, allowlisted environment, complete process-tree termination, lifecycle
composition, and mapping to Protocol/Core. Core retains Tool, approval, Agent, Session, and
cancellation ownership. Protocol owns strict JSON-serializable DTOs and schemas. The Webview sees
only those projections.

The production transport is a package-private SDK transport over an Extension-owned stdio port;
the SDK's process-spawning stdio transport is not used. The pinned SDK version and supported
MCP versions are recorded in the [current MCP contract](../mcp.md). The Client declares no
Roots, Sampling, Elicitation, Tasks, or other Server-to-Client capability. Server metadata cannot
lower Tool risk, grant access, or add an operation.

## Alternatives considered

- Put MCP handling in Core: rejected because SDK/protocol details would contaminate the
  host-independent runtime and weaken the existing ownership boundary.
- Let the SDK own process startup: rejected because it cannot enforce CtrlZebra's trust,
  approval, environment, and complete process-tree cleanup rules.
- Expose SDK or JSON-RPC values to the Webview: rejected because external values must be validated
  and projected into a closed, bounded product contract.
- Implement every capability offered by MCP: rejected because availability is not product
  authorization and would expand the security and UX surface without review.

## Consequences

MCP lifecycle and compatibility are independently testable while Core and Webview remain vendor
independent. Every external operation passes through existing trust, approval, cancellation,
generation, persistence, and bounded-content controls. A new transport, capability, content type,
SDK version, or credential path requires a separate product, architecture, security, protocol,
persistence, UX, and compatibility review.

See [MCP](../mcp.md) for the current contract; this ADR records why the boundary exists, not its
complete implementation specification.
