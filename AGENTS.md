# CtrlZebra Agent Guidelines

These rules apply to every developer and coding agent working in this repository. They exist to keep changes scoped, verifiable, and consistent with CtrlZebra's architecture.

## 1. Source of Truth and Task Scope

- `docs/implementation-plan.md` is the single source of truth for implementation order, task scope, acceptance criteria, and phase gates.
- Work on exactly one roadmap task ID or one standalone maintenance change at a time. Stop after verification and reporting; do not start another item automatically.
- Before roadmap implementation, read the task's goal, deliverables, tests, exclusions, and prerequisites.
- Do not expand a task through opportunistic refactoring, speculative abstractions, dependency upgrades, or work intended for a later task.
- If implementation requires changing a module boundary, technical baseline, task order, or acceptance criterion, present the evidence and update the implementation plan before changing code.

Phase 1 is limited to the desktop VS Code extension capabilities listed in the implementation plan. Unless the plan is updated first, it excludes multi-agent or sub-agent features, MCP, browser automation, automatic Git commits or PRs, SQLite, vector databases, semantic code indexes, Web Extensions, and cloud accounts, sync, or telemetry backends.

### 1.1 Standalone Maintenance Changes

- `docs/implementation-plan.md` is a committed execution roadmap, not an inbox for every cleanup idea.
- A small, local, behavior-preserving maintenance change may use a dedicated branch and PR without becoming a roadmap task when it does not change architecture, public contracts, persisted data, user-facing behavior, or task ordering.
- If the maintenance is directly required by the current task and concerns code introduced or modified by that task, keep the smallest necessary change in the current task PR.
- If it concerns pre-existing code unrelated to the current task, use a separate maintenance PR; never mix it into the active task PR.
- Deferred optional maintenance does not need a roadmap entry. Create a GitHub Issue only when the work is valuable enough to track.
- A change that affects package public APIs, Webview/Extension protocol, tool names, VS Code command IDs, persisted fields, user configuration, module boundaries, or technical baselines is not minor maintenance. Update the implementation plan and, when appropriate, an ADR before implementation.
- Standalone maintenance PRs do not alter the implementation-plan task ledger unless they are explicitly accepted as roadmap work.

## 2. Architecture Boundaries

CtrlZebra uses a host-independent Agent Core, a VS Code Extension Host adapter layer, and a React Webview.

Allowed dependency directions:

```text
webview ───────────────→ protocol
extension ─────────────→ protocol + core + providers + builtin-tools
providers ─────────────→ core contracts
builtin-tools ─────────→ core contracts + protocol DTOs
core ──────────────────→ protocol
testkit ───────────────→ core contracts + protocol
```

Rules:

- `packages/core` must remain host-independent. It must not depend on `vscode`, React, Webview code, the Node.js filesystem, or a concrete model SDK.
- Inject model, tool, approval, storage, clock, and ID capabilities into Core through interfaces.
- `apps/extension` owns VS Code APIs, lifecycle, and dependency composition. Keep `extension.ts` limited to registration and composition, not business workflows.
- `apps/webview` owns presentation and user interaction only. It must not access models, the filesystem, `SecretStorage`, or VS Code commands directly.
- `packages/providers` adapts third-party model SDKs to the internal `ModelGateway`; SDK types must not leak into Core.
- `packages/builtin-tools` must not depend on `vscode`; Extension adapters perform workspace operations.
- Data crossing the Webview/Extension boundary or persistence boundary must be JSON-serializable and runtime-validated at the untrusted boundary.
- Packages may import other packages only through declared public entry points. Cross-package deep imports are forbidden.

Extension lifecycle red lines:

- Keep activation limited to lightweight registration and composition. Do not scan workspaces, access the network, initialize model clients, restore sessions, or start background work during module import or activation.
- Give every VS Code registration and long-lived resource exactly one `Disposable` owner. Put extension-lifetime registrations in `ExtensionContext.subscriptions`; track asynchronous cleanup separately because VS Code does not await asynchronous subscription disposal.
- Use the stable `ctrlZebra.<action>` namespace for command IDs. Treat a command rename as a public-contract change.
- Preserve `vscode.Uri` values at the host boundary. Convert them only inside an adapter with an explicit operating-system path requirement, and never use string-prefix checks for workspace containment.
- Keep VS Code types and host-specific lifecycle behavior inside `apps/extension` adapters. Initialize costly services lazily on first use with concurrency-safe failure cleanup.

## 3. Development Environment and Code Style

### 3.1 Environment

