
## IDE context and read-only Tool boundary (T1901)

T1901 establishes the boundary for editor, selection, diagnostic, and language-service data. It is a
docs-only contract; T1902–T1905 add the individual adapters and user entry points only after this
constraint is merged.

- `apps/extension` is the sole owner of `window.activeTextEditor`, selections, `TextDocument` reads,
  VS Code diagnostic and language-service commands, `vscode.Uri`, Workspace Trust, and the host
  lifecycle. It maps those values into the strict `Ide*Dto` types in Protocol and never passes a VS
  Code object, `fsPath`, provider object, or host exception to Core, Webview, persistence, or a Tool.
- The workspace adapter keeps the canonical `vscode.Uri` private while it checks the selected root,
  scheme, authority, URI path segments, symlinks/junctions, and the document revision. A returned
  location that cannot be normalized and proven inside the selected root is discarded rather than
  shown or inserted. Active editor changes never silently switch the selected root.
- `packages/builtin-tools` owns only host-independent parsing, Tool names, result DTOs, and injected
  `IdeContextPort`/language-service Ports. It may expose read-only Tools such as
  `read_editor_context`, `get_diagnostics`, `find_definition`, `find_references`, and
  `list_symbols`; it never imports VS Code or decides Trust, URI containment, freshness, or UI state.
- `packages/core` treats an explicitly attached IDE snapshot as one ordinary, untrusted user-context
  unit. It is never a System message, policy, Tool definition, approval scope, Workspace authorization,
  or hidden instruction. Core budgets and truncates it with the existing Files/context budget and
  never borrows System, History, or Tools budget to preserve it.
- `apps/webview` receives only validated Protocol projections. It owns the visible attachment list,
  remove/refresh interaction, and presentation state; it cannot read the editor, invoke a language
  service, choose a URI, or turn a read-only result into a write, Code Action, command, or approval.
- `packages/mcp-client` remains independent of VS Code and IDE context. `packages/testkit` supplies
  deterministic Port fakes; no test or fixture starts a real language server or reads a developer
  workspace.

Host lifecycle and freshness are explicit:

- Activation may register lightweight editor/diagnostic events, but it never reads the active document,
  scans a workspace, starts a provider, or injects context in the background. An explicit user
  attachment or model Tool call starts one bounded capture.
- `read_editor_context` resolves only the requested active editor or exact selection. A collapsed
  selection produces a valid empty snapshot with `text: ""` and the exact collapsed range; it never
  falls back to an active line/file. If no active editor exists, the Host returns the fixed unavailable
  outcome and performs no fallback capture.
- Each capture records the Host-owned source URI, selection/range, language identifier, and document
  version privately before collecting text. Before a projection is delivered, the Host rechecks the
  active editor/selection, selected root, Trust state, setting, and document version. A changed
  source is marked `stale` and requires an explicit refresh or user decision; a pending capture that
  loses its owner is dropped and cannot arrive as a late injection.
- Each capture and read-only Tool call owns an `AbortController` connected to the Run, Session switch,
  editor/workspace change, setting disable, Trust loss, and Extension disposal. The owner closes the
  delivery gate before cleanup. Cancellation is not a Tool Result: after it, no text, diagnostic,
  language result, retry, persistence mutation, approval, or Host/Webview message may be emitted. A
  Webview cancel handler updates only its own local interaction state synchronously before it attempts
  one cancel intent in the same event turn; if the Host gate is already closed, it posts no intent. It
  cannot wait for or synthesize a Host cancellation outcome.
- Read-only language-service calls use only the existing VS Code provider commands and return data;
  they never execute Code Actions, edits, commands, network requests, or an index. Provider output is
  untrusted and is bounded, URI-validated, and source-labelled before it can become a Tool Result. A
  non-empty mixed location set is filtered to in-scope items and marked with the closed
  `out-of-workspace` omission reason; an all-filtered or malformed set returns stable `invalid-output`
  with no path/detail, while an actually empty provider set remains a valid empty result. SDK symbol
  kinds are mapped to the closed CtrlZebra `IdeSymbolKind` set with unknown values mapped to `unknown`.
  DocumentSymbol nodes are flattened depth-first with optional detail; each child may receive its
  immediate parent name as optional containerName. SymbolInformation entries preserve optional
  containerName and have no detail; absent optional fields are omitted and unsupported SDK fields never
  cross the boundary.
- The same ownership and gate apply in a limited untrusted workspace. Read-only capture may remain
  available when the Extension declares that capability, but it never grants Trust or enables a write,
  execute, MCP, or other side-effecting operation. If VS Code or a provider refuses an operation, the
  Host returns a stable unavailable outcome without a hidden fallback.

### T1905 editor entry lifecycle

The explicit entry path is an Extension-owned controller layered on the T1902 adapter. The public
configuration key is `ctrlZebra.editorContext.enabled` (boolean, default `false`, `window` scope). The
public commands are `ctrlZebra.askAboutSelection` and `ctrlZebra.askAboutFile`; both are registered and
contributed to Command Palette and `editor/context`, but their menu `when` clauses and `enablement` are
only discoverability hints. The controller rechecks the setting, active editor, exact selection (for the
selection command), selected root, Trust, supported text identity, and document version immediately before
capture. A direct `commands.executeCommand` invocation cannot bypass those checks.

