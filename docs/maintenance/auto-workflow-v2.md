# Auto-Workflow Current Profiles (historical migration record)

## Maintenance Change

- Goal: Consolidate the versioned auto-workflow profiles into the current unversioned
  `AUTO_DRAFT` and `AUTO_FULL` profiles while retaining `MANUAL`.
- Reason: The former versioned profiles duplicated authorization envelopes and maintained separate
  coordinator/finalizer routing. The current routine workflow needs one explicit behavior: Reviewer is
  the sole implementation-quality gate; Finalizer is transactional/mechanical; Executor remains `max`
  and Finalizer remains `low`.
- Scope: Remove obsolete versioned profile definitions, legacy coordinator/finalizer/rework branches,
  aliases, and examples; rename the surviving draft/full behavior; synchronize skills, role configs,
  prompts, and documentation.
- Planned owners: `.agents/skills/auto-workflow`, `task-executor`, `task-reviewer`, `task-finalizer`,
  `.codex/README.md`, `.codex/PROMPTS.md`, relevant `.codex/agents/*.toml`, and this record.
- Public-contract impact: None. This changes agent workflow policy and profile names only; product code,
  Protocol DTOs, persistence, security policy, dependencies, CI, and release behavior are unchanged.
- Explicitly excluded: `docs/roadmap/archive/phase-11.md` product-version language and unrelated V1/V2
  terminology outside auto-workflow profiles.
- Build vs Buy: Not applicable. Existing roles, skills, templates, Git state, and CI remain the owners;
  no coordinator, dependency, scanner, or workflow service is added.
- Reuse: Deepen the existing workflow roles, authorization profiles, progressive-loading guidance,
  review checklist, task/PR templates, and agent configs. No alias or second process owner remains.
- Verification: Profile-reference scan, authorization-envelope review, repository check, diff check,
  and final scope review.

## Decision Evidence

The former versioned profiles shared two operation envelopes but differed in role routing and evidence.
The current profiles remove that split: `AUTO_DRAFT` authorizes branch/commit/push/draft-PR work and
stops at `READY_FOR_MERGE`; `AUTO_FULL` adds explicitly authorized plan/status updates, squash merge,
and safe branch/temporary cleanup. Both use the same quality loop: Executor → Reviewer → transactional
Finalizer, with at most two consolidated correction cycles. `MANUAL` continues to require explicit
authorization for closure operations.

## Completion

- Implementation summary: Removed obsolete versioned definitions, authorization envelopes, legacy
  coordinator/finalizer/rework routes, and prompt/config examples; renamed the surviving routine
  behavior to `AUTO_DRAFT`/`AUTO_FULL`; synchronized all workflow owners and retained `MANUAL`.
- Durable behavior: Reviewer is the only implementation-quality gate; Finalizer checks only revision,
  approval, CI, mergeability, and state transition; Executor stays at `max`; Finalizer stays at `low`.
- Evidence: The authoritative definitions are `.agents/skills/auto-workflow/SKILL.md` and the synced
  role/config/prompt owners. No PR #230 link was present in the prior record, so none is invented here.
- Verification: Exact obsolete-profile scan, route/profile consistency checks, repository check,
  `git diff --check`, and scope review pass.
