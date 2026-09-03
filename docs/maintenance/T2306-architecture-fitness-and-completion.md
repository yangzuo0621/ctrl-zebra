# T2306 Architecture Fitness Checks and Phase 23 Completion Comparison

## Scope and decision

T2306 turns the package and ownership invariants already established by T2301-T2305 into a
repeatable check without changing product behavior, public contracts, persistence, security policy, or
package direction. The implementation is `scripts/check-architecture.mjs`; it uses Node's standard
library, the checked-in workspace manifests, source imports, package entry points, the roadmap index,
and (for advisory context only) the existing Git checkout.

Build-vs-Buy was completed before implementation. The evaluation order was: Node standard library or
VS Code API, existing dependencies, an official SDK, maintained third-party libraries, then
self-implementation. Node's standard library was selected for bounded directory traversal,
JSON/Markdown checks, import extraction, graph traversal, builtin-module enumeration, Git evidence,
and the built-in `node:test` runner. Existing Biome, pnpm, TypeScript, and Git checks remain in place;
none provides a repository-local package-boundary and roadmap-owner rule with the required diagnostics.
There is no applicable official SDK. A maintained static-analysis platform was considered but rejected:
it would add configuration, runtime, license, CI and VSIX/toolchain maintenance without improving these
finite import/manifest/table decisions. Self-implementation keeps the checker behind a repository
script boundary, has no third-party types or failures, does not own product cancellation or security
policy, and requires no adapter or packaging change beyond the existing Node runner. The fixture tests
cover parser boundaries and failure diagnostics; cancellation is not applicable because the checker is
a bounded synchronous process.

Commands:

```text
pnpm check:architecture
pnpm test:architecture
```

`check:architecture` reports advisory signals but exits non-zero only for hard-gate failures.
`test:architecture` runs positive and negative temporary fixtures with Node's built-in test runner.
The CI workflow runs both commands. Advisory output is review evidence, not a KPI, budget, or product
telemetry source.

## Hard gates

The script reports the importing owner, source file and line, target package or SDK, and a repair
direction for every failure. Each rule is deterministic because it is based on finite checked-in
manifests, source import specifiers, public entry paths, or mechanically owned roadmap tables.

| Rule | Owner | Mechanical decision | Positive / negative evidence |
|---|---|---|---|
| Package dependency direction and declared workspace edges | `AGENTS.md`, package manifests, owning package | Workspace manifest edges and actual `@ctrl-zebra/*` imports must be in the documented direction, and every actual edge must be declared by the importer. | The checked-in workspace is positive. Fixtures reject a `core -> providers` edge and an undeclared edge. |
| Dependency cycles | Workspace package graph | A directed graph made from declared and actual workspace edges is acyclic; DFS returns a concrete cycle chain. | The checked-in graph is positive. A fixture creates `protocol -> core -> protocol`. |
| Forbidden deep cross-package imports | Target package public `exports` entry | Cross-package imports must use the exact package name. Package subpaths and relative paths into another workspace owner fail. | The checked-in sources have no such import. Fixtures reject `@ctrl-zebra/core/src/internal.js` and a relative path into `packages/core`. |
| Core host/vendor independence | `packages/core`, `AGENTS.md`, Core architecture docs | No `vscode`, Node Host API, Provider SDK, or MCP SDK import or manifest dependency is allowed from Core. | The checked-in Core source and manifest are positive. Fixtures reject `vscode`, `node:fs`, bare `http`, `require("node:fs")`, `ai`, and `@ai-sdk/openai` from Core. |
| Webview dependency direction | `apps/webview`, `protocol`, `AGENTS.md` | Webview source and manifest edges may use Protocol, but not Core, Providers, Builtin Tools, or MCP Client. | The checked-in Webview graph is positive. A fixture rejects a Webview -> Core import. |
| SDK and third-party boundary isolation | Extension / Providers / MCP Client public owners | VS Code imports belong to Extension, Provider SDK imports belong to Providers, and MCP SDK imports belong to MCP Client. Public entries may not directly or transitively re-export those SDK modules, including default, namespace, and local type aliases. | The checked-in ownership map is positive. Fixtures reject an Extension -> MCP SDK import and public-entry leaks through named, default, and aliased exports. |
| Roadmap status owner and active-phase indexing | `docs/implementation-plan.md`, phase spec, completed-task archive | The canonical active-task section/table must exist; progress counts equal the completed archive plus parsed active tasks; active tasks have one active phase and a matching active spec; phase links exist; a task cannot be both active and archived. A phase may remain active while no task is currently in progress. | The checked-in roadmap is positive. Fixtures remove the canonical section and change the pending count, each failing with the expected owner/repair direction. |