Each Agent Webview view owns two explicit gates, as defined by the Protocol contract. The **capture delivery
gate** owns one bounded read, an AbortController, and a Host-issued `captureId`; Refresh closes the prior
gate before opening the next. Cancellation, supersession, editor/selection/document/workspace transition,
setting disable, Trust loss, Session/New chat, view disposal, or Extension disposal closes this gate before
cleanup. A completion whose gate, source tuple, or document revision is no longer current is dropped and
cannot post a `ready` or `unavailable` capture result, owner transition, or card.

The capture fence is `(viewGeneration, sessionGeneration, captureId)`. The delivered-card owner tuple is
exactly `(viewGeneration, sessionGeneration, cardGeneration, contextId)`; `captureId` appears only on
`ready`/`stale` projections for capture correlation and is not part of a Webview intent tuple. `cleared`
intentionally omits `captureId` and correlates by the current owner tuple's card/context fields.

The **delivered-card/event projection owner gate** opens only at the ordered `ready` enqueue commit and owns
the immutable `(viewGeneration, sessionGeneration, cardGeneration, contextId)` tuple. It remains the sole
owner of that card until replacement or invalidation. After all affected capture gates close, an editor,
selection, or document transition may pass one bounded `stale` event through this gate; setting disable,
Trust loss, selected-root/workspace change, or unsupported current editor passes one Host-driven `cleared`
event and closes it. Remove and accepted New chat are Webview-local transitions: the Webview clears the
editor card, stale decision, and capture-local state synchronously before posting the single intent or new-chat
action. Session switch/restore is Host-driven but transactional: the Host closes both gates and the Webview
clears its editor store before the new session generation is committed; the Host emits no editor `cleared`
event for that boundary. Disposal likewise closes both gates and emits no editor event. If no card has been
committed, transitions emit no stale/clear projection and a cancelled capture emits no result. A card gate
never reopens a capture gate or authorizes a model/Tool action.

The controller serializes capture completion, Webview intents, and spontaneous transitions in one owner
queue. `viewGeneration` is allocated monotonically for each Webview resolution (counter starts at `1` per
Extension activation); `sessionGeneration` starts at `0` per view and increments for each Host-accepted
Session owner replacement (restore/selection commit, Session switch, or New chat); `cardGeneration`
increments on card allocation/invalidation; and `eventSequence` increments for every Host-to-Webview editor
event. Every counter is a non-negative safe integer. Before incrementing, the owner checks the next value
against `Number.MAX_SAFE_INTEGER`; overflow fails closed with no event, wrap, reuse, or silent reset, closes
the affected gate, and rejects further editor entry. Session/card/event overflow requires a new Webview
generation; view overflow requires a new Extension activation. Counters otherwise reset only with their
owning view/session generation and are never reused within an Extension activation. Outbound `requestId`
values are Host-issued event IDs; inbound Webview request IDs are intent IDs and are deduplicated by exact
payload. The active owner tuple and generation fences reject old capture results, old requests, cross-view/
session events, same-sequence conflicts, and post-disposal messages before any state mutation.

When the Webview receives a Host event, it compares the canonical validated payload with the retained record
for the exact same `eventSequence` before applying monotonic ordering. An identical same-sequence event is an
idempotent no-op; a conflicting same-sequence event is discarded. Only an event with a greater sequence can
commit and advance the watermark; a lower sequence is a stale no-op. This ordering applies before any UI
mutation and is covered by the deterministic race tests.

For each delivered owner the Host keeps a one-way `staleTransitionWatermark` containing bounded normalized
stale reasons and a deterministic source fingerprint (Host-owned source identity, document version, language,
and exact range/selection). The owner queue checks this record before allocating an event sequence or request
ID. The first transition reserves it and emits one stale projection; matching pending/committed transitions,
and any later transition while the owner is stale-latched, emit nothing and allocate no IDs. A newer ready
owner resets the watermark. This Host transition check is separate from Webview exact same-sequence,
requestId, and canonical-payload retransmission de-duplication.

The Agent view exposes only the strict `extension/editor-context` projection. It queues at most the newest
event for a resolved owner, drops queued data on disposal, and never exposes `Webview`, `TextEditor`, `Uri`,
or `AbortController` objects to Webview/Core. A command focuses the Agent view, then posts one projection;
it does not call the model or create a Run. A ready card can be sent after review/editing; only stale state
blocks Send until refresh or explicit `Use stale context`.

Required adapter/controller tests cover normal ready → editable/send, collapsed selection, no editor, an
`editorTextFocus` menu-visible but unsupported/outside/untrusted document, setting disable, focus and
selection preservation, cancel/close races, Refresh A→B, transition-before-capture-completion,
completion-before-transition, one-stale-per-owner transition watermarking before event ID allocation,
Webview retransmission deduplication, stale/clear deduplication, local Remove/New-chat/disposal clearing with no Host
clear event, transactional Host restore/session-switch clearing, generation allocation/reset, safe-integer
overflow fail-closed/new-view requirements, strict message validation, cross-view/session fences,
same-sequence duplicate/conflict comparison before monotonic checks, and post-disposal suppression.
