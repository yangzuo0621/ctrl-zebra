import type { PreparedToolApproval, ToolApprovalOperation } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import { ToolApprovalWorkflowRouter } from "./tool-approval-workflow.js";

describe("ToolApprovalWorkflowRouter", () => {
  it("routes command execution and file writes to their owning workflows", async () => {
    const fileOperation = {} as ToolApprovalOperation;
    const commandOperation = {} as ToolApprovalOperation;
    const fileEdits = createWorkflow(fileOperation);
    const commands = createWorkflow(commandOperation);
    const router = new ToolApprovalWorkflowRouter(fileEdits.values, commands.values);
    const signal = new AbortController().signal;

    await expect(router.create(prepared("write", "propose_file_edit"), signal)).resolves.toBe(
      fileOperation,
    );
    await expect(router.create(prepared("execute", "run_command"), signal)).resolves.toBe(
      commandOperation,
    );
    expect(fileEdits.create).toHaveBeenCalledOnce();
    expect(commands.create).toHaveBeenCalledOnce();
  });

  it("forwards UI actions and disposes both owners", () => {
    const fileEdits = createWorkflow({} as ToolApprovalOperation);
    const commands = createWorkflow({} as ToolApprovalOperation);
    const router = new ToolApprovalWorkflowRouter(fileEdits.values, commands.values);

    router.showDiff("approval-1");
    router.decide("approval-1", "approved");
    router.dispose();

    expect(fileEdits.showDiff).toHaveBeenCalledWith("approval-1");
    expect(fileEdits.decide).toHaveBeenCalledWith("approval-1", "approved");
    expect(commands.decide).toHaveBeenCalledWith("approval-1", "approved");
    expect(fileEdits.dispose).toHaveBeenCalledOnce();
    expect(commands.dispose).toHaveBeenCalledOnce();
  });
});

function createWorkflow(operation: ToolApprovalOperation) {
  const create = vi.fn(async () => operation);
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

function prepared(risk: "write" | "execute", name: string): PreparedToolApproval {
  return {
    sessionId: "session-1",
    runId: "run-1",
    call: { id: "call-1", name, input: {} },
    risk,
    prepared: { output: {}, truncated: false },
  };
}
