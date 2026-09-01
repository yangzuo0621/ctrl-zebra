# T2301 Maintainability Hotspot Baseline

## 1. Scope and snapshot

This report is a bounded, read-only maintainability snapshot for Phase 23. It records evidence for
T2302-T2306 without changing production code, tests, configuration, package boundaries, public
contracts, persisted data, security policy, or user behavior. It is not a new architecture owner;
the linked domain documents and public package entry points remain authoritative.

- Baseline revision: `471f9177961c06ec8d6d7965a2b79890615523c2` (`main`, 2026-09-01).
- Size measure: physical lines in tracked TypeScript/TSX and Markdown source; generated output,
  dependencies, and roadmap archives are excluded.
- Change-frequency window: the 269 commits from 2026-07-01 through the baseline revision. A count is
  the number of commits touching the path, not the number of changed lines.
- Similarity tier: **TARGETED**. Searches covered the named hotspots, their existing owners and
  adjacent tests, workspace manifests/imports/exports, `EO-001`-`EO-008`, and their maintenance
  records. No shared abstraction, dependency, or replacement is proposed by this task.
- Interpretation: size and frequency are review signals. A candidate is actionable only when the
  responsibility, repeated mechanism, lifecycle, or owner evidence below also supports it.

## 2. Production hotspots

| Path | Lines | Commits | Evidence and disposition |
|---|---:|---:|---|
| `apps/extension/src/extension.ts` | 1,448 | 49 | Highest-change production file. `activate()` owns valid composition, but lines 323-639 also inline five file-mutation validation/diff/checkpoint/apply compositions, while editor-context and workspace-reference feature closures occupy further large blocks. T2305 should move only cohesive feature wiring to an existing controller/adapter or feature-local composition owner; registrations and dependency assembly stay here. |
| `apps/webview/src/chat-store.ts` | 1,444 | 19 | One store projects messages, reasoning, Tool/approval state, Run status, usage/budget, regeneration, recovery, and batching. It is a real responsibility-density signal, but Phase 23 has no authorized Webview-production refactor and the audit found no second equivalent store lifecycle. Monitor through T2306 advisory output; do not refactor in T2302-T2305. |
| `packages/core/src/agent-runtime.ts` | 1,269 | 27 | Core orchestration entry also owns history loading/validation and pruning, overflow retry, model-event/reasoning normalization, Tool selection/execution, approval consumption, Run budget observation, diagnostics, and terminal priority. Concrete cohesive clusters are listed for T2304 below. |
| `apps/extension/src/adapters/vscode-language-services.ts` | 1,135 | 3 | Large but low-change adapter. Its source projection primitives already delegate to `ideSourceProjector`; collection, VS Code calls, bounds, cancellation, and error mapping remain one Host adapter responsibility. Size alone does not justify a Phase 23 split. |
| `packages/protocol/src/messages.ts` | 1,083 | 32 | High-frequency public schema owner with many closed message variants. It is intentionally centralized at the wire boundary; T2301 found no unauthorized dependency or second message-schema owner. Protocol changes are excluded from Phase 23. |
| `apps/extension/src/adapters/vscode-diagnostics.ts` | 892 | 3 | Large but low-change Host adapter and an EO-003 consumer. Projection primitives are already shared; diagnostics collection/ordering/budget/error mapping remain cohesive enough to retain. |
| `packages/mcp-client/src/controlled-mcp-client.ts` | 886 | 9 | Coordinates MCP connection and catalog behavior. EO-005 already removed the repeated Tool/Prompt/Resource pagination and refresh lifecycles; no regression evidence supports reopening that maintenance. |
| `apps/webview/src/app.tsx` | 867 | 33 | High-change UI composition surface. Component/event breadth is a review signal, but no two equivalent production mechanisms were established and no Phase 23 task authorizes a Webview split. |
| `apps/extension/src/controllers/session-recovery.ts` | 798 | 12 | Owns bounded recovery/projection and compatibility behavior. Its size is coupled to persistence invariants; no change is authorized without separate evidence and compatibility review. |
| `apps/extension/src/controllers/session-history.ts` | 763 | 6 | Owns Session history/deletion/retention projection. Current evidence is size rather than duplicate lifecycle; retain. |
| `apps/extension/src/controllers/chat-runner.ts` | 679 | 21 | High-change Host bridge between runtime, persistence, and Webview events. It is a change-surface participant, but T2304 must keep Core work separate and T2305 may alter it only if composition-root evidence requires a narrow owner change. |

