import { parseWorkspaceEditPlan, type WorkspaceEditPlan } from "@ctrl-zebra/core";

import { FileMutationApprovalWorkflow } from "./file-mutation-approval-workflow.js";
import type { WorkspaceTrustPolicy } from "./workspace-trust-policy.js";

interface WorkspaceEditApprovalWorkflowDependencies {
  readonly createId: () => string;
  readonly now: () => Date;
  readonly bindPlan: (plan: WorkspaceEditPlan, signal: AbortSignal) => Promise<string>;
  readonly validatePlan: (plan: WorkspaceEditPlan, signal: AbortSignal) => Promise<void>;
  readonly presentDiff: (plan: WorkspaceEditPlan, signal: AbortSignal) => Promise<void>;
  readonly applyPlan: (
    plan: WorkspaceEditPlan,
    ownership: { readonly sessionId: string; readonly runId: string },
    signal: AbortSignal,
  ) => Promise<"applied" | "conflict">;
  readonly approvalLifetimeMilliseconds?: number;
  readonly reportError: (message: string) => void;
  readonly workspaceTrust: WorkspaceTrustPolicy;
}

export class WorkspaceEditApprovalWorkflow extends FileMutationApprovalWorkflow<WorkspaceEditPlan> {
  constructor(dependencies: WorkspaceEditApprovalWorkflowDependencies) {
    super({
      createId: dependencies.createId,
      now: dependencies.now,
      parsePlan: (value) => parseWorkspaceEditPlan(value),
      bindPlan: dependencies.bindPlan,
      resources: (plan) =>
        plan.files.map(({ uri, originalRevision }) => ({ uri, revision: originalRevision })),
      validatePlan: dependencies.validatePlan,
      presentDiff: dependencies.presentDiff,
      applyPlan: dependencies.applyPlan,
      title: "Apply proposed workspace edits",
      summary: (plan) => {
        const editCount = plan.files.reduce((total, file) => total + file.edits.length, 0);
        return `${editCount} text edit${editCount === 1 ? "" : "s"} will be applied atomically to ${plan.files.length} files.`;
      },
      conflictMessage: "One or more approved workspace edit targets changed before application.",
      trustConflictMessage:
        "Workspace trust changed before the approved workspace edits could be applied.",
      approvalLifetimeMilliseconds: dependencies.approvalLifetimeMilliseconds,
      reportError: dependencies.reportError,
      workspaceTrust: dependencies.workspaceTrust,
      result: "applied",
    });
  }
}
