# Architecture Guidelines

This document defines the current runtime boundaries for the CtrlZebra desktop VS Code extension. It complements the dependency rules in `AGENTS.md` and keeps module ownership separate from protocol, security, and user-experience contracts.

The architecture contract is organized by domain so readers can load only the rules they need. Each
topic has one normative owner:

| Topic | Owner |
|---|---|
| Extension lifecycle, disposal, command naming, URI and adapter boundaries, and lazy initialization | [Lifecycle](architecture/lifecycle.md#extension-lifecycle) |
| IDE context and read-only Tool boundary, including editor entry lifecycle | [IDE Context](architecture/ide-context.md#ide-context-and-read-only-tool-boundary-t1901) |
| Model Provider and Provider configuration boundaries, including event projections | [Providers](architecture/providers.md#model-provider-boundary) |
| Tool contract and file lifecycle/atomic WorkspaceEdit boundary | [Tools and Files](architecture/tools-and-files.md#tool-contract-boundary) |
| Context budgeting, recovery, multi-turn history, and Session state machine | [Context and Session](architecture/context-and-session.md#context-budget-and-recovery-boundary) |
| Webview composition and host-capability boundary | This document and [UX](ux.md) |
| MCP package ownership and dependency direction | [MCP](mcp.md#process-ownership) |

The shard links above are stable entry points for the corresponding architecture domains; they are
the authoritative source for the exact runtime boundaries.

## Webview responsibility

The Webview is a presentation and interaction surface. It owns only validated display projections,
feature-store state, component-local interaction state, and intent dispatch. It does not access VS
Code APIs, files, secrets, models, persistence, or workspace state directly; those capabilities remain
behind the Extension Host and the Protocol boundary.

The Host owns Session identity, Run allocation, cancellation, approvals, persistence, workspace
access, and resource invalidation. Webview components receive typed data and callbacks, never parse
untrusted protocol envelopes or make workflow decisions. Shared client state belongs to feature stores;
derived values are computed from the owning state rather than synchronized through duplicate copies.

The Webview acquires the VS Code API through one local adapter when host messaging is available. The
acquired object is not exposed on `window`, serialized, logged, or passed through component props.
Rendering uses semantic HTML, existing VS Code CSS variables, visible focus, keyboard interaction,
and bounded text projections; detailed interaction behavior is owned by [UX](ux.md), while CSP and
untrusted-content rules are owned by [Security](security.md).