The largest files are therefore not one undifferentiated refactor queue. The actionable Phase 23
production evidence is limited to the Core runtime orchestration cluster and Extension composition
root. Webview, Protocol, IDE adapter, MCP, and persistence candidates remain retained signals unless a
later authorized task finds stronger responsibility or duplication evidence.

## 3. Test hotspots and behavior distribution

| Path | Lines | Commits | Tests | Disposition |
|---|---:|---:|---:|---|
| `packages/core/src/agent-runtime.test.ts` | 3,029 | 26 | 56 | T2303 target. It is both the largest test and a single regression boundary for several independent runtime behaviors. |
| `apps/extension/src/controllers/webview-message-controller.test.ts` | 2,044 | 31 | 26 | High-change Host dispatch suite. No Phase 23 task authorizes its split; retain as an advisory hotspot. |
| `apps/webview/src/chat-store.test.ts` | 1,595 | 11 | 31 | Mirrors the broad store projection. Retain pending an authorized Webview task. |
| `apps/extension/src/controllers/session-recovery.test.ts` | 1,314 | 12 | 30 | Large compatibility/recovery contract suite; splitting without owner-aware fixtures risks hiding persistence invariants. |
| `apps/webview/src/app.test.tsx` | 1,215 | 25 | 23 | High-change UI integration-style component suite; not in Phase 23 production scope. |
| `apps/extension/src/controllers/chat-runner.test.ts` | 1,186 | 16 | 23 | Host/runtime/persistence bridge coverage; keep separate from the Core split. |
| `packages/protocol/src/messages.test.ts` | 919 | 21 | 20 | Public schema boundary matrix. Protocol changes are excluded. |

The 56 `AgentRuntime` tests currently form these contiguous behavior regions:

| Current region | Tests | Observable behavior represented |
|---|---:|---|
| Context, history, overflow, and Run ownership | 20 | External context ordering/budgeting, sequential/concurrent Runs, history validation/pruning, one overflow retry, truncation, and cancellation priority. |
| Approval identity | 1 | Fresh Session/Run/Tool ownership binding per Run. |
| Model stream and finish | 9 | Text/usage/reasoning source order, system instruction, Tool availability, malformed/empty/length-finished response behavior. |
| Tool, approval, output, and loop | 14 | Tool Call/Result ordering, denial and exact approval, preparation/consumption/invalidation, output validation/limits, repetition and maximum steps. |
| Cancellation and abort | 7 | Cancellation during execution/stream/status sinks, caller signal propagation, and no later work. |
| Run token budget | 4 | Estimate/usage boundaries, post-Tool stop, and cancellation priority. |
| Provider failure | 1 | Failed terminal state and error propagation. |

T2303 may split these into focused package-local suites. The existing bottom-of-file
`createModelGateway`, `createScriptedModelGateway`, `createCountingModelGateway`, and
`createNumberTool` helpers are the first reuse candidates. There are 63 `AgentRuntime` constructions
and 26 `ToolRegistry` constructions, but setup similarity alone does not authorize a mega fixture.
Any extracted support remains private to `packages/core`; it must not move to `packages/testkit`.

## 4. Document hotspots and fact ownership risk

