# CtrlZebra Agent Constitution and Document Router

This file contains repository-wide invariants and routes agents to the authoritative documents for task-specific rules. Keep root context small: load detailed policy only when the work requires it.

## 1. Scope and sources of truth

- Work on exactly one roadmap task or one standalone maintenance change at a time.
- Preserve product scope, architecture, security, public contracts, persisted data, user behavior, and roadmap order unless change control explicitly authorizes otherwise.
- The product remains the desktop VS Code Extension defined by [`docs/product.md`](docs/product.md).
- Current product and domain documents describe the main branch. Work-item goals, acceptance criteria, exclusions, prerequisites, and verification belong to the Issue, PR, or transient task handoff; completed history is retained by Git, merged PRs, and the changelog.
- Domain documents own their respective architecture, protocol, security, persistence, UX, CI, packaging, and release rules.
- Public package entry points and domain documents own exact interfaces and schemas. Resolve conflicts through the owning source rather than duplicating policy elsewhere.

### Progressive document loading

Read only the documents required by the current work.

| Work area | Read first |
|---|---|
| Roadmap task or maintenance change | Issue/PR or transient task handoff, then the affected owner documents |
| Product scope/baseline | `docs/product.md` |
| Code/config/dependency | `docs/development.md`; add `docs/testing.md` when behavior or tests change |
| Core lifecycle/providers/tools/session | Applicable section under `docs/architecture/` |
| Webview/protocol/UX | Applicable section of `docs/protocol.md`, `docs/webview.md`, or `docs/ux.md` |
| Workspace/approvals/commands/credentials | Applicable section of `docs/security.md` |
| Persistence/checkpoints | `docs/persistence.md` plus applicable restore/security rules |
| MCP | `docs/mcp.md`; add `docs/security.md` for security-sensitive MCP changes |
| CI/packaging/release | `docs/ci.md`, `docs/packaging.md`, or `docs/release-checklist.md` |
| Implementation review | `docs/review-checklist.md` plus only documents required by the reviewed change |
| Auto workflow | `.agents/skills/auto-workflow/SKILL.md` and the dispatched role Skill |

Do not load completed history or whole domain documents when an applicable anchored section is sufficient.

Use current external library/framework/API documentation when necessary, but repository owner documents remain authoritative for CtrlZebra policy and architecture.

## 2. Architecture invariants

Allowed package directions are:

```text
webview ───────────────→ protocol
extension ─────────────→ protocol + core + providers + builtin-tools + mcp-client
providers ─────────────→ core contracts
builtin-tools ─────────→ core contracts + protocol DTOs
mcp-client ────────────→ core contracts
core ──────────────────→ protocol
testkit ───────────────→ core contracts + protocol
```

- `packages/core` remains host- and vendor-independent.
- SDK-specific types and failures remain inside provider boundaries.
- Extension code owns VS Code APIs, host lifecycle, URI conversion, and composition.
- Webview owns presentation and interaction only.
- Protocol owns JSON-serializable boundary contracts and validation of untrusted boundary data.
- MCP SDK implementation details remain private to the MCP boundary.
- Use public package entry points only. Do not introduce deep cross-package imports, dependency cycles, or unowned abstractions.
- Preserve Core ownership of Session state transitions and the lifecycle/cancellation guarantees defined by the applicable architecture documents.

## 3. Security and resource invariants

- Treat Webview input, model output, Tool arguments/results, persisted data, and summaries as untrusted.
- Workspace operations must remain confined to the selected canonical workspace root.
- Writes and commands require exact, expiring, single-use authorization for the immutable operation.
- Revalidate security-sensitive state immediately before side effects.
- Never execute commands through a shell unless an authoritative security design explicitly changes this rule.
- Never expose secrets outside approved secret storage or place them in logs, persisted messages, fixtures, snapshots, diagnostics, or commits.
- Bound externally influenced reads, searches, logs, context, Tool results, and command output before constructing unbounded values.
- Long-running operations must preserve cancellation, ownership, cleanup, and bounded-resource guarantees.
- Preserve checkpoint/restore and MCP security boundaries defined in their owning documents.

Read `docs/security.md` and the applicable domain document before modifying any of these mechanisms.

## 4. Development and verification

- Confirm task scope, acceptance criteria, prerequisites, exclusions, and affected contracts before editing.
- Follow [`Reuse Before Build`](docs/development.md#reuse-before-build) before introducing a new implementation, wrapper, abstraction, helper, fake, error, constant, or mechanism.
- Apply [`Build vs Buy`](docs/development.md#build-vs-buy) when its documented triggers apply.
- Keep implementation task-scoped. Do not opportunistically add unrelated maintenance, refactors, dependencies, or later-roadmap work.
- Validate from narrow to broad according to `docs/testing.md`: affected checks first, then required package/repository checks and smoke tests.
- Finish implementation work with `git diff --check`, `git status --short`, and a final diff review. Report required checks that were not run.
- Use the pull-request template and the selected workflow's handoff fields for task execution evidence; do not create a permanent task-spec or completion ledger in `docs/`.

Detailed Executor, Reviewer, Planner, AUTO, reuse-tier, review-loop, handoff, and closure behavior belongs to the applicable `.agents/skills/*/SKILL.md`, not this root file.

## 5. Git and authorization

- `main` is protected. Changes reach it only through the repository's approved PR process.
- Keep branches, commits, PRs, and status changes scoped to the assigned task.
- Do not stage, commit, push, create/update/merge a PR, delete branches, rewrite history, or clean the workspace unless the current request or selected workflow explicitly authorizes that operation.
- AUTO authorization profiles and their exact envelopes are owned exclusively by `.agents/skills/auto-workflow/SKILL.md`.
- Never overwrite, discard, relocate, or clean unrelated user changes.
- Never force-push, use destructive cleanup, or bypass branch protection without explicit authorization for that exact action and target.
- Do not invent Git, PR, CI, review, merge, or cleanup state; verify it.

## 6. Change control and stop conditions

Before changing a module boundary, technical baseline, roadmap order, acceptance criterion, persisted format, security model, public contract, or cross-module contract:

1. Identify the concrete evidence and affected owner.
2. Present the change and at least one viable alternative with impact.
3. Obtain direction when the existing authoritative sources do not already authorize the change.
4. Update the authoritative documentation and ADR when the decision is long-lived.
5. Only then implement and verify.

Stop and report rather than guess when work requires:

- an unauthorized architecture, security, public-contract, persistence, or roadmap change;
- scope expansion beyond the assigned task;
- an unapproved dependency introduction;
- bypassing an authorization or independent-review boundary;
- destructive treatment of unrelated user work;
- resolving contradictory authoritative sources without ownership guidance; or
- claiming repository, CI, review, PR, or runtime state that cannot be verified.

Record non-blocking discoveries in the appropriate owner document or engineering-opportunity mechanism rather than implementing them opportunistically.
