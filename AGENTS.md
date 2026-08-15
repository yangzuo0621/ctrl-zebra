# CtrlZebra Agent Constitution and Document Router

These rules keep work scoped, verifiable, and consistent with the product and architecture owners. The
linked owner documents contain detailed policy; this file is the concise universal constitution.

## 1. Scope and sources of truth

- Work on exactly one roadmap task or standalone maintenance change at a time. Preserve behavior,
  architecture, security, public contracts, persisted data, user behavior, and roadmap order.
- The product remains the desktop VS Code Extension authorized by
  [the product foundation](docs/roadmap/product-foundation.md). Do not add unrelated maintenance,
  refactors, dependencies, later-task work, or scope expansion.
- `docs/implementation-plan.md` is the hot roadmap index: order, active/pending status, counts,
  progress summary, current/next task, active-spec links, and the completed-history link only. Active
  task specifications own goals, deliverables, tests, exclusions, prerequisites, and gates; completed
  task status/PR/date records and specifications live under `docs/roadmap/archive/`.
- Domain documents own exact architecture, protocol, security, persistence, UX, webview, CI, packaging,
  and release rules. Public entry points and domain documents own exact interfaces and schemas.
  Resolve conflicts by this ownership map and use change control to correct the source.

### Progressive document loading

Start with only the documents needed for the work:

| Work area | Read first |
|---|---|
| Roadmap task | `docs/implementation-plan.md`, then the linked active phase section |
| Product scope/baseline | `docs/roadmap/product-foundation.md` |
| Code/config/dependency | `docs/development.md`; add `docs/testing.md` for tests or logic |
| Lifecycle/providers/tools/session | The applicable anchored section in `docs/architecture/` |
| Webview/protocol/UX | The applicable section of `docs/protocol.md`, `docs/webview.md`, or `docs/ux.md` |
| Workspace, approvals, commands, credentials | The applicable anchored section of `docs/security.md` |
| Persistence/checkpoints | `docs/persistence.md` plus the checkpoint/restore security section |
| MCP | `docs/architecture/mcp-client.md` and the applicable MCP domain section |
| CI/packaging/release | `docs/ci.md`, `docs/packaging.md`, or `docs/release-checklist.md` |
| Implementation review | `docs/review-checklist.md` and only the reviewed task's required documents |

Do not load completed history or whole cold-domain documents for routine execution when an anchored
section is sufficient. Use Context7 for current library, framework, SDK, API, CLI, or cloud-service
documentation; it supplements, and does not replace, repository owner documents.

## 2. Architecture and dependency constitution

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

- `packages/core` is host- and vendor-independent: no VS Code, React/Webview, Node filesystem, or
  concrete model SDK. Inject model, Tool, approval, storage, clock, and ID capabilities through
  interfaces.
- SDK types/failures stay in `packages/providers`; the Extension owns VS Code APIs, URI conversion,
  lifecycle, and composition. `extension.ts` remains registration/composition-only.
- Webview owns presentation/interaction only, never models, files, secrets, or VS Code commands.
  Protocol owns JSON-serializable boundary DTOs/Schemas and validates untrusted `unknown` before
  dispatch, persistence, or execution.
- Builtin tools use Core contracts and Protocol DTOs; host adapters perform workspace operations.
  MCP SDK types remain private while Extension owns processes, configuration, Trust, and lifecycle.
- Use public package entry points only. No deep cross-package imports, cycles, or unowned abstractions.
- Cancellation is not failure: after cancellation emit no deltas, execute no Tool/retry, and create no
  side effect. Only the Core state machine changes Session status; Tools/callers do not mutate status,
  continue loops, approve operations, or make UI decisions.

## 3. Security and resource red lines

- Treat Webview input, model output, Tool arguments, persisted data, and summaries as untrusted.
- Workspace targets stay host-boundary URIs. Require the selected root; validate scheme and authority
  by segments; canonicalize with the host's symlink-aware operation; and reject missing identity or
  containment.
- Reject binary workspace content. Bound reads, searches, logs, context, command output, and the
  global serialized Tool Result before constructing unbounded values.
- Writes and commands require an expiring, single-use approval for the exact immutable operation;
  material change, retry, cancellation, consumption, or reuse invalidates it.
