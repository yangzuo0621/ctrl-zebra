import type { McpClientError, McpClientErrorCode } from "./contracts.js";

const errorMessages = {
  "connect-failed": "Could not connect to the MCP Server.",
  "protocol-incompatible": "The MCP Server does not support the required protocol version.",
  "capability-unsupported": "The MCP Server requested an unsupported capability.",
  "malformed-message": "The MCP Server sent a malformed message.",
  "limit-exceeded": "The MCP Server exceeded a resource limit.",
  "server-exited": "The MCP Server exited unexpectedly.",
  disconnected: "The MCP Server is disconnected.",
  "termination-unconfirmed": "The MCP Server process could not be confirmed as terminated.",
  internal: "The MCP connection failed unexpectedly.",
} as const satisfies Record<McpClientErrorCode, string>;

export function createMcpClientError(code: McpClientErrorCode): McpClientError {
  return { code, message: errorMessages[code] };
}

export class McpTransportFailure extends Error {
  constructor(readonly code: McpClientErrorCode) {
    super(errorMessages[code]);
    this.name = "McpTransportFailure";
  }
}
