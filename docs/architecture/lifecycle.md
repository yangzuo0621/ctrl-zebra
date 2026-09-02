## Extension Lifecycle

- `activate(context)` is the composition root. It registers VS Code-facing resources, wires adapters to internal contracts, and returns only after registrations required for activation are usable.
- Activation must remain cheap and deterministic. It must not scan a workspace, access the network, initialize a model client, restore sessions, or perform other work that can wait for an explicit user action.
- Registration and composition belong in `extension.ts`; business workflows belong in controllers or host-independent packages introduced by later tasks.
- `deactivate()` is reserved for asynchronous cleanup that VS Code must await. Synchronous VS Code registrations should be owned by `ExtensionContext.subscriptions` instead of being disposed a second time from `deactivate()`.
- Cleanup must be idempotent. A partially initialized resource must either never become reachable or have an owner that can safely dispose it.

## Uninstall-before local-data cleanup (T2106)

`ctrlZebra.clearLocalData` is a normal Extension-lifetime command and the Agent view delegates to
the same Host controller. Activation only creates the lightweight controller, adapters, and command;
it does not scan storage or clear anything. The user must invoke the action and accept its modal
high-risk warning before work begins.

The controller acquires cancellation/resource locks before clearing Session and Checkpoint stores,
Extension-owned storage roots, transient caches, Provider Secret names, configuration leaves, MCP
configuration, and Extension Mementos. It holds those locks through completion, shares concurrent
requests, releases them in reverse order, and reports each category so a failed cleanup can be retried.
MCP termination failure prevents destructive cleanup. A restart does not resume the operation; the
remaining local state is handled by a new explicit request. Uninstall documentation directs users to
run this action before removing the Extension, while VS Code global data outside CtrlZebra, workspace
files, user code, and other Extension state remain outside its ownership.

The same controller owns the explicit confirmation, fixed Protocol result projection, and terminal
Host notification for command and Webview callers. `extension.ts` supplies the VS Code prompt and
notification ports plus the concrete category operations; it does not implement a second clear flow.

## Disposable Ownership

- Every command, provider, event listener, watcher, timer, stream, child process, and other long-lived resource has exactly one lifecycle owner.
- Extension-lifetime VS Code registrations are added to `context.subscriptions` immediately after creation.
- A controller or adapter that creates child resources owns a composite `Disposable` and releases its children in reverse dependency order.
- Ownership transfer must be explicit. A factory must not retain a resource after returning ownership to its caller.
- Asynchronous cleanup is tracked separately because VS Code does not await asynchronous functions placed in `context.subscriptions`.

## Command Naming

- Public command IDs use the stable `ctrlZebra.<action>` namespace, for example `ctrlZebra.openAgent`.
- Action names describe user intent, not the implementing class or UI location.
- Renaming a contributed command is a public-contract change and requires an implementation-plan update before code changes.
- Internal commands use the same namespace and remain unlisted in `contributes.commands` unless users or keybindings need to invoke them.

## URI Boundary

- VS Code-facing code accepts and returns `vscode.Uri`; it must not reduce a URI to `fsPath` before entering an adapter that explicitly requires an operating-system path.
- Host-independent packages use JSON-serializable URI DTOs or their own validated identifiers and never import `vscode.Uri`.
- URI scheme, authority, query, and fragment are preserved across boundaries unless a documented adapter contract intentionally rejects them.
- Workspace containment and path normalization are security policy decisions owned by the workspace adapter layer. They must not be implemented with string-prefix comparisons.

## Adapter Responsibilities

- `apps/extension` adapters are the only modules that translate VS Code APIs and host values into internal contracts.
- Adapters handle host-specific registration, URI conversion, cancellation, errors, and resource disposal. They do not own Agent business decisions.
- Controllers coordinate a user interaction through internal ports. They must not leak VS Code types into Core or Protocol contracts.
- `extension.ts` may construct adapters and controllers but must not become an alternate location for their behavior.

## Feature-local Host wiring

- `createVsCodeFileMutationApprovalWorkflows` owns the complete VS Code binding for file edit,
  workspace edit, create, delete, and rename approvals: canonical revalidation, Diff presentation,
  Checkpoint-before-apply construction, Trust recheck, and conflict mapping. It starts no work during
  activation and owns no approval state. It transfers the five workflows to
  `ToolApprovalWorkflowRouter` and the Diff Presenter to `ExtensionContext.subscriptions`.
- `VsCodeEditorContext` owns Host availability classification and opaque source fingerprinting.
  `EditorContextEntryController` owns asynchronous transition fencing and view state; `extension.ts`
  only forwards VS Code editor/document events.
- `WorkspaceFileReferenceController` owns the set of view-local reference actions, removes disposed
  children, broadcasts document/root/Trust boundary changes, and disposes remaining children
  idempotently. `extension.ts` owns only the VS Code event registrations.

## Lazy Initialization

- Activation creates only the registrations and lightweight state required to make the extension available.
- Model clients, session stores, workspace indexing, Webviews, and other costly resources are initialized on first use by the module that owns them.
- Lazy initialization must be concurrency-safe: simultaneous callers share one initialization attempt and receive the same success or failure outcome.
- Failed initialization must leave no partially registered or unowned resources. A later retry is allowed only when the owning contract defines it.
- Background work must have an explicit trigger, cancellation path, and lifecycle owner; module import must never start work as a side effect.

## User-triggered diagnostics export (T2205)

Diagnostics export is composed in `extension.ts` but owned by the Extension-side
`DiagnosticsExportController`. The controller enforces one in-flight request, exact request/export
correlation, preview-before-confirmation, disposal invalidation, and fixed outcomes for no target,
invalid state, size limit, unavailable save dialog, and write failure. It does not read workspace or
conversation content and does not create background work during activation.

- The host-independent Protocol owns the strict diagnostics document and preview/request message
  schemas. The diagnostics builder owns the allowlist, redaction, aggregation, and UTF-8 bound;
  `PerformanceBaselineRecorder` supplies the existing bounded activation/display/RSS snapshot. The
  `ready` preview carries the exact compact serialization returned by that builder, including its
  trailing newline, so the rendered content and confirmed bytes cannot diverge.
- The Extension receives Run status only from the host-owned `WebviewRunMessageHandler` lifecycle
  callbacks. It records the emitted status (including active non-idle states); after view disposal,
  the unobservable state is represented as `unknown` rather than inferred from Webview state.
- `vscode-diagnostics-export.ts` is the only VS Code adapter. It owns the save dialog options,
  `Uri` display formatting, and `workspace.fs.writeFile` call. The selected target remains an opaque
  adapter value until the user confirms; only a bounded display label crosses to the Webview.
- The Webview owns the preview state and buttons. It cannot write directly and only sends strict
  request/confirm/cancel intents. A cancelled dialog, explicit Cancel, stale correlation, or view
  disposal cannot trigger a write. The write API is awaited and normalized to a fixed success or
  failure message; no raw host error is forwarded.
