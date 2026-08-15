# Roadmap Task Execution Template

Use this for transient execution, handoff, and PR evidence. Keep the implementation plan index-only;
omit raw output and transcripts. Read [`AGENTS.md`](../../AGENTS.md), the active phase section, and
only task-relevant owner documents. Omit any field or section with no content; the planned-file list
is always required and remains the Executor's hard scope boundary.

## Default task contract

```md
### Task

- Task:
- Goal:
- Scope / planned files:                 <!-- mandatory hard boundary -->
- Explicit exclusions:                   <!-- omit when none -->
- Acceptance criteria:
- Verification:
- Contracts/domains touched:             <!-- omit when none -->
- Reuse tier: TARGETED (Executor default)
```

Add `Build-vs-Buy` only when a documented trigger applies. `FULL` requires an existing
[`Reuse Before Build`](../development.md#reuse-before-build) trigger; `ESCALATED FULL` is
Reviewer-only. Ordinary uncertainty does not justify a repository-wide audit.

## Reuse Audit (when applicable)

Record only the evidence that exists:

- Tier and trigger (if `FULL` or `ESCALATED FULL`):
- Search focus and relevant candidates/owners:
- Reuse decision and actual reuse/deepening:
- Actual-symbol check and remaining similarity/disposition:

For `FULL`, include the repository-wide definitions, owners, and dispositions needed to substantiate
the decision. Reviewer independently verifies material claims and repeats the full audit only for a
concrete `ESCALATED FULL` trigger.

## Build-vs-Buy (conditional)

- Trigger and decision/rationale:
- Options/evidence in owner-defined order:
- Maintenance, license, compatibility, packaging, cancellation, security, adapter, and isolation
  impact:

## Executor Review Handoff

```md
## Review Handoff

- Task / PR / exact revision:
- Acceptance criteria:
- Changed areas:
- Contracts touched:                    <!-- omit when none -->
- Docs actually consulted:              <!-- list only docs actually read -->
- Verification and unrun checks:
- Reuse tier / candidates / conclusion:
- Build-vs-Buy summary:                 <!-- omit when no trigger -->
- Known caveats or deviations:          <!-- omit when none -->
```

The handoff's base context is the Review Handoff, the exact current PR diff, and the acceptance
criteria. Do not include document counts, repeated-audit counts, raw searches, or tool transcripts.

## Root closure evidence

For the exact final revision, report only the non-empty fields needed to hand off closure:

- Reviewer decision and reviewed revision:
- Checks and mergeability:
- Root closure result and final task state:
- Authorized status, merge, or cleanup actually performed (when applicable):
