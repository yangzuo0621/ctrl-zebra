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

- `modern-only` accepts only `2026-07-28` and never sends legacy `initialize`.
- `dual` accepts exactly `2026-07-28` and `2025-11-25` over local stdio.
- Every dual attempt makes one bounded `server/discover` probe first.
- Only a specification-defined non-modern response or bounded probe timeout may enter one legacy
  `initialize` / `notifications/initialized` exchange.
- Recognized modern results and errors lock modern and never authorize fallback. Malformed or
  validation-failing values are `malformed-message`; structurally valid unknown or unclassified
  values are `protocol-incompatible`; overflow, cancellation, process exit, trust loss, and
  cleanup failure are terminal. None authorizes fallback.
- The probe is closed before fallback, late responses are rejected by the generation gate, and no
  capability is published before the selected complete handshake succeeds.
- Both eras use the same normalized startup identity, Workspace Trust, exact approval, process
  containment, generation fence, Tool approval, capability restrictions, cancellation, and cleanup.
  Negotiated era is evidence of a completed handshake, not a new authorization scope.

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