| Path | Lines | Commits | Assessment for T2302 |
|---|---:|---:|---|
| `docs/implementation-plan.md` | 156 | 205 | The hottest document by change count, but already a small index with explicit status ownership. Keep it as the canonical hot router; do not add execution evidence or split its state table. |
| `docs/security.md` | 1,356 | 39 | Large, frequently changed, and spans Webview content, Session/history, Tools/workspace, approval, commands, checkpoints, logging, credentials, Providers, MCP, and diagnostics export. These are stable security subdomains, so router-plus-shards is a T2302 candidate only if links and normal task loading become narrower without creating duplicate security owners. |
| `docs/ux.md` | 634 | 28 | Large cross-feature UX owner. Its sections are distinct user journeys, but they remain one UX domain; evaluate navigation and duplicated full rules, not raw size. |
| `docs/protocol.md` | 38 | 27 | Already a lightweight router plus one still-local diagnostics-export contract. Preserve it; do not redesign for symmetry. |
| `docs/webview.md` | 562 | 22 | Owns several stable projection/rendering domains. Candidate for targeted duplicate-rule removal, not automatic splitting. |
| `docs/persistence.md` | 631 | 21 | Strong T2302 candidate: one file owns layout, Session projection/compatibility/damage, Checkpoints, retention/clearing, and MCP persistence. Retain each persistence fact here, but remove full lifecycle/security restatements or shard only along these stable owners. |
| `docs/engineering-opportunities.md` | 165 | 14 | Correctly owns opportunity state and points to maintenance evidence. Preserve as a ledger; do not copy T2301 details into it without a new out-of-scope opportunity. |
| `docs/configuration.md` | 242 | 9 | Mixes editor context, retention, Run budget, clear-data, and the versioned MCP representation/lifecycle. T2302 should identify one canonical setting owner and turn non-owner copies into links or short domain-specific constraints. |
| `docs/development.md` | 178 | 9 | Cohesive development owner. Reuse/Build-vs-Buy rules intentionally connect to the task/review/PR evidence surfaces per `reuse-audit-enforcement.md`; that workflow linkage is not duplicate product policy. |
| `docs/architecture.md` | 20 | 31 | Already the intended lightweight architecture router. Preserve it unchanged unless a broken route is found. |
| `docs/reviews/REVIEW-2026-08-06.md` | 1,540 | 1 | Largest Markdown snapshot but cold historical evidence, not a hot normative owner. Exclude it from T2302. |

Targeted searches show the same features appearing in several domain documents—notably Session
retention, complete local-data clearing, Run budget, IDE context, file lifecycle, and MCP. Many
appearances are legitimate domain facets. T2302 must remove only a complete duplicated normative rule,
leaving a stable link or the minimum security/UX/persistence-specific constraint. It must not choose a
new owner from wording similarity alone.

## 5. Package dependency and public-entry baseline

The workspace manifests and actual static workspace imports produce this graph:

| Importing owner | Actual workspace imports | Manifest result | `AGENTS.md` result |
|---|---|---|---|
| `apps/extension` | `builtin-tools`, `core`, `mcp-client`, `protocol`, `providers` | All declared | Allowed |
| `apps/webview` | `protocol` | Declared | Allowed |
| `packages/core` | `protocol` | Declared | Allowed |
| `packages/providers` | `core` | Declared | Allowed |
| `packages/builtin-tools` | `core`, `protocol` | Declared | Allowed |
| `packages/mcp-client` | `core` | Declared | Allowed |
| `packages/testkit` | `core` | Declared | Allowed; the permitted `protocol` edge is currently unused |

All six library packages expose only `".": "./src/index.ts"`; Providers and Testkit have minimal
entry points while Core, Protocol, Builtin Tools, and MCP re-export their owned public contracts. The
audit found:

- no `@ctrl-zebra/<package>/...` deep import;
- no cross-package cycle in the actual edge graph;
- no VS Code/Node Host/Provider SDK/MCP SDK import in `packages/core`;
- no VS Code import outside `apps/extension`;
- no Provider SDK import outside `packages/providers`;
- no MCP SDK import outside `packages/mcp-client`; and
- no Webview workspace dependency other than `@ctrl-zebra/protocol`.

The map therefore matches manifests, package exports, and the root dependency directions. There is no
T2301 evidence for a package-boundary change. The check is manual today: Biome uses its recommended
rules and `scripts/check-governance-docs.mjs` checks governance text/links, but neither enforces this
import graph. That absence is the concrete T2306 hard-gate opportunity.

## 6. Targeted reuse, similarity, and completed-maintenance regression audit

### Current candidates

1. **Extension file-mutation wiring:** `extension.ts` constructs edit, workspace-edit, create, delete,
   and rename workflows with repeated scope binding, canonical revalidation, Diff presentation,
   Checkpoint-store selection, durable-before-apply adapter construction, Trust checks, conflict
   mapping, and error presentation. These are five concrete compositions, but the approval state
   machine is already single-owned by `FileMutationApprovalWorkflow` and `ApprovalLifecycle`; the
   operation-specific workflow classes correctly retain parse/resource/copy differences. T2305 may
   relocate/deepen composition, but must not add another approval lifecycle or generic forwarding
   manager.
2. **Agent runtime mechanics:** `AgentRuntime` contains one implementation—not duplicate runtime state
   machines—of `#streamWithOverflowRecovery`, `#streamModel`, `#executeTool`, budget observation,
   `#executeApprovalRequiredTool`, and `#executeToolImplementation`. T2304 is justified by cohesive
   responsibility density after T2303, not by a claim of duplicate implementations. Existing owners
   (`history-pruner`, `context-overflow-recovery`, `RunTokenBudget`, `SessionStateMachine`, Tool input/
   output/repetition modules) must be deepened before any new package-private module is considered.
