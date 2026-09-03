# ADR 0003: Provider Credential Lifecycle Boundary

- Status: Accepted

## Context

Provider API keys belong in Extension-owned VS Code `SecretStorage`. Users need explicit save, delete,
and rotation commands without exposing credential values to Protocol, Webview, logs, or persisted
data. SecretStorage provides asynchronous `store`, `get`, and `delete` operations but does not
promise transactions, compare-and-swap, rollback, or idempotent deletion.

## Decision

Keep credential lifecycle commands in `apps/extension`, exposed through the Command Palette. Provide
stable save, delete, and rotate commands for OpenAI, Gemini, and OpenAI-compatible Providers. Delete
confirmation names only the Provider and generic consequence; it does not read the Secret. After
confirmation, presence is checked once and projected only as `present`, `absent`, or `unavailable`.
An absent key is a no-op, a rejected presence read is indeterminate, and a delete is attempted only
for a present key.

Rotation uses a fresh password-masked input and one save call, including when no previous key exists.
A fulfilled save or delete is the operation's commit boundary. Rejected storage calls remain
indeterminate and receive safe retry/settings guidance; the command never claims rollback or that an
old value remains. Credential values are compared only for presence and immediately discarded.

Save, delete, rotate, and presence operations are serialized per Provider through storage settlement
and reconciliation. Disposal or an obsolete generation suppresses late user-visible results while
still observing the underlying operation for cleanup.

## Alternatives

- Put lifecycle actions in Webview: rejected because credential mutation is Host-only and would widen
  the presentation boundary.
- Delete before saving during rotation: rejected because a failed replacement would create a known
  missing state with no rollback guarantee.
- Use one global queue: rejected because unrelated Providers would block without improving same-Provider
  safety.

## Consequences

Command IDs and user-facing safety text are stable Extension contracts. Tests must cover cancellation
before side effects, fulfilled and rejected storage calls, absent-key deletion, same-Provider races,
late settlements, and credential redaction. Any credential lifecycle surface outside Host commands
requires a new change-control decision.

See [Security](../security.md) and [Configuration](../configuration.md) for current credential
boundaries and settings.
