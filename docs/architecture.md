# Architecture Guidelines

This document defines the initial runtime boundaries for the CtrlZebra desktop VS Code extension. It complements the dependency rules in `AGENTS.md` and is intentionally limited to decisions required before T0101.

The architecture contract is organized by domain so readers can load only the rules they need. Each
topic has one normative owner:

| Topic | Owner |
|---|---|
| Extension lifecycle, disposal, command naming, URI and adapter boundaries, and lazy initialization | [Lifecycle](architecture/lifecycle.md#extension-lifecycle) |
| IDE context and read-only Tool boundary, including editor entry lifecycle | [IDE Context](architecture/ide-context.md#ide-context-and-read-only-tool-boundary-t1901) |
| Model Provider and Provider configuration boundaries, including event projections | [Providers](architecture/providers.md#model-provider-boundary) |
| Tool contract and file lifecycle/atomic WorkspaceEdit boundary | [Tools and Files](architecture/tools-and-files.md#tool-contract-boundary) |
| Context budgeting, recovery, multi-turn history, and Session state machine | [Context and Session](architecture/context-and-session.md#context-budget-and-recovery-boundary) |
| MCP package ownership and dependency direction | [MCP](mcp.md#process-ownership) |

The shard links above are stable entry points for the corresponding architecture domains; they are
the authoritative source for the exact runtime boundaries.