3. **Runtime test setup:** three local model-gateway builders and one Tool builder already exist in
   `agent-runtime.test.ts`. T2303 should reuse them while splitting behavior. Repeated constructor calls
   are not sufficient evidence for a broad builder or Testkit export.

No other candidate in the scoped search had two equivalent production implementations or a repeated
state machine/lifecycle. In particular, similarly shaped text, record, URI, Provider, MCP, persistence,
and IDE projection helpers were already dispositioned by completed maintenance or have different
package/domain ownership.

### `EO-001`-`EO-008` regression check

| Item | Current evidence | Disposition |
|---|---|---|
| EO-001 Provider endpoint policy | One `providerEndpointPolicy` definition; configuration and connection-check callers both use it. | No regression; do not reopen. |
| EO-002 Extension test support | One package-local `createTestUri` support class and one Webview `createWebviewHostFixture`; consumers import those fixtures. | No second equivalent fixture owner found; do not reopen. |
| EO-003 IDE source projection | One `ideSourceProjector` used by diagnostics, language-services, and editor-context adapters. | No regression; adapter-specific collection/error mapping stays local. |
| EO-004 Bounded text persistence | One `VscodeBoundedTextStorage` used by Session, Checkpoint, workspace-local, and global-local storage composition. | No duplicate bounded persistence I/O owner found. |
| EO-005 MCP catalog refresh | One `collectMcpCatalogPages` and one `McpCatalogRefresh`; Tool, Resource, and Prompt paths each use them. | No repeated cursor/refresh coordinator found. |
| EO-006 MCP error ownership | `packages/mcp-client/src/errors.ts` owns client messages; Extension retains only Host/process/configuration fallback mapping. | Origin-based split remains intentional. |
| EO-007 Package-local primitives | Text, record, URI, and canonical JSON/equality seams remain package-local; no repository-wide `common`/`utils` owner appeared. | No regression; cross-package consolidation remains excluded. |
| EO-008 Safe regex engine | `packages/builtin-tools/src/search-files.ts` is the sole `re2js` importer and controlled regex compiler; the dependency is declared only in Builtin Tools. | No second regex engine or bypass found. |

The ledger also keeps EO-009 and EO-011 deferred and other open items under their stated evaluation
windows. T2301 does not promote or implement them.

## 7. Evidence and boundaries for T2302-T2306

| Task | Concrete evidence / candidate owner | Expected directional benefit | Explicit exclusions reinforced by this baseline |
|---|---|---|---|
| T2302 | Document table above; prioritize `persistence.md`, `configuration.md`, and the multi-domain parts of `security.md`/`webview.md`. Preserve `implementation-plan.md`, `architecture.md`, and `protocol.md` as hot routers and `development.md` as the workflow owner. | Narrow normal reading paths and remove conflicting full restatements while keeping one fact owner. | No archive rewrite, no semantic rewrite, no mechanical split, no second roadmap/security/protocol/persistence owner. |
| T2303 | `agent-runtime.test.ts`: 3,029 lines, 56 tests, seven observable behavior regions, 26 changes; existing local gateway/Tool helpers. | Independently runnable regression suites that locate runtime failures before production movement. | No production runtime split, no deleted boundary cases, no cross-package/Testkit fixture, no hidden security setup. |
| T2304 | `AgentRuntime` methods `run`, `#streamWithOverflowRecovery`, `#streamModel`, `#executeTool`, `#observeBudget*`, `#executeApprovalRequiredTool`, `#executeToolImplementation`, plus history/approval validators; existing Core owners named above. | Reduce orchestration density by moving only cohesive mechanics to their natural owner while keeping the main Run loop legible. | No public export/Protocol change, no new coordinator hierarchy, no Session/Tool/approval/event-order/budget change. |
| T2305 | `extension.ts` at 1,448 lines/49 changes; file-mutation composition at lines 323-639 and existing feature controllers/adapters for MCP, diagnostics, editor context, workspace references, Session recovery/history, and local-data clearing. | Reduce repeated feature wiring and inline Host workflow decisions while retaining `activate()` as cheap registration/composition. | No daemon/framework, no per-closure file extraction, no VS Code type leakage, no command/setting/UI/activation behavior change. |
| T2306 | Actual dependency graph is compliant but has no deterministic enforcement. Baseline hotspot/change-frequency and representative change surfaces below provide advisory comparison data. | Catch package direction, cycles, deep imports, and Core/SDK Host leakage deterministically; report size/similarity/change surface without making them hard gates. | No large analysis platform without approval; no LOC/similarity/change-surface hard fail; no product telemetry; no metric-driven extra refactor. |

