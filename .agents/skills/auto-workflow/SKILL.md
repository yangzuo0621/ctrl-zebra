# Auto-Workflow

## Purpose
Coordinate one roadmap task through the configured Executor, Reviewer, Finalizer, and optional Planner
roles without taking over any role responsibilities.

The root agent owns orchestration. `auto-workflow` is a coordinator skill, not a fifth implementation
or review agent. `AUTO_DRAFT` and `AUTO_FULL` are the current routine profiles; `MANUAL` remains the
explicit-approval mode.

## Inputs
- `AGENTS.md`
- `docs/implementation-plan.md`
- exactly one task ID
- authorization profile: `AUTO_DRAFT` or `AUTO_FULL`
- the user’s explicit, task-scoped authorization for every Git/PR action in the selected profile

## Authorization Profiles

### AUTO_DRAFT
The user must explicitly authorize, for the assigned task only:
- creating and switching to the dedicated `codex/...` branch;
- staging only task-scoped changes;
- committing and pushing the feature branch;
- creating and updating a draft PR.

After current-revision Reviewer approval and required checks, stop when Finalizer returns
`READY_FOR_MERGE`. Do not merge, delete branches, or perform destructive cleanup.

### AUTO_FULL
Includes every `AUTO_DRAFT` permission. The user must additionally authorize:
- Finalizer plan/status commits and pushes;
- squash-merging the approved PR;
- deleting the merged feature branch and task-owned temporary resources when safe.

Authorization for every profile excludes force-push, unrelated changes, destructive cleanup, scope
expansion, architecture or contract changes, bypassing branch protection, and resolving ambiguous
conflicts.

Explicitly authorizing an exact profile for exactly one task authorizes every operation listed by that
profile for that task. Merely naming or selecting a mode without explicit authorization does not. If
authorization is missing or ambiguous, stop before dispatch and request it.

The profile authorization envelope is immutable. Permission changes require an explicit change to the
current profiles and renewed authorization; do not create aliases or silently broaden a profile.

## Coordinator Workflow
1. Pin the assigned task, base revision, branch, authorization profile, authorized operations, and
   targeted/full reuse-audit tier.
2. Use `sol-planner` only before implementation when task decomposition, architecture, or roadmap
   ambiguity cannot be resolved inside the existing task. Planner is not part of routine closure.
3. Dispatch `task-executor` for startup, contract, implementation, verification, early PR creation,
   and a compact handoff packet.
4. Dispatch `task-reviewer` against the actual current PR revision. The Reviewer is the only code
   quality gate and returns one consolidated finding set.
5. Route `REJECTED` to `task-executor`, then review the new revision. Do not distribute the same
   correction across multiple roles.
6. After `APPROVED`, dispatch `task-finalizer` against that exact revision. Finalizer verifies only
   revision identity, current approval, required CI, mergeability, and the allowed task-state
   transition; it does not repeat acceptance, architecture, scope, test-sufficiency, or similarity
   review.
7. Route stale approval to `task-reviewer`. Route failed CI or merge conflicts to `task-executor`;
   require re-review only when the approved implementation revision changes. Finalizer never requests
   an implementation fix based on a second code review.
8. In `AUTO_DRAFT`, stop at `READY_FOR_MERGE`. In `AUTO_FULL`, continue through authorized plan update,
   merge, and cleanup only after the transactional gates pass.

The coordinator waits for each role, records the actual revision reviewed, and never treats a
dispatched or running role as completed.

## Retry and Circuit Breakers
- Allow at most two Reviewer rejection/correction cycles. Require each review to consolidate all
  current blocking findings; stop rather than continue agent ping-pong after the limit.
- Reset a route count only after material progress, such as a new revision or resolved finding.
- Stop for persistent review failure, stale or contradictory evidence, missing authorization,
  unexpected scope, architecture/security conflict, required change control, unresolved merge conflict,
  failing required checks that cannot be corrected in scope, or unverifiable repository/PR state.
- Never repeat a completed side effect.

## Role Boundaries
- The coordinator does not implement, review, approve, finalize, or plan.
- Task-Executor never self-reviews, finalizes, merges, or closes the PR.
- Task-Reviewer remains read-only, is the only implementation-quality gate, and approves only the
  reviewed revision.
- Task-Finalizer owns closure but performs only operations authorized by the selected profile.
- Sol-Planner handles planning escalation and does not implement or approve code.

## Completion
Report the task, profile, branch, PR, reviewed and merged revisions when applicable, checks/CI evidence,
review cycles, final task state, and cleanup actually performed. Never invent state.