The SDK rule intentionally checks ownership and public-entry import/export bindings rather than
attempting to infer TypeScript's complete structural type declarations. This is the stable high-value
boundary: SDK imports, SDK failures, and adapters remain in their existing owner, while public entries
expose only CtrlZebra-owned contracts. Typecheck and the package exports continue to validate the
actual public surface.

## Advisory signals

These signals are printed as warnings/review context and never cause CI failure:

| Signal | T2301-derived threshold / scope | Noise controls |
|---|---|---|
| Production hotspot | 650 physical lines, the lower edge of T2301's named production hotspot set | Source only; excludes tests, fixtures, generated output, dependencies, and caches; reports the top 12. |
| Test hotspot | 900 physical lines, just below T2301's smallest named test hotspot | Reports test files only and retains focused suites as separate files. |
| Document hotspot | 600 physical lines, aligned with T2301's `persistence.md` / `ux.md` distribution | Excludes roadmap archives and cold review snapshots. |
| Significant hotspot regression | More than both 32 lines and 10% above the T2301 snapshot for a named path | A one-line documentation movement is not a regression warning. Missing/deleted paths are reported in the comparison data, not failed. |
| Deleted-path regression | A path deleted after the T2301 revision is present again at the current revision | Git history is advisory-only; shallow checkouts report unavailable, and the signal never fails CI. |
| Conservative similarity signal | Exact three-line normalized blocks occurring across distinct workspace owners | Ignores comments, imports/exports, generated/test/fixture paths, trivial punctuation, and package-local repetition. It requires ownership review before any change. |
| Change surface | Count and category breakdown of paths changed since the T2301 revision, with production/tests/docs/manifests and workspace owners compared directionally with T2204/T2205/EO-007 | Directional only; shallow clones report unavailable. No package-touch or file-count budget is enforced. |

The report is deliberately small and bounded: advisory reads skip files above 4 MiB and similarity
candidate collection caps at 100,000 unique blocks. A similarity match is not an abstraction decision,
and a large file is not a refactor mandate.

## Phase 23 completion comparison

The comparison uses the T2301 baseline revision and its named hotspot values. Physical line counts are
review signals, not completion criteria.

### Production hotspots

- `apps/extension/src/extension.ts`: 1,448 -> 971 lines (-477). T2305 removed the repeated inline
  file-mutation composition and moved cohesive feature wiring while leaving registration and dependency
  assembly in the composition root.
- `packages/core/src/agent-runtime.ts`: 1,269 -> 445 lines (-824). T2304 moved proven mechanics to
  existing or cohesive Core owners and left the runtime as the orchestration entry.
- `apps/webview/src/chat-store.ts`: 1,444 -> 1,444. This remains one Webview projection owner; no
  Phase 23 task authorized a Webview production split and no duplicate lifecycle was found.
- The remaining named adapter, Protocol, MCP, persistence, Webview, and Host bridge hotspots remain
  materially unchanged. Their size is coupled to stable domain ownership, public schema centralization,
  or compatibility/security-sensitive behavior; file size alone did not justify another refactor.

### Test hotspots

`packages/core/src/agent-runtime.test.ts` (3,029 lines, 56 tests) was replaced by focused suites:
`agent-runtime.context.test.ts` (725), `.approval.test.ts` (687), `.tools.test.ts` (670),
`.cancellation.test.ts` (409), `.stream.test.ts` (311), `.budget.test.ts` (147), and
`.provider-failure.test.ts` (52), plus 108 lines of package-private support. The aggregate is not
smaller, and that is reasonable: the improvement is independent behavior ownership and failure
locality, not fewer test lines or hidden setup.