## 8. Representative change-surface baseline

These recent squash commits represent two cross-layer features and one explicitly authorized
maintenance consolidation. Counts are changed files at the commit, separated into production source,
tests, documents, and manifests; “code owners” are workspace apps/packages touched.

| Change | Revision | Files | Production | Tests | Docs | Manifests | Workspace code owners |
|---|---|---:|---:|---:|---:|---:|---|
| T2204 Run token guardrails | `4b77801` | 44 | 22 | 13 | 8 | 1 | Extension, Webview, Core, Protocol (4) |
| T2205 Diagnostics export | `cad6ee2` | 40 | 19 | 11 | 9 | 0 | Extension, Webview, Protocol (3) |
| EO-007 Package-local primitives | `53bc57b` | 80 | 56 | 22 | 2 | 0 | Extension, Webview, Builtin Tools, Core, MCP Client, Protocol, Providers (7) |

T2306 should compare directionally against changes of similar semantic breadth, not expect every
feature to touch fewer files. EO-007 deliberately crossed seven owners because its approved scope was
a repository-wide per-package consolidation; it is a guard against using owner count as a quality
score. The useful question is whether a later change reaches its established owner without adding a
new parallel path.

## 9. Invariants for all later Phase 23 work

| Area | Invariant to preserve | Authoritative owner |
|---|---|---|
| Product and package scope | Desktop VS Code Extension only; current package directions and public entry points remain unchanged. Core stays Host- and vendor-independent. | `AGENTS.md`; `docs/roadmap/product-foundation.md` |
| Runtime behavior | Session transitions remain Core-owned; Run ownership, model/Tool event order, Tool Call/Result pairing, reasoning projection, one overflow recovery, repetition/step limits, terminal priority, and Provider-normalized outcomes remain observable-equivalent. | `docs/architecture/context-and-session.md`; `docs/architecture/providers.md` |
| Approval and workspace security | Model/Tool input remains untrusted. Writes and commands require exact, expiring, single-use authorization bound to immutable Session/Run/Tool/resource state; canonical scope and Trust are revalidated immediately before side effects. Commands never run through a shell. | `docs/security.md` approval, workspace, command, and MCP sections |
| Protocol | Existing JSON-serializable DTOs, strict Schemas, message correlation/version, Tool/approval/session shapes, and package exports do not change. | `docs/protocol.md` and its shards; `packages/protocol/src/index.ts` |
| Persistence | Version-1 layout/event meaning, strict compatibility/damage behavior, secret exclusion, bounded reads, atomic manifests/JSONL rules, and Checkpoint durable-before-side-effect/all-target recovery semantics remain unchanged. No migration or format reinterpretation is introduced. | `docs/persistence.md` |
| Cancellation and resources | Cancellation remains a distinct, higher-priority outcome; after cancellation there are no later deltas, Tool calls, retries, persistence side effects, or hidden work. Every registration, stream, timer, process, and child resource has one owner and idempotent cleanup. | `docs/development.md`; `docs/testing.md`; `docs/architecture/lifecycle.md` |
| Activation | `activate()` remains cheap, deterministic, and lazy: no workspace scan, network access, model initialization, or implicit Session restore. Extension registrations remain owned by `context.subscriptions` or an explicit asynchronous owner. | `docs/architecture/lifecycle.md` |
| MCP and SDK isolation | MCP transport/schema/SDK types stay private to `packages/mcp-client`; Provider SDK types stay private to `packages/providers`; Extension retains real process, Trust, configuration, and disposal ownership. | `AGENTS.md`; `docs/architecture/mcp-client.md`; `docs/security.md` |

Any later task that cannot preserve one of these invariants must stop for change control rather than
using this snapshot as authorization.

## 10. T2301 conclusion

The task premise holds. Current evidence supports the planned sequence: document ownership first,
then runtime-test partitioning, runtime responsibility convergence, Extension composition convergence,
and finally deterministic fitness checks plus advisory comparison. It does not support a package
boundary change, a Protocol/persistence/security change, a Webview refactor, reopening EO-001-EO-008,
or repository-wide similarity cleanup.
