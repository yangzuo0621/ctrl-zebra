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

### 4.1 `packages/protocol`

Owns all cross-boundary data structures:

- Webview-to-Extension commands and Extension-to-Webview events.
- Serializable Session, Message, and Tool Call DTOs.
- Reasoning blocks, stream events, truncation state, and recovery projections.
- Zod Schemas and the TypeScript types derived from them.
- Persistence format version identifiers.

Protocol must not depend on React, VS Code, or model SDKs. Every value must be JSON serializable, and
Webview input must be runtime-validated in the Extension Host.

### 4.2 `packages/core`

Owns host-independent business logic:

- Agent state machine and loop.
- Session lifecycle.
- Tool Registry and Tool Executor.
- Approval Policy.
- Context construction, pruning, and summary interfaces.
- Checkpoint data model.
- Domain events and error classification.
- Provider-neutral reasoning-summary lifecycle and source ordering relative to answer, Tool, and terminal events.

Core must not import `vscode` or access filesystems, terminals, Webviews, or SecretStorage directly.
External capabilities are injected through constructor interfaces.

### 4.3 `packages/providers`

Converts third-party model SDK events into the internal contract:

- Text deltas.
- Provider-authored user-visible reasoning-summary deltas.
- Tool Calls.
- Finish Reasons.
- Token Usage.
- Provider Errors.

Providers expose `ModelGateway`; Agent Core never depends directly on Vercel AI SDK types.

### 4.4 `packages/builtin-tools`

Owns built-in Tool definitions and host-independent argument validation:

- `list_files`
- `read_file`
- `search_files`
- `propose_file_edit`
- `run_command`

The file-lifecycle contract preserves the single-file meaning of `propose_file_edit` and adds
`propose_file_create`, `propose_file_delete`, `propose_file_rename`, and edit-only
`propose_workspace_edit`. Names, closed inputs, limits, failure, and recovery semantics belong to the
[Protocol file-lifecycle contract](protocol/tools-and-file-lifecycle.md#file-lifecycle-and-atomic-mutation-contracts-t2001).
The Extension alone parses VS Code URIs, checks Trust, creates Checkpoints, and submits atomic
`WorkspaceEdit` operations. Regular-expression search is explicitly enabled by
`search_files.mode: "regex"` using a controlled RE2-compatible dialect; literal search remains the
default and engine integration belongs to its domain owner.

Read-only IDE Tools use host-independent input, output, and boundary contracts. They depend only on
injected `IdeContextPort` and language-service Ports, never import VS Code, read host URIs, or decide
Workspace Trust.

Actual file operations are performed by Extension adapters.

### 4.5 `apps/extension`

Owns VS Code integration:

- Command and `WebviewViewProvider` registration.
- Dependency composition.
- Validation and dispatch of Webview commands to lifecycle-owning controllers.
- File, editor, Diff, storage, logging, and credential adapters.
- Canonical target/revision validation, temporary Diff, Checkpoint durability, and one Host-owned
  atomic `WorkspaceEdit` for file lifecycle operations. Mutation plans do not cross into the Webview
  as host values.
- VS Code API access for active editor/selection, diagnostics, and language services; URI normalization,
  Workspace Trust checks, cancellation, and disposal. Only bounded `Ide*Dto` values are published to
  Core and Protocol; VS Code types do not cross the boundary.
- Extension and Disposable lifecycle.

`extension.ts` is limited to registration and composition, not business workflows.

### 4.6 `apps/webview`

Owns presentation and user interaction:

- Chat message lists and streaming text.
- Independent, collapsible reasoning-summary presentation.
- Tool Call status cards and approval UI.
- Session selection and settings controls.
- Removable IDE-context source, range, stale/truncation state, and read-only Tool results.

Editor entry is captured by an Extension-owned controller and published as a strict
`extension/editor-context` projection. The Webview owns only the pending card, draft, and
`webview/editor-context-refresh|remove|use-stale` intents. Configuration, commands, VS Code lifecycle,
Trust, URI normalization, and cancellation remain Extension responsibilities; Protocol owns the closed
message set and `Ide*Dto` Schema.

The Webview never holds API keys or calls models, filesystems, or VS Code commands directly. Extension-
authoritative state is represented by Host snapshots/events and is not duplicated as a second authority.

### 4.7 `packages/testkit`

Provides reusable test doubles for stable Core contracts, such as deterministic Model Gateways,
Summarizers, and event collectors. Public names and scope follow the package `exports`; a Fake used by
one package remains in that package's tests. Tests never use real model APIs, user credentials, or
machine state.

### 4.8 `packages/mcp-client`

Isolates the official MCP SDK and exposes a Host-independent controlled Client boundary:

- Controlled stdio negotiation for modern `2026-07-28` and legacy `2025-11-25`, with the approved
  common Server primitives.
- Request correlation, cancellation, pagination, list refresh, limits, and stable error normalization.
- Protocol lifecycle through an injected stdio/process Port; it does not create real processes directly.
- MCP Tool adaptation to existing Core Tool contracts without owning Registry, approval, or Agent Loop.

SDK, JSON-RPC, transport, capability, Schema, and error types remain private to the package. It does
not depend on VS Code, Extension adapters, React, Webview, or persistence, and does not declare or
handle Roots, Sampling, Elicitation, Tasks, `input_required` continuation, HTTP, OAuth, experimental,
or multimodal capabilities. Real configuration, Workspace Trust, spawning, minimal environment, and
process-tree cleanup remain owned by `apps/extension`.

## 5. Dependency rules

```text
webview ───────────────→ protocol
extension ─────────────→ protocol + core + providers + builtin-tools
extension ─────────────→ mcp-client
providers ─────────────→ core contracts
builtin-tools ─────────→ core contracts + protocol DTOs
mcp-client ────────────→ core contracts (external Tool adaptation only)
core ──────────────────→ protocol
testkit ───────────────→ core contracts + protocol
```

Forbidden directions include:

```text
core → vscode
core → webview
webview → core implementation
providers → extension
builtin-tools → vscode
core → mcp-client
mcp-client → vscode
mcp-client → extension
```

Dependency rules should be protected by lint rules, path conventions, or dedicated architecture tests.

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