The other test hotspots remain unchanged (`webview-message-controller.test.ts`, `chat-store.test.ts`,
`session-recovery.test.ts`, `app.test.tsx`, `chat-runner.test.ts`, and Protocol message tests). They
remain advisory because their current fixtures protect Host, UI, persistence, or public-schema
contracts that Phase 23 did not authorize to split.

### Document hotspots

- `docs/security.md`: 1,356 -> 1,312 lines (-44), while the security owner and domain-specific links
  remain intact.
- `docs/configuration.md`: 242 -> 161 lines (-81), with settings representation ownership made
  narrower and cross-domain copies reduced.
- `docs/persistence.md`: 631 -> 627 and `docs/webview.md`: 562 -> 557; small reductions preserve
  their respective facts and links.
- `docs/ux.md`: 634 -> 635 (+1), which is insignificant under the regression signal and reflects a
  legitimate route/constraint update rather than hotspot growth.
- `docs/implementation-plan.md`, `docs/architecture.md`, `docs/protocol.md`, and
  `docs/development.md` remain routers or cohesive owners as intended by T2301.

### Representative change surface

T2301's directional baselines remain: T2204 touched 44 files / 4 workspace owners, T2205 touched 40
files / 3 owners, and EO-007 touched 80 files / 7 owners because its approved scope was repository-wide
package-local consolidation. T2303, T2304, and T2305 each kept their own focused task surface (11,
11, and 14 changed paths respectively, including tests and roadmap evidence). This is not evidence
that every future feature must touch fewer files; it shows the existing owner seams can carry the
consolidation without adding a new package, framework, or parallel implementation. Change surface
remains advisory and is not a product KPI.

### Retained and deferred opportunities

- The Webview chat store remains the clearest unchanged responsibility-density hotspot. It is recorded
  as EO-013 in `docs/engineering-opportunities.md` for a future Webview-scoped evidence review; this
  task does not split it.
- Large language-service, diagnostics, MCP, Session recovery/history, Protocol message, and Webview
  files remain with their current owners. No new duplicate implementation, unsafe boundary, or clear
  Phase 23 seam justified further refactoring.
- Existing EO-001-EO-008 maintenance remains closed or in its documented state; T2306 found no
  regression and does not reopen or duplicate those mechanisms.

## Verification and completion decision

The architecture-fitness sub-gate is met by the current evidence: package direction and high-value
boundary regressions are mechanically detected, advisory signals are non-blocking, the Core and
Extension hotspots with task evidence improved, the large runtime test boundary is behavior-partitioned,
document ownership narrowed without conflicting copies, and unchanged hotspots have explicit retention
reasons or an opportunity-ledger entry.

The overall Phase 23 completion gate remains pending until this PR is merged, as required by the
roadmap status owner. GitHub Actions is the cross-platform verification authority for this revision;
the PR must remain green across architecture checks, fixture tests, lint, typecheck, unit tests,
Extension integration, coverage, performance, and build before merge.

Local environment-sensitive evidence still records these caveats:

- A full `pnpm test` rerun after the review fixes hit the existing Webview edit timeout: 205/206 files
  and 2,175/2,176 tests passed. An earlier full run passed (206 files / 2,176 tests and Extension
  integration), but the two full `pnpm test:coverage` runs each hit the existing 5-second
  `heuristic-token-counter` timeout (one run also hit the existing Webview edit timeout). The targeted
  tests pass; no timeout or coverage threshold was changed.
- `pnpm benchmark:performance -- --runs 3 --warmups 1` completed its package/smoke measurement but
  failed the existing budgets locally for Webview first usable p95 (1,207 ms vs 1,100 ms) and workspace
  search p95 (649 ms vs 500 ms); the Ubuntu CI run passed the existing performance gate. No threshold
  was changed and no functionality was removed.
- VSIX packaging/smoke was not run independently because the packaging command requires a clean
  worktree and the checkout contains the pre-existing user edit in `.codex/agents/task-executor.toml`.
  Extension integration smoke and repository build did pass.

The VSIX packaging caveat remains a separate local verification gap, not authorization to expand Phase
23 or make metrics prettier. The roadmap status should remain pending until the repository owner merges
the PR under the normal process.
