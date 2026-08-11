import type { ClientOptions } from "@modelcontextprotocol/client";

import { type McpProtocolMode, mcpLegacyProtocolVersion, mcpProtocolVersion } from "./contracts.js";

export const controlledSdkClientOptions = {
  capabilities: {},
  enforceStrictCapabilities: true,
  inputRequired: { autoFulfill: false },
  supportedProtocolVersions: [mcpProtocolVersion],
  versionNegotiation: { mode: { pin: mcpProtocolVersion } },
} satisfies ClientOptions;

/**
 * Build the private SDK option set used after the package-owned era probe.
 * `connect({ prior })` skips the SDK's own probe; the legacy version remains
 * present only so its initialize handshake can offer the closed legacy value.
 */
export function createControlledSdkClientOptions(mode: McpProtocolMode): ClientOptions {
  return {
    capabilities: {},
    enforceStrictCapabilities: true,
    inputRequired: { autoFulfill: false },
    supportedProtocolVersions:
      mode === "dual" ? [mcpProtocolVersion, mcpLegacyProtocolVersion] : [mcpProtocolVersion],
    versionNegotiation: { mode: { pin: mcpProtocolVersion } },
  };
}
