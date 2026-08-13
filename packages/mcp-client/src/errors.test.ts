import { describe, expect, it } from "vitest";

import { McpToolDiscoveryError } from "./controlled-mcp-client.js";
import { createMcpClientError, McpTransportFailure } from "./errors.js";
import { McpNegotiationFailure } from "./mcp-negotiation.js";
import { McpPromptError } from "./mcp-prompt.js";
import { McpResourceError } from "./mcp-resource.js";
import { McpToolSnapshotError } from "./mcp-tool-snapshot.js";

const clientErrorCodes = [
  "connect-failed",
  "protocol-incompatible",
  "capability-unsupported",
  "malformed-message",
  "invalid-schema",
  "limit-exceeded",
  "server-exited",
  "disconnected",
  "tool-unavailable",
  "resource-unavailable",
  "resource-unsupported",
  "prompt-unavailable",
  "prompt-unsupported",
  "termination-unconfirmed",
  "internal",
] as const;

describe("MCP client errors", () => {
  it("normalizes every client failure to its stable code and message", () => {
    for (const code of clientErrorCodes) {
      expect(createMcpClientError(code)).toEqual({
        code,
        message: expect.any(String),
      });
      expect(new McpTransportFailure(code)).toMatchObject({
        code,
        message: createMcpClientError(code).message,
      });
    }
  });

  it.each([
    ["prompt", new McpPromptError("prompt-unsupported")],
    ["resource", new McpResourceError("resource-unsupported")],
    ["tool snapshot", new McpToolSnapshotError("invalid-schema")],
    ["tool discovery", new McpToolDiscoveryError("invalid-schema")],
    ["negotiation", new McpNegotiationFailure("protocol-incompatible")],
  ] as const)("keeps the %s domain error message client-owned", (_kind, error) => {
    expect(error.message).toBe(createMcpClientError(error.code).message);
  });
});
