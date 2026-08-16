import { describe, expect, it } from "vitest";

import { createDiagnosticsExport } from "./diagnostics-export.js";

describe("diagnostics export builder", () => {
  it("keeps only safe versions, categories, statuses, and bounded runtime facts", () => {
    const result = createDiagnosticsExport({
      extensionVersion: "0.1.1",
      vscodeVersion: "1.125.0",
      platform: "win32",
      provider: "openai-compatible",
      errors: [
        { category: "network", count: 2 },
        { category: "network", count: 3 },
        { category: "unknown-secret", count: 99 },
      ],
      mcp: {
        status: "failed",
        generation: 4,
        protocolMode: "dual",
        negotiatedVersion: "2025-11-25",
        errorCategory: "mcp",
        command: "C:\\private\\server.exe",
        args: ["--token", "secret"],
      },
      runtime: {
        activationDurationMs: 12,
        firstWebviewDisplayDurationMs: 28,
        memoryBytes: 52_428_800,
        runStatus: "failed",
        workspacePath: "C:\\private\\workspace",
        conversation: "private source",
      },
      endpoint: "https://example.invalid?api_key=secret",
      authorization: "Bearer secret",
    } as unknown as Parameters<typeof createDiagnosticsExport>[0]);

    expect(result.document).toEqual({
      formatVersion: 1,
      extensionVersion: "0.1.1",
      vscodeVersion: "1.125.0",
      platform: "win32",
      provider: "openai-compatible",
      errors: [{ category: "network", count: 5 }],
      mcp: {
        status: "failed",
        generation: 4,
        protocolMode: "dual",
        negotiatedVersion: "2025-11-25",
        errorCategory: "mcp",
      },
      runtime: {
        activationDurationMs: 12,
        firstWebviewDisplayDurationMs: 28,
        memoryBytes: 52_428_800,
        runStatus: "failed",
      },
    });
    expect(result.json).not.toContain("private");
    expect(result.json).not.toContain("secret");
    expect(result.json).not.toContain("token");
    expect(result.bytes.byteLength).toBeLessThanOrEqual(64 * 1024);
  });

  it("fails closed for corrupt state without invoking getters", () => {
    const input = Object.defineProperties(
      {
        extensionVersion: "0.1.1",
        vscodeVersion: "1.125.0",
        platform: "linux",
        provider: "openai",
        errors: [],
        mcp: undefined,
        runtime: { runStatus: "idle" },
      },
      {
        authorization: {
          get() {
            throw new Error("secret getter");
          },
        },
      },
    );

    const result = createDiagnosticsExport(input);

    expect(result.document.provider).toBe("openai");
    expect(result.document.mcp).toEqual({ status: "unknown", generation: 0 });
    expect(result.document.runtime).toEqual({
      activationDurationMs: 0,
      memoryBytes: 0,
      runStatus: "idle",
    });
    expect(result.json).not.toContain("secret getter");
  });

  it("redacts credential-like version values and rejects unsupported platform/provider facts", () => {
    const result = createDiagnosticsExport({
      extensionVersion: "api-key-version",
      vscodeVersion: "Bearer secret-version",
      platform: "private-os",
      provider: "private-provider",
      errors: [],
      mcp: { status: "unconfigured", generation: -1 },
      runtime: { memoryBytes: Number.POSITIVE_INFINITY },
    });

    expect(result.document.extensionVersion).toBe("[REDACTED]");
    expect(result.document.vscodeVersion).toBe("[REDACTED]");
    expect(result.document.platform).toBe("unknown");
    expect(result.document.provider).toBe("unknown");
    expect(result.document.mcp).toEqual({ status: "unconfigured", generation: 0 });
    expect(result.document.runtime.memoryBytes).toBe(0);
  });
});
