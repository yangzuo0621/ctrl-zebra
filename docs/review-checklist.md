# Implementation Review Checklist

This is a compact review gate. Durable PR context and verification belong in the PR; transient
review/workflow evidence belongs in the handoff or conversation. Detailed semantics remain authoritative in
[Reuse Before Build](development.md#reuse-before-build) and
[Build vs Buy](development.md#build-vs-buy); repository ownership and security rules remain in
[AGENTS.md](../AGENTS.md), not in the current-state documents under `docs/`.

## 1. Scope

- [ ] The change is within the authorized work item or standalone maintenance scope.
- [ ] Acceptance criteria, planned files, exclusions, public-contract impact, and changed areas match
      the actual diff; no opportunistic work or dependency was added.
- [ ] When independent review is invoked, the compact Review Handoff names the work item, PR, exact
      revision, contracts, consulted docs, verification, applicable reuse evidence, and caveats.
- [ ] When independent review is invoked, base context was the Review Handoff, exact current PR
      diff/revision, and acceptance criteria.
      Extra documents were opened only for a touched contract, material handoff claim, concrete
      concern, or similarity escalation, and are listed in the review report.

## 2. Correctness

- [ ] Acceptance criteria are satisfied on the reviewed revision.
- [ ] Normal behavior, edge cases, expected failures, regressions, cancellation, and stale or
      repeated operations are handled consistently with the owning contracts.
- [ ] Public DTOs/Schemas, persisted fields, commands, Tool contracts, and stable errors remain
      compatible unless an authorized change-control decision explicitly permits otherwise.
- [ ] Scope does not hide an unresolved design, architecture, or security change.

## 3. Architecture & Security

- [ ] Dependency direction, public entry points, host/vendor isolation, lifecycle ownership, and
      package/module boundaries remain compliant.
- [ ] Untrusted input is validated before dispatch, persistence, or execution; workspace containment,
      bounded I/O/results, exact single-use approvals, direct command spawning, trust/cwd checks,
      SecretStorage, cancellation, and cleanup rules are preserved where touched.
- [ ] Core state/session ownership, MCP ownership, checkpoint/restore safety, and protocol boundaries
      are not bypassed.
- [ ] No secret, authorization data, unbounded value, SDK failure/type, or host detail crosses an
      unowned boundary.

## 4. Tests & Verification

- [ ] Verification covers the normal path, an important boundary, and an expected failure; defects
      include a regression test where practical.
- [ ] Affected package checks, required repository checks, and smoke tests are run and reported.
- [ ] Unrun checks, environment limitations, and remaining caveats are explicit; no check is inferred.
- [ ] `git diff --check` and final scope/status checks are clean.

## 5. Reuse

- [ ] The tier is justified: `TARGETED` by default; `FULL` only for an existing Executor trigger;
      `ESCALATED FULL` only for a documented Reviewer escalation.
- [ ] Search focus, relevant candidates/owners, reuse or non-reuse decision, and actual symbols
      reused/deepened are recorded; the tier-appropriate completion audit is present.
- [ ] A second implementation has an explicit direct-reuse/module-deepening assessment; a third
      equivalent implementation has distinct ownership or semantics. Superseded paths and tests are
      removed when replacement coverage is equivalent.
- [ ] Review verification matches the selected tier; repository-wide inventory is repeated only for
      `ESCALATED FULL` and its reason/differences are recorded.

## 6. Build vs Buy

- [ ] The reviewer identifies whether a documented general-purpose trigger applies.
- [ ] If a trigger applies, evidence evaluates options in the owner-defined order and records
      maintenance, license, compatibility, packaging, cancellation, security, adapter, and rationale
      impacts; the selected mechanism remains behind CtrlZebra-owned interfaces.
- [ ] If no trigger applies, omit the Build-vs-Buy field and evidence.
- [ ] A review recommendation does not authorize unrelated dependency adoption or scope expansion.

## 7. Code Quality

- [ ] The change is understandable, proportionate, and cohesive, with no material duplication,
      unnecessary abstraction, deep nesting, excessive coupling, SRP violation, or maintenance debt.
- [ ] Errors, resources, timers, listeners, streams, processes, and promises have explicit ownership
      and cleanup where relevant.
- [ ] Non-blocking discoveries are recorded for a future task; the read-only Reviewer does not edit
      code, plans, PR state, or task status.

## 8. Decision

### Review Decision: APPROVED | REJECTED | BLOCKED

`APPROVED` applies only to the exact reviewed revision. Any implementation change invalidates the
approval and requires re-review. `REJECTED` must consolidate all blocking findings. `BLOCKED` is
terminal only when blockers remain after correction #2; do not start a fourth Reviewer pass.

### Blocking Findings

- issue, evidence, and required fix; use `none` for an approval.

### Non-Blocking Suggestions

- optional improvement; use `none` when empty.
