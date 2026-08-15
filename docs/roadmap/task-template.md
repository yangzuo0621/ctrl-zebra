# Roadmap Task Execution Template

Use this for transient execution, handoff, and PR evidence. Keep the implementation plan index-only;
omit raw output/transcripts. Read [AGENTS.md](../../AGENTS.md), the active phase section, and only
task-relevant owner documents.

## Default task contract

```md
### Task

- Task:
- Goal:
- Scope / planned files:
- Explicit exclusions:
- Acceptance criteria:
- Verification:
- Contracts/domains touched:
- Reuse tier: TARGETED (Executor default) / FULL (only with an existing trigger)
- Build-vs-Buy: N/A — no trigger.
```

When triggered, replace the final line with the trigger and decision status. `ESCALATED FULL` remains
Reviewer-only under [Reuse Before Build](../development.md#reuse-before-build).

## Routine evidence

### Reuse Audit (TARGETED default)

- Search focus:
- Relevant candidates/owners:
- Reuse decision; actual reuse/deepening:
- Remaining similarity, second/third implementation assessment, or removed path:

For an existing `FULL` trigger only, add repository-wide definitions/counts, owners, dispositions, and
the final actual-symbol audit. Reviewer verifies material claims independently and repeats the full
audit only for an `ESCALATED FULL` trigger.

### Build-vs-Buy (conditional)

- Trigger, or `N/A — no trigger`:
- Options/evidence in owner-defined order; decision/rationale:
- Maintenance, license, compatibility, packaging, cancellation, security, adapter, and isolation impact:

## Executor Review Handoff

```md
## Review Handoff

- Task / PR / exact revision:
- Acceptance criteria:
- Changed areas:
- Contracts touched:
- Docs actually consulted:
- Verification and unrun checks:
- Reuse tier / candidates / conclusion:
- Build-vs-Buy summary:
- Known caveats or deviations:
```

List only deduplicated documents actually read.

## Completion evidence

Repeat the Review Handoff fields for the exact final revision, then add:

- Reviewer decision / reviewed revision:
- Finalizer result / final task state:
