# Auto-Workflow V2 Simplification

## Maintenance Change

- Goal: Add a lower-overhead V2 auto workflow with one implementation-quality gate, transactional
  finalization, tiered reuse evidence, and lower reasoning effort for transactional closure.
- Reason: V1 makes Reviewer and Finalizer repeat acceptance, scope, and verification judgments; permits
  a Finalizer-to-Executor-to-Reviewer loop; requires repository-wide independent similarity evidence
  for ordinary work; and rebuilds overlapping context across roles.
- Scope: Add `AUTO_DRAFT_V2` and `AUTO_FULL_V2`, keep V1 compatibility, define a compact handoff packet,
  make Reviewer the sole V2 quality gate, restrict V2 Finalizer to mechanical closure gates, introduce
  targeted/full reuse-audit tiers, preserve Executor at `max`, and lower Finalizer to `low`.
- Planned files: `AGENTS.md`, `docs/development.md`, `docs/review-checklist.md`,
  `docs/roadmap/task-template.md`, `.github/pull_request_template.md`, the four workflow role skills,
  Executor/Finalizer agent configs, `.codex/README.md`, `.codex/PROMPTS.md`, and this record.
- Public-contract impact: None.
- Explicitly excluded: Product code, roadmap order/status, dependencies, CI, release behavior, public
  APIs, Protocol DTOs, persistence, security policy, changes to V1 authorization operations, Git
  publication, and PR/merge actions.
- Build vs Buy triggers: None. This change narrows existing documented orchestration and adds no
  dependency, runtime, scanner, or workflow service.
- Build vs Buy decision and evidence: Not applicable. Existing role skills, PR handoff, Git state, CI,
  and repository templates remain the owners.
- Reuse Audit: Targeted audit of existing workflow roles, authorization profiles, routing states,
  progressive document loading, reuse guidance, review checklist, task template, PR template, and agent
  configs. The active plan deepens these owners instead of adding another coordinator or review role.
  No second or third workflow implementation is introduced; V2 is a versioned behavior profile inside
  the existing workflow owner, while immutable V1 authorization operations remain available.
- Final Similarity Audit plan: Search all V1/V2 profile names, Finalizer routes, full-audit triggers,
  handoff fields, and reasoning settings; verify documentation and configuration agree and that no
  product or dependency files changed.
- Verification: Run repository formatting/lint checks, `git diff --check`, targeted cross-reference
  searches, status, and final diff review.

## Decision Evidence

The repository definition confirmed three overlapping defaults:

1. Reviewer checks acceptance, architecture, security, scope, tests, and code smells, while V1
   Finalizer checks acceptance, tests/CI, scope, and implementation changes again.
2. V1 routes Finalizer implementation findings through Executor, Reviewer, and Finalizer a second time.
3. Reuse policy requires repository-wide implementer inventory and independent reviewer reproduction
   even when the change is local and no risk trigger exists.

The selected design keeps independent implementation review but removes the second quality gate from
V2. The alternative of changing only model reasoning levels was rejected because it would reduce model
work without removing duplicate decisions or routing loops.

Official OpenAI model guidance recommends using multi-agent work for complex tasks that divide cleanly,
reserving maximum reasoning for the hardest quality-first workloads, stating instructions once, and
measuring lower-effort configurations on representative tasks. These principles support the direction;
the exact V2 roles and gates remain repository-owned policy. Executor remains at `max` by project
decision, while only the mechanical Finalizer moves to `low`.

## Completion

- Implementation summary: Added V2 draft/full profiles without changing V1 operation envelopes;
  established Reviewer as the sole V2 implementation-quality gate; limited Finalizer to revision,
  approval, CI, mergeability, and state-transition checks; added the compact handoff packet and bounded
  review loop; split reuse evidence into targeted and full tiers; preserved Executor reasoning at
  `max` and changed Finalizer from `medium` to `low`; updated workflow examples and evidence templates.
- Verification: `pnpm run check` passed for 427 files; targeted assertions confirmed all four profile
  names, every V2 mechanical blocker route, audit-tier guidance, and reasoning settings; `git diff
  --check` passed. Final status contained only the 14 planned documentation/configuration files.
- Public-contract impact: None.
