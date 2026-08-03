import type { McpClientError, McpClientErrorCode } from "./contracts.js";

const errorMessages = {
  "connect-failed": "Could not connect to the MCP Server.",
  "protocol-incompatible": "The MCP Server does not support the required protocol version.",
  "capability-unsupported": "The MCP Server requested an unsupported capability.",
  "malformed-message": "The MCP Server sent a malformed message.",
  "invalid-schema": "The MCP Server supplied an invalid or unsupported Tool schema.",
  "limit-exceeded": "The MCP Server exceeded a resource limit.",
  "server-exited": "The MCP Server exited unexpectedly.",
  disconnected: "The MCP Server is disconnected.",
  "tool-unavailable": "The MCP Tool is unavailable for the current connection.",
  "resource-unavailable": "The MCP Resource is unavailable for the current connection.",
  "resource-unsupported": "The MCP Resource uses unsupported content.",
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
