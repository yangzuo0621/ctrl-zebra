# Ctrl-Zebra Codex Multi-Agent Workflow

## Recommended routine roles

- Root coordinator using explicitly selected `auto-workflow` — authorization, dispatch, waits, revision
  tracking, circuit breakers, and transactional closure
- `task-executor` — task startup, implementation, verification, early PR, and review fixes
- `task-reviewer` — the implementation-quality gate only for an active auto-workflow or an explicitly
  requested independent review
- `sol-planner` — optional project architecture and planning escalation before implementation

## Lifecycle boundary

Ordinary / MANUAL:

```text
implement
→ verify
→ stop / report
```

Explicit auto-workflow:

```text
Task-Executor
→ Task-Reviewer
→ Root closure
```

Ordinary implementation, work items, PR requests, verification, and maintenance requests do not
implicitly select `auto-workflow`. The detailed lifecycle below applies only after the user explicitly
selects `auto-workflow` or authorizes `AUTO_DRAFT` / `AUTO_FULL` for the exact work item.

## Active auto-workflow lifecycle

```text
Pending
→ Root: validate task, authorization, and reuse-audit tier
→ Task-Executor: In Progress, contract, implementation, verification, early PR, handoff packet
→ Task-Reviewer: review exact revision
   ├─ REJECTED → consolidated fixes → delta-focused correction review
   │              (at most correction #1 and #2)
   └─ APPROVED
        → Root closure: revision + approval + CI + mergeability + state transition + authorization
           ├─ APPROVAL_STALE → Task-Reviewer
           ├─ CHECKS_NOT_GREEN / MERGE_CONFLICT → Task-Executor
           │    └─ re-review only when the implementation revision changes
           ├─ READY_FOR_MERGE (AUTO_DRAFT)
           └─ COMPLETED (AUTO_FULL or explicitly authorized closure)
```

The first Reviewer pass returns one consolidated set of blocking findings. Later correction passes
are delta-focused unless scope, architecture, security, or implementation strategy materially
changes. If blockers remain after correction #2, Reviewer returns terminal `BLOCKED`; Root only
propagates that result and stops, without owning or reinterpreting the quality decision. No fourth
Reviewer pass starts. Root closure is mechanical and never repeats acceptance, architecture, scope,
test-sufficiency, or similarity review.

## Reuse evidence

`docs/development.md` owns the `TARGETED`/`FULL`/`ESCALATED FULL` rules. `TARGETED` is the default;
`FULL` requires an existing Executor trigger, and `ESCALATED FULL` requires a concrete Reviewer
escalation. The compact Review Handoff and exact PR diff are the shared evidence surface; Reviewer
loads other documents only for concrete verification.

## Ownership principle

**Task-Executor opens the PR. Task-Reviewer owns quality approval only for an active auto-workflow run
or an explicitly requested independent review. Root performs transactional closure for the active
auto-workflow.**

The feature PR and compact handoff packet are the shared surfaces across task-level roles. Approval is
bound to the exact reviewed implementation revision; any implementation change invalidates it and
requires review of the new revision.

## AUTO authorization profiles

The authoritative, immutable profiles are defined only in
`.agents/skills/auto-workflow/SKILL.md`.

`AUTO_DRAFT` and `AUTO_FULL` are the current profiles. Invoke one by its exact name and explicitly
authorize it for one work item. `AUTO_DRAFT` stops at `READY_FOR_MERGE`; only explicitly authorized
`AUTO_FULL` closure may update work-item status, merge, or clean up.