- Commands are an executable plus ordered arguments, spawned directly without a shell, from a trusted
  workspace with canonical selected-workspace cwd, minimal environment, bounded time/output, and full
  process-tree termination. Immediately before side effects re-check trust, approval, scope, cwd, and
  operation; disable writes/commands in untrusted workspaces.
- Store API keys only in VS Code `SecretStorage`; never put secrets or authorization data in Webview
  state, logs, diagnostics, persisted messages, fixtures, snapshots, or commits.
- Long-running work accepts an `AbortSignal`; timers, listeners, streams, processes, registrations,
  and unobserved promises have explicit ownership and idempotent cleanup. Distinguish timeout,
  cancellation, spawn failure, non-zero exit, cleanup failure, and unconfirmed termination.
- Preserve checkpoint/restore safety, MCP security/lifecycle ownership, bounded resource rules, and
  exact approval semantics in their owning documents.

## 4. Task workflow and evidence

1. Check `git status`; confirm the task/scope, prerequisites, exclusions, contracts, and validation
   commands before editing. Do not overlap another active task.
2. Complete the [Reuse Before Build](docs/development.md#reuse-before-build) audit before adding an
   implementation, fake, wrapper, interface, helper, error, constant, or mechanism.
   `TARGETED` is the default; `FULL` is Executor-only under the documented triggers; `ESCALATED
   FULL` is Reviewer-only under its existing escalation conditions. Record tier-appropriate evidence
   in the task execution, handoff, or PR.
3. Apply [Build vs Buy](docs/development.md#build-vs-buy) before a documented general-purpose trigger.
   CtrlZebra retains policy, authorization, lifecycle, state, budgets, cancellation, persistence
   compatibility, security gates, and stable errors. Do not adopt a dependency outside confirmed scope.
4. Validate from narrow to broad: affected direct checks, package tests/types, repository checks, and
   required smoke tests. Follow `docs/testing.md`; finish with `git diff --check`, `git status
   --short`, and a final diff review. Report unrun checks.
5. Use the compact [task template](docs/roadmap/task-template.md) for transient execution, handoff, and
   PR evidence. Do not copy execution logs or detailed audits into the implementation index.

Reviewers start from the compact Review Handoff, exact current PR diff/revision, and acceptance criteria.
They open extra documents only for a touched contract, material handoff claim, concrete concern, or
documented similarity escalation. The Reviewer is read-only and the only implementation-quality gate;
Finalizer is transactional and never reopens implementation review.

## 5. Git, authorization, and destructive actions

- `main` is protected. Changes reach it only through a reviewed, squash-merged PR. Fetch before a
  roadmap task and create the dedicated `codex/...` branch from the exact latest remote revision.
- Without explicit authorization, do not stage, commit, push, create/update a PR, merge, delete a
  branch, rewrite history, or clean the workspace. AUTO_DRAFT/AUTO_FULL meanings and authorization
  envelopes are owned by [auto-workflow](.agents/skills/auto-workflow/SKILL.md); do not broaden them.
- Keep changes task-scoped; never commit secrets, build output, coverage, caches, temporary files, or
  private editor state. Never use `git reset --hard`, force-push, or destructive cleanup without
  explicit authorization for the exact target and scope.
- Do not overwrite, discard, relocate, or clean user changes. A reviewer never edits implementation,
  plan, PR state, or task status; no role self-approves. Preserve exact revision freshness and
  invalidate approval after any implementation change.

## 6. Change control and stop conditions

Before changing a module boundary, technical baseline, task order, acceptance criterion, persisted
format, security model, public contract, or cross-module contract:

1. Present concrete evidence and at least one alternative with its impact.
2. Obtain direction.
3. Update the authoritative roadmap/domain documents and an ADR when the decision is long-lived.
4. Only then implement and verify.

Stop and report instead of guessing for a security/architecture conflict, public/runtime or persisted
contract change, roadmap reorder/acceptance change, AUTO authorization change, Reviewer bypass,
dependency introduction, deleted historical evidence, unresolved conflicting sources of truth, or
required scope expansion. Record non-blocking discoveries in the owning document or engineering
opportunity ledger; do not implement them opportunistically.
