# Ctrl-Zebra Codex Multi-Agent Workflow — Finalizer Owns Closure

## Roles
- root coordinator using `auto-workflow` — authorization validation, dispatch, waits, revision tracking, retry routing, and circuit breakers
- `task-executor` — In Progress, implementation, early PR creation, implementation/rework
- `task-reviewer` — independent code review
- `task-finalizer` — closure audit, Done state, blocker routing, squash merge, cleanup
- `sol-planner` — project/Phase decomposition, architecture analysis, dependency/roadmap replanning

## Routine lifecycle
```text
Pending
→ Root coordinator: validate task + authorization profile
→ Task-Executor: In Progress
→ Contract
→ MANUAL approval / AUTO gate
→ Implementation
→ Early PR
→ Task-Reviewer
   ├─ REJECTED
   │    → Task-Executor fix
   │    → Task-Reviewer
   └─ APPROVED
        → Task-Finalizer
           ├─ READY_FOR_MERGE (AUTO_DRAFT_V1)
           │    → stop before merge
           ├─ COMPLETED (AUTO_FULL_V1 or authorized MANUAL closure)
           │    → plan/status updated
           │    → squash merge
           │    → cleanup
           ├─ BLOCKED: IMPLEMENTATION_FIX_REQUIRED
           │    → Task-Executor fix
           │    → re-review if required
           │    → Task-Finalizer again
           └─ BLOCKED: PLANNING_ESCALATION
                → Sol-Planner
                → Root coordinator checks change-control and re-review impact
                → resume workflow or stop for user direction
```

## Ownership principle
**Task-Executor opens the PR. Task-Finalizer closes the PR.**

The feature PR is the shared handoff surface across all task-level agents.

## AUTO authorization profiles

AUTO mode is coordinated by the root agent through the repository's `auto-workflow` skill. The role agents never dispatch themselves or infer completion from a pending handoff.

The authoritative, immutable authorization profiles are defined only in `.agents/skills/auto-workflow/SKILL.md`. Invoke a profile by its exact versioned name and explicitly authorize it for one task. Any permission change requires a new profile version rather than modifying an existing version.
