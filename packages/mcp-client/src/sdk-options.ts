import type { ClientOptions } from "@modelcontextprotocol/client";

import { mcpProtocolVersion } from "./contracts.js";

export const controlledSdkClientOptions = {
  capabilities: {},
  enforceStrictCapabilities: true,
  inputRequired: { autoFulfill: false },
  supportedProtocolVersions: [mcpProtocolVersion],
  versionNegotiation: { mode: { pin: mcpProtocolVersion } },
} satisfies ClientOptions;
