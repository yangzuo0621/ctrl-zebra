import { ToolRegistry } from "@ctrl-zebra/core";
import type {
  McpConnectOutcome,
  McpDisconnectOutcome,
  McpProcessTermination,
  McpStdioPortHandlers,
} from "@ctrl-zebra/mcp-client";
import { McpPromptError, McpResourceError, McpToolDiscoveryError } from "@ctrl-zebra/mcp-client";
import { describe, expect, it, vi } from "vitest";

import type { McpServerConfiguration } from "../adapters/mcp-server-configuration.js";
import type { McpHostProcessFailure } from "../adapters/mcp-stdio-port.js";
import {
  McpConnectionController,
  type McpConnectionSnapshot,
} from "./mcp-connection-controller.js";

const configuration = {
  version: 1,
  serverId: "local_fixture",
  displayName: "Local fixture",
  command: "node",
  args: ["server.mjs"],
} as const satisfies McpServerConfiguration;

const connectedOutcome = {
  kind: "connected",
  connection: {
    status: "connected",
    protocolVersion: "2026-07-28",
    capabilities: {
      tools: false,
      toolsListChanged: false,
      resources: false,
      resourceTemplates: false,
      resourcesListChanged: false,
      prompts: false,
      promptsListChanged: false,
    },
  },
} as const satisfies McpConnectOutcome;

