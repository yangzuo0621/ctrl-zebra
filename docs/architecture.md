# Architecture Guidelines

This document defines the initial runtime boundaries for the CtrlZebra desktop VS Code extension. It complements the dependency rules in `AGENTS.md` and is intentionally limited to decisions required before T0101.

## Extension Lifecycle

- `activate(context)` is the composition root. It registers VS Code-facing resources, wires adapters to internal contracts, and returns only after registrations required for activation are usable.
- Activation must remain cheap and deterministic. It must not scan a workspace, access the network, initialize a model client, restore sessions, or perform other work that can wait for an explicit user action.
- Registration and composition belong in `extension.ts`; business workflows belong in controllers or host-independent packages introduced by later tasks.
- `deactivate()` is reserved for asynchronous cleanup that VS Code must await. Synchronous VS Code registrations should be owned by `ExtensionContext.subscriptions` instead of being disposed a second time from `deactivate()`.
- Cleanup must be idempotent. A partially initialized resource must either never become reachable or have an owner that can safely dispose it.

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

## Lazy Initialization

- Activation creates only the registrations and lightweight state required to make the extension available.
- Model clients, session stores, workspace indexing, Webviews, and other costly resources are initialized on first use by the module that owns them.
- Lazy initialization must be concurrency-safe: simultaneous callers share one initialization attempt and receive the same success or failure outcome.
- Failed initialization must leave no partially registered or unowned resources. A later retry is allowed only when the owning contract defines it.
- Background work must have an explicit trigger, cancellation path, and lifecycle owner; module import must never start work as a side effect.
