import type { PreparedToolApproval, WorkspaceEditPlan } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceEditApprovalWorkflow } from "./workspace-edit-approval-workflow.js";

const plan = {
  operation: "edit",
  files: [
    {
      path: "a.ts",
      uri: "file:///workspace/a.ts",
      originalRevision: { kind: "document_version", value: 1 },
      edits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
          newText: "one",
        },
      ],
    },
    {
      path: "b.ts",
      uri: "file:///workspace/b.ts",
      originalRevision: { kind: "document_version", value: 2 },
      edits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
          newText: "two",
        },
      ],
    },
  ],
} satisfies WorkspaceEditPlan;

const prepared = {
  sessionId: "session-1",
  runId: "run-1",
  call: { id: "call-1", name: "propose_workspace_edit", input: {} },
  risk: "write",
  prepared: { output: plan, truncated: false },
} satisfies PreparedToolApproval;

describe("WorkspaceEditApprovalWorkflow", () => {
  it("binds every resource and consumes one atomic application", async () => {
    const dependencies = createDependencies();
    const workflow = new WorkspaceEditApprovalWorkflow(dependencies.values);
    const operation = await workflow.create(prepared, new AbortController().signal);
    const signal = new AbortController().signal;
    const decision = operation.requestDecision(signal);
    workflow.decide(operation.request.id, "approved");

    await expect(decision).resolves.toMatchObject({ decision: "approved" });
    await expect(operation.consume(signal)).resolves.toEqual({ outcome: "applied" });
    expect(operation.request.scope.resources).toEqual([
      { uri: plan.files[0]?.uri, revision: plan.files[0]?.originalRevision },
      { uri: plan.files[1]?.uri, revision: plan.files[1]?.originalRevision },
    ]);
    expect(dependencies.applyPlan).toHaveBeenCalledWith(
      plan,
      { sessionId: "session-1", runId: "run-1" },
      signal,
    );
  });

  it("presents a diff only after validating the complete plan", async () => {
    const dependencies = createDependencies();
    const workflow = new WorkspaceEditApprovalWorkflow(dependencies.values);
    const operation = await workflow.create(prepared, new AbortController().signal);
    const signal = new AbortController().signal;
    const decision = operation.requestDecision(signal);

    workflow.showDiff(operation.request.id);
    await vi.waitFor(() => expect(dependencies.presentDiff).toHaveBeenCalledWith(plan, signal));
    expect(dependencies.validatePlan).toHaveBeenCalledWith(plan, signal);
    workflow.decide(operation.request.id, "denied");
    await decision;
  });
});

function createDependencies() {
  const bindPlan = vi.fn(async () => "file:///workspace");
  const validatePlan = vi.fn(async () => {});
  const presentDiff = vi.fn(async () => {});
  const applyPlan = vi.fn(async () => "applied" as const);
  return {
    values: {
      createId: () => "approval-1",
      now: () => new Date("2026-07-19T00:00:00.000Z"),
      bindPlan,
      validatePlan,
      presentDiff,
      applyPlan,
      reportError: vi.fn(),
      workspaceTrust: { isTrusted: () => true, requireTrusted() {} },
    },
    bindPlan,
    validatePlan,
    presentDiff,
    applyPlan,
  };
}