describe("MCP connection controller", () => {
  it("revalidates and connects only after a fresh exact startup approval", async () => {
    const harness = createHarness();
    const controller = new McpConnectionController(harness.values);

    await expect(controller.connect()).resolves.toMatchObject({
      generation: 1,
      status: "connected",
      server: { serverId: "local_fixture", displayName: "Local fixture" },
      configurationStale: false,
    });

    expect(harness.readConfiguration).toHaveBeenCalledTimes(2);
    expect(harness.bindWorkspace).toHaveBeenCalledTimes(2);
    expect(harness.requestStartupApproval).toHaveBeenCalledOnce();
    expect(harness.createPort).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "node",
        args: ["server.mjs"],
        cwdPath: "/workspace",
        environment: { PATH: "/bin" },
      }),
      expect.any(Function),
    );
    expect(harness.client.connect).toHaveBeenCalledOnce();
    expect(harness.notifyInformation).toHaveBeenCalledWith(
      "Connected to MCP Server “Local fixture”.",
    );
  });

  it("publishes connected state only after the complete Tool snapshot is accepted", async () => {
    const harness = createHarness();
    const controller = new McpConnectionController(harness.values);

    const result = await controller.connect();

    expect(harness.client.discoverTools).toHaveBeenCalledWith(
      {
        server: { serverId: "local_fixture", displayName: "Local fixture" },
        generation: 1,
        reservedToolNames: undefined,
      },
      expect.any(AbortSignal),
    );
    expect(harness.client.discoverResources).toHaveBeenCalledWith(
      {
        server: { serverId: "local_fixture", displayName: "Local fixture" },
        generation: 1,
      },
      expect.any(AbortSignal),
    );
    expect(harness.client.discoverPrompts).toHaveBeenCalledWith(
      {
        server: { serverId: "local_fixture", displayName: "Local fixture" },
        generation: 1,
      },
      expect.any(AbortSignal),
    );
    expect(result.status).toBe("connected");
  });

  it("fails and closes the connection when initial Tool discovery is rejected", async () => {
    const harness = createHarness();
    harness.client.discoverTools.mockRejectedValueOnce(new McpToolDiscoveryError("invalid-schema"));
    const controller = new McpConnectionController(harness.values);

    await expect(controller.connect()).resolves.toMatchObject({
      status: "failed",
      error: { code: "invalid-schema" },
    });
    expect(harness.client.disconnect).toHaveBeenCalledTimes(1);
  });

  it("fails and closes the connection when initial Resource discovery is rejected", async () => {
    const harness = createHarness();
    harness.client.discoverResources.mockRejectedValueOnce(
      new McpResourceError("malformed-message"),
    );
    const controller = new McpConnectionController(harness.values);

    await expect(controller.connect()).resolves.toMatchObject({
      status: "failed",
      error: { code: "malformed-message" },
    });
    expect(harness.client.disconnect).toHaveBeenCalledTimes(1);
  });

  it("fails and closes the connection when initial Prompt discovery is rejected", async () => {
    const harness = createHarness();
    harness.client.discoverPrompts.mockRejectedValueOnce(new McpPromptError("malformed-message"));
    const controller = new McpConnectionController(harness.values);

    await expect(controller.connect()).resolves.toMatchObject({
      status: "failed",
      error: { code: "malformed-message" },
    });
    expect(harness.client.disconnect).toHaveBeenCalledTimes(1);
  });

  it("merges concurrent connection requests before approval and process creation", async () => {
    const harness = createHarness();
    let approve: ((value: "approved") => void) | undefined;
    harness.requestStartupApproval.mockImplementation(
      () => new Promise((resolve) => (approve = resolve)),
    );
    const controller = new McpConnectionController(harness.values);

    const first = controller.connect();
    const second = controller.connect();
    await vi.waitFor(() => expect(harness.requestStartupApproval).toHaveBeenCalledOnce());
    approve?.("approved");

    await expect(first).resolves.toMatchObject({ status: "connected" });
    await expect(second).resolves.toMatchObject({ status: "connected" });
    expect(harness.requestStartupApproval).toHaveBeenCalledOnce();
    expect(harness.createPort).toHaveBeenCalledOnce();
  });

  it.each([
    ["denied", "approval-denied"],
    ["expired", "approval-expired"],
  ] as const)("does not spawn when startup approval is %s", async (approval, code) => {
    const harness = createHarness();
    harness.requestStartupApproval.mockResolvedValue(approval);
    const controller = new McpConnectionController(harness.values);

    await expect(controller.connect()).resolves.toMatchObject({
      status: "failed",
      error: { code },
    });
    expect(harness.createPort).not.toHaveBeenCalled();
  });

  it("invalidates approval when the effective configuration changes", async () => {
    const harness = createHarness();
    harness.readConfiguration
      .mockReturnValueOnce(configuration)
      .mockReturnValueOnce({ ...configuration, args: ["changed.mjs"] });
    const controller = new McpConnectionController(harness.values);

    await expect(controller.connect()).resolves.toMatchObject({
      status: "failed",
      error: { code: "approval-invalidated" },
    });
    expect(harness.createPort).not.toHaveBeenCalled();
  });

  it("invalidates an approval when workspace trust is lost before consumption", async () => {
    const harness = createHarness();
    harness.requestStartupApproval.mockImplementation(async () => {
      harness.setTrusted(false);
      return "approved";
    });
    const controller = new McpConnectionController(harness.values);

    await expect(controller.connect()).resolves.toMatchObject({
      status: "failed",
      error: { code: "approval-invalidated" },
    });
    expect(harness.createPort).not.toHaveBeenCalled();
  });

  it("rejects an untrusted workspace before approval or spawn", async () => {
    const harness = createHarness();
    harness.setTrusted(false);
    const controller = new McpConnectionController(harness.values);

    await expect(controller.connect()).resolves.toMatchObject({
      status: "failed",
      error: { code: "workspace-untrusted" },
    });
    expect(harness.requestStartupApproval).not.toHaveBeenCalled();
    expect(harness.createPort).not.toHaveBeenCalled();
  });

  it("marks a live configuration stale without replacing or restarting it", async () => {
    const harness = createHarness();
    const controller = new McpConnectionController(harness.values);
    await controller.connect();

    controller.markConfigurationStale();

    expect(controller.getState()).toMatchObject({
      status: "connected",
      configurationStale: true,
      server: { serverId: "local_fixture" },
    });
    expect(harness.createPort).toHaveBeenCalledOnce();
  });

  it("closes the result owner and reports an unexpected Server exit", async () => {
    const harness = createHarness();
    const controller = new McpConnectionController(harness.values);
    await controller.connect();

    harness.emitHostFailure("server-exited");

    expect(controller.getState()).toMatchObject({
      status: "failed",
      error: { code: "server-exited" },
    });
    expect(harness.notifyError).toHaveBeenCalledWith("The MCP Server exited unexpectedly.");
  });

  it("cancels an in-flight approval on disconnect and never creates a process", async () => {
    const harness = createHarness();
    harness.requestStartupApproval.mockImplementation(
      (_operation, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve("cancelled"), { once: true });
        }),
    );
    const controller = new McpConnectionController(harness.values);
    const connecting = controller.connect();
    await vi.waitFor(() => expect(harness.requestStartupApproval).toHaveBeenCalledOnce());

    await expect(controller.disconnect()).resolves.toMatchObject({ status: "disconnected" });
    await expect(connecting).resolves.toMatchObject({ status: "disconnected" });
    expect(harness.createPort).not.toHaveBeenCalled();
  });

  it("keeps unconfirmed termination failed and blocks process reuse", async () => {
    const harness = createHarness();
    harness.client.disconnect.mockResolvedValue({
      kind: "failed",
      error: {
        code: "termination-unconfirmed",
        message: "The MCP Server process could not be confirmed as terminated.",
      },
    });
    const controller = new McpConnectionController(harness.values);
    await controller.connect();

    await expect(controller.disconnect()).resolves.toMatchObject({
      status: "failed",
      error: { code: "termination-unconfirmed" },
    });
    await expect(controller.connect()).resolves.toMatchObject({
      status: "failed",
      error: { code: "termination-unconfirmed" },
    });
    expect(harness.createPort).toHaveBeenCalledOnce();
  });

  it("disconnects a live Server when notified of workspace trust loss", async () => {
    const harness = createHarness();
    const controller = new McpConnectionController(harness.values);
    await controller.connect();
    harness.setTrusted(false);

    controller.handleWorkspaceTrustChange();

    await vi.waitFor(() => expect(harness.client.disconnect).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(controller.getState().status).toBe("disconnected"));
  });

  it("reports unconfirmed process termination during Extension disposal", async () => {
    const harness = createHarness();
    harness.client.dispose.mockResolvedValue({
      kind: "failed",
      error: {
        code: "termination-unconfirmed",
        message: "The MCP Server process could not be confirmed as terminated.",
      },
    });
    const controller = new McpConnectionController(harness.values);
    await controller.connect();

    await expect(controller.dispose()).rejects.toThrow(
      "could not be confirmed as terminated during disposal",
    );
    expect(controller.getState()).toMatchObject({
      status: "failed",
      error: { code: "termination-unconfirmed" },
    });
  });

  it("does not start a Server merely by constructing or disposing the lifecycle owner", async () => {
    const harness = createHarness();
    const controller = new McpConnectionController(harness.values);

    expect(controller.getState()).toEqual<McpConnectionSnapshot>({
      generation: 0,
      status: "disconnected",
      configurationStale: false,
    });
    await controller.dispose();
    expect(harness.readConfiguration).not.toHaveBeenCalled();
    expect(harness.createPort).not.toHaveBeenCalled();
  });
});

