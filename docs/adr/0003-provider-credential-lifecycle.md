# ADR 0003: Provider Credential Lifecycle Boundary

- Status: Accepted
- Date: 2026-08-11
- Task: T1604

## Context

The Provider configuration boundary already keeps API keys in Extension-owned `SecretStorage` and
T1601 exposes password-masked save commands for the three supported Providers. T1604 adds deletion
and rotation. The existing Security and Architecture contracts specified the SecretStorage adapter
and idempotent deletion, but did not define the user-facing command surface, the no-read delete
confirmation, the replacement commit boundary, presence-only status, or the race behavior of
overlapping commands.

The product foundation already authorizes save, delete, and rotation of the three Provider
credentials. This decision does not add a Provider, a Webview capability, a Protocol message, a
settings field, or a new package boundary.

## Decision

- Expose one stable delete command and one stable rotate command for each supported Provider:
  `ctrlZebra.deleteOpenAIApiKey`, `ctrlZebra.deleteGeminiApiKey`,
  `ctrlZebra.deleteOpenAICompatibleApiKey`, `ctrlZebra.rotateOpenAIApiKey`,
  `ctrlZebra.rotateGeminiApiKey`, and `ctrlZebra.rotateOpenAICompatibleApiKey`.
- Keep all lifecycle commands in `apps/extension`. They are contributed to the Command Palette and
  owned by `ExtensionContext.subscriptions`; no lifecycle intent enters Protocol or Webview and
  T1603 Onboarding remains unchanged.
- Delete confirmation names only the Provider and generic consequence. The command does not read
  the Secret before confirmation, and `SecretStorage.delete` remains idempotent when no value exists.
- Rotation uses a new password-masked input with no prefill. It invokes `SecretStorage.store` once
  after validation, without a preceding read/delete. A successful store is the replacement commit
  boundary; a rejected store is a failure and the old value remains authoritative.
- Save, delete, and rotate operations are serialized per Provider from prompt start through result
  notification. The queue stores only promises. Different Provider queues are independent.
- Presence/status paths use a dedicated boolean projection. They never return or inspect Secret
  length, prefix, suffix, hash, or other derived data at the caller boundary.

## Alternatives considered

### Add delete and rotate actions to T1603 Webview onboarding

Rejected. It would expand a presentation-only boundary with credential lifecycle intents, increase
the number of paths that can trigger SecretStorage writes, and require Protocol/Webview contract
changes. Command Palette workflows are already discoverable and preserve the Host-only authority.

### Read/delete/store during rotation

Rejected. Clearing the old value before the new write would lose a working credential when the write
fails. A single `SecretStorage.store` is the only available replacement operation; its fulfilled
result is treated as the commit boundary.

### Use one global queue for all Providers

Rejected. It would make an unrelated OpenAI operation block Gemini or OpenAI-Compatible without
improving same-Provider race safety. Per-Provider queues provide the required ordering with a
smaller user-visible impact.

## Consequences

- The command IDs and their titles are public Extension contribution contracts and must remain stable.
- Tests must cover cancellation, storage failure, absent-key deletion, concurrent same-Provider
  commands, and inspection of all user-facing/logged text for credential leakage.
- No Protocol, Webview, Core, Provider SDK, or persisted-data changes are required for T1604.
- Any future lifecycle surface outside Host commands requires a new change-control decision.

## Reviewed primary references

- [VS Code Extension API: SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)
- [VS Code Extension API: showInputBox](https://code.visualstudio.com/api/references/vscode-api#window.showInputBox)
- [VS Code Extension API: showWarningMessage](https://code.visualstudio.com/api/references/vscode-api#window.showWarningMessage)

These official references were resolved and queried through Context7 on 2026-08-11. The API
specifies `undefined` for dismissed input, `undefined` for an unselected message item, and
`SecretStorage.get` returning `undefined` for an absent key; it does not provide a compare-and-swap
operation, so T1604 keeps replacement atomic at the single fulfilled `store` call boundary.
