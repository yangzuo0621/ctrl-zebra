---
name: task-executor
description: Implement and verify one assigned work item. Default to MANUAL; handle independent-review handoff only when explicitly requested or dispatched by an active AUTO workflow.
---

# Task-Executor

Own implementation and verification for one authorized Issue/PR or standalone maintenance change.
Use [AGENTS.md](../../../AGENTS.md) and the affected owner documents. MANUAL is the default;
[AUTO profiles](../auto-workflow/SKILL.md#authorization-profiles) require explicit task-scoped
selection and authorization. This skill does not itself grant Git/PR permissions.

In MANUAL, the primary agent normally applies this skill directly, including local implementation
planning, implementation, and verification. A separate Executor is optional when context isolation
helps; using this skill alone does not require a role handoff.

## Implementation

1. Establish scope, acceptance criteria, exclusions, affected contracts, base revision, and verification
   from the request or handoff. Check for conflicting active work without disturbing unrelated changes.
   Create or use a dedicated feature branch when applicable and authorized.
2. Record a compact work-item contract in the conversation/handoff, or in an authorized PR. Keep the
   planned-file boundary current: amend it before editing another file. A routine file-list amendment
   within the authorized scope does not require renewed approval; scope or contract expansion follows
   AGENTS.md change control.
3. Continue when implementation is already authorized. A planning-only request does not authorize
   implementation. Ask only for a missing decision or grant that blocks the next action, after completing
   independent authorized preparation.
4. Apply [Reuse Before Build](../../../docs/development.md#reuse-before-build) and
   [Build vs Buy](../../../docs/development.md#build-vs-buy) when their triggers apply. TARGETED is the
   default reuse tier; FULL needs a documented trigger, and ESCALATED FULL belongs to Reviewer.
5. Implement within scope and verify the affected surface. Create or update the same PR early only
   when authorized, using the repository PR template for durable context. In MANUAL, report changes,
   verification, unrun checks, and remaining blockers; do not automatically dispatch Reviewer.

## Independent review and handoff

An active AUTO run or a separate explicit user request for independent review requires a compact
Review Handoff: task, review target as defined by [Task-Reviewer](../task-reviewer/SKILL.md#review-target),
acceptance criteria, changed areas and contracts, verification
and unrun checks, and applicable reuse or Build-vs-Buy evidence. Keep transient revision and execution
evidence in the handoff; omit raw transcripts and routine audit counts from it and the PR.

In AUTO, return the handoff to Root for dispatch; never self-dispatch Reviewer. Address returned
blockers in scope under the [review loop](../auto-workflow/SKILL.md#review-loop-and-stop-conditions).
After approval, stop editing and return the same PR and exact revision to Root for closure. For an
explicit independent review outside AUTO, return the result to the caller without AUTO closure.
Any change to the reviewed content invalidates approval and needs re-review, including changes made
to fix CI or conflicts.

## Boundaries and blockers

Never self-approve an independent review. In AUTO, do not take over independent Reviewer, project
Planner, or Root closure responsibilities, or merge or close the PR or work item. In MANUAL, local
planning and explicitly authorized follow-up operations do not require another agent; substantial
architecture or roadmap planning still follows AGENTS.md change control. A separately dispatched
Executor returns to its caller for coordination and closure.
Follow AGENTS.md stop conditions for missing authorization, scope/contract expansion, security or
architecture conflict, and unverifiable state. Correct in-scope mechanical failures when safe;
report BLOCKED when they cannot be resolved or the review-loop limit is reached.
