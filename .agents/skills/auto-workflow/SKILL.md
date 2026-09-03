# Auto-Workflow

## Purpose

Coordinate exactly one approved work item across Root, Executor, Reviewer, and the optional Planner. Root
orchestrates the work and performs the transactional closure after an independent Reviewer approval;
Root does not take over implementation or implementation review.

## Invocation boundary

`auto-workflow` is an explicitly selected, opt-in workflow. Enter it only when the user explicitly
requests `auto-workflow` or explicitly authorizes `AUTO_DRAFT` / `AUTO_FULL` for one exact task.
Ordinary implementation, roadmap-task, PR, verification, or maintenance requests must not be inferred
to enable `auto-workflow`. Once an active auto-workflow is established, Task-Reviewer remains mandatory
and the v3 review-loop and closure rules below continue unchanged.

## Inputs

- `AGENTS.md`, the affected current-state owner documents, and one Issue/PR or standalone maintenance
  scope
- authorization profile: `AUTO_DRAFT` or `AUTO_FULL`
- explicit task-scoped authorization for every Git/PR operation in that profile
- base revision, branch, acceptance criteria, and the Executor reuse tier

## Authorization profiles

`AUTO_DRAFT` authorizes, for the assigned task only:

- create or switch to its dedicated `codex/...` branch;
- stage only task-scoped changes;
- commit and push that branch; and
- create and update its draft PR.

After Reviewer approval of the current implementation revision and required checks are green, Root
closure stops at `READY_FOR_MERGE`. `AUTO_DRAFT` never authorizes merge, branch deletion, cleanup, or
marking the task completed.

`AUTO_FULL` includes `AUTO_DRAFT` and additionally authorizes, for the assigned task only:

- task-scoped plan/status updates and their required commit/push;
- squash merge of the approved PR; and
- safe deletion of the merged feature branch and task-owned temporary resources.

Both profiles exclude force-push, unrelated changes, destructive cleanup, scope expansion,
architecture/contract changes, branch-protection bypass, and ambiguous conflict resolution. Naming a
profile is not authorization: the user must explicitly authorize that exact profile for that exact
task. The envelope is immutable; changing it requires a profile change and renewed authorization.

## Coordinator workflow

1. Pin the work item, acceptance criteria, base revision, branch, authorization envelope, and Executor
   `TARGETED`/`FULL` tier.
2. Use `sol-planner` only for pre-implementation decomposition or unresolved architecture/roadmap
   ambiguity; it is not part of routine closure.
3. Dispatch Executor for startup, implementation, verification, early PR creation, and a compact
   Review Handoff.
4. Dispatch the read-only Reviewer with exactly the Review Handoff, exact current PR diff/revision,
   and task acceptance criteria as base context. Within this active auto-workflow run, Reviewer is the
   only implementation-quality gate.
5. Require the first Reviewer pass to inspect the complete current revision and return one
   consolidated set of all identifiable blocking findings. Route that set to Executor. For correction
   #1 and #2, Reviewer uses a delta-focused review of the previous blockers, current revision delta,
   fix-induced regressions, and directly affected contracts. A substantive scope, architecture,
   security, or implementation-strategy change is the only reason to broaden that review.
6. After `APPROVED`, Root performs transactional closure for that exact revision. Root checks only:
   revision and approval freshness, required CI/checks, PR mergeability/conflicts, the permitted
   task-state transition, and exact authorization. Root does not reopen review, reinterpret the
   quality decision, or add implementation findings.
7. Route a stale approval to Reviewer and CI/conflict mechanics to Executor. Require review of the
   exact new revision whenever a fix changes implementation. Route authorization or unverifiable
   state blockers to Root/user; do not guess or route closure to another role.

Root reports one mechanical blocker route when a closure gate fails:

| Failure | Status | Owner | Re-review |
|---|---|---|---|
| approved revision is stale or HEAD differs | `APPROVAL_STALE` | Reviewer | yes |
| required CI/checks are missing or failing | `CHECKS_NOT_GREEN` | Executor | only if the revision changes |
| PR has a merge conflict | `MERGE_CONFLICT` | Executor | if the resolution changes the revision |
| operation is not authorized | `AUTHORIZATION_REQUIRED` | Root/user | no |
| repository or PR state cannot be verified | `STATE_UNVERIFIABLE` | Root/user | no |

Each route returns `BLOCKED` until its owner supplies verifiable state; closure never invents a
quality decision.

8. For `AUTO_DRAFT`, return `READY_FOR_MERGE` after the closure gates pass. For `AUTO_FULL`, perform
   only the explicitly authorized status, merge, and cleanup operations, then verify their actual
   result.

Wait for each role result, record the exact revision actually reviewed, and never repeat a completed
side effect.

## Review-loop and stop conditions

The normal loop has at most two correction cycles: initial review, correction #1, and correction #2
(at most three Reviewer passes). If blockers remain after correction #2, return `BLOCKED` and do not
start a fourth pass. Any implementation revision change after approval invalidates that approval and
requires review of the new exact revision, subject to the same limit.

Stop for missing or ambiguous authorization, persistent review failure, stale/contradictory or
unverifiable state, unexpected scope, architecture/security conflict, change-control need, an
unresolved merge conflict, or required checks that cannot be corrected in scope.

## Role boundaries

- Root coordinates and performs only the mechanical, profile-authorized closure described above.
- Executor implements and handles review-directed fixes; it never reviews, approves, merges, or
  closes the task.
- Reviewer is read-only, approves only the exact reviewed revision, and is the sole
  implementation-quality gate within the active auto-workflow run.
- Planner plans only and never implements, reviews, approves, or performs routine closure.

## Reuse and evidence

`TARGETED` is the default Executor reuse path. Select `FULL` only for an existing trigger in
[`Reuse Before Build`](../../../docs/development.md#reuse-before-build); ordinary uncertainty does not
justify a repository-wide audit. Reviewer uses evidence/spot checks for `TARGETED`, independently
verifies material `FULL` claims, and repeats a full audit only for an existing `ESCALATED FULL` trigger.

Keep the Review Handoff and PR diff as the shared evidence surface. Do not emit routine document
counts, additional-document counts, repeated-audit counts, or similar telemetry. Add bounded `FULL`
or `ESCALATED FULL` trigger/evidence only when that tier was actually used.

## Output contract

The default final result contains only:

```text
Task: <task>
PR: <PR or none>
Revision: <reviewed/current revision>
Checks: <required check result>
Review: <APPROVED | REJECTED | BLOCKED>
Review cycles: <initial + correction count>
Final state: <READY_FOR_MERGE | COMPLETED | BLOCKED>
```

When `FULL` or `ESCALATED FULL` was genuinely triggered, append only its tier, trigger, and bounded
verification result. Never replace these fields with raw transcripts or unbounded audit output.
