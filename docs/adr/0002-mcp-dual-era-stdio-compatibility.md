# ADR 0002: MCP Dual-Era stdio Compatibility

- Status: Accepted
- Date: 2026-08-09
- Supersedes: ADR 0001 only for protocol-era/version negotiation and compatibility

## Context

ADR 0001 fixed the first MCP implementation to modern MCP `2026-07-28`. That keeps the lifecycle
small but excludes installed Servers using the legacy `initialize` /
`notifications/initialized` lifecycle. The current MCP specification defines a controlled
modern-first compatibility path, but fallback must not become an unrestricted timeout downgrade or
leak probe state into a second lifecycle.

## Decision

CtrlZebra supports a user-visible per-Server mode with the closed values `modern-only` and `dual`.
Existing version 1 settings remain modern-only. Dual behavior requires explicit migration to version 2
and explicit selection; upgrades never broaden an existing Server silently.

The decision is to retain modern-only as the strict option and add an explicitly selected dual mode.
Modern-only accepts only `2026-07-28`; dual supports exactly `2026-07-28` and `2025-11-25` over
local stdio. Dual uses a controlled modern-first compatibility path and never turns arbitrary
timeouts, malformed or unknown responses, overflow, cancellation, trust loss, or cleanup failure
into an unrestricted downgrade. Negotiated era is evidence of a completed handshake, not a new
authorization scope.

The complete negotiation matrix, configuration representation, projections, and failure behavior
are maintained in the [MCP contract](../mcp.md).

## Alternatives considered

- Remain modern-only: rejected as the only mode because it leaves compatible legacy Servers
  unusable; it remains available as the strict per-Server option.
- Enable dual silently for existing settings: rejected because it changes approved behavior on
  upgrade and hides timeout-triggered fallback.
- Support every historical revision or transport: rejected because the compatibility set must be
  closed, testable, and separately reviewed.
- Retry or respawn after a failed era: rejected because it would weaken cancellation, generation,
  cleanup, and user-visible approval guarantees.

## Consequences

CtrlZebra gains controlled interoperability with the two supported stdio eras without adding a
second runtime or an implicit downgrade path. The explicit mode, closed classification, and
single-attempt rule add compatibility tests and diagnostics, while preserving the same security,
projection, persistence, and recovery boundaries.

See [MCP](../mcp.md) for the current contract.
