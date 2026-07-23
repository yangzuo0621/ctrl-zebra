import type { PreparedToolApproval, ToolApprovalOperation } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import { ToolApprovalWorkflowRouter } from "./tool-approval-workflow.js";

describe("ToolApprovalWorkflowRouter", () => {
  it("routes command execution and file writes to their owning workflows", async () => {
    const fileOperation = createOperation("file-approval");
    const commandOperation = createOperation("command-approval");
    const fileEdits = createWorkflow(fileOperation);
    const commands = createWorkflow(commandOperation);
    const router = new ToolApprovalWorkflowRouter(fileEdits.values, commands.values);
    const signal = new AbortController().signal;

    const routedFileOperation = await router.create(prepared("write", "propose_file_edit"), signal);
    const routedCommandOperation = await router.create(prepared("execute", "run_command"), signal);

    expect(routedFileOperation.request).toBe(fileOperation.request);
    expect(routedCommandOperation.request).toBe(commandOperation.request);
    expect(fileEdits.create).toHaveBeenCalledOnce();
    expect(commands.create).toHaveBeenCalledOnce();
  });

  it("routes UI actions only to the workflow that owns the approval", async () => {
    const fileEdits = createWorkflow(createOperation("file-approval"));
    const commands = createWorkflow(createOperation("command-approval"));
    const router = new ToolApprovalWorkflowRouter(fileEdits.values, commands.values);
    const signal = new AbortController().signal;

    await router.create(prepared("write", "propose_file_edit"), signal);
    await router.create(prepared("execute", "run_command"), signal);
    router.showDiff("file-approval");
    router.showDiff("command-approval");
    router.decide("file-approval", "approved");
    router.decide("command-approval", "denied");
    router.decide("unknown-approval", "approved");

    expect(fileEdits.showDiff).toHaveBeenCalledOnce();
    expect(fileEdits.showDiff).toHaveBeenCalledWith("file-approval");
    expect(fileEdits.decide).toHaveBeenCalledOnce();
    expect(fileEdits.decide).toHaveBeenCalledWith("file-approval", "approved");
    expect(commands.decide).toHaveBeenCalledOnce();
    expect(commands.decide).toHaveBeenCalledWith("command-approval", "denied");
  });

  it("releases ownership after terminal decisions, consumption, cancellation, and failures", async () => {
    const denied = createOperation("denied-approval", "denied");
    const expired = createOperation("expired-approval", "expired");
    const consumed = createOperation("consumed-approval");
    const failed = createOperation("failed-approval", undefined, new Error("decision failed"));
    const consumptionFailed = createOperation(
      "consumption-failed-approval",
      undefined,
      undefined,
      new Error("consumption failed"),
    );
    const fileEdits = createWorkflow(denied, expired, consumed, failed, consumptionFailed);
    const commands = createWorkflow(createOperation("cancelled-approval"));
    const router = new ToolApprovalWorkflowRouter(fileEdits.values, commands.values);

    const deniedOperation = await router.create(
      prepared("write", "propose_file_edit"),
      new AbortController().signal,
    );
    await deniedOperation.requestDecision(new AbortController().signal);
    router.decide("denied-approval", "approved");

    const expiredOperation = await router.create(
      prepared("write", "propose_file_edit"),
      new AbortController().signal,
    );
    await expiredOperation.requestDecision(new AbortController().signal);
    router.decide("expired-approval", "approved");

    const consumedOperation = await router.create(
      prepared("write", "propose_file_edit"),
      new AbortController().signal,
    );
    await consumedOperation.consume(new AbortController().signal);
    router.decide("consumed-approval", "approved");

    const failedOperation = await router.create(
      prepared("write", "propose_file_edit"),
      new AbortController().signal,
    );
    await expect(failedOperation.requestDecision(new AbortController().signal)).rejects.toThrow(
      "decision failed",
    );
    router.decide("failed-approval", "approved");

    const consumptionFailedOperation = await router.create(
      prepared("write", "propose_file_edit"),
      new AbortController().signal,
    );
    await expect(consumptionFailedOperation.consume(new AbortController().signal)).rejects.toThrow(
      "consumption failed",
    );
    router.decide("consumption-failed-approval", "approved");

    const cancellation = new AbortController();
    await router.create(prepared("execute", "run_command"), cancellation.signal);
    cancellation.abort();
    router.decide("cancelled-approval", "approved");

    expect(fileEdits.decide).not.toHaveBeenCalled();
    expect(commands.decide).not.toHaveBeenCalled();
  });

  it("rejects duplicate approval identifiers without replacing the existing owner", async () => {
    const fileEdits = createWorkflow(createOperation("duplicate-approval"));
    const commands = createWorkflow(createOperation("duplicate-approval"));
    const router = new ToolApprovalWorkflowRouter(fileEdits.values, commands.values);
    const signal = new AbortController().signal;

    await router.create(prepared("write", "propose_file_edit"), signal);
    await expect(router.create(prepared("execute", "run_command"), signal)).rejects.toThrow(
      "Approval identifier is already owned by another workflow.",
    );
    router.decide("duplicate-approval", "approved");

    expect(fileEdits.decide).toHaveBeenCalledOnce();
    expect(commands.decide).not.toHaveBeenCalled();
  });

  it("disposes both workflows and releases all ownership", async () => {
    const fileEdits = createWorkflow(createOperation("file-approval"));
    const commands = createWorkflow(createOperation("command-approval"));
    const router = new ToolApprovalWorkflowRouter(fileEdits.values, commands.values);
    const signal = new AbortController().signal;

    await router.create(prepared("write", "propose_file_edit"), signal);
    await router.create(prepared("execute", "run_command"), signal);
    router.dispose();
    router.decide("file-approval", "approved");
    router.decide("command-approval", "approved");

    expect(fileEdits.decide).not.toHaveBeenCalled();
    expect(commands.decide).not.toHaveBeenCalled();
    expect(fileEdits.dispose).toHaveBeenCalledOnce();
    expect(commands.dispose).toHaveBeenCalledOnce();
  });
});

function createWorkflow(...operations: ToolApprovalOperation[]) {
  const create = vi.fn(async () => {
    const operation = operations.shift();
    if (operation === undefined) {
      throw new Error("No approval operation configured.");
    }
    return operation;
  });
  const showDiff = vi.fn();
  const decide = vi.fn();
  const dispose = vi.fn();
  return {
    values: { create, showDiff, decide, dispose },
    create,
    showDiff,
    decide,
    dispose,
  };
}

function createOperation(
  approvalId: string,
  decision: "approved" | "denied" | "expired" = "approved",
  decisionError?: Error,
  consumptionError?: Error,
): ToolApprovalOperation {
  return {
    request: { id: approvalId } as ToolApprovalOperation["request"],
    requestDecision: vi.fn(async () => {
      if (decisionError !== undefined) {
        throw decisionError;
      }
      if (decision === "expired") {
        return { requestId: approvalId, decision };
      }
      return {
        requestId: approvalId,
        decision,
        decidedAt: "2026-07-23T00:00:00.000Z",
      };
    }),
    consume: vi.fn(async () => {
      if (consumptionError !== undefined) {
        throw consumptionError;
      }
      return { outcome: "approved" as const };
    }),
  };
}

function prepared(risk: "write" | "execute", name: string): PreparedToolApproval {
  return {
    sessionId: "session-1",
    runId: "run-1",
    call: { id: "call-1", name, input: {} },
    risk,
    prepared: { output: {}, truncated: false },
  };
}
