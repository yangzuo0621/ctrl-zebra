import { describe, expect, it, vi } from "vitest";

import { createDiagnosticsExportStore } from "./diagnostic-export-store.js";
import { createWebviewHostFixture } from "./test/support/webview-host.js";

const document = {
  formatVersion: 1 as const,
  extensionVersion: "0.1.1",
  vscodeVersion: "1.125.0",
  platform: "linux" as const,
  provider: "openai" as const,
  errors: [],
  mcp: { status: "unconfigured" as const, generation: 0 },
  runtime: {
    activationDurationMs: 1,
    memoryBytes: 2,
    runStatus: "idle" as const,
  },
};
const content = `${JSON.stringify(document)}\n`;

describe("diagnostics export store", () => {
  it("requires an explicit preview confirmation before posting a save", () => {
    const host = createWebviewHostFixture();
    host.requestDiagnosticsExport = vi.fn();
    host.confirmDiagnosticsExport = vi.fn();
    host.cancelDiagnosticsExport = vi.fn();
    const store = createDiagnosticsExportStore(host, () => "request-1");

    expect(store.getState().start()).toBe(true);
    expect(host.requestDiagnosticsExport).toHaveBeenCalledWith("request-1");
    expect(store.getState().confirm()).toBe(false);

    store.getState().receive({
      protocolVersion: 1,
      type: "extension/diagnostics-export-preview",
      requestId: "request-1",
      status: "ready",
      exportId: "export-1",
      target: "file:///tmp/diagnostics.json",
      document,
      content,
    });

    expect(store.getState().status).toBe("ready");
    expect(store.getState().confirm()).toBe(true);
    expect(host.confirmDiagnosticsExport).toHaveBeenCalledWith("request-1", "export-1");
  });

  it("cancels a ready preview without posting a write", () => {
    const host = createWebviewHostFixture();
    host.requestDiagnosticsExport = vi.fn();
    host.confirmDiagnosticsExport = vi.fn();
    host.cancelDiagnosticsExport = vi.fn();
    const store = createDiagnosticsExportStore(host, () => "request-2");
    store.getState().start();
    store.getState().receive({
      protocolVersion: 1,
      type: "extension/diagnostics-export-preview",
      requestId: "request-2",
      status: "ready",
      exportId: "export-2",
      target: "file:///tmp/diagnostics.json",
      document,
      content,
    });

    expect(store.getState().cancel()).toBe(true);
    expect(host.cancelDiagnosticsExport).toHaveBeenCalledWith("request-2", "export-2");
    expect(host.confirmDiagnosticsExport).not.toHaveBeenCalled();
    expect(store.getState().status).toBe("cancelled");
  });

  it("ignores a preview for another request and exposes stable failure text", () => {
    const host = createWebviewHostFixture();
    host.requestDiagnosticsExport = vi.fn();
    const store = createDiagnosticsExportStore(host, () => "request-3");
    store.getState().start();
    store.getState().receive({
      protocolVersion: 1,
      type: "extension/diagnostics-export-preview",
      requestId: "other-request",
      status: "error",
      code: "write-failed",
      message: "The diagnostics file could not be written.",
    });
    expect(store.getState().status).toBe("preparing");

    store.getState().receive({
      protocolVersion: 1,
      type: "extension/diagnostics-export-preview",
      requestId: "request-3",
      status: "error",
      code: "write-failed",
      message: "The diagnostics file could not be written.",
    });
    expect(store.getState().status).toBe("error");
    expect(store.getState().message).toContain("could not be written");
  });
});
