import type { PreparedToolApproval, TextEditPlan } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import { FileEditApprovalWorkflow } from "./file-edit-approval-workflow.js";

const plan = {
  uri: "file:///workspace/src/file.ts",
  originalRevision: { kind: "document_version", value: 3 },
  edits: [
    {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      newText: "zebra",
    },
  ],
} satisfies TextEditPlan;

const prepared = {
  sessionId: "session-1",
  runId: "run-1",
  call: {
    id: "call-1",
    name: "propose_file_edit",
    input: { path: "src/file.ts", edits: [] },
  },
  risk: "write",
  prepared: { output: plan, truncated: false },
} satisfies PreparedToolApproval;

describe("FileEditApprovalWorkflow", () => {
  it("binds the exact prepared operation and consumes one approved application", async () => {
    const dependencies = createDependencies();
    const workflow = new FileEditApprovalWorkflow(dependencies.values);
    const operation = await workflow.create(prepared, new AbortController().signal);
    const signal = new AbortController().signal;
    const decision = operation.requestDecision(signal);

    workflow.decide(operation.request.id, "approved");

    await expect(decision).resolves.toMatchObject({ decision: "approved" });
    await expect(operation.consume(signal)).resolves.toEqual({ outcome: "approved" });
    await expect(operation.consume(signal)).rejects.toThrow("not available");
    expect(operation.request.scope).toEqual({
      sessionId: "session-1",
      call: prepared.call,
      risk: "write",
      workspaceRootUri: "file:///workspace",
      resources: [{ uri: plan.uri, revision: plan.originalRevision }],
    });
    expect(dependencies.bindPlan).toHaveBeenCalledWith(plan, expect.any(AbortSignal));
    expect(dependencies.applyPlan).toHaveBeenCalledOnce();
    expect(dependencies.applyPlan).toHaveBeenCalledWith(
      plan,
      { sessionId: "session-1", runId: "run-1" },
      signal,
    );
  });

  it("does not apply a denied operation", async () => {
    const dependencies = createDependencies();
    const workflow = new FileEditApprovalWorkflow(dependencies.values);
    const operation = await workflow.create(prepared, new AbortController().signal);
    const decision = operation.requestDecision(new AbortController().signal);

    workflow.decide(operation.request.id, "denied");

    await expect(decision).resolves.toMatchObject({ decision: "denied" });
    await expect(operation.consume(new AbortController().signal)).rejects.toThrow("not available");
    expect(dependencies.applyPlan).not.toHaveBeenCalled();
  });

  it("returns a conflict without retrying or applying a second time", async () => {
    const dependencies = createDependencies("conflict");
    const workflow = new FileEditApprovalWorkflow(dependencies.values);
    const operation = await workflow.create(prepared, new AbortController().signal);
    const signal = new AbortController().signal;
    const decision = operation.requestDecision(signal);
    workflow.decide(operation.request.id, "approved");
    await decision;

    await expect(operation.consume(signal)).resolves.toEqual({
      outcome: "conflict",
      message: "The approved file changed before its edits could be applied.",
    });
    await expect(operation.consume(signal)).rejects.toThrow("not available");
    expect(dependencies.applyPlan).toHaveBeenCalledOnce();
  });

  it("validates the selected scope before presenting the bound diff", async () => {
    const dependencies = createDependencies();
    const workflow = new FileEditApprovalWorkflow(dependencies.values);
    const operation = await workflow.create(prepared, new AbortController().signal);
    const signal = new AbortController().signal;
    const decision = operation.requestDecision(signal);

    workflow.showDiff(operation.request.id);
    await vi.waitFor(() => expect(dependencies.presentDiff).toHaveBeenCalledWith(plan, signal));
    expect(dependencies.validatePlan).toHaveBeenCalledWith(plan, signal);

    workflow.decide(operation.request.id, "denied");
    await decision;
  });

  it("cancels a pending wait without applying afterward", async () => {
    const dependencies = createDependencies();
    const workflow = new FileEditApprovalWorkflow(dependencies.values);
    const operation = await workflow.create(prepared, new AbortController().signal);
    const controller = new AbortController();
    const cancellation = new Error("cancel run");
    const decision = operation.requestDecision(controller.signal);

    controller.abort(cancellation);

    await expect(decision).rejects.toBe(cancellation);
    expect(() => workflow.decide(operation.request.id, "approved")).not.toThrow();
    expect(dependencies.applyPlan).not.toHaveBeenCalled();
  });

  it("settles an expired wait and releases the operation", async () => {
    vi.useFakeTimers();
    try {
      const dependencies = createDependencies();
      const workflow = new FileEditApprovalWorkflow(dependencies.values);
      const operation = await workflow.create(prepared, new AbortController().signal);
      const decision = operation.requestDecision(new AbortController().signal);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);

      await expect(decision).resolves.toEqual({
        requestId: operation.request.id,
        decision: "expired",
      });
      expect(() => workflow.decide(operation.request.id, "approved")).not.toThrow();
      expect(dependencies.applyPlan).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidates an approval when workspace trust is lost before apply", async () => {
    const dependencies = createDependencies();
    const workflow = new FileEditApprovalWorkflow(dependencies.values);
    const operation = await workflow.create(prepared, new AbortController().signal);
    const signal = new AbortController().signal;
    const decision = operation.requestDecision(signal);
    workflow.decide(operation.request.id, "approved");
    await decision;

    dependencies.setTrusted(false);

    await expect(operation.consume(signal)).resolves.toEqual({
      outcome: "conflict",
      message: "Workspace trust changed before the approved file edits could be applied.",
    });
    expect(dependencies.applyPlan).not.toHaveBeenCalled();
  });

  it("rejects approval preparation in an untrusted workspace", async () => {
    const dependencies = createDependencies();
    dependencies.setTrusted(false);
    const workflow = new FileEditApprovalWorkflow(dependencies.values);

    await expect(workflow.create(prepared, new AbortController().signal)).rejects.toThrow(
      "Trust this workspace",
    );
    expect(dependencies.bindPlan).not.toHaveBeenCalled();
  });
});

function createDependencies(result: "applied" | "conflict" = "applied") {
  let trusted = true;
  const validatePlan = vi.fn(async () => {});
  const bindPlan = vi.fn(async () => "file:///workspace");
  const presentDiff = vi.fn(async () => {});
  const applyPlan = vi.fn(async () => result);
  const reportError = vi.fn();
  return {
    values: {
      createId: () => "approval-1",
      now: () => new Date("2026-07-19T00:00:00.000Z"),
      bindPlan,
      validatePlan,
      presentDiff,
      applyPlan,
      reportError,
      workspaceTrust: {
        isTrusted: () => trusted,
        requireTrusted() {
          if (!trusted) {
            throw new Error("Trust this workspace before using file writes or command execution.");
          }
        },
      },
    },
    validatePlan,
    bindPlan,
    presentDiff,
    applyPlan,
    reportError,
    setTrusted(value: boolean) {
      trusted = value;
    },
  };
}
