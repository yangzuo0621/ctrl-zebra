# Ctrl-Zebra Codex Multi-Agent Workflow

## Recommended V2 roles

- root coordinator using `auto-workflow` — authorization, dispatch, waits, revision tracking, and circuit breakers
- `task-executor` — task startup, implementation, verification, early PR, and review fixes
- `task-reviewer` — the only implementation-quality gate
- `task-finalizer` — low-reasoning transactional closure, plan state, merge, and cleanup
- `sol-planner` — optional project/Phase architecture and roadmap escalation before approval

## V2 routine lifecycle

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
           ├─ READY_FOR_MERGE (AUTO_DRAFT_V2)
           └─ COMPLETED (AUTO_FULL_V2 or authorized MANUAL closure)
```

Finalizer does not repeat acceptance, architecture, scope, test-sufficiency, or similarity review in V2.
Planner is not part of routine task closure. The normal quality loop is Executor → Reviewer, with at
most two correction cycles before the coordinator stops.

## Reuse evidence

Every task performs a targeted reuse audit. Repository-wide definition inventories and independent
reviewer reproduction are required only for the full-audit triggers in `docs/development.md`, such as
shared/general-purpose infrastructure, duplicate centralization, sensitive cross-cutting boundaries,
or concrete duplication concerns.

## Ownership principle

**Task-Executor opens the PR. Task-Reviewer owns quality approval. Task-Finalizer closes the PR.**

The feature PR and compact V2 handoff packet are the shared surfaces across task-level agents.

## AUTO authorization profiles

V2 is recommended for routine work. V1 remains available as a legacy workflow and preserves its
existing routing. The authoritative, immutable authorization profiles are defined only in
`.agents/skills/auto-workflow/SKILL.md`.

Invoke a profile by its exact versioned name and explicitly authorize it for one task. V2 uses the same
Git/PR operation envelopes as V1 but must still be authorized by its own exact name. Any permission
change requires a new profile version rather than modifying an existing version.
