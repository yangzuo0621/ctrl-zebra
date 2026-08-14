# Protocol Guidelines

This document defines the Webview/Extension message boundary established before T0105. It applies to messages in both directions and complements the architecture and security rules in `AGENTS.md`.

The protocol contract is organized by domain so readers can load only the rules they need. Each
topic has one normative owner:

| Topic | Owner |
|---|---|
| Envelope, direction, correlation, Provider model selection/onboarding, and restricted Markdown | [Wire and Provider](protocol/wire-and-provider.md#envelope) |
| Session/Run commands, reasoning and usage events, runtime validation, errors, and serialization | [Session and Runtime](protocol/session-and-runtime.md#session-and-run-commands) |
| Tool DTOs, file lifecycle/atomic mutation, and search regex mode | [Tools and File Lifecycle](protocol/tools-and-file-lifecycle.md#tool-data-contracts) |
| IDE context/read-only Tools and editor-initiated context entry | [IDE Context](protocol/ide-context.md#ide-context-and-read-only-tool-dtos-t1901) |
| MCP identity, status, errors, message correlation, and Tool catalog projections | [MCP Connection](protocol/mcp-connection.md#mcp-cross-boundary-contract) |
| MCP Tool acceptance, schema policy, diagnostics, and recovery projection | [MCP Schema and Diagnostics](protocol/mcp-schema-and-diagnostics.md#tool-acceptance-and-rejection-projection) |
| MCP dual-era configuration, resources, prompts, validation, and bounds | [MCP Configuration and Resources](protocol/mcp-configuration-and-resources.md#dual-era-configuration-and-negotiated-projection-t1804) |

The shard links above are stable entry points for the corresponding protocol domains; they are the
authoritative source for the exact wire contracts.
