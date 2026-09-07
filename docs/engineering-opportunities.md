# CtrlZebra Engineering Opportunity Ledger

## 1. Purpose and Ownership

This ledger records reuse, module-deepening, dependency, and duplication-removal opportunities that
are not yet authorized for implementation, so that discoveries are neither lost nor used to bypass
task scope under the guise of cleanup. This document owns only opportunity status, evaluation gates,
and the next evaluation window; merged PRs and Git history hold completed decisions, execution
evidence, and verification conclusions; issues, PRs, and transient task handoffs own the order and
status of concrete work items. It does not own product semantics, public contracts, or the technical
baseline.

- `EO-*` is a stable opportunity identifier, not a work-item identifier, and does not imply
  authorization.
- A candidate enters an issue, PR, or standalone maintenance change only after explicit approval.
- A standalone change that needs cross-session tracking, dependency review, multiple PRs, or external
  discussion gets a GitHub issue before implementation, linked from this ledger; small maintenance
  that fits in one authorized session may use a transient handoff instead.
- Once promoted, execution order and status live only in the corresponding issue or PR; merged PRs and
  Git history are the source for completed decisions and execution evidence. This ledger keeps only
  the entry point, status, and final disposition, so that no second task-status system forms.
- When an out-of-scope opportunity is found, update this ledger only; do not implement it in passing.

## 2. Status and Promotion Flow

| Status | Meaning |
|---|---|
| `Discovered` | Initial duplication or Build-vs-Buy evidence exists; no solution evaluation yet |
| `Under evaluation` | Candidate seam, alternatives, and principal risks identified; awaiting decision or validation |
| `Ready to promote` | Approach is specific enough; awaiting explicit authorization into an issue/PR or maintenance change |
| `Promoted` | A formal task, issue, or PR exists; that record owns execution status |
| `Completed` | The promoted item is merged, and the old implementation and any residue this ledger required are disposed of |
| `Deferred` | Insufficient benefit, evidence, or window right now; re-evaluation trigger retained |
| `Rejected` | Decided against, with the reason recorded |

When promoting an opportunity:

1. Re-verify that the evidence still holds and that the opportunity has not been absorbed by currently
   approved work.
