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
- Final Similarity Audit plan: Run the reproducible full-repository searches and changed-file checks
  below, then inventory every changed document surface and confirm that the code declaration count is
  zero. An independent reviewer repeats the same searches and records any difference.
- Verification: Review the rendered rule flow and cross-document terminology; run the repository
  formatter/linter, `git diff --check`, final repository-wide similarity search, status, and diff review.

## Similarity Audit

### Reproducible full-repository searches

Run these commands from the repository root against PR base
`4bb03ba3a4c23a9564d2e02a98d12d3d000ad14a` and the final maintenance head:

```powershell
rg -n -i --glob 'AGENTS.md' --glob 'docs/**' --glob '.github/pull_request_template.md' `
  'reuse before build|reuse audit|similarity audit|repository-wide|operation-specific|pass-through|final inventory|independent reviewer|direct reuse|deepened'
```

Result: 56 policy/document matches across the root policy, development guidance, task template,
review checklist, PR template, engineering-opportunity ledger, and maintenance records. The exact
semantic owners are listed in the inventory below.

```powershell
rg -n -i --glob 'docs/engineering-opportunities.md' --glob 'docs/maintenance/EO-*.md' `
  'reuse|duplicate|wrapper|owner|similarity|build vs buy'
```

Result: 58 engineering-opportunity matches; these records remain candidates and prior ownership
evidence, not a second policy owner.

```powershell
rg -n -i --glob 'apps/**' --glob 'packages/**' `
  'vscode-session-storage|vscode-checkpoint-storage|IdeSourceProjector|VscodeBoundedTextStorage|utf8ByteLength|assertPathSegment'
```

Result: 307 focused code-area candidate matches were inspected for existing owners; this maintenance
does not change any of them.

```powershell
git diff --name-only 4bb03ba3a4c23a9564d2e02a98d12d3d000ad14a HEAD -- `
  apps packages scripts .github/workflows package.json pnpm-lock.yaml
```

Result: no output (0 code, configuration, dependency, script, or workflow files changed).

```powershell
git diff --name-only 4bb03ba3a4c23a9564d2e02a98d12d3d000ad14a HEAD -- `
  AGENTS.md docs/development.md docs/roadmap/task-template.md docs/review-checklist.md `
  .github/pull_request_template.md docs/maintenance/reuse-audit-enforcement.md
```

Result: exactly the six authorized files listed in `Planned files`; no other file is in the PR.

### Changed-surface inventory

The final diff contains no product-code declarations. Counts below are changed documentation
surfaces (not runtime symbols); each has one semantic owner and one disposition:

| Location | Changed surface count | Semantic owner | Disposition |
| --- | ---: | --- | --- |
| `AGENTS.md` §4.1.1 | 2 policy obligations | Root agent policy | Retain concise role-independent implementation/review gates; link details outward |
| `docs/development.md` §Reuse Before Build | 2 guidance bullets | Development guidance | Deepen existing mechanics for search, direct reuse, wrapper mapping, and final inventory |
| `docs/roadmap/task-template.md` Reuse/Completion fields | 2 evidence field groups | Roadmap task evidence | Reuse existing task template; require initial and final inventory fields |
| `docs/review-checklist.md` §2 | 3 review checks | Independent review gate | Reuse checklist; require reviewer repeat-search and wrapper disposition |
| `.github/pull_request_template.md` Reuse section | 5 handoff fields | PR evidence surface | Expose the same evidence for review; no new process owner |
| `docs/maintenance/reuse-audit-enforcement.md` | 1 maintenance record | Maintenance evidence ledger | Record rationale, commands, counts, owners, and final disposition |
| `apps/**`, `packages/**`, scripts, workflows, manifests | 0 declarations | Existing product/CI owners | No changes; no scanner, dependency, command, workflow, or product behavior added |

Root `AGENTS.md` remains the concise policy owner. `docs/development.md` owns implementation
mechanics; the task template owns executor fields; the review checklist owns the independent gate;
the PR template exposes handoff evidence; and this record owns maintenance evidence. Repeated terms
are intentional links between distinct surfaces, not parallel implementations.

## Completion

- Implementation summary: Any agent implementing a change must now search before writing, actively call
  or deepen existing owners, avoid operation-specific forwarding wrappers used only for error
  translation, and provide a final actual-symbol inventory. Any agent reviewing the implementation must
  independently repeat the search and block incomplete evidence or unjustified duplicates even when
  behavioral checks pass.
- Verification: `pnpm run check` passed for 380 files; `git diff --check` passed; the exact final searches
  above returned 56 policy/document matches, 58 engineering-opportunity matches, 307 focused code-area
  candidate matches, and an empty changed-code/config/dependency/workflow file list. Actual product-code
  declarations changed: 0. Typecheck, unit, integration, build, and VSIX checks were not run because
  the change is documentation/process-only.
- Public-contract impact: None. No configuration, command, Protocol DTO, persistence, dependency, package
  boundary, CI workflow, or product behavior changed.
