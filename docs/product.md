# CtrlZebra Product and Technical Foundation

This document contains only the currently approved product scope, technical baseline, module
boundaries, cross-module contract map, and product-level verification requirements. Runtime, security,
protocol, persistence, Webview, and UX semantics belong to their domain documents; historical approval
and implementation records belong in Git, merged pull requests, and ADRs.

## 1. Current approved product scope

This section includes approved capabilities that are implemented or may be implemented. It defines
product boundaries only; it does not pre-authorize DTOs, Tool names, persisted fields, state transitions,
error codes, algorithms, dependencies, or security behavior.

### 1.1 Approved capabilities

- The product remains a desktop VS Code Extension with a local-first conversation and workspace-
  collaboration experience in the Activity Bar Agent sidebar. It does not introduce a cloud account,
  synchronization service, or telemetry backend.
- Users may create, restore, and explicitly continue local multi-turn Sessions. History reconstruction,
  context pruning, Token Usage, truncation, and overflow recovery preserve cancellation, approval,
  persistence compatibility, and resource limits. Approved capabilities also include regeneration,
  edit-and-resend, workspace file references, Session deletion, history clearing, retention policy, and
  clearing all CtrlZebra-owned local data.
- OpenAI, Gemini, and OpenAI-Compatible Providers use one Provider-neutral Runtime for streaming text,
  Tool Calling, optional bounded user-visible reasoning summaries, controlled retries, stable errors,
  and Token Usage. Users may save, delete, and rotate credentials, choose or manually enter a model,
  and explicitly run minimal connection and capability checks that contain no workspace or Session
  content. Capabilities that cannot be determined reliably remain unknown. Credentials are stored only
  in Extension-owned `SecretStorage`.
- Built-in workspace capabilities include bounded file listing, reading, searching, regular-expression
  searching, text-edit proposals, and command execution, plus approved create, delete, rename, and
  multi-file atomic editing. Side effects remain subject to Workspace Trust, canonical paths, exact
  single-use approval, reviewable Diff, `WorkspaceEdit` or equivalent atomic write, cancellation,
  result limits, and recoverable Checkpoints. A model-initiated Tool Call may continue the Agent Loop
  only after controlled execution produces a Tool Result.
- The Webview provides streaming messages, Tool and approval states, Session recovery, Token Usage,
  accessible interaction, consistent product language, and restricted technical Markdown. Presentation
  must not expand CSP, command, file, network, HTML, or unapproved URI capabilities.
- Within user control and workspace scope, the Extension may read the active editor, selection,
  diagnostics, and VS Code language-service results as bounded, untrusted, removable context or
  read-only Tool Results. It does not create its own semantic, vector, or code index. These capabilities
  enter through Extension-owned Host adapters; cross-boundary data is limited to `Ide*Dto` and ordinary
  user context. VS Code objects, absolute host paths, editor snapshots, and Provider results never
  become System instructions, authorization material, or cross-Session memory. Users may explicitly
  enable `ctrlZebra.editorContext.enabled` and use `ctrlZebra.askAboutSelection` or
  `ctrlZebra.askAboutFile` to fill a visible, editable Composer draft. The entry point does not send,
  run the model, or grant authority automatically.
- One explicitly configured and connected local stdio MCP Server may provide Tools, Resources including
  Templates, and Prompts. MCP Tools use the existing Core Tool, approval, cancellation, and result
  boundaries; Resources and Prompts enter ordinary untrusted context only through bounded user- or
  application-controlled paths. Supported modes are `modern-only | dual`, with the closed versions
  modern `2026-07-28` and legacy `2025-11-25`, as recorded by
  [ADR 0002](adr/0002-mcp-dual-era-stdio-compatibility.md). Existing configuration does not silently
  enable dual. The Extension owns the Server process, configuration, Workspace Trust, startup approval,
  and complete process-tree cleanup; model, Webview, and workspace content cannot create or broaden
  Server configuration.
- Preview/GA engineering scope includes coverage and cross-platform CI, repository governance,
  reviewed dependency updates, data migration or read-only fallback, per-Run cost guardrails,
  user-triggered redacted diagnostics export, performance and resource budgets, license/SBOM/VSIX
  audits, reproducible release pipelines, and Marketplace evidence. Actual publication still requires
  explicit authorization.

