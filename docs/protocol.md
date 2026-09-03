# Protocol Guidelines

This document defines the Webview/Extension message boundary established before T0105. It applies to messages in both directions and complements the architecture and security rules in `AGENTS.md`.

The protocol contract is organized by domain so readers can load only the rules they need. Each
topic has one normative owner:

| Topic | Owner |
|---|---|
| Envelope, direction, correlation, Provider model selection/onboarding, and restricted Markdown | [Wire and Provider](protocol/wire-and-provider.md#envelope) |
| Session/Run commands (including target-bound regeneration and historical editing), reasoning and usage events, runtime validation, errors, and serialization | [Session and Runtime](protocol/session-and-runtime.md#session-and-run-commands) |
| Tool DTOs, file lifecycle/atomic mutation, and search regex mode | [Tools and File Lifecycle](protocol/tools-and-file-lifecycle.md#tool-data-contracts) |
| IDE context/read-only Tools and editor-initiated context entry | [IDE Context](protocol/ide-context.md#ide-context-and-read-only-tool-dtos-t1901) |
| MCP boundary DTO family | [MCP](mcp.md#protocol-projections) |
| User-triggered redacted diagnostics export and preview correlation | This document and the public `@ctrl-zebra/protocol` diagnostics-export/message schemas |

The shard links above are stable entry points for the corresponding protocol domains; they are the
authoritative source for the exact wire contracts.

## User-triggered redacted diagnostics export (T2205)

The Webview sends `webview/diagnostics-export` with a request ID, then may send the exact
`webview/diagnostics-export-confirm` or `webview/diagnostics-export-cancel` pair only after a
`extension/diagnostics-export-preview` with a matching export ID. A `ready` preview contains the
bounded target display label, the strict `DiagnosticsExportDocument`, and `content`, the exact compact
JSON-plus-newline serialization that the Host will write. The Protocol rejects content that does not
match that document byte representation; terminal messages contain only fixed status codes and bounded
product text. Unknown fields, stale IDs, unsupported enum values, raw errors, and unbounded text are
rejected at the Protocol boundary.

`DiagnosticsExportDocument` is an allowlisted local support projection: extension/VS Code/platform
versions, a closed Provider type, aggregated closed error categories, MCP status/generation and
closed negotiation facts, and bounded runtime measurements. It never contains keys, authorization
headers, endpoint credentials, command arguments, paths, workspace or editor content, conversation
body, or raw third-party errors. The serialized UTF-8 document is bounded to 64 KiB and is shown in
full before confirmation. The target label is a preview-only value and is not part of the document.
