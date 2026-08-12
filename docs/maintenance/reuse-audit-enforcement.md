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
  review requirements, PR evidence, CI commands, and existing EO-001 through EO-004 maintenance records.
  Existing root rules and `docs/development.md` remain the authority and are deepened rather than
  replaced. The roadmap task template, review checklist, and PR template are reused as the evidence
  surfaces. No new workflow system, dependency, or parallel policy owner is introduced.
- Active reuse plan: Deepen the existing root workflow rules and reuse the existing task, review, and
  pull-request evidence surfaces. Do not create a scanner, policy package, or second process owner.
- Second/third implementation assessment: None. All changes deepen existing documentation owners.
- Final Similarity Audit plan: Search the final diff and repository for executor reuse responsibility,
  repository-wide searches, direct reuse, pass-through wrappers, actual-symbol inventories, and
  independent reviewer verification; record all remaining adjacent rules and their ownership below.
- Verification: Review the rendered rule flow and cross-document terminology; run the repository
  formatter/linter, `git diff --check`, final repository-wide similarity search, status, and diff review.

## Similarity Audit

- Final searches covered `Any agent that implements`, `Reuse Audit`, `Similarity Audit`,
  `repository-wide`, `operation-specific`, `pass-through`, `final inventory`, and independent reviewing
  agent searches across `AGENTS.md`, `docs`, and the pull-request template.
- Root `AGENTS.md` remains the policy owner. `docs/development.md` explains implementation mechanics,
  the roadmap task template captures executor evidence, the review checklist captures the independent
  reviewer gate, and the pull-request template exposes the evidence during handoff. These are distinct
  workflow surfaces, not parallel policy implementations.
- The considered declaration scanner and CI gate were removed before completion. No script, dependency,
  package command, workflow step, automated allowlist, or second semantic classifier remains.
- Remaining similarity is intentional terminology linking each evidence surface to the root rule. Future
  workflow changes must deepen these owners rather than add another checklist or audit format.

## Completion

- Implementation summary: Any agent implementing a change must now search before writing, actively call
  or deepen existing owners, avoid operation-specific forwarding wrappers used only for error
  translation, and provide a final actual-symbol inventory. Any agent reviewing the implementation must
  independently repeat the search and block incomplete evidence or unjustified duplicates even when
  behavioral checks pass.
- Verification: `pnpm run check` passed for 380 files; `git diff --check` passed; the final repository-wide
  terminology and ownership search is recorded above. No product code changed, so typecheck, unit,
  integration, build, and VSIX checks were not run.
- Public-contract impact: None. No configuration, command, Protocol DTO, persistence, dependency, package
  boundary, CI workflow, or product behavior changed.