2. Determine the reuse level, module ownership, and replacement-completion gate per
   [Reuse Before Build](development.md#reuse-before-build); when
   [Build vs Buy](development.md#build-vs-buy) is triggered, complete that evaluation and retain the
   evidence in the PR or transient handoff.
3. Decide whether it is a roadmap capability, standalone maintenance, or acceptance content of an
   existing task; when it touches order, the technical baseline, public contracts, or module
   direction, follow [AGENTS.md change control](../AGENTS.md#6-change-control-and-stop-conditions).
4. Promote a single independently verifiable tranche, implement it only after explicit authorization,
   and record the link and disposition here on completion.

## 3. Candidate Set and Suggested Windows

The table lists only opportunities that are not fully disposed of and still need evaluation or an
explicit window; promoted and completed items move to section 4. Windows are planning suggestions and
do not change the current execution point.

| Opportunity | Type | Priority | Suggested window or dependency | Status |
|---|---|---:|---|---|
| [EO-009 Markdown renderer](#eo-009-markdown-renderer) | Buy re-evaluation | P3 | Prove net benefit and pass baseline change control first | `Deferred` |
| [EO-010 Targeted Zod reuse](#eo-010-targeted-zod-reuse) | Existing-dependency reuse | P2 | In tranches, alongside the task that owns the schema | `Discovered` |
| [EO-011 Provider token counting](#eo-011-provider-token-counting) | Buy / experiment | P3 | Requires accuracy or budget-defect data first | `Deferred` |
| [EO-012 MCP SDK-native negotiation](#eo-012-mcp-sdk-native-negotiation) | Buy / existing-dependency deepening | P0 | Evaluate before MCP evolves again; does not block the roadmap | `Under evaluation` |
| [EO-013 Webview chat-store responsibility density](#eo-013-webview-chat-store-responsibility-density) | Module deepening | P2 | Needs independent Webview behavior-partition evidence; not part of currently approved work | `Deferred` |

The one relationship that still affects future execution is:

```text
EO-012 evidence ──→ independent maintenance decision
```

EO-012 can be evaluated independently; unless an actual defect is found in the current negotiation, it
does not block roadmap progress. EO-009 and EO-011 must not block the current release wrap-up. If
SDK-native negotiation is verified to preserve the existing security semantics, promote it to
standalone maintenance.

### EO-013 Webview chat-store responsibility density

- **Evidence**: a single file, `apps/webview/src/chat-store.ts`, concentrates projection of messages,
  reasoning, tool/approval, run state, usage/budget, regeneration, recovery, and batching. The size
  trend of that file is owned by the hotspot baseline in `scripts/check-architecture.mjs`; this ledger
  does not restate line counts.
- **Current judgment**: deferred. Only responsibility-density evidence exists — there is no second
  equivalent store lifecycle and no approved Webview production split. File size and change frequency
  alone do not authorize an abstraction.
- **Re-evaluation trigger**: a new Webview capability must span more than two stable behavior regions,
  or focused behavior tests demonstrate that the current store has become an unlocatable regression
  boundary.
- **Constraints**: establish focused suites along real Webview behavior boundaries first; preserve the
  Protocol-only Webview import direction, message-projection order, and observable recovery/approval
  semantics; do not introduce a cross-package `common` or manager wrapper.

## 4. Closed Opportunities

EO-001 through EO-008 are complete. Technical decisions, execution evidence, and verification
conclusions are retained by the merged PRs and Git history; this ledger no longer duplicates execution
records for closed items.

## 5. Build vs Buy Opportunities

### EO-009 Markdown renderer

- **Current judgment**: deferred. The project already uses and pins `markdown-it`; what is
  self-maintained is only the constrained Markdown-token-to-React-tree mapping and the product security
  policy. This is not a straightforward case of "failing to buy off the shelf".
- **Re-evaluation trigger**: the maintenance cost of the hand-written token-to-tree mapping keeps
  growing, and a Webview-private renderer adapter can still retain the bounded prefix, element
  allowlist, custom links, copy interaction, and error degradation.
- **Initial screening material**: [`react-markdown` repository and documentation](https://github.com/remarkjs/react-markdown).
- **To complete when evaluation starts**: corpus differential tests, GFM scope, bundle/VSIX impact,
  React/Vite compatibility, dependency tree and license, malicious URL/HTML behavior, and net
  maintenance benefit. A replacement changes the technical baseline and requires change control first.

### EO-010 Targeted Zod reuse

- **Evidence**: the repository already uses Zod, but some `unknown` inputs are still validated by
  duplicated record/field parsers.
- **Candidate mechanism**: prefer reusing schemas already owned by Protocol, or define the schema in
  the package that actually owns the input semantics; do not attempt a repository-wide one-shot
  "Zod-ification".
- **Target seam**: the schema is responsible for structural validation; the calling module remains
  responsible for budgets, authorization, state, and stable error mapping.
- **Acceptance**: each tranche proves the schema is the single source of truth, removes the superseded
  parser and its implementation-specific tests, and keeps public/error compatibility tests; accepted
  inputs and package dependency direction must not change for convenience.

### EO-011 Provider token counting

- **Current judgment**: deferred. `gpt-tokenizer` provides OpenAI model/encoding-level counting but
  cannot accurately represent Gemini or arbitrary OpenAI-compatible providers; adopting it globally
  would manufacture incorrect product semantics.
- **Initial screening material**: [`gpt-tokenizer` repository and documentation](https://github.com/niieani/gpt-tokenizer).
- **Re-evaluation trigger**: real data shows the current estimate causes significant context waste,
  rejections, or overflow, and the provider adapter can select a trustworthy encoding for known
  models; Core still depends only on an injected token-counting interface, and unknown models retain a
  bounded fallback.
- **To complete when evaluation starts**: model coverage, version-drift policy, bundle/startup cost,
  offline behavior, accuracy corpus, and provider-specific failure mapping. Do not open a dependency PR
  before the trigger is met.

### EO-012 MCP SDK-native negotiation

- **Evidence**: `packages/mcp-client/src/mcp-negotiation.ts` currently implements MCP modern-first
  negotiation itself, including the `server/discover` probe, JSON-RPC request/reply classification,
  timeouts, modern/legacy determination, UnsupportedProtocolVersion handling, DiscoverResult and
  capability structure validation, and temporary takeover of the probe transport handler. Today
  `ControlledMcpClient.connect()` first calls the package-owned `negotiateMcpEra()` and then hands the
  negotiation result to `@modelcontextprotocol/client` via `Client.connect(..., { prior })`. The
  repository already pins `@modelcontextprotocol/client@2.0.0`, and `sdk-options.ts` already configures
  the SDK's `versionNegotiation`, so whether a self-built protocol negotiation layer is still necessary
  should be re-evaluated.
- **Candidate mechanism**: first evaluate the native version negotiation / probe classification
  capabilities of `@modelcontextprotocol/client` v2, letting the SDK own MCP wire-level protocol
  negotiation while CtrlZebra retains only product-level security and lifecycle policy. Do not add a
  second MCP library, and do not maintain a protocol state machine the SDK already provides officially.
- **Target seam**: `ControlledMcpClient` continues to own host-owned process / stdio transport
  lifecycle, startup approval and Workspace Trust, generation fencing, cancellation and stale-completion
  rejection, bounded stderr / cleanup, termination confirmation, CtrlZebra stable error mapping, and
  connection-state projection. The MCP SDK should own as much as possible of the `server/discover` wire
  protocol, protocol-version negotiation, UnsupportedProtocolVersion handling, modern negotiation DTO /
  protocol validation, and the negotiation failure taxonomy the SDK formally defines. SDK-native types,
  exceptions, and negotiation DTOs must not leak directly into Core, Protocol, or Webview public
  contracts.
- **Build vs Buy**: prefer deepening the existing `@modelcontextprotocol/client` dependency over
  continuing to maintain a CtrlZebra-private protocol negotiation implementation. Retain the self-built
  negotiation seam only if differential validation proves the SDK cannot express CtrlZebra's fixed
  modern-only / dual downgrade security semantics, or cannot maintain bounded, deterministic failure
  classification.
- **Evidence to complete**:
  1. Verify the public API of the currently pinned SDK version, rather than relying on unreleased or
     internal API.
  2. Build a differential corpus between the existing `negotiateMcpEra()` and SDK-native negotiation.
  3. Cover modern success, unsupported requested version, legacy server, timeout, malformed result,
     unknown JSON-RPC error, server exit, abort, and stale generation.
  4. Establish the SDK's actual behavior for modern-only and dual compatibility mode.
  5. Verify whether structural validation of `supportedVersions`, capabilities, and DiscoverResult is
     fully owned by the SDK; the current security boundary must not be loosened merely to reduce code.
  6. Verify that the transport can still preserve CtrlZebra-owned process termination, stderr bounds,
     and the delivery gate.
  7. Compare bundle/VSIX size, type complexity, test volume, and the net code finally deleted.
- **Expected deletions**: if SDK-native negotiation is adopted, delete the probe / classifier /
  protocol DTO validation in `mcp-negotiation.ts` that the SDK equivalently owns, package-private
  helpers that serve only those implementations, implementation-specific tests that verify the deleted
  internal algorithm rather than product behavior, and the glue code that exists before
  `Client.connect(..., { prior })` solely to bypass SDK negotiation. Do not keep a long-lived
  "SDK negotiation plus self-built negotiation" dual path or a fallback shadow implementation.
- **Acceptance**: public MCP connection / error / capability contracts are unchanged unless formal
  change control is completed first; modern-only performs no unauthorized legacy downgrade; dual mode's
  downgrade conditions are no looser than the current implementation; malformed, timeout, abort,
  stale-generation, and transport-failure behavior has equivalent or stricter test coverage; process
  cleanup and termination confirmation remain owned by the CtrlZebra host boundary; the superseded
  implementation is deleted once all differential tests pass, with no dual path retained; the full MCP
  unit, extension integration, and VSIX smoke test suites pass.
- **Size and risk**: medium to large; protocol- and compatibility-sensitive, but with high net-deletion
  potential. Do a standalone investigation / proof tranche first, then decide whether to promote it to
  maintenance.
