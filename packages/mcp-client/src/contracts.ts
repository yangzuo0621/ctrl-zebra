export const mcpProtocolVersion = "2026-07-28" as const;
export const maxMcpMessageBytes = 1_048_576;
export const maxMcpStderrBytes = 65_536;
export const maxMcpListPages = 100;
export const maxMcpListEntries = 1_000;
export const maxMcpDescriptorBytes = 65_536;
export const maxMcpListSnapshotBytes = 1_048_576;
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
  | "termination-unconfirmed"
  | "internal";

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

export interface McpToolArguments {
  readonly [key: string]: import("@ctrl-zebra/core").JsonValue;
}