- On Windows, prefer PowerShell 7 (`pwsh`). Fall back to Windows PowerShell only when `pwsh` is unavailable or a command has a documented compatibility requirement, and report the reason.
- Use pnpm for workspace and dependency operations. Do not use npm or Yarn in this repository.
- Use current documentation rather than memory for libraries, frameworks, SDKs, APIs, CLI tools, and cloud services. Resolve the library in Context7 first, then query its documentation with the task's specific question.

### 3.2 TypeScript and Naming

- Use TypeScript strict mode.
- Accept external input as `unknown`, then validate or narrow it. Do not use `any` to bypass boundary checks.
- Prefer string unions or `as const` objects over TypeScript `enum`.
- Keep DTOs, domain objects, and UI state distinct.
- Treat cancellation as a separate outcome, not as a generic failure.
- Do not swallow errors or branch on third-party error messages.
- Use `kebab-case` filenames; use `PascalCase` for types, classes, and React components; use `camelCase` for functions and variables.
- Do not prefix interfaces with `I`.
- Name tests `*.test.ts` or `*.test.tsx`.
- Comments should explain constraints, rationale, or non-obvious behavior rather than restating code.

### 3.3 Files and Formatting

- Use UTF-8, LF line endings, and a final newline for all text files.
- Biome, EditorConfig, and Git attributes are authoritative for mechanical formatting. Do not duplicate indentation, quote, semicolon, or import-order rules here.
- Do not format or rewrite unrelated files as part of a task.
- Generate lockfiles through pnpm; never edit a lockfile manually.
- Do not commit build output, coverage, caches, platform temporary files, or private editor state.

### 3.4 Imports and Public APIs

- Prefer named exports. Use default exports only when a framework convention or toolchain requirement provides a concrete reason.
- Use `import type` for type-only dependencies.
- Circular dependencies are forbidden.
- Do not create global barrel files that hide dependency direction or unnecessarily widen public APIs.
- Keep public APIs minimal; implementation details remain private unless a cross-module use case requires export.

### 3.5 Dependencies

- Before adding a production dependency, confirm that the standard library and existing dependencies cannot reasonably satisfy the need, and state the reason for adding it.
- Install a dependency in the workspace package that uses it. Keep only repository-wide development tools at the root.
- Do not retain unpinned `latest` dependency declarations. Keep one compatible version of a dependency across the workspace where practical.
- Do not add a large dependency for small, stable utility logic.
- Check new dependencies for maintenance status, license, runtime compatibility, and toolchain compatibility.
- Third-party library and SDK types must not appear in public domain contracts.

### 3.6 Async Work and Resource Lifecycles

- Long-running or blocking operations must accept an `AbortSignal`. If cancellation is impossible, document the reason and exact behavior.
- After cancellation, do not emit further deltas, run subsequent tools, or create new side effects.
- Do not create unobserved promises or promises without a traceable owner.
- VS Code registrations, event listeners, timers, streams, child processes, and similar resources must have an explicit owner and be disposed at lifecycle end.
- Cleanup should be idempotent. Timeout, cancellation, and failure must remain distinguishable outcomes.
- Do not hide races with arbitrary delays or increased timeouts. A clearly owned module must control each state transition.

### 3.7 TODOs and Rule Exceptions

- Do not commit ownerless `TODO` or `FIXME` comments, commented-out code, or permanently skipped tests.
- A necessary temporary item must include a task or issue ID, its reason, and its removal condition.
- Do not silently bypass problems with Biome ignores, `@ts-ignore`, unsafe casts, or equivalent mechanisms.
- When an exception is unavoidable, constrain it to the smallest scope and explain why. Prefer a documented `@ts-expect-error` for expected TypeScript errors.

## 4. Security Rules

- Treat Webview input, model output, tool arguments, and persisted data as untrusted.
- Normalize workspace paths and verify that they remain inside the explicitly selected workspace scope.
- Apply explicit limits to file reads, search results, model context, logs, and command output.
- File writes and command execution must never bypass approval policy.
- Bind approval to the exact operation. Invalidate prior approval when the file or operation changes.
- Store API keys only in VS Code `SecretStorage`. They must not enter Webview state, logs, persisted messages, snapshots, fixtures, or commits.
- Redact logs. Never log authorization headers or user secrets.
- Disable file writes and command execution in untrusted workspaces.

## 5. Testing