### 1.2 Explicit exclusions

- Multi-Agent, sub-Agent, Skills, cross-Session memory, custom Modes, mid-Run interruption, and
  multimodal input or file parsing.
- Browser automation, automatic Git commits or pull requests, automatic publishing, and workspace or
  command side effects without exact approval.
- Web Extension, cloud accounts, synchronization, telemetry backends, SQLite, vector databases, and
  self-built semantic or code indexes.
- Generating, completing, or reconstructing hidden or complete model reasoning through prompts, extra
  model calls, or Host inference.
- MCP versions older than `2025-11-25` or unknown future versions, Streamable HTTP, legacy HTTP+SSE,
  remote MCP, OAuth, multiple Servers, automatic installation, Server marketplaces, shared workspace
  Server configuration, and Roots, Sampling, Elicitation, Tasks, `input_required` continuation, or
  other unapproved Server-to-Client capabilities.

An item appearing in an external SDK, evaluation report, or candidate list is not authorization. Expanding
this scope requires an update to this document; changes to the trust model or long-lived architecture
also require updates to the relevant domain document and ADR.

## 2. Technical baseline

| Area | Choice |
|---|---|
| Language | TypeScript 7.0.2 (exactly pinned), `strict` enabled; shared target and standard library `ES2025` |
| Desktop host | VS Code `1.125.0` or newer; Extension Host baseline Node.js 24, verified with `24.15.0` |
| Package management | pnpm workspace |
| Extension build | esbuild, target `node24` |
| Webview | React + Vite; TypeScript libraries `ES2025` + `DOM` + `DOM.Iterable`; Vite target `es2025` |
| Webview state | Zustand |
| Styling | CSS Modules + VS Code CSS Variables |
| Runtime validation | Zod |
| MCP Client | Official `@modelcontextprotocol/client` v2; first implementation exactly `2.0.0`, isolated in `packages/mcp-client` |
| External Tool JSON Schema | Public Ajv validator from the same pinned SDK, compiled after closed-keyword and structural limits |
| Model normalization | Vercel AI SDK 7 behind a CtrlZebra-owned interface |
| Unit tests | Vitest |
| UI tests | Testing Library + jsdom |
| Extension integration tests | `@vscode/test-electron` |
| Formatting and static checks | Biome + TypeScript |
| Release | `@vscode/vsce` |

Installed versions must be mutually compatible and recorded in the lockfile. Long-lived dependency
declarations must not use an unpinned `latest`.

## 3. Workspace structure

```text
ctrl-zebra/
├─ apps/
│  ├─ extension/        # VS Code Host, composition root, adapters, and controllers
│  └─ webview/          # React presentation and user interaction
├─ packages/
│  ├─ protocol/         # Cross-boundary DTOs and Schemas
│  ├─ core/              # Host- and Provider-neutral business logic
│  ├─ providers/        # Concrete model SDK adapters
│  ├─ builtin-tools/    # Host-independent built-in Tools
│  ├─ mcp-client/       # Controlled MCP SDK boundary
│  └─ testkit/          # Cross-package test doubles
└─ docs/                # Product, domain, ADR, and release documents
```

This section fixes Workspace-level modules only; it does not prescribe package folders or individual
files. The source tree and each package's public `exports` are the implementation source of truth.
Adding or moving a Workspace module requires updating this section and the dependency rules first.

## 4. Module boundaries

This ownership map summarizes the approved modules. Domain documents own detailed behavior; public
package entries own exact interfaces. The map does not authorize new dependencies or capabilities.

