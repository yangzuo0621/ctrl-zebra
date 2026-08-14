import type { PreparedToolApproval } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import { FileRenameApprovalWorkflow } from "./file-rename-approval-workflow.js";

const plan = {
  operation: "rename",
  sourcePath: "old.txt",
  targetPath: "new.txt",
  sourceUri: "file:///workspace/old.txt",
  targetUri: "file:///workspace/new.txt",
  beforeContent: "zebra\n",
  beforeHash: "a".repeat(64),
} as const;
const prepared = {
  sessionId: "session-1",
  runId: "run-1",
  call: {
    id: "call-1",
    name: "propose_file_rename",
    input: { sourcePath: plan.sourcePath, targetPath: plan.targetPath },
  },
  risk: "write",
  prepared: { output: plan, truncated: false },
} satisfies PreparedToolApproval;

describe("FileRenameApprovalWorkflow", () => {
  it("binds both resources and consumes one approved rename", async () => {
    const dependencies = createDependencies();
    const workflow = new FileRenameApprovalWorkflow(dependencies.values);
    const operation = await workflow.create(prepared, new AbortController().signal);
    const decision = operation.requestDecision(new AbortController().signal);

    workflow.decide(operation.request.id, "approved");

    await expect(decision).resolves.toMatchObject({ decision: "approved" });
    await expect(operation.consume(new AbortController().signal)).resolves.toEqual({
      outcome: "applied",
    });
    expect(dependencies.bindPlan).toHaveBeenCalledWith(plan, expect.any(AbortSignal));
    expect(dependencies.applyPlan).toHaveBeenCalledOnce();
  });
});

function createDependencies() {
  const bindPlan = vi.fn(async () => "file:///workspace");
  const applyPlan = vi.fn(async () => "applied" as const);
  return {
    values: {
      createId: () => "approval-1",
      now: () => new Date("2026-08-13T00:00:00.000Z"),
      hashText: () => plan.beforeHash,
      bindPlan,
      validatePlan: vi.fn(async () => {}),
      presentDiff: vi.fn(async () => {}),
      applyPlan,
      reportError: vi.fn(),
      workspaceTrust: { isTrusted: () => true, requireTrusted() {} },
    },
    bindPlan,
    applyPlan,
  };
}
