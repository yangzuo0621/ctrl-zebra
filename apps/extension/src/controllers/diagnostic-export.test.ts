import type { ExtensionToWebviewMessage } from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  classifyDiagnosticsErrorCategory,
  DiagnosticsExportController,
} from "./diagnostic-export.js";

function createInput(runStatus: "idle" | "streaming" = "idle") {
  return {
    extensionVersion: "0.1.1",
    vscodeVersion: "1.125.0",
    platform: "linux",
    provider: "openai",
    errors: [],
    mcp: { status: "unconfigured", generation: 0 },
    runtime: { activationDurationMs: 1, memoryBytes: 2, runStatus },
  };
}

describe("DiagnosticsExportController", () => {
  it("maps provider failures to stable categories and caps aggregate counts", () => {
    const categories = new Map([
      ["provider-timeout", "configuration"],
      ["missing-api-key", "authentication"],
      ["secret-storage-read", "authentication"],
      ["permission-denied", "authentication"],
      ["run-budget-configuration", "configuration"],
      ["budget-exceeded", "budget"],
      ["configuration-invalid", "configuration"],
      ["context-overflow", "context"],
      ["invalid-context", "context"],
      ["rate-limit", "rate-limit"],
      ["unavailable", "network"],
      ["network", "network"],
      ["invalid-request", "configuration"],
      ["model-not-found", "configuration"],
      ["mcp-connect", "mcp"],
      ["server-exit", "mcp"],
      ["tool-failed", "tool"],
      ["unexpected", "internal"],
    ] as const);
    for (const [code, category] of categories) {
      expect(classifyDiagnosticsErrorCategory(code)).toBe(category);
    }

    const controller = new DiagnosticsExportController({
      createId: () => "unused",
      readInput: createInput,
      target: {
        chooseTarget: async () => undefined,
        formatTarget: () => "unused",
        writeFile: vi.fn(),
      },
    });
    for (let index = 0; index < 1_005; index += 1) {
      controller.recordErrorCategory("network");
    }
    expect(controller.getErrorCounts()).toEqual([{ category: "network", count: 1_000 }]);
  });

  it("shows a bounded preview and writes only after explicit confirmation", async () => {
    let choose!: (target: unknown) => void;
    const writes: Uint8Array[] = [];
    const post = vi.fn<(message: ExtensionToWebviewMessage) => void>();
    const controller = new DiagnosticsExportController({
      createId: () => "export-1",
      readInput: createInput,
      target: {
        chooseTarget: () => new Promise((resolve) => (choose = resolve)),
        formatTarget: () => "file:///tmp/diagnostics.json",
        writeFile: async (_target, bytes) => {
          writes.push(bytes);
        },
      },
    });

    controller.request("request-1", post);
    await Promise.resolve();
    choose("target");
    await Promise.resolve();
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "extension/diagnostics-export-preview",
        requestId: "request-1",
        status: "ready",
        exportId: "export-1",
        target: "file:///tmp/diagnostics.json",
      }),
    );
    expect(writes).toHaveLength(0);

    controller.confirm("request-1", "export-1", post);
    await Promise.resolve();
    expect(writes).toHaveLength(1);
    const preview = post.mock.calls
      .map(([message]) => message)
      .find(
        (
          message,
        ): message is Extract<
          ExtensionToWebviewMessage,
          { type: "extension/diagnostics-export-preview"; status: "ready" }
        > => message.type === "extension/diagnostics-export-preview" && message.status === "ready",
      );
    expect(preview).toBeDefined();
    expect(new TextDecoder().decode(writes[0])).toBe(preview?.content);
    expect(new TextEncoder().encode(preview?.content)).toEqual(writes[0]);
    expect(new TextDecoder().decode(writes[0])).not.toContain("target");
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "completed", requestId: "request-1" }),
    );
  });

  it("treats target cancellation as a no-write outcome", async () => {
    const post = vi.fn<(message: ExtensionToWebviewMessage) => void>();
    const controller = new DiagnosticsExportController({
      createId: () => "export-2",
      readInput: createInput,
      target: {
        chooseTarget: async () => undefined,
        formatTarget: () => "unused",
        writeFile: vi.fn(),
      },
    });

    controller.request("request-2", post);
    await Promise.resolve();
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "cancelled", code: "no-target" }),
    );
  });

  it("exports the current non-idle Run status in the preview", async () => {
    const post = vi.fn<(message: ExtensionToWebviewMessage) => void>();
    const controller = new DiagnosticsExportController({
      createId: () => "export-active",
      readInput: () => createInput("streaming"),
      target: {
        chooseTarget: async () => "target",
        formatTarget: () => "target",
        writeFile: vi.fn(),
      },
    });

    controller.request("request-active", post);
    await Promise.resolve();
    const ready = post.mock.calls.at(-1)?.[0];
    if (ready?.type !== "extension/diagnostics-export-preview" || ready.status !== "ready") {
      throw new Error("Expected an active diagnostics preview.");
    }
    expect(ready.document.runtime.runStatus).toBe("streaming");
  });

  it("keeps cancellation separate from a write failure", async () => {
    const post = vi.fn<(message: ExtensionToWebviewMessage) => void>();
    const writeFile = vi.fn(async () => {
      throw new Error("disk secret");
    });
    const controller = new DiagnosticsExportController({
      createId: () => "export-3",
      readInput: createInput,
      target: {
        chooseTarget: async () => "target",
        formatTarget: () => "target",
        writeFile,
      },
    });

    controller.request("request-3", post);
    await Promise.resolve();
    const ready = post.mock.calls[0]?.[0];
    if (ready?.type !== "extension/diagnostics-export-preview" || ready.status !== "ready") {
      throw new Error("Expected a diagnostics preview.");
    }
    controller.cancel("request-3", ready.exportId, post);
    expect(writeFile).not.toHaveBeenCalled();
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "cancelled", code: "user-cancelled" }),
    );

    controller.request("request-4", post);
    await Promise.resolve();
    await Promise.resolve();
    const next = post.mock.calls.at(-1)?.[0];
    if (next?.type !== "extension/diagnostics-export-preview" || next.status !== "ready") {
      throw new Error("Expected a second diagnostics preview.");
    }
    controller.confirm("request-4", next.exportId, post);
    await Promise.resolve();
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error", code: "write-failed" }),
    );
  });

  it("reports corrupt source state with a stable error without leaking the cause", async () => {
    const post = vi.fn<(message: ExtensionToWebviewMessage) => void>();
    const controller = new DiagnosticsExportController({
      createId: () => "export-4",
      readInput: () => {
        throw new Error("raw third-party secret");
      },
      target: {
        chooseTarget: vi.fn(),
        formatTarget: () => "target",
        writeFile: vi.fn(),
      },
    });

    controller.request("request-5", post);
    await Promise.resolve();
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error", code: "invalid-state" }),
    );
    expect(JSON.stringify(post.mock.calls)).not.toContain("raw third-party secret");
  });

  it("normalizes a synchronous write failure without exposing its cause", async () => {
    const post = vi.fn<(message: ExtensionToWebviewMessage) => void>();
    const controller = new DiagnosticsExportController({
      createId: () => "export-5",
      readInput: createInput,
      target: {
        chooseTarget: async () => "target",
        formatTarget: () => "target",
        writeFile: () => {
          throw new Error("permission denied: private path");
        },
      },
    });

    controller.request("request-6", post);
    await Promise.resolve();
    await Promise.resolve();
    const ready = post.mock.calls.at(-1)?.[0];
    if (ready?.type !== "extension/diagnostics-export-preview" || ready.status !== "ready") {
      throw new Error("Expected a diagnostics preview.");
    }
    controller.confirm("request-6", ready.exportId, post);
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error", code: "write-failed" }),
    );
    expect(JSON.stringify(post.mock.calls)).not.toContain("private path");
  });

  it("reports an unavailable save dialog without exposing its cause", async () => {
    const post = vi.fn<(message: ExtensionToWebviewMessage) => void>();
    const controller = new DiagnosticsExportController({
      createId: () => "export-6",
      readInput: createInput,
      target: {
        chooseTarget: async () => {
          throw new Error("dialog credentials");
        },
        formatTarget: () => "unused",
        writeFile: vi.fn(),
      },
    });

    controller.request("request-7", post);
    await Promise.resolve();
    await Promise.resolve();
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error", code: "unavailable" }),
    );
    expect(JSON.stringify(post.mock.calls)).not.toContain("dialog credentials");
  });

  it("reports unavailable preview failures from ID and target formatting", async () => {
    const post = vi.fn<(message: ExtensionToWebviewMessage) => void>();
    const createIdFailure = new DiagnosticsExportController({
      createId: () => {
        throw new Error("id secret");
      },
      readInput: createInput,
      target: {
        chooseTarget: async () => "target",
        formatTarget: () => "target",
        writeFile: vi.fn(),
      },
    });

    createIdFailure.request("request-8", post);
    await Promise.resolve();
    await Promise.resolve();
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error", code: "unavailable" }),
    );

    const invalidTarget = new DiagnosticsExportController({
      createId: () => "export-9",
      readInput: createInput,
      target: {
        chooseTarget: async () => "private target",
        formatTarget: () => "",
        writeFile: vi.fn(),
      },
    });
    invalidTarget.request("request-9", post);
    await Promise.resolve();
    await Promise.resolve();
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error", code: "unavailable" }),
    );
    expect(JSON.stringify(post.mock.calls)).not.toContain("private target");
  });

  it("rejects overlapping and stale control requests without writing", async () => {
    let choose!: (target: unknown) => void;
    const post = vi.fn<(message: ExtensionToWebviewMessage) => void>();
    const writeFile = vi.fn(async () => {});
    const controller = new DiagnosticsExportController({
      createId: () => "export-10",
      readInput: createInput,
      target: {
        chooseTarget: () => new Promise((resolve) => (choose = resolve)),
        formatTarget: () => "target",
        writeFile,
      },
    });

    controller.request("request-10", post);
    await Promise.resolve();
    controller.request("request-11", post);
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: "request-11", code: "invalid-state" }),
    );

    choose("target");
    await Promise.resolve();
    await Promise.resolve();
    const ready = post.mock.calls.at(-1)?.[0];
    if (ready?.type !== "extension/diagnostics-export-preview" || ready.status !== "ready") {
      throw new Error("Expected a diagnostics preview.");
    }

    controller.confirm("request-10", "wrong-id", post);
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: "request-10", code: "invalid-state" }),
    );
    controller.cancel("request-10", "wrong-id", post);
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: "request-10", code: "invalid-state" }),
    );
    controller.cancel("request-10", ready.exportId, post);
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: "request-10", status: "cancelled" }),
    );
    controller.confirm("request-10", ready.exportId, post);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
