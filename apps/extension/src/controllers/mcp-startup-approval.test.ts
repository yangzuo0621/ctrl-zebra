import { describe, expect, it, vi } from "vitest";

import {
  approveMcpServerStartLabel,
  type McpServerStartOperation,
  McpStartupApproval,
  sameMcpStartOperation,
} from "./mcp-startup-approval.js";

const operation = {
  configuration: {
    version: 1,
    serverId: "local_fixture",
    displayName: "Local fixture",
    command: "node",
    args: ["server.mjs", "--stdio"],
  },
  command: "node",
  args: ["server.mjs", "--stdio"],
  cwdUri: "file:///workspace",
  cwdPath: "/workspace",
  environment: { PATH: "/bin" },
} satisfies McpServerStartOperation;

describe("MCP startup approval", () => {
  it("shows and approves the exact process operation once", async () => {
    const showWarningMessage = vi.fn(
      async (_message: string, _options: import("vscode").MessageOptions, _item: string) =>
        approveMcpServerStartLabel,
    );
    const approval = new McpStartupApproval({ now: fixedNow, showWarningMessage });

    await expect(approval.request(operation, new AbortController().signal)).resolves.toBe(
      "approved",
    );
    expect(showWarningMessage).toHaveBeenCalledWith(
      "Start external MCP Server “Local fixture”?",
      expect.objectContaining({
        modal: true,
        detail: expect.stringContaining('Executable: "node"'),
      }),
      approveMcpServerStartLabel,
    );
    const detail = showWarningMessage.mock.calls[0]?.[1].detail ?? "";
    expect(detail).toContain('Arguments: ["server.mjs","--stdio"]');
    expect(detail).toContain("Working directory: file:///workspace");
    expect(detail).toContain("Protocol mode: modern-only");
    expect(detail).toContain("Workspace trust: trusted");
    expect(detail).toContain("Expires: 2026-08-03T00:05:00.000Z");
    expect(detail).not.toContain("PATH");
  });

  it("renders the normalized explicit mode without exposing raw configuration details", async () => {
    const showWarningMessage = vi.fn(
      async (_message: string, _options: import("vscode").MessageOptions, _item: string) =>
        undefined,
    );
    const approval = new McpStartupApproval({ now: fixedNow, showWarningMessage });
    const dualOperation = {
      ...operation,
      configuration: {
        ...operation.configuration,
        version: 2,
        protocolMode: "dual" as const,
      },
    } satisfies McpServerStartOperation;

    await expect(approval.request(dualOperation, new AbortController().signal)).resolves.toBe(
      "denied",
    );
    const detail = showWarningMessage.mock.calls[0]?.[1].detail ?? "";
    expect(detail).toContain("Protocol mode: dual");
    expect(detail).not.toContain('"version"');
    expect(detail).not.toContain("protocolMode");
  });

  it("distinguishes denial, expiry, and cancellation", async () => {
    await expect(
      new McpStartupApproval({ now: fixedNow, showWarningMessage: async () => undefined }).request(
        operation,
        new AbortController().signal,
      ),
    ).resolves.toBe("denied");

    let now = new Date("2026-08-03T00:00:00.000Z");
    await expect(
      new McpStartupApproval({
        now: () => now,
        showWarningMessage: async () => {
          now = new Date("2026-08-03T00:05:00.000Z");
          return approveMcpServerStartLabel;
        },
      }).request(operation, new AbortController().signal),
    ).resolves.toBe("expired");

    let resolvePrompt: ((value: string | undefined) => void) | undefined;
    const controller = new AbortController();
    const request = new McpStartupApproval({
      now: fixedNow,
      showWarningMessage: () => new Promise((resolve) => (resolvePrompt = resolve)),
    }).request(operation, controller.signal);
    controller.abort();
    await expect(request).resolves.toBe("cancelled");
    resolvePrompt?.(approveMcpServerStartLabel);
  });

  it("compares every immutable startup field except the hidden fixed environment", () => {
    expect(sameMcpStartOperation(operation, { ...operation })).toBe(true);
    expect(
      sameMcpStartOperation(operation, {
        ...operation,
        configuration: { ...operation.configuration, args: ["other.mjs"] },
      }),
    ).toBe(false);
    expect(sameMcpStartOperation(operation, { ...operation, cwdPath: "/other" })).toBe(false);
  });

  it("compares the normalized effective protocol mode, not the raw configuration version", () => {
    const explicitModernOnly = {
      ...operation,
      configuration: {
        ...operation.configuration,
        version: 2,
        protocolMode: "modern-only" as const,
      },
    } satisfies McpServerStartOperation;
    const dual = {
      ...operation,
      configuration: {
        ...operation.configuration,
        version: 2,
        protocolMode: "dual" as const,
      },
    } satisfies McpServerStartOperation;

    expect(sameMcpStartOperation(operation, explicitModernOnly)).toBe(true);
    expect(sameMcpStartOperation(explicitModernOnly, operation)).toBe(true);
    expect(sameMcpStartOperation(operation, dual)).toBe(false);
    expect(sameMcpStartOperation(dual, operation)).toBe(false);
  });
});

function fixedNow(): Date {
  return new Date("2026-08-03T00:00:00.000Z");
}
