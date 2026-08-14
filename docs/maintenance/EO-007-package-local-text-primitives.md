# EO-007 Package-local Text Primitives

## Scope Gate

- Authorized tranche: one maintenance change covering every equivalent implementation identified by the
  repository audit within each shared package/application runtime. Each package keeps its own private
  seam for text measurement, record predicates, URI identity, and canonical JSON/equality.
- Contract gate: preserve limits, schema errors, malformed-Unicode handling, public exports,
  persistence, configuration, commands, lifecycle, and security policy.
- Handoff gate: implementation remained available for independent task-reviewer review.

## Maintenance Change

- Goal: Promote equivalent small implementations into package-local owners without creating a
  repository-wide utility.
- Reason: Repeated UTF-8 measurement, record predicates, URI identity, and canonical
  JSON/equality could drift at byte limits, Unicode boundaries, validation errors, and exact
  comparison semantics.
- Scope: Add private seams and contract coverage; migrate equivalent callers; retain package
  boundaries and no public re-exports.
- Public-contract impact: None.
- Explicitly excluded: Cross-package utilities, public exports, dependencies, Protocol schema redesign,
  persistence encoding, and unrelated refactoring. Byte-emitting encoders, descriptor/accessor
  validation, order-sensitive `sameJson`, provider one-offs, and other semantically distinct helpers
  remain their existing owners. Standalone Node VSIX validation remains a separate Node owner from
  Extension TypeScript; Builtin-tools boundary validation remains its package owner.
- Build vs Buy: Deepen each existing package with a pure private helper. Standard `TextEncoder`
  remains the runtime primitive behind numeric byte-width owners where appropriate, but allocation,
  package boundaries, policy, and malformed-input behavior remain CtrlZebra-owned. No dependency or
  cross-package utility would remove those semantics.
- Reuse: Repository-wide audit found equivalent clusters in the packages below; no fourth owner or
  public utility was introduced.

## Scope Matrix

| Semantic cluster | Package-local owner | Durable boundary retained |
|---|---|---|
| Text measurement and numeric UTF-8 width | Protocol, Core, Builtin-tools, MCP-client, Providers, Extension adapters, and Webview `text-primitives` seams | Streaming counters, malformed-Unicode checks, persistence/transport encoders, and caller error/limit mapping stay local |
| Loose/plain records and exact-key checks | Existing Builtin-tools boundary validation; new Core, MCP-client, and Extension record-validation seams; standalone Node VSIX record owner | Domain `readRecord` wrappers retain allowed-key, descriptor/accessor, and stable-error policy |
| URI identity/comparison | Extension `uri-comparison` seam | Workspace containment/case policy and source projection remain in their owning adapters |
| Canonical JSON/equality | Core canonical/json-values seams and Webview canonical-json seam | Extension `sameJson` remains order-sensitive exact-operation comparison |
| Directly evidenced test helpers | Call package-local owners or retain distinct caller fixtures | No public testkit or repository-wide helper is added |

Every row represents one package-local owner, not a shared cross-package abstraction. Remaining one-off
helpers are intentionally separate where semantics differ.

## Similarity Audit

The final disposition is one text owner per listed package, one record-predicate owner in each
applicable package, one Extension URI comparison owner, and Core/Webview canonical JSON/equality
owners. Callers retain narrow error mapping, schema/accessor checks, streaming/depth logic, host
composition, and transport/storage encoding. The standalone VSIX script imports its Node-local
record owner; it is not coupled to bundled Extension code. Direct test helpers now call the owning
seam. No duplicate equivalent implementation remains in the audited clusters.

Future changes must extend the package-local owner and its contract tests. Do not create a
repository-wide `text-utils`/common package, public export, or wrapper that crosses package policy.
Any newly observed one-off or semantically different helper requires a fresh reuse audit.

## Completion

- Implementation summary: Added private text, record, URI, canonical JSON, and JSON equality seams
  in the owning packages/applications; migrated equivalent callers and directly evidenced test
  helpers; retained strict malformed-Unicode, descriptor, streaming, order-sensitive, and
  transport/persistence semantics where they differ.
- Verification conclusion: Affected-package and full tests, package/workspace typechecks, repository
  check, build, integration, and final diff review passed; known harness warnings were non-fatal.
- Similarity disposition: Final audit confirmed one owner per semantic cluster and no public export,
  dependency, cross-package utility, or duplicate equivalent implementation.
- PR/branch: PR #222 was independently reviewed and squash-merged as
  `53bc57bc73fd58766dc334839937adb5ff947a16`; the feature branch was deleted after merge.
