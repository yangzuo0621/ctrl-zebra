import type { JSONRPCMessage } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

import { maxMcpMessageBytes } from "./contracts.js";
import { McpTransportFailure } from "./errors.js";
import { FixtureStdioPort } from "./fixture-stdio-port.js";
import { SdkStdioTransport } from "./sdk-stdio-transport.js";

describe("SdkStdioTransport", () => {
  it("rejects an oversized outbound frame before writing and cleans up once", async () => {
    const port = new FixtureStdioPort();
    const failures: string[] = [];
    const transport = new SdkStdioTransport(port, (code) => failures.push(code));
    const message: JSONRPCMessage = {
      jsonrpc: "2.0",
      method: "fixture/oversized",
      params: { value: "a".repeat(maxMcpMessageBytes) },
    };

    await transport.start();

    await expect(transport.send(message)).rejects.toEqual(
      new McpTransportFailure("limit-exceeded"),
    );
    await transport.waitForCleanup();

    expect(port.messages).toEqual([]);
    expect(failures).toEqual(["limit-exceeded"]);
    expect(port.closeInputCount).toBe(1);
    expect(port.terminateCount).toBe(1);
  });
});
