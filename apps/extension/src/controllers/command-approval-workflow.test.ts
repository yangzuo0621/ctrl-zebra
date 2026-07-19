import type { PreparedToolApproval } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import {
  CommandApprovalPresentationTooLargeError,
  CommandApprovalWorkflow,
  InvalidCommandApprovalError,
} from "./command-approval-workflow.js";

const input = {
  command: "node",
  args: ["scripts/check.mjs", "--label", "safe value"],
  cwd: "packages/core",
  timeoutMs: 30_000,
} as const;

const prepared = {
  sessionId: "session-1",
  runId: "run-1",
  call: {
    id: "call-command-1",
    name: "run_command",
    input,
  },
  risk: "execute",
  prepared: { output: input, truncated: false },
} satisfies PreparedToolApproval;

describe("CommandApprovalWorkflow", () => {
  it("binds the complete command and canonical cwd to one approved consumption", async () => {
    const dependencies = createDependencies();
    const workflow = new CommandApprovalWorkflow(dependencies.values);
    const operation = await workflow.create(prepared, new AbortController().signal);
    const signal = new AbortController().signal;
    const decision = operation.requestDecision(signal);

    workflow.decide(operation.request.id, "approved");

    await expect(decision).resolves.toMatchObject({ decision: "approved" });
    await expect(operation.consume(signal)).resolves.toEqual({ outcome: "approved" });
    await expect(operation.consume(signal)).rejects.toThrow("not available");
    expect(operation.request.scope).toEqual({
      sessionId: prepared.sessionId,
      call: prepared.call,
      risk: "execute",
      workspaceRootUri: "file:///workspace",
      resources: [{ uri: "file:///workspace/packages/core" }],
    });
    expect(operation.request.presentation).toEqual({
      title: "Run command",
      summary: [
        'Executable: "node"',
        'Arguments: ["scripts/check.mjs","--label","safe value"]',
        "Working directory: file:///workspace/packages/core",
        "Timeout: 30000 ms",
      ].join("\n"),
    });
    expect(dependencies.bindCwd).toHaveBeenCalledWith("packages/core", expect.any(AbortSignal));

    workflow.decide(operation.request.id, "denied");
    await expect(operation.consume(signal)).rejects.toThrow("not available");
  });

  it("creates a fresh approval identifier for every command call", async () => {
    const dependencies = createDependencies();
    const workflow = new CommandApprovalWorkflow(dependencies.values);

    const first = await workflow.create(prepared, new AbortController().signal);
    const second = await workflow.create(
      {
        ...prepared,
        call: { ...prepared.call, id: "call-command-2" },
      },
      new AbortController().signal,
    );

    expect(first.request.id).not.toBe(second.request.id);
    expect(first.request.scope.call.id).toBe("call-command-1");
    expect(second.request.scope.call.id).toBe("call-command-2");
    workflow.dispose();
  });

  it("does not consume a denied command", async () => {
    const workflow = new CommandApprovalWorkflow(createDependencies().values);
    const operation = await workflow.create(prepared, new AbortController().signal);
    const decision = operation.requestDecision(new AbortController().signal);

    workflow.decide(operation.request.id, "denied");

    await expect(decision).resolves.toMatchObject({ decision: "denied" });
    await expect(operation.consume(new AbortController().signal)).rejects.toThrow("not available");
  });

  it("cancels a pending command without accepting a later approval", async () => {
    const workflow = new CommandApprovalWorkflow(createDependencies().values);
    const operation = await workflow.create(prepared, new AbortController().signal);
    const controller = new AbortController();
    const cancellation = new Error("cancel command approval");
    const decision = operation.requestDecision(controller.signal);

    controller.abort(cancellation);

    await expect(decision).rejects.toBe(cancellation);
    expect(() => workflow.decide(operation.request.id, "approved")).not.toThrow();
    await expect(operation.consume(new AbortController().signal)).rejects.toThrow("not available");
  });

  it("expires a pending command and ignores a late decision", async () => {
    vi.useFakeTimers();
    try {
      const workflow = new CommandApprovalWorkflow(createDependencies().values);
      const operation = await workflow.create(prepared, new AbortController().signal);
      const decision = operation.requestDecision(new AbortController().signal);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);

      await expect(decision).resolves.toEqual({
        requestId: operation.request.id,
        decision: "expired",
      });
      expect(() => workflow.decide(operation.request.id, "approved")).not.toThrow();
      await expect(operation.consume(new AbortController().signal)).rejects.toThrow(
        "not available",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a command whose complete presentation cannot be displayed", async () => {
    const workflow = new CommandApprovalWorkflow(createDependencies().values);
    const oversized = {
      ...prepared,
      call: {
        ...prepared.call,
        input: { ...input, args: ["x".repeat(4_096)] },
      },
    } satisfies PreparedToolApproval;

    await expect(workflow.create(oversized, new AbortController().signal)).rejects.toBeInstanceOf(
      CommandApprovalPresentationTooLargeError,
    );
  });

  it("rejects non-command and non-execute approval operations", async () => {
    const workflow = new CommandApprovalWorkflow(createDependencies().values);
    const invalid = {
      ...prepared,
      risk: "write",
    } satisfies PreparedToolApproval;

    await expect(workflow.create(invalid, new AbortController().signal)).rejects.toBeInstanceOf(
      InvalidCommandApprovalError,
    );
  });
});

function createDependencies() {
  let nextId = 1;
  const bindCwd = vi.fn(async () => ({
    workspaceRootUri: "file:///workspace",
    cwdUri: "file:///workspace/packages/core",
  }));
  return {
    values: {
      createId: () => `approval-command-${nextId++}`,
      now: () => new Date("2026-07-19T00:00:00.000Z"),
      bindCwd,
    },
    bindCwd,
  };
}
