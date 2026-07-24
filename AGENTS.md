# CtrlZebra Agent Guidelines

These rules apply to every developer and coding agent in this repository. Keep work scoped,
verifiable, and consistent with CtrlZebra's architecture.

## 1. Operating Model and Sources of Truth

- Work on exactly one roadmap task ID or one standalone maintenance change at a time. Stop after
  verification and reporting; do not start another item automatically.
- `docs/implementation-plan.md` is the authoritative roadmap entry point and owns task order,
  status, completion evidence, and the current execution point.
- The linked active phase specification owns each task's goal, deliverables, tests, exclusions,
  prerequisites, and phase gate. Active and planned phases live under `docs/roadmap/phases/`;
  completed specifications live under `docs/roadmap/archive/`.
- `docs/roadmap/product-foundation.md` owns the first-phase product scope, technical baseline,
  module boundaries, interface drafts, test layers, and definition of done.
- Do not expand work through opportunistic refactoring, speculative abstractions, dependency
  upgrades, or later-task changes.

### 1.1 Progressive Document Loading

Read the roadmap index first for roadmap work, then only the rows below that match the task. Do not
load every domain document or completed phase archive by default.

| Work area | Required documents |
|---|---|
| Roadmap task | `docs/implementation-plan.md` and the linked active phase specification |
| Product scope or technical baseline | `docs/roadmap/product-foundation.md` |
| Any code, config, or dependency change | `docs/development.md`; add `docs/testing.md` when tests or logic change |
| Core, Provider, Extension lifecycle, context budgeting | `docs/architecture.md` |
| Webview/Extension messages or Tool DTOs | `docs/protocol.md`; add `docs/architecture.md` for runtime ownership |
| Workspace access, approval, commands, checkpoints, secrets, logging | `docs/security.md` |
| Webview state, components, styling, accessibility, streaming | `docs/webview.md` |
| Persistence or recovery | `docs/persistence.md`; add `docs/security.md` for checkpoint restore |
| CI, VSIX packaging, or release | `docs/ci.md`, `docs/packaging.md`, or `docs/release-checklist.md` as applicable |

When documents conflict, use the ownership above and the roadmap's fact-ownership table. Correct
the conflict through change control rather than choosing the convenient rule.

### 1.2 Scope Limits and Maintenance

Phase 1 remains limited to the desktop VS Code Extension in the product foundation. Unless the
product foundation and roadmap are updated first, it excludes multi-agent features, MCP, browser
automation, automatic Git commits or PRs, SQLite, vector databases, semantic indexes, Web
Extensions, and cloud accounts, sync, or telemetry backends.

A small behavior-preserving cleanup may be a standalone maintenance change only when it does not
change architecture, public contracts, persisted data, user behavior, or task order. Keep
pre-existing unrelated maintenance out of a roadmap task. Public API, protocol, tool name, command
ID, persisted field, configuration, module-boundary, or baseline changes require the owning roadmap
document and, when appropriate, an ADR to change first.

## 2. Universal Architecture Boundaries

Allowed dependency directions:

```text
webview ───────────────→ protocol
extension ─────────────→ protocol + core + providers + builtin-tools
providers ─────────────→ core contracts
builtin-tools ─────────→ core contracts + protocol DTOs
core ──────────────────→ protocol
testkit ───────────────→ core contracts + protocol
```

- `packages/core` remains host- and vendor-independent. It must not depend on VS Code, React,
  Webview code, the Node.js filesystem, or a concrete model SDK.
- Inject model, tool, approval, storage, clock, and ID capabilities through interfaces. Provider SDK
  types and failures remain private to `packages/providers`.
- `apps/extension` owns VS Code APIs, lifecycle, URI conversion, and dependency composition.
  `extension.ts` stays limited to registration and composition.
- `apps/webview` owns presentation and user interaction only. It does not access models, files,
  secrets, or VS Code commands directly.
- `packages/protocol` owns JSON-serializable cross-boundary DTOs and Schemas. Accept untrusted
  boundary input as `unknown` and validate it before dispatch, persistence, or execution.
- `packages/builtin-tools` depends only on Core contracts and Protocol DTOs; host adapters perform
  workspace operations.
- Import packages only through declared public entry points. Cross-package deep imports and
  circular dependencies are forbidden.
- Cancellation is a distinct outcome, not an ordinary Provider or Tool failure. No deltas, tools,
  retries, or side effects may occur after cancellation.
- Session status changes go through the Core state machine. Tools and callers never mutate status,
  continue the model loop, approve operations, or make UI decisions themselves.

Detailed Provider, Tool, lifecycle, context-budget, and state-machine contracts live in
`docs/architecture.md`; wire and Tool DTO ownership lives in `docs/protocol.md`.

## 3. Security and Resource Red Lines

