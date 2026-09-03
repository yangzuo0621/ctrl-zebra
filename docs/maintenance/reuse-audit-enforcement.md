# Reuse Audit Enforcement

## Maintenance Change

- Goal: Make reuse an explicit responsibility of any agent implementing a change and require independently
  verifiable final reuse evidence before review approval.
- Reason: EO-003 centralized the owned projection algorithms but its task-local audit omitted known
  repository candidates and accepted repeated operation-specific error-mapping wrappers without a
  complete definition inventory. Passing behavior tests did not expose that process gap.
- Scope: Strengthen the root agent rules, development guidance, task template, review checklist, and
  pull-request evidence fields for repository-wide initial and final reuse searches, proactive direct
  reuse, wrapper disposition, and independent reviewer verification.
- Planned files: `AGENTS.md`, `docs/development.md`, `docs/roadmap/task-template.md`,
  `docs/review-checklist.md`, `.github/pull_request_template.md`, and this maintenance record.
- Public-contract impact: None.
- Explicitly excluded: EO-003 code cleanup, EO-007 primitive consolidation, dependency changes,
  automated semantic classification, CI workflow changes, configuration, commands, Protocol DTOs,
  persistence, and product behavior.
- Build vs Buy triggers: None. This maintenance changes repository workflow rules and evidence only.
- Build vs Buy decision and evidence: Not applicable. An automated declaration scanner was considered
  but rejected for this tranche because same-name detection cannot determine semantic ownership and
  the installed TypeScript 7 package exposes parsing through unstable APIs. Existing Git/search tools
  remain optional evidence; executor and reviewer semantic judgment stays authoritative.
- Initial Reuse Audit: Searched `Reuse Before Build`, `Reuse Audit`, `Similarity Audit`, task templates,
  review requirements, PR evidence, CI commands, and prior maintenance decisions. Existing root rules
  and `docs/development.md` remain the authority and are deepened rather than replaced. The roadmap
  task template, review checklist, and PR template are reused as the evidence surfaces. No new workflow
  system, dependency, or parallel policy owner is introduced.
- Active reuse plan: Deepen the existing root workflow rules and reuse the existing task, review, and
  pull-request evidence surfaces. Do not create a scanner, policy package, or second process owner.
- Second/third implementation assessment: None. All changes deepen existing documentation owners.
- Final Similarity Audit plan: Review the final diff and repository-wide search evidence for actual
  changed behavior, semantic owners, and intentional remaining similarities. An independent reviewer
  repeats the search and records any difference in the PR handoff.
- Verification: Review the rendered rule flow and cross-document terminology; run the repository
  formatter/linter, `git diff --check`, status, and diff review.

## Similarity Audit

Root `AGENTS.md` remains the only policy owner. `docs/development.md` owns implementation mechanics;
the task template and PR template own executor and handoff evidence; the review checklist owns the
independent review gate; and this record owns maintenance rationale and outcome. Repeated terms are
intentional links between distinct surfaces, not parallel policy implementations.
The final audit found no product-code, script, dependency, or CI changes. Exact search commands and
temporary match counts are review evidence in the PR handoff, not persistent maintenance state.

## Completion

- Implementation summary: Any agent implementing a change must now search before writing, actively call
  or deepen existing owners, avoid operation-specific forwarding wrappers used only for error
  translation, and provide a final actual-symbol inventory. Any agent reviewing the implementation must
  independently repeat the search and block incomplete evidence or unjustified duplicates even when
  behavioral checks pass.
- Verification: `pnpm run check` passed for 380 files; `git diff --check` passed; actual product-code
  declarations changed: 0. Typecheck, unit, integration, build, and VSIX checks were not run because
  the change is documentation/process-only.
- Public-contract impact: None. No configuration, command, Protocol DTO, persistence, dependency, package
  boundary, CI workflow, or product behavior changed.
