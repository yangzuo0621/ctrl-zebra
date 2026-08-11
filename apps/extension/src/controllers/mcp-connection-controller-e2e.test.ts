import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ControlledMcpClient, type McpProtocolMode } from "@ctrl-zebra/mcp-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServerConfiguration } from "../adapters/mcp-server-configuration.js";
import { NodeMcpStdioPort } from "../adapters/mcp-stdio-port.js";
import {
  McpConnectionController,
  type McpConnectionSnapshot,
} from "./mcp-connection-controller.js";

const fixturePath = fileURLToPath(
  new URL("../test/fixtures/mcp-server-fixture.mjs", import.meta.url),
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("MCP connection controller stdio wiring", () => {
  it("connects an explicit dual configuration to the legacy fixture after approval and trust", async () => {
    const fixture = await createControllerFixture("legacy", "dual");
    try {
      const snapshot = await fixture.controller.connect();

      expect(snapshot).toMatchObject({
        generation: 1,
        status: "connected",
        configuredMode: "dual",
        server: { serverId: "local_fixture" },
        connection: {
          configuredMode: "dual",
          negotiated: { era: "legacy", version: "2025-11-25" },
        },
      });
      expect(fixture.requestStartupApproval).toHaveBeenCalledOnce();
      expect(fixture.createPort).toHaveBeenCalledOnce();
      expect(fixture.createClient).toHaveBeenCalledWith(expect.anything(), {
        protocolMode: "dual",
      });
      const events = await readFile(fixture.eventsPath, "utf8");
      expect(events).toContain('"detail":"server/discover"');
      expect(events).toContain('"detail":"initialize"');
    } finally {
      await fixture.controller.dispose();
    }
  });

  it("keeps malformed dual stdio failures in the controller without legacy fallback", async () => {
    const fixture = await createControllerFixture("malformed", "dual");
    let snapshot: McpConnectionSnapshot | undefined;
    try {
      snapshot = await fixture.controller.connect();

      expect(snapshot).toMatchObject({
        generation: 1,
        status: "failed",
        configuredMode: "dual",
        error: { code: "malformed-message" },
      });
      await vi.waitFor(async () =>
        expect(await readFile(fixture.eventsPath, "utf8")).toContain('"event":"exited"'),
      );
      const events = await readFile(fixture.eventsPath, "utf8");
      expect(events).toContain('"detail":"server/discover"');
      expect(events).not.toContain('"detail":"initialize"');
    } finally {
      if (snapshot?.status !== "failed") {
        await fixture.controller.disconnect();
      }
      await fixture.controller.dispose();
    }
  });
});

async function createControllerFixture(mode: "legacy" | "malformed", protocolMode: "dual") {
  const directory = await mkdtemp(join(tmpdir(), "ctrl-zebra-mcp-controller-fixture-"));
  temporaryDirectories.push(directory);
  const eventsPath = join(directory, "events.jsonl");
  const configuration = {
    version: 2,
    protocolMode,
    serverId: "local_fixture",
    displayName: "Local fixture",
    command: process.execPath,
    args: [fixturePath, "--mode", mode, "--events", eventsPath],
  } as const satisfies McpServerConfiguration;
  const requestStartupApproval = vi.fn(async () => "approved" as const);
  const createPort = vi.fn(
    (operation, onFailure) => new NodeMcpStdioPort(operation, { onFailure }),
  );
  const createClient = vi.fn(
    (
      port: ConstructorParameters<typeof ControlledMcpClient>[0],
      options: { readonly protocolMode: McpProtocolMode },
    ) => new ControlledMcpClient(port, options),
  );
  const controller = new McpConnectionController({
    readConfiguration: () => configuration,
    bindWorkspace: vi.fn(async () => ({
      cwdUri: "file:///workspace",
      cwdPath: process.cwd(),
    })),
    workspaceTrust: {
      isTrusted: () => true,
      requireTrusted() {},
    },
    environment: {},
    requestStartupApproval,
    createPort,
    createClient,
    notifyInformation: vi.fn(),
    notifyError: vi.fn(),
    log: vi.fn(),
    getReservedToolNames: () => [],
  });
  return { controller, createClient, createPort, eventsPath, requestStartupApproval };
}