function createHarness() {
  let trusted = true;
  let hostFailureHandler: ((failure: McpHostProcessFailure) => void) | undefined;
  const readConfiguration = vi.fn((): McpServerConfiguration => configuration);
  const bindWorkspace = vi.fn(async () => ({
    cwdUri: "file:///workspace",
    cwdPath: "/workspace",
  }));
  const requestStartupApproval = vi.fn(
    async (
      _operation: import("./mcp-startup-approval.js").McpServerStartOperation,
      _signal: AbortSignal,
    ): Promise<import("./mcp-startup-approval.js").McpStartupApprovalOutcome> => "approved",
  );
  const port = {
    hostFailure: undefined as McpHostProcessFailure | undefined,
    start: vi.fn(async (_handlers: McpStdioPortHandlers) => {}),
    write: vi.fn(async (_bytes: Uint8Array) => {}),
    closeInput: vi.fn(async () => {}),
    terminate: vi.fn(async (): Promise<McpProcessTermination> => "terminated"),
  };
  const createPort = vi.fn((_operation, onFailure: (failure: McpHostProcessFailure) => void) => {
    hostFailureHandler = onFailure;
    return port;
  });
  const client = {
    getState: vi.fn(() => connectedOutcome.connection),
    connect: vi.fn(async (): Promise<McpConnectOutcome> => connectedOutcome),
    discoverTools: vi.fn(
      async (context: {
        server: { serverId: string; displayName: string };
        generation: number;
      }) => ({
        server: context.server,
        generation: context.generation,
        tools: [],
        registry: new ToolRegistry(),
      }),
    ),
    getToolSnapshot: vi.fn(() => undefined),
    discoverResources: vi.fn(
      async (context: {
        server: { serverId: string; displayName: string };
        generation: number;
      }) => ({ ...context, resources: [], templates: [] }),
    ),
    getResourceCatalog: vi.fn(() => undefined),
    readResource: vi.fn(),
    discoverPrompts: vi.fn(
      async (context: {
        server: { serverId: string; displayName: string };
        generation: number;
      }) => ({ ...context, prompts: [] }),
    ),
    getPromptCatalog: vi.fn(() => undefined),
    getPrompt: vi.fn(),
    disconnect: vi.fn(async (): Promise<McpDisconnectOutcome> => ({ kind: "disconnected" })),
    dispose: vi.fn(async (): Promise<McpDisconnectOutcome> => ({ kind: "disconnected" })),
  };
  const notifyInformation = vi.fn();
  const notifyError = vi.fn();
  const log = vi.fn();

  return {
    values: {
      readConfiguration,
      bindWorkspace,
      workspaceTrust: {
        isTrusted: () => trusted,
        requireTrusted() {
          if (!trusted) {
            throw new Error("workspace untrusted");
          }
        },
      },
      environment: { PATH: "/bin" },
      requestStartupApproval,
      createPort,
      createClient: () => client,
      notifyInformation,
      notifyError,
      log,
    },
    readConfiguration,
    bindWorkspace,
    requestStartupApproval,
    createPort,
    client,
    notifyInformation,
    notifyError,
    setTrusted(value: boolean) {
      trusted = value;
    },
    emitHostFailure(failure: McpHostProcessFailure) {
      port.hostFailure = failure;
      hostFailureHandler?.(failure);
    },
  };
}