- Treat Webview input, model output, Tool arguments, persisted data, and summaries as untrusted.
- Preserve workspace targets as URIs at the host boundary. Require the explicitly selected root,
  validate scheme and authority by segments, canonicalize through a host-owned symlink-aware
  operation, and reject access when canonical identity or containment cannot be established.
- Reject binary workspace content and enforce bounded reads, searches, logs, context, command
  output, and the global serialized Tool Result limit before constructing unbounded values.
- File writes and commands require approval bound to the exact immutable operation. Approval is
  expiring, single-use, and invalid after any material change, retry, cancellation, or consumption.
- Commands model an executable and ordered arguments separately and use direct spawn with shell
  interpretation disabled. They require a trusted workspace, canonical selected-workspace cwd,
  minimal environment, bounded timeout/output, and full process-tree termination.
- Disable file writes and commands in untrusted workspaces. Re-check trust, approval, scope, cwd,
  and bound operation immediately before side effects.
- Store API keys only in VS Code `SecretStorage`. Never place secrets or authorization data in
  Webview state, logs, diagnostics, persisted messages, snapshots, fixtures, or commits.
- Long-running work accepts an `AbortSignal`. Timers, listeners, streams, processes, registrations,
  and unobserved promises require an explicit owner and idempotent cleanup.
- Keep timeout, cancellation, spawn failure, non-zero exit, cleanup failure, and unconfirmed
  termination distinguishable.

`docs/security.md` is authoritative for the exact workspace, approval, command, checkpoint, logging,
and credential contracts.

## 4. Task Workflow

### 4.1 Before Implementation

1. Check `git status` and preserve all existing user changes.
2. For roadmap work, locate the current task through the roadmap index and read its linked active
   phase context plus only the applicable documents from Section 1.1.
3. For standalone maintenance, confirm Section 1.2 applies and that no active task overlaps it.
4. Confirm prerequisites, planned files, exclusions, public-contract impact, and validation commands.
5. Fetch current documentation through Context7 when work involves a library, framework, SDK, API,
   CLI, or cloud service.
6. Stop and explain ambiguity that would materially change the implementation.

For roadmap work, use `docs/roadmap/task-template.md` and post its Current Task and Test Plan before
implementation. For standalone maintenance, post:

```md
### Maintenance Change

- Goal:
- Reason:
- Scope:
- Planned files:
- Public-contract impact: None
- Explicitly excluded:
- Verification:
```

### 4.2 Implementation and Verification

- Change only files required by the confirmed scope. Preserve unrelated user work and formatting.
- Add no dependency, abstraction, exception, ignore, or deferred task without a current use case and
  an explicit owner.
- Record non-blocking discoveries instead of fixing them opportunistically.
- New logic needs risk-appropriate tests for the normal path, an important boundary, and an expected
  failure. Add a regression test for defects. Follow `docs/testing.md`.
- Run checks from fastest and narrowest to broader repository checks: direct verification, affected
  package types/tests, then established repository-wide checks and required smoke tests.
- Finish with `git diff --check`, `git status --short`, and final diff review. Never claim an
  unexecuted check passed; report anything that could not run and why.

Use the completion section in `docs/roadmap/task-template.md` for roadmap tasks. For maintenance,
replace `Task` with `Maintenance` and omit `Next task`. Stop after reporting.

## 5. Git and Integration Workflow

- `main` is protected. Before every task or maintenance change, fetch and confirm the latest remote
  `main`, then create a dedicated `codex/...` branch from that exact commit.
- Never overwrite, clean, relocate, or discard existing user changes merely to update the base.
- Do not mix multiple tasks, unrelated maintenance, formatting, or dependency upgrades in one
  commit or PR.
- Roadmap commit and squash titles include the task ID. Standalone maintenance uses an Issue number
  when one exists or a clear conventional title otherwise.
- All changes reach `main` through a reviewed Pull Request and squash merge. Do not merge or push
  directly to `main`.
- Do not stage, commit, push, create a PR, rewrite history, merge, delete branches, or clean the
  workspace unless the user explicitly requests that action.
- Never use `git reset --hard`, force-push, or another destructive operation unless the user
  explicitly authorizes the exact target and scope.
- Never commit secrets, build output, coverage, caches, temporary files, or private editor state.

## 6. Change Control

When implementation requires changing a module boundary, technical baseline, task order,
acceptance criterion, persisted format, security model, or cross-module contract:

1. Present concrete evidence and at least one alternative with its impact.
2. Obtain direction.
3. Update the authoritative roadmap index, phase specification, product foundation, and ADR when
   the decision has long-term architectural consequences.
4. Then change and verify the code.

Do not use an ADR for ordinary implementation details, and do not use “cleanup” to bypass roadmap
change control.
