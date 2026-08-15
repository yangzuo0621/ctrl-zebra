# Auto-Workflow

## Purpose

Coordinate exactly one roadmap task across Executor, Reviewer, Finalizer, and optional Planner roles.
The root agent orchestrates but does not take over implementation, review, planning, or finalization.

## Inputs

- `AGENTS.md`, the active portion of `docs/implementation-plan.md`, and one task ID
- authorization profile: `AUTO_DRAFT` or `AUTO_FULL`
- explicit task-scoped authorization for every Git/PR operation in that profile
- base revision, branch, acceptance criteria, and Executor reuse tier

## Authorization profiles

`AUTO_DRAFT` authorizes, for the assigned task only:

- create/switch to its dedicated `codex/...` branch;
- stage only task-scoped changes;
- commit and push that branch; and
- create and update its draft PR.

After current-revision Reviewer approval and required checks, stop at `READY_FOR_MERGE`. It does not
authorize merge, branch deletion, or destructive cleanup.

`AUTO_FULL` includes `AUTO_DRAFT` and additionally authorizes, for the assigned task only:

- Finalizer plan/status commits and pushes;
- squash merge of the approved PR; and
- safe deletion of the merged feature branch and task-owned temporary resources.

Both profiles exclude force-push, unrelated changes, destructive cleanup, scope expansion,
architecture/contract changes, branch-protection bypass, and ambiguous conflict resolution. Naming a
profile is not authorization: the user must explicitly authorize that exact profile for that exact
task. The envelope is immutable; changing it requires a profile change and renewed authorization.

## Coordinator workflow

1. Pin the task, base revision, branch, authorization envelope, and Executor `TARGETED`/`FULL` tier.
2. Use `sol-planner` only for pre-implementation decomposition or unresolved architecture/roadmap
   ambiguity; it is not part of routine closure.
3. Dispatch Executor for startup, implementation, verification, early PR creation, and a compact
   Review Handoff.
4. Dispatch the read-only Reviewer with exactly the handoff, exact current PR diff/revision, and task
   acceptance criteria as base context. Reviewer is the only implementation-quality gate.
5. Route one consolidated `REJECTED` finding set to Executor. Review every changed implementation
   revision; no role may self-approve.
6. After `APPROVED`, dispatch Finalizer for that exact revision. Finalizer checks only freshness,
   required CI, mergeability, task-state transition, and authorization; it never reopens review.
7. Route stale approval to Reviewer and CI/conflict mechanics to Executor. Require re-review whenever
   the approved implementation revision changes.
8. Stop at `READY_FOR_MERGE` for `AUTO_DRAFT`; for `AUTO_FULL`, continue through authorized status,
   merge, and cleanup operations only after all transactional gates pass.

Wait for each role result, record the revision actually reviewed, and never repeat a completed side
effect.

## Retry and stop conditions

Allow at most two Reviewer rejection/correction cycles, resetting a route count only after material
progress. Stop for missing/ambiguous authorization, persistent review failure, stale/contradictory or
unverifiable state, unexpected scope, architecture/security conflict, change-control need, unresolved
merge conflict, or required checks that cannot be corrected in scope.

## Role boundaries

- Coordinator orchestrates only.
- Executor implements and handles review-directed fixes; it never reviews, approves, merges, or closes.
- Reviewer is read-only, approves only the exact reviewed revision, and is the sole quality gate.
- Finalizer is transactional, performs only profile-authorized closure, and does not review code.
- Planner plans only and never implements or approves.

## Output contract

Report task, profile, branch, PR, reviewed/merged revisions as applicable, checks/CI, review cycles,
final state, and cleanup actually performed. Include:

```text
Executor document count: <n>
Executor audit tier: TARGETED | FULL
Reviewer base context: Review Handoff + current PR diff + task acceptance criteria
Reviewer additional docs count: <n>
Reviewer similarity verification: evidence check/spot-check | independent targeted verification | independent full audit
Reviewer full audit repeated: yes | no
Finalizer implementation docs loaded: <n>
Full-repo similarity audit count: <n>
Review-loop count: <n>
```

Count deduplicated documents actually read and role reports that explicitly mark a full-repository
audit; `Reviewer full audit repeated` is `yes` only for `ESCALATED FULL`. Never infer missing state or
replace bounded summaries with raw transcripts.
