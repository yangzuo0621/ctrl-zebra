import type { PreparedToolApproval } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import { FileDeleteApprovalWorkflow } from "./file-delete-approval-workflow.js";

const plan = {
  operation: "delete",
  path: "old.txt",
  uri: "file:///workspace/old.txt",
  beforeContent: "zebra\n",
  beforeHash: "a".repeat(64),
} as const;
const prepared = {
  sessionId: "session-1",
  runId: "run-1",
  call: { id: "call-1", name: "propose_file_delete", input: { path: plan.path } },
  risk: "write",
  prepared: { output: plan, truncated: false },
} satisfies PreparedToolApproval;

describe("FileDeleteApprovalWorkflow", () => {
  it("binds and consumes one approved deletion", async () => {
    const dependencies = createDependencies();
    const workflow = new FileDeleteApprovalWorkflow(dependencies.values);
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

  it("does not apply a rejected deletion", async () => {
    const dependencies = createDependencies();
    const workflow = new FileDeleteApprovalWorkflow(dependencies.values);
    const operation = await workflow.create(prepared, new AbortController().signal);
    const decision = operation.requestDecision(new AbortController().signal);

    workflow.decide(operation.request.id, "denied");

    await expect(decision).resolves.toMatchObject({ decision: "denied" });
    await expect(operation.consume(new AbortController().signal)).rejects.toThrow("not available");
    expect(dependencies.applyPlan).not.toHaveBeenCalled();
  });
});

function createDependencies() {
  const applyPlan = vi.fn(async () => "applied" as const);
  return {
    values: {
      createId: () => "approval-1",
      now: () => new Date("2026-08-13T00:00:00.000Z"),
      hashText: () => plan.beforeHash,
      bindPlan: vi.fn(async () => "file:///workspace"),
      validatePlan: vi.fn(async () => {}),
      presentDiff: vi.fn(async () => {}),
      applyPlan,
      reportError: vi.fn(),
      workspaceTrust: { isTrusted: () => true, requireTrusted() {} },
    },
    applyPlan,
  };
}
