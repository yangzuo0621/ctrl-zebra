# Ctrl-Zebra Codex Multi-Agent Workflow

## Recommended routine roles

- root coordinator using `auto-workflow` — authorization, dispatch, waits, revision tracking, and circuit breakers
- `task-executor` — task startup, implementation, verification, early PR, and review fixes
- `task-reviewer` — the only implementation-quality gate
- `task-finalizer` — low-reasoning transactional closure, plan state, merge, and cleanup
- `sol-planner` — optional project/Phase architecture and roadmap escalation before approval

## Routine lifecycle

```text
Pending
→ Root: validate task, authorization, and reuse-audit tier
→ Task-Executor: In Progress, contract, implementation, verification, early PR, handoff packet
→ Task-Reviewer: review exact revision
   ├─ REJECTED → consolidated fixes → re-review
   └─ APPROVED
        → Task-Finalizer: revision + approval + CI + mergeability + state transition only
           ├─ APPROVAL_STALE → Task-Reviewer
           ├─ CHECKS_NOT_GREEN / MERGE_CONFLICT → Task-Executor
           │    └─ re-review only when the approved revision changes
           ├─ READY_FOR_MERGE (AUTO_DRAFT)
           └─ COMPLETED (AUTO_FULL or authorized MANUAL closure)
```

Finalizer does not repeat acceptance, architecture, scope, test-sufficiency, or similarity review.
Planner is not part of routine task closure. The normal quality loop is Executor → Reviewer, with at
most two correction cycles before the coordinator stops.

## Reuse evidence

`docs/development.md` owns the `TARGETED`/`FULL`/`ESCALATED FULL` rules. The compact Review Handoff and
PR diff are the shared evidence surface; Reviewer loads other documents only for concrete verification.

## Ownership principle

**Task-Executor opens the PR. Task-Reviewer owns quality approval. Task-Finalizer closes the PR.**

The feature PR and compact handoff packet are the shared surfaces across task-level agents.

## AUTO authorization profiles

The authoritative, immutable profiles are defined only in
`.agents/skills/auto-workflow/SKILL.md`.

`AUTO_DRAFT` and `AUTO_FULL` are the current profiles. Invoke one by its exact name and explicitly
authorize it for one task. Any permission change requires an explicit profile change and renewed
authorization; there are no version aliases.
