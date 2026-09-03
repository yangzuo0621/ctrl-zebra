# ADR 0002: MCP Dual-Era stdio Compatibility

- Status: Accepted

## Context

The first MCP implementation was modern-only. Some installed local Servers still use the supported
legacy `initialize` / `notifications/initialized` lifecycle. Compatibility must remain explicit and
closed; it must not become an unrestricted timeout downgrade or leak probe state into a second
lifecycle.

## Decision

Expose a per-Server mode with only `modern-only` and `dual`. Existing version 1 settings remain
modern-only. Dual mode requires explicit migration to version 2 and explicit selection; an upgrade
never broadens an existing setting silently.

Modern-only accepts MCP `2026-07-28`. Dual supports exactly `2026-07-28` and `2025-11-25` over local
stdio through one controlled modern-first path. Arbitrary timeouts, malformed or unknown responses,
overflow, cancellation, trust loss, or cleanup failure never authorize fallback. Negotiated era is
evidence of a completed handshake, not a new authorization scope.

## Alternatives

- Remain modern-only: rejected as the only mode because compatible legacy Servers would be unusable;
  it remains available as the strict option.
- Enable dual silently: rejected because it changes approved behavior on upgrade.
- Support every historical revision or transport: rejected because the compatibility set must be
  closed, testable, and separately reviewed.
- Retry or respawn after a failed era: rejected because it weakens cancellation and cleanup rules.

## Consequences

CtrlZebra supports the two reviewed stdio eras without adding a second runtime or implicit downgrade
path. The explicit mode and closed failure classification preserve the existing security,
projection, persistence, and recovery boundaries.

See [MCP](../mcp.md) for the current compatibility matrix and failure behavior.