- New logic requires risk-appropriate automated tests covering the normal path, an important boundary, and an expected failure path.
- Test Core, Protocol, and policy logic without starting VS Code.
- Provider tests must mock SDK responses. Default tests must not call real models or the network.
- Test Webview behavior with Testing Library through user-visible behavior, not component internals.
- Restrict Extension integration tests to VS Code API adapters and registrations.
- Tests involving cancellation or asynchronous resources must verify post-cancellation behavior and cleanup.
- Keep tests deterministic and independent of execution order, wall-clock time, random IDs, the network, and user machine state.
- Do not replace important behavioral assertions with snapshots or hide races by increasing test timeouts.
- Add a regression test when fixing a defect.
- Run manual smoke tests only when required by the task or phase. They do not replace automated tests.
- Run only validation commands established by the current or prerequisite tasks; do not require tooling that a later task has not introduced.

## 6. Task Workflow

### 6.1 Before Implementation

1. Check `git status` and preserve all existing user changes.
2. For roadmap work, read the current task and its surrounding implementation-plan context. For standalone maintenance, confirm that Section 1.1 applies and that the change does not overlap an active roadmap task.
3. Confirm prerequisites, intended files, explicit exclusions, public-contract impact, and validation commands.
4. Fetch current documentation through Context7 when the work involves a library, framework, SDK, API, CLI, or cloud service.
5. Stop and explain any ambiguity that would materially change the implementation.

Post the following summary before roadmap implementation:

```md
### Current Task

- ID: Txxxx
- Goal:
- Prerequisites:
- Planned files:
- Explicitly excluded:

### Test Plan

- Unit tests:
- Integration tests:
- Manual smoke test:
```

For standalone maintenance, post this summary instead:

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

### 6.2 During Implementation

- Change only files required by the current task or standalone maintenance scope.
- Do not add dependencies needed only by later tasks.
- Do not change unrelated code, formatting, or directory structure.
- Do not introduce abstractions without a current use case.
- Record and report non-blocking discoveries instead of fixing them opportunistically.
- Never overwrite, revert, delete, or relocate user changes outside the current scope.

### 6.3 Verification

Run applicable checks from fastest to broadest:

1. Direct verification of the task outcome.
2. Type checks and tests for affected packages.
3. Existing repository-wide lint, typecheck, test, and build commands.
4. Required Extension Development Host smoke tests.
5. `git diff --check`, `git status --short`, and final diff review.

Never claim that an unexecuted check passed. Report any check that could not run and the reason.

### 6.4 Completion Report

Use the roadmap completion report below for implementation-plan tasks. For standalone maintenance, replace `Task` with `Maintenance` and omit `Next task`.

```md
### Completion

- Task: Txxxx
- Summary:
- Files changed:
- Verification:
- Manual smoke test: Not applicable / result
- Design deviations: None / details
- Outstanding issues: None / details
- Next task: Txxxx (informational only; do not start it)
```

## 7. Git and Integration Workflow

- `main` is protected. Never create development commits directly on `main` or push changes directly to it.
- Before every task or standalone maintenance change, fetch and confirm the latest remote `main`, then create a dedicated branch from that exact commit. Do not branch from stale `main` or another unmerged branch.
- If local changes exist, identify and preserve their ownership. Never overwrite, clean, or relocate them merely to update `main`.
- Use branch names such as `codex/t0001-pnpm-workspace` for roadmap work or `codex/rename-session-loader` for standalone maintenance.
- Include the task ID in roadmap commit messages, for example `chore(T0001): initialize pnpm workspace`.
- For standalone maintenance, include the GitHub Issue number when one exists. If no Issue is warranted, use a clear conventional title such as `refactor: clarify session loader naming`.
- Do not mix multiple implementation tasks, unrelated maintenance, unrelated formatting, or unrelated dependency upgrades in one commit or PR.
- All code reaches `main` through a reviewed Pull Request and squash merge. Do not use merge commits or rebase merge for integration.
- The squashed commit message must contain the roadmap task ID or maintenance Issue number when applicable, and must accurately describe the PR's single coherent change.
- Do not commit, push, create a PR, rewrite history, merge, or clean the workspace unless the user explicitly requests that action.
- Never use `git reset --hard`, force-push, or another command that can destroy user work unless the user explicitly authorizes the exact operation and scope.
- Never commit secrets, caches, generated output, private editor state, or test temporary data.

## 8. Change Control

When an unplanned design change is required:

1. Present concrete evidence that blocks the current task.
2. Describe at least one alternative and its impact.
3. Obtain direction and update `docs/implementation-plan.md` or the relevant ADR first.
4. Then change and verify the code.

Create an ADR only for decisions that affect long-term architecture, persisted formats, the security model, or cross-module contracts. Do not create ADRs for ordinary implementation details.
