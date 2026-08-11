export const mcpProtocolVersion = "2026-07-28" as const;
export const maxMcpMessageBytes = 1_048_576;
export const maxMcpStderrBytes = 65_536;
export const maxMcpListPages = 100;
export const maxMcpListEntries = 1_000;
export const maxMcpDescriptorBytes = 65_536;
export const maxMcpListSnapshotBytes = 1_048_576;
export const maxMcpRejectedTools = 256;
export const maxMcpRejectedToolProjectionBytes = maxMcpListSnapshotBytes;
export const maxMcpToolSchemaBytes = 65_536;
export const maxMcpToolSnapshotSchemaBytes = 524_288;
export const maxMcpToolSchemaDepth = 32;
export const maxMcpToolSchemaNodes = 4_096;
export const maxMcpToolSchemaProperties = 1_024;
export const maxMcpToolArgumentsBytes = 262_144;
export const maxMcpToolTextItems = 500;
export const maxMcpToolTextCodePoints = 262_144;
export const maxMcpToolTextBytes = 524_288;
export const maxMcpToolStructuredContentBytes = 524_288;
export const maxMcpResourceUriCodePoints = 2_048;
export const maxMcpResourceUriBytes = 8_192;
export const maxMcpResourceItems = 32;
export const maxMcpResourceCodePoints = 131_072;
export const maxMcpResourceTextBytes = 524_288;
export const maxMcpPromptArguments = 32;
export const maxMcpPromptArgumentNameCodePoints = 64;
export const maxMcpPromptArgumentValueCodePoints = 4_096;
export const maxMcpPromptArgumentsBytes = 65_536;
export const maxMcpPromptMessages = 32;
export const maxMcpPromptCodePoints = 65_536;
export const maxMcpPromptTextBytes = 262_144;

export type McpClientErrorCode =
  | "connect-failed"
  | "protocol-incompatible"
  | "capability-unsupported"
  | "malformed-message"
  | "invalid-schema"
  | "limit-exceeded"
  | "server-exited"
  | "disconnected"
  | "tool-unavailable"
  | "resource-unavailable"
  | "resource-unsupported"
  | "prompt-unavailable"
  | "prompt-unsupported"
  | "termination-unconfirmed"
  | "internal";

/** Stable, non-sensitive classifications for a Tool omitted from a mixed snapshot. */
export type McpToolRejectionReason =
  | "forbidden-keyword"
  | "unknown-keyword"
  | "invalid-reference"
  | "non-object-root"
  | "schema-invalid"
  | "limit-exceeded";

export interface McpClientError {
  readonly code: McpClientErrorCode;
  readonly message: string;
}

export interface McpServerCapabilities {
  readonly tools: boolean;
  readonly toolsListChanged: boolean;
  readonly resources: boolean;
  readonly resourceTemplates: boolean;
  readonly resourcesListChanged: boolean;
  readonly prompts: boolean;
  readonly promptsListChanged: boolean;
}

export interface McpConnectedState {
  readonly status: "connected";
  readonly protocolVersion: typeof mcpProtocolVersion;
  readonly capabilities: McpServerCapabilities;
}

export interface McpFailedState {
  readonly status: "failed";
  readonly capabilities: McpServerCapabilities;
  readonly error: McpClientError;
}

export interface McpInactiveState {
  readonly status: "disconnected" | "connecting" | "disconnecting";
  readonly capabilities: McpServerCapabilities;
}

export type McpConnectionState = McpConnectedState | McpFailedState | McpInactiveState;

export type McpConnectOutcome =
  | { readonly kind: "connected"; readonly connection: McpConnectedState }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly error: McpClientError };

export type McpDisconnectOutcome =
  | { readonly kind: "disconnected" }
  | { readonly kind: "failed"; readonly error: McpClientError };

export interface McpStderrSnapshot {
  readonly text: string;
  readonly truncated: boolean;
}

export interface McpStdioPortHandlers {
  readonly stdout: (chunk: Uint8Array) => void;
  readonly stderr: (chunk: Uint8Array) => void;
  readonly exited: () => void;
  readonly error: (cause: unknown) => void;
}

export type McpProcessTermination = "terminated" | "unconfirmed";

/**
 * Extension-owned process and pipe operations injected into the MCP package.
 * Implementations must enforce Host trust, spawn, environment, and process-tree policy.
 */
export interface McpStdioPort {
  start(handlers: McpStdioPortHandlers): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  closeInput(): Promise<void>;
  terminate(): Promise<McpProcessTermination>;
}

export interface ControlledMcpClientOptions {
  readonly clientName?: string;
  readonly clientVersion?: string;
}

export interface McpServerIdentity {
  readonly serverId: string;
  readonly displayName: string;
}

export interface McpToolDiscoveryContext {
  readonly server: McpServerIdentity;
  readonly generation: number;
  readonly reservedToolNames?: readonly string[];
}

export type McpToolDiagnostic =
  | {
      readonly kind: "rejections";
      readonly rejectedTools: readonly {
        readonly mcpToolName: string;
        readonly reason: McpToolRejectionReason;
      }[];
      readonly rejectedToolsTruncated: boolean;
    }
  | {
      readonly kind: "failure";
      readonly code: "invalid-schema" | "limit-exceeded" | "malformed-message";
    };

export interface McpToolArguments {
  readonly [key: string]: import("@ctrl-zebra/core").JsonValue;
}

export interface McpResourceDiscoveryContext {
  readonly server: McpServerIdentity;
  readonly generation: number;
}

export interface McpPromptDiscoveryContext {
  readonly server: McpServerIdentity;
  readonly generation: number;
}
