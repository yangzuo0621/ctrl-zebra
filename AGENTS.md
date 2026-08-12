# CtrlZebra Agent Guidelines

These rules keep contributor and agent work scoped, verifiable, and architecturally consistent.

## 1. Scope and Sources of Truth

- Work on one roadmap task ID or standalone maintenance change at a time; verify and report it before
  starting another.
- `docs/implementation-plan.md` owns roadmap order, status, evidence, and execution point. Linked
  specifications under `docs/roadmap/phases/` own task goals, deliverables, tests, exclusions,
  prerequisites, and gates; completed specifications move to `docs/roadmap/archive/`.
- `docs/roadmap/product-foundation.md` owns product scope, baseline, module boundaries, contract map,
  product verification, and definition of done. Public entry points and domain documents own exact
  interfaces and schemas.
- Do not add unrelated maintenance, opportunistic refactors, speculative abstractions, dependency
  upgrades, or later-task work. Record non-blocking discoveries instead.

### 1.1 Progressive Document Loading

Read the roadmap index first for roadmap work, then only the matching rows below. Read a linked
section through its next same-level heading and direct references; load a whole domain document only
for cross-cutting work. Do not load completed phase archives by default.

| Work area | Required documents |
|---|---|
| Roadmap task | `docs/implementation-plan.md` and the linked active phase specification |
| Product scope or technical baseline | `docs/roadmap/product-foundation.md` |
| Code, config, or dependency | `docs/development.md`; add `docs/testing.md` for tests or logic |
| Extension lifecycle, disposal, adapters, or lazy initialization | Applicable section from [`Extension Lifecycle`](docs/architecture.md#extension-lifecycle) through [`Lazy Initialization`](docs/architecture.md#lazy-initialization) |
| Provider boundary or configuration | [`Model Provider Boundary`](docs/architecture.md#model-provider-boundary) and/or [`Provider Configuration Boundary`](docs/architecture.md#provider-configuration-boundary) |
| Core Tool lifecycle, context budgeting, history, or Session state | Applicable section from [`Tool Contract Boundary`](docs/architecture.md#tool-contract-boundary) through [`Session State Machine`](docs/architecture.md#session-state-machine) |
| Webview/Extension messages, Session/Run commands, or Tool DTOs | Applicable [`docs/protocol.md`](docs/protocol.md) section; add the owning Architecture section for runtime behavior |
| Workspace access, Tool I/O, approvals, commands, or checkpoints | Applicable section from [`Tool Input and Output`](docs/security.md#tool-input-and-output) through [`Checkpoint and restore boundary`](docs/security.md#checkpoint-and-restore-boundary) |
| Diagnostics, API keys, Provider endpoints, or credentials | Applicable section from [`Structured Diagnostic Logging`](docs/security.md#structured-diagnostic-logging) through [`Gemini API Key Entry`](docs/security.md#gemini-api-key-entry) |
| Webview state, components, styling, accessibility, or streaming | Applicable [`docs/webview.md`](docs/webview.md) section |
| Journeys, information architecture, feedback, hierarchy, or UX acceptance | Applicable [`docs/ux.md`](docs/ux.md) section; add the corresponding Webview constraints |
| Persistence, recovery, or checkpoints | Applicable [`docs/persistence.md`](docs/persistence.md) section; add [`Checkpoint and restore boundary`](docs/security.md#checkpoint-and-restore-boundary) for restore |
| MCP lifecycle, transport, or SDK isolation | [`Controlled MCP Client Boundary`](docs/architecture.md#controlled-mcp-client-boundary) and applicable MCP domain sections |
| CI, VSIX packaging, or release | `docs/ci.md`, `docs/packaging.md`, or `docs/release-checklist.md` as applicable |
| Implementation review | `docs/review-checklist.md` plus the reviewed task's required documents and declared scope |

Resolve conflicts by this ownership and the roadmap fact-ownership table; correct them through
change control.

### 1.2 Scope Limits and Maintenance

The product remains the desktop VS Code Extension authorized by the product foundation. Its
exclusions remain until that document and the roadmap change. Standalone maintenance must preserve
behavior, architecture, public contracts, persisted data, user behavior, and task order. Changes to
public APIs, protocols, Tool names, command IDs, persisted fields, configuration, module boundaries,
or baselines require change control first.

## 2. Universal Architecture Boundaries

Allowed dependency directions:

```text
webview ───────────────→ protocol
extension ─────────────→ protocol + core + providers + builtin-tools + mcp-client
providers ─────────────→ core contracts
builtin-tools ─────────→ core contracts + protocol DTOs
mcp-client ────────────→ core contracts
core ──────────────────→ protocol
testkit ───────────────→ core contracts + protocol
```

- `packages/core` is host- and vendor-independent: no VS Code, React, Webview, Node.js filesystem, or
  concrete model SDK. Inject model, Tool, approval, storage, clock, and ID capabilities through
  interfaces.
- SDK types and failures stay in `packages/providers`. `apps/extension` owns VS Code APIs, lifecycle,
  URI conversion, and composition; `extension.ts` remains registration-and-composition-only.
- `apps/webview` owns presentation and interaction only, never models, files, secrets, or VS Code
  commands. `packages/protocol` owns JSON-serializable boundary DTOs and Schemas; validate untrusted
  `unknown` before dispatch, persistence, or execution.
- `packages/builtin-tools` uses only Core contracts and Protocol DTOs; host adapters perform workspace
  operations. Among CtrlZebra packages, `packages/mcp-client` uses only Core contracts; its SDK types
  stay private while Extension owns real processes, configuration, Trust, and lifecycle.
- Use only public package entry points. Deep cross-package imports, cycles, and unowned abstractions
  are forbidden.
- Cancellation is not failure. Afterwards, emit no deltas, execute no Tools or retries, and create no
  side effects. Only the Core state machine changes Session status; Tools and callers never mutate
  status, continue the model loop, approve operations, or make UI decisions.

Architecture owns Provider, Tool, lifecycle, context, and state-machine behavior; `docs/protocol.md`
owns wire and Tool DTO contracts.

## 3. Security and Resource Red Lines

- Treat Webview input, model output, Tool arguments, persisted data, and summaries as untrusted.
- Keep workspace targets as host-boundary URIs. Require the selected root, validate scheme and
  authority by segments, canonicalize with a host-owned symlink-aware operation, and reject access
  without established identity and containment.
- Reject binary workspace content. Enforce bounded reads, searches, logs, context, command output,
  and the global serialized Tool Result limit before constructing unbounded values.
- Writes and commands require expiring, single-use approval for the exact immutable operation;
  material change, retry, cancellation, consumption, or reuse invalidates it.
- Represent commands as an executable and ordered arguments; spawn directly without a shell. Require
  a trusted workspace, canonical selected-workspace cwd, minimal environment, bounded time/output,
  and full process-tree termination. Immediately before side effects, re-check trust, approval,
  scope, cwd, and the operation; disable writes and commands in untrusted workspaces.
- Store API keys only in VS Code `SecretStorage`; never put secrets or authorization data in Webview
  state, logs, diagnostics, persisted messages, fixtures, snapshots, or commits.
- Long-running work accepts an `AbortSignal`. Timers, listeners, streams, processes, registrations,
  and unobserved promises require explicit ownership and idempotent cleanup.
- Keep timeout, cancellation, spawn failure, non-zero exit, cleanup failure, and unconfirmed
  termination distinguishable.

`docs/security.md` owns exact workspace, approval, command, checkpoint, logging, and credential rules.

## 4. Task Workflow

### 4.1 Before Implementation

1. Check `git status` and preserve all user changes.
2. For roadmap work, locate the current task and read its active phase plus applicable Section 1.1
   documents. For maintenance, confirm Section 1.2 applies and no active task overlaps it.
3. Confirm prerequisites, planned files, exclusions, public-contract impact, and validation commands.
4. Complete the Reuse Before Build audit, then any applicable Build vs Buy decision below.
5. Use Context7 for current library, framework, SDK, API, CLI, or cloud-service documentation.
6. Stop and explain ambiguity that would materially change the implementation.

#### 4.1.1 Reuse and Build vs Buy Decisions

- Before adding an implementation or test fake, follow
  [`Reuse Before Build`](docs/development.md#reuse-before-build), record existing candidates, and
  reuse or deepen the owning module. A second implementation requires a deepening assessment; a
  third equivalent implementation is blocked without distinct ownership or semantics.
- Prefer one deep module over copied helpers or repository-wide utilities. Replacement removes
  superseded implementations and tests instead of layering.

- For general-purpose mechanisms, repeated infrastructure, or dependency changes, follow
  [`Build vs Buy`](docs/development.md#build-vs-buy) and record the decision in the task plan.
- CtrlZebra owns policy, authorization, lifecycle, state, security, budgets, cancellation,
  persistence compatibility, and stable errors. Use maintained mechanisms only when they reduce
  total maintenance, remain behind CtrlZebra-owned interfaces, and preserve those boundaries.
- Task agents may recommend but not adopt dependencies outside confirmed scope or Section 5
  authorization. Review agents use `docs/review-checklist.md` and report missing evidence or
  unjustified repeated infrastructure.

For roadmap work, post the Current Task, Reuse Audit, Build vs Buy, Test Plan, and Constraint Gate
sections from `docs/roadmap/task-template.md`. For maintenance, post:

```md
### Maintenance Change

- Goal:
- Reason:
- Scope:
- Planned files:
- Public-contract impact: None
- Explicitly excluded:
- Build vs Buy triggers: None / explain
- Build vs Buy decision and evidence: Not applicable / explain
- Reuse Audit: Search terms, locations, candidates, and decision
- Verification:
```

### 4.2 Implementation, Verification, and Reporting

- Change only confirmed files; preserve unrelated work and formatting. Add no dependency,
  abstraction, exception, ignore, or deferral without a current use case and explicit owner.
- New logic needs risk-appropriate tests for the normal path, an important boundary, and an expected
  failure; defects need a regression test. Follow `docs/testing.md`.
- Verify from narrow to broad: direct checks, affected package types/tests, repository checks, then
  required smoke tests.
- Finish with `git diff --check`, `git status --short`, and final diff review. Report checks that could
  not run; never claim an unexecuted check passed.
- Use the roadmap template's completion section. For maintenance, replace `Task` with `Maintenance`,
  omit `Next task`, report, and stop.

## 5. Git and Change Control

- `main` is protected. Fetch before each task and branch as `codex/...` from the exact latest remote
  commit. Changes reach `main` only through a reviewed, squash-merged PR; never push or merge there.
- Never overwrite, clean, relocate, or discard user changes to update the base. Do not mix tasks,
  unrelated maintenance, formatting, or dependency upgrades in one commit or PR.
- Roadmap commit and squash titles include the task ID. Maintenance uses its Issue number or a clear
  conventional title.
- Without explicit user authorization, do not stage, commit, push, create a PR, rewrite history,
  merge, delete branches, or clean the workspace. Never use `git reset --hard`, force-push, or other
  destructive operations without authorization for the exact target and scope.
- Never commit secrets, build output, coverage, caches, temporary files, or private editor state.

Before changing a module boundary, technical baseline, task order, acceptance criterion, persisted
format, security model, or cross-module contract:

1. Present concrete evidence and at least one alternative with its impact.
2. Obtain direction.
3. Update the authoritative roadmap index, phase specification, product foundation, and an ADR when
   the decision has long-term architectural consequences.
4. Then change and verify the code.

Do not use an ADR for ordinary implementation details or use “cleanup” to bypass change control.
