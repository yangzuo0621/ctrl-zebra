import type { PreparedToolApproval } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import { FileCreateApprovalWorkflow } from "./file-create-approval-workflow.js";

const content = "zebra\n";
const afterHash = "a".repeat(64);
const plan = {
  operation: "create",
  path: "src/new.txt",
  uri: "file:///workspace/src/new.txt",
  content,
  afterHash,
} as const;
const prepared = {
  sessionId: "session-1",
  runId: "run-1",
  call: {
    id: "call-1",
    name: "propose_file_create",
    input: { path: plan.path, content },
  },
  risk: "write",
  prepared: { output: plan, truncated: false },
} satisfies PreparedToolApproval;

describe("FileCreateApprovalWorkflow", () => {
  it("binds and consumes one approved creation", async () => {
    const dependencies = createDependencies();
    const workflow = new FileCreateApprovalWorkflow(dependencies.values);
    const operation = await workflow.create(prepared, new AbortController().signal);
    const decision = operation.requestDecision(new AbortController().signal);

    workflow.decide(operation.request.id, "approved");

    await expect(decision).resolves.toMatchObject({ decision: "approved" });
    await expect(operation.consume(new AbortController().signal)).resolves.toEqual({
      outcome: "applied",
    });
    expect(dependencies.applyPlan).toHaveBeenCalledWith(
      plan,
      { sessionId: prepared.sessionId, runId: prepared.runId },
      expect.any(AbortSignal),
    );
  });

  it("expires a pending creation approval without applying", async () => {
    vi.useFakeTimers();
    try {
      const dependencies = createDependencies();
      const workflow = new FileCreateApprovalWorkflow(dependencies.values);
      const operation = await workflow.create(prepared, new AbortController().signal);
      const decision = operation.requestDecision(new AbortController().signal);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);

      await expect(decision).resolves.toEqual({
        requestId: operation.request.id,
        decision: "expired",
      });
      await expect(operation.consume(new AbortController().signal)).rejects.toThrow(
        "not available",
      );
      expect(dependencies.applyPlan).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending decision without applying afterward", async () => {
    const dependencies = createDependencies();
    const workflow = new FileCreateApprovalWorkflow(dependencies.values);
    const operation = await workflow.create(prepared, new AbortController().signal);
    const controller = new AbortController();
    const cancellation = new Error("cancel file create");
    const decision = operation.requestDecision(controller.signal);

    controller.abort(cancellation);

    await expect(decision).rejects.toBe(cancellation);
    workflow.decide(operation.request.id, "approved");
    await expect(operation.consume(new AbortController().signal)).rejects.toThrow("not available");
    expect(dependencies.applyPlan).not.toHaveBeenCalled();
  });
});

function createDependencies() {
  const bindPlan = vi.fn(async () => "file:///workspace");
  const validatePlan = vi.fn(async () => {});
  const presentDiff = vi.fn(async () => {});
  const applyPlan = vi.fn(async () => "applied" as const);
  let trusted = true;

  return {
    values: {
      createId: () => "approval-1",
      now: () => new Date("2026-07-19T00:00:00.000Z"),
      hashText: () => afterHash,
      bindPlan,
      validatePlan,
      presentDiff,
      applyPlan,
      reportError: vi.fn(),
      workspaceTrust: {
        isTrusted: () => trusted,
        requireTrusted() {
          if (!trusted) throw new Error("Trust this workspace before creating files.");
        },
      },
    },
    bindPlan,
    validatePlan,
    presentDiff,
    applyPlan,
    setTrusted(value: boolean) {
      trusted = value;
    },
  };
}
