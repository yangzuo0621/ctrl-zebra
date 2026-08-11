# ADR 0003: Provider Credential Lifecycle Boundary

- Status: Accepted
- Date: 2026-08-11
- Task: T1604

## Context

The Provider configuration boundary already keeps API keys in Extension-owned `SecretStorage` and
T1601 exposes password-masked save commands for the three supported Providers. T1604 adds deletion
and rotation. The existing Security and Architecture contracts specified the SecretStorage adapter
but did not define the user-facing command surface, the no-read delete confirmation, the replacement
commit boundary, presence-only status, or the race behavior of overlapping commands. The official
VS Code API also does not promise idempotent delete or transactional failure semantics.

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
  the Secret before confirmation. A cancellation before any storage call guarantees no side effect.
  After confirmation it asks the existing Host-owned presence adapter once, which compares the
  unavoidable `SecretStorage.get` result only with `=== undefined` and immediately discards it. An
  `absent` result (fulfilled `get` with `undefined`) produces a fixed no-op and does not call
  `ApiKeySecretStorage.delete`; a `present` result (fulfilled `get` with a non-`undefined` value)
  permits exactly one adapter delete call. A rejected `get` is `unavailable`, never absent: no delete
  or rotate mutation is invoked, and the command returns indeterminate with fixed safe retry/settings
  guidance. The official API does not promise idempotent delete; a fulfilled adapter call is a
  completed command outcome and a rejected call is indeterminate, followed by presence-only
  reconciliation and fixed safe retry/settings guidance.
- Rotation uses a new password-masked input with no prefill. It invokes the existing
  `ApiKeySecretStorage.save` once after validation. It first asks the presence adapter; `present` or
  `absent` permits that one save, while `unavailable` invokes no rotation mutation and returns fixed
  safe indeterminate retry/settings guidance. A fulfilled adapter save is the replacement commit
  boundary; a rejected call is indeterminate because the official API only promises `Thenable<void>`
  and offers no transaction, compare-and-swap, or rollback guarantee. The command does not read the
  Secret, compensate, or claim that the old value remains; it performs presence-only reconciliation
  and gives fixed safe retry/settings guidance. Cancellation before the adapter call guarantees no
  side effect; once the call starts, it cannot be reported as a reversible cancellation.
- Save, delete, rotate, and presence operations are serialized per Provider from prompt start through
  mutation settlement, presence-only reconciliation, and result notification, including T1603 status
  reads. The queue is released only after settlement and reconciliation. It stores only promises;
  different Provider queues are independent. Disposal or an obsolete generation closes the result
  gate: late settlements are still observed for idempotent cleanup but cannot emit notifications,
  Webview status, or logs. The underlying SecretStorage Thenable is not cancellable.
- Presence/status paths use an internal tri-state projection: `present` only for fulfilled non-`undefined`,
  `absent` only for fulfilled `undefined`, and `unavailable` for rejection. `unavailable` never maps
  to false; T1603's public Boolean-only status uses its safe failure/retain-last-projection path (or
  emits no replacement). The adapter receives the unavoidable `get` string only transiently, compares
  it with `=== undefined`, immediately discards it, and never returns/inspects/logs length, prefix,
  suffix, hash, or content at the caller boundary.

## Alternatives considered

### Add delete and rotate actions to T1603 Webview onboarding

Rejected. It would expand a presentation-only boundary with credential lifecycle intents, increase
the number of paths that can trigger SecretStorage writes, and require Protocol/Webview contract
changes. Command Palette workflows are already discoverable and preserve the Host-only authority.

### Read/delete/store during rotation

Rejected. Clearing the old value before the new write introduces a known missing state before the
replacement request settles and cannot be repaired safely when the write is rejected. A single
`ApiKeySecretStorage.save` is the only available replacement operation; it maps to one underlying
`SecretStorage.store`, whose fulfilled result is treated as the commit boundary while a rejected
result remains indeterminate because the API has no rollback guarantee.

### Use one global queue for all Providers

Rejected. It would make an unrelated OpenAI operation block Gemini or OpenAI-Compatible without
improving same-Provider race safety. Per-Provider queues provide the required ordering with a
smaller user-visible impact.

## Consequences

- The command IDs and their titles are public Extension contribution contracts and must remain stable.
- Tests must cover pre-side-effect cancellation, fulfilled and rejected adapter calls (including the
  indeterminate outcome and presence-only reconciliation), absent-key delete no-op without an adapter
  delete call, concurrent same-Provider save/delete/rotate/presence commands through settlement and
  reconciliation, disposal/generation late-settlement suppression, and inspection of all
  user-facing/logged text for credential leakage.
- No Protocol, Webview, Core, Provider SDK, or persisted-data changes are required for T1604.
- Any future lifecycle surface outside Host commands requires a new change-control decision.

## Reviewed primary references

- [VS Code Extension API: SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)
- [VS Code Extension API: showInputBox](https://code.visualstudio.com/api/references/vscode-api#window.showInputBox)
- [VS Code Extension API: showWarningMessage](https://code.visualstudio.com/api/references/vscode-api#window.showWarningMessage)

These official references were resolved and queried through Context7 on 2026-08-11. The API
specifies `undefined` for dismissed input, `undefined` for an unselected message item, and
`SecretStorage.get` returning `undefined` for an absent key. `store` and `delete` only promise
`Thenable<void>`; they do not provide transaction, compare-and-swap, rollback, or post-rejection
state guarantees. T1604 therefore treats only a fulfilled call as a commit/absence observation and
handles rejected calls as indeterminate with presence-only reconciliation.