| Module | Responsibility and boundary | Detailed owner |
|---|---|---|
| `packages/protocol` | JSON-serializable commands/events, Session/Message/Tool DTOs, reasoning/recovery projections, strict Schemas and inferred types, and persistence version identifiers. Host validates Webview input; no React, VS Code, or model SDK dependency. | [Protocol](protocol.md), [Persistence](persistence.md) |
| `packages/core` | Host-independent Agent Loop, Session state machine, Tool Registry/Executor, approval policy, context/pruning/summary interfaces, Checkpoint model, events/errors, and ordered reasoning lifecycle. External capabilities enter through injected interfaces; no direct files, terminals, Webviews, or SecretStorage. | [Context and Session](architecture/context-and-session.md), [Tools](architecture/tools-and-files.md), [Providers](architecture/providers.md) |
| `packages/providers` | Implements `ModelGateway`, translating SDK text, reasoning, Tool, Finish, Usage, and error events into Core values. Concrete SDK types remain private. | [Providers](architecture/providers.md#model-provider-boundary) |
| `packages/builtin-tools` | Tool definitions and host-independent validation through injected workspace, IDE, and language-service ports. The Host owns URI resolution, Trust, files, Checkpoints, and atomic writes. | [Tool and file contracts](protocol/tools-and-file-lifecycle.md), [IDE boundary](architecture/ide-context.md#ide-context-and-read-only-tool-boundary-t1901) |
| `apps/extension` | VS Code registration, composition, validated dispatch to lifecycle controllers, editor/file/Diff/storage/logging/credential adapters, canonical revisions, Trust, Checkpoints, atomic WorkspaceEdit, cancellation and disposal. Host objects and mutation plans do not cross into the Webview. | [Lifecycle](architecture/lifecycle.md), [Tools and Files](architecture/tools-and-files.md), [IDE Context](architecture/ide-context.md), [Security](security.md) |
| `apps/webview` | Message/reasoning/Tool/approval/Session presentation, settings controls, IDE context cards and Composer intents. Host snapshots remain authoritative; no direct keys, models, files, or VS Code commands. | [Webview responsibility](architecture.md#webview-responsibility), [UX](ux.md) |
| `packages/testkit` | Deterministic Fakes for shared Core contracts, including Model Gateways, Summarizers, and event collectors. Single-package Fakes stay local; scope follows public exports. | [Testing](testing.md#fake-and-mock-boundaries) |
| `packages/mcp-client` | Controlled SDK negotiation, correlation, cancellation, pagination/refresh, limits, and normalization through injected stdio/process ports; external Tool adaptation uses Core contracts. SDK types stay private; the Host owns processes and configuration. | [MCP ownership](mcp.md#process-ownership), [approved scope](#12-explicit-exclusions) |

`extension.ts` remains registration and composition only. Built-in Tool names and inputs follow the
[Tool contracts](protocol/tools-and-file-lifecycle.md); literal search remains the default, with
explicit regex mode using the controlled RE2-compatible dialect. IDE and file operations preserve
the cross-module ownership map below.

## 5. Dependency rules

[AGENTS.md architecture invariants](../AGENTS.md#2-architecture-invariants) own allowed package
directions and host/vendor isolation. MCP depends on Core contracts only for external Tool adaptation;
it has no dependency on concrete process implementations or persistence. The
[architecture checker](../scripts/check-architecture.mjs) enforces the repository dependency gates.

## 6. Cross-module contract map

This section identifies contract owners without copying TypeScript signatures, enum members, or
Schemas. Exact public interfaces belong to the exporting package; cross-boundary semantics belong to
the relevant domain document. Code implementation details do not become product or public contracts
merely because they appear in the source tree.

| Contract | Code source of truth | Semantic owner |
|---|---|---|
| Model requests, events, Usage, Finish, and stable errors | [`packages/core/src/model-gateway.ts`](../packages/core/src/model-gateway.ts) | [Architecture: Model Provider Boundary](architecture/providers.md#model-provider-boundary) |
| Agent Loop, Tool lifecycle, and Session transitions | [`packages/core`](../packages/core/src/index.ts) and [`packages/protocol/src/session.ts`](../packages/protocol/src/session.ts) | [Architecture: Tool Contract, Context, and Session](architecture/tools-and-files.md#tool-contract-boundary) |
| Tool Call, Result, risk, and JSON values | [`packages/protocol/src/tool.ts`](../packages/protocol/src/tool.ts) | [Protocol: Tool Data Contracts](protocol/tools-and-file-lifecycle.md#tool-data-contracts) and [Security: Tool Input and Output](security.md#tool-input-output-and-workspace-scope) |
| Webview/Extension messages and request correlation | [`packages/protocol/src/messages.ts`](../packages/protocol/src/messages.ts) | [Protocol Guidelines](protocol.md) |
| Session Repository, events, and recovery projections | [`packages/core/src/session-repository.ts`](../packages/core/src/session-repository.ts) and [`packages/protocol/src/persistence.ts`](../packages/protocol/src/persistence.ts) | [Persistence Contract](persistence.md) |
| Approval request, decision, consumption, and invalidation | [`packages/core`](../packages/core/src/index.ts) and [`packages/protocol/src/approval.ts`](../packages/protocol/src/approval.ts) | [Security: Approval Boundary](security.md#approval-boundary) |
| MCP Client, Tool, Resource, and Prompt projections | [`packages/mcp-client`](../packages/mcp-client/src/index.ts) and [`packages/protocol`](../packages/protocol/src/index.ts) | [MCP](mcp.md); security, persistence, Webview, and UX integration follow their owner documents |
| IDE context and read-only Tool DTOs, provenance, and lifecycle | Extension adapters, `packages/builtin-tools`, and `packages/protocol` public entries | [Architecture: IDE context and read-only Tool boundary](architecture/ide-context.md#ide-context-and-read-only-tool-boundary-t1901), [Protocol: IDE context and read-only Tool DTOs](protocol/ide-context.md#ide-context-and-read-only-tool-dtos-t1901), [Security](security.md#ide-context-and-file-references), [Persistence](persistence.md#ephemeral-ide-and-workspace-file-context), [UX](ux.md#ide-context-and-workspace-file-references) |
| File lifecycle, atomic edits, and recovery plans | `packages/builtin-tools`, Core approval/Checkpoint contracts, and Extension workspace adapters | [Architecture: File lifecycle and atomic WorkspaceEdit boundary](architecture/tools-and-files.md#file-lifecycle-and-atomic-workspaceedit-boundary-t2001), [Protocol: File lifecycle and atomic mutation contracts](protocol/tools-and-file-lifecycle.md#file-lifecycle-and-atomic-mutation-contracts-t2001), [Security: Checkpoint and restore](security.md#checkpoint-and-restore), [Persistence: Checkpoint durability and recovery](persistence.md#checkpoint-durability-and-recovery) |

Cross-module invariants:

- External and cross-process input enters its owning boundary as `unknown` and becomes a domain value
  only after validation.
- Cancellation is a distinct outcome. After cancellation, no further delta, Tool, retry, persistence
  mutation, side effect, or invisible background work may continue.
- VS Code, Node Host, and concrete SDK types do not cross their declared adapter or package boundary.
- Session state changes only through the Core state machine; Tools, Providers, Webview, and persistence
  adapters do not advance the Agent Loop independently.
- Secrets, authorization material, raw third-party errors, and unbounded untrusted content do not enter
  Webview state, persistence, logs, or test fixtures.
- Editor, selection, diagnostic, and language-service data carry Host-owned provenance and bounded
  state. They are ordinary untrusted user context or read-only Tool Results, never System instructions,
  capability claims, approval material, or implicit cross-Session memory.
- Update the owning domain document before changing a public contract. Change this document only when
  product scope, technical baseline, or module boundaries change.

## 7. Product-level verification requirements

[Testing Guidelines](testing.md) owns test layers, naming, Fakes/Mocks, determinism, regression, and
asynchronous cleanup. This section defines only the product-level evidence categories; an Issue, PR, or
CI workflow may declare additional task-specific verification.

| Evidence | Minimum purpose |
|---|---|
| Package unit tests | Prove normal paths, important boundaries, and expected failures for Core, Protocol, Provider, Tool, MCP, and pure policy |
| Webview component tests | Prove messages, streaming state, approvals, recovery, accessibility, and content boundaries through visible behavior |
| Extension integration tests | Prove VS Code registration, adapters, lifecycle, storage, SecretStorage, process, and Trust boundaries |
| VSIX smoke and manual paths | Prove the packaged product installs, activates, and completes declared critical user paths; these do not replace applicable automation |
| CI, coverage, and resource gates | Prevent unreviewed regressions in supported platforms, key behavior, performance budgets, and release artifacts |

Tests do not access real models, user credentials, or uncontrolled networks, and do not depend on wall
clock time, random values, execution order, or user machine state. Verification must preserve both this
baseline and the Testing Guidelines.
