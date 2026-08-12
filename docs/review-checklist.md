# Implementation Review Checklist

This checklist supports implementation review by the primary agent and review subagents. It verifies
the rules in [`AGENTS.md`](../AGENTS.md) and the operational criteria in
[`Development Guidelines`](development.md#reuse-before-build); it does not redefine their authority.
Reviewers read only the task-relevant documents and changes required by the progressive-loading
rules.

## 1. Scope and Evidence

- [ ] The change belongs to the authorized roadmap task or standalone maintenance scope.
- [ ] Planned files, exclusions, public-contract impact, and verification match the implementation.
- [ ] Required task-plan evidence is present and updated when implementation findings changed the
      design.
- [ ] Non-blocking discoveries are recorded instead of being implemented opportunistically.

## 2. Reuse Before Build

- [ ] The reviewer independently searched by concept, behavior, owning type, error, invariant, and
      dependency combination rather than relying on the proposed symbol name or author-provided audit.
- [ ] The search covered public entry points, owning and adjacent modules, tests and test support, and
      applicable architecture or domain documents.
- [ ] Existing candidates and non-reuse reasons are recorded and consistent with the implementation.
- [ ] A second implementation includes a direct-reuse or module-deepening assessment. A third equivalent
      implementation has demonstrated distinct ownership or semantics; otherwise it blocks approval.
- [ ] The change does not duplicate security, budget, cancellation, ordering, stale-fencing, serialization,
      or stable-error rules merely to produce a different caller-facing error.
- [ ] Any extracted module has a clear owner and a smaller interface than the complexity it hides; it is
      not a repository-wide utilities collection or a pass-through layer.
- [ ] Superseded implementations and implementation-specific tests are removed once equivalent behavioral
      coverage exists; the change does not leave both paths active or add a pass-through layer.
- [ ] The completion report includes a Similarity Audit based on the actual implementation.

## 3. Build vs Buy

- [ ] The reviewer identified whether the change implements a parser, tokenizer, regular-expression
      engine, diff or patch algorithm, serializer, retry/backoff mechanism, queue, mutex,
      concurrency primitive, encoding algorithm, protocol primitive, or similar general-purpose
      mechanism.
- [ ] The reviewer checked the additional triggers: roughly 100 lines of general-purpose logic,
      implementation in two or more places, or substantial algorithm-specific boundary tests.
- [ ] When a trigger applies, the task plan evaluates the standard library or VS Code API, existing
      dependencies, official SDKs, maintained third-party libraries, and self-implementation in the
      order required by `docs/development.md`.
- [ ] The chosen option has concrete evidence covering maintenance status, license, runtime and
      toolchain compatibility, packaging or VSIX impact, cancellation behavior, security behavior,
      and the amount of project-owned adapter code still required.
- [ ] Self-implementation is justified by product semantics, boundary requirements, inadequate
      candidates, or lower total maintenance cost rather than a preference for zero dependencies.
- [ ] A new dependency materially removes algorithmic, compatibility, or security maintenance; it
      does not merely replace small, stable utility logic.
- [ ] Third-party mechanisms remain behind CtrlZebra-owned interfaces, and third-party types,
      failures, defaults, lifecycle decisions, and unbounded values do not cross public boundaries.
- [ ] CtrlZebra still owns product policy, authorization, lifecycle, state transitions, budgets,
      cancellation semantics, persistence compatibility, security gates, and stable errors.
- [ ] Repeated infrastructure has one justified owner or an explicit follow-up disposition.

## 4. Review Outcomes

- Missing required reuse or Build vs Buy evidence is an actionable review finding; reviewers do not
  infer a justification from the implementation.
- A better library discovered during review does not authorize unrelated adoption. The reviewer
  reports the candidate, expected benefit, and best task or maintenance scope.
- Review agents do not add, remove, or upgrade dependencies while performing a read-only review.
- Approval of the mechanism does not approve a product-scope, module-boundary, public-contract,
  persisted-format, security-model, or technical-baseline change; those changes still follow the
  change-control process in `AGENTS.md`.
