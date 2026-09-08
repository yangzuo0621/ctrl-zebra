# CtrlZebra Engineering Opportunities

This is an inbox for useful engineering discoveries outside the authorized task. Keep only the
evidence location, potential benefit, re-evaluation trigger, and disposition or Issue/PR link.
An `EO-*` identifier preserves a reference; it grants no implementation authorization or priority
over approved work. Reuse and dependency decisions follow
[Reuse Before Build](development.md#reuse-before-build) and
[Build vs Buy](development.md#build-vs-buy).

When an opportunity becomes an authorized task, move its investigation plan and acceptance criteria
to the Issue/PR or transient maintenance handoff. Keep only a link here when a durable task exists;
do not mirror execution status. Remove resolved entries; Git and merged PRs retain their history.
Read-only reviewers report discoveries to the caller, who records useful candidates within the
authorized work. Do not implement an opportunity in passing.

## EO-009 Markdown renderer

- **Evidence**: the project already uses pinned `markdown-it`; the custom seam is the constrained
  Markdown-token-to-React-tree mapping and product security policy.
- **Potential benefit**: a renderer adapter might reduce mapping maintenance if its net benefit is
  demonstrated; this is not a missing-parser problem.
- **Re-evaluation trigger**: mapping maintenance grows enough to justify comparing an alternative
  against existing rendering behavior, security constraints, and packaging cost.
- **Disposition**: deferred. Any replacement must preserve bounded rendering, the element allowlist,
  links, copy interaction, and error degradation, and requires technical-baseline change control.

## EO-010 Targeted Zod reuse

- **Evidence**: Zod is already used, while some `unknown` inputs still use duplicated record/field
  parsers. Identify concrete equivalent parsers in the schema owner's area before proposing work.
- **Potential benefit**: reuse owner-defined schemas to remove duplicate structural validation while
  keeping budgets, authorization, state, and stable error mapping with their current owners.
- **Re-evaluation trigger**: an authorized task touches a schema boundary with equivalent parsers.
- **Disposition**: candidate for a bounded maintenance change or explicitly included task scope;
  no repository-wide conversion. Preserve accepted inputs and package dependency direction.

## EO-011 Provider token counting

- **Evidence**: provider coverage varies; a tokenizer for known OpenAI encodings cannot by itself
  establish accurate counting for Gemini or arbitrary OpenAI-compatible providers.
- **Potential benefit**: provider-specific counting could improve context utilization if estimation
  error is causing measurable waste or failures.
- **Re-evaluation trigger**: real data shows significant context waste, rejections, or overflow, and
  a provider adapter can select a trustworthy encoding for known models.
- **Disposition**: deferred pending data. Keep Core's injected counting interface and a bounded
  fallback for unknown models; no dependency adoption is authorized.

## EO-012 MCP SDK-native negotiation

- **Evidence**: `packages/mcp-client/src/mcp-negotiation.ts` implements the discovery probe,
  classification, validation, and timeouts. `controlled-mcp-client.ts` calls `negotiateMcpEra()` and
  supplies `prior` to `Client.connect()`, while `sdk-options.ts` configures SDK version negotiation.
- **Potential benefit**: deepening the existing MCP SDK dependency could remove custom wire-protocol
  machinery. Whether the pinned public SDK API can replace this seam remains unproven.
- **Re-evaluation trigger**: the next negotiation change, or explicit authorization for a standalone
  investigation comparing SDK behavior with the current implementation.
- **Disposition**: candidate investigation; does not block roadmap work absent a verified defect.
  Preserve modern-only/dual downgrade policy, stable errors, bounded validation, cancellation,
  generation fencing, and host-owned process cleanup. Define differential cases and replacement
  acceptance criteria in the authorized task before implementation.

## EO-013 Webview chat-store responsibility density

- **Evidence**: `apps/webview/src/chat-store.ts` concentrates message projection, reasoning,
  tool/approval, run state, usage/budget, regeneration, recovery, and batching. The size baseline is
  owned by `scripts/check-architecture.mjs`; size alone does not establish a need for abstraction.
- **Potential benefit**: clearer behavior boundaries could make regressions easier to locate.
- **Re-evaluation trigger**: a new capability spans more than two stable behavior regions, or focused
  tests demonstrate that the store has become an unlocatable regression boundary.
- **Disposition**: deferred pending behavior-partition evidence. Preserve Protocol-only imports,
  projection order, and recovery/approval semantics; no production split is currently authorized.
