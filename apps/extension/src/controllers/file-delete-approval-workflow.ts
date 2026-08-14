import { type FileDeletePlan, parseFileDeletePlan } from "@ctrl-zebra/core";

import { FileMutationApprovalWorkflow } from "./file-mutation-approval-workflow.js";
import type { WorkspaceTrustPolicy } from "./workspace-trust-policy.js";

interface FileDeleteApprovalWorkflowDependencies {
  readonly createId: () => string;
  readonly now: () => Date;
  readonly hashText: (text: string) => string;
  readonly bindPlan: (plan: FileDeletePlan, signal: AbortSignal) => Promise<string>;
  readonly validatePlan: (plan: FileDeletePlan, signal: AbortSignal) => Promise<void>;
  readonly presentDiff: (plan: FileDeletePlan, signal: AbortSignal) => Promise<void>;
  readonly applyPlan: (
    plan: FileDeletePlan,
    ownership: { readonly sessionId: string; readonly runId: string },
    signal: AbortSignal,
  ) => Promise<"applied" | "conflict">;
  readonly approvalLifetimeMilliseconds?: number;
  readonly reportError: (message: string) => void;
  readonly workspaceTrust: WorkspaceTrustPolicy;
}

export class FileDeleteApprovalWorkflow extends FileMutationApprovalWorkflow<FileDeletePlan> {
  constructor(dependencies: FileDeleteApprovalWorkflowDependencies) {
    super({
      createId: dependencies.createId,
      now: dependencies.now,
      parsePlan: (value) => parseFileDeletePlan(value, dependencies.hashText),
      bindPlan: dependencies.bindPlan,
      resources: (plan) => [{ uri: plan.uri }],
      validatePlan: dependencies.validatePlan,
      presentDiff: dependencies.presentDiff,
      applyPlan: dependencies.applyPlan,
      title: "Delete proposed file",
      summary: (plan) => `Delete ${plan.path} (${plan.beforeContent.length} text characters).`,
      conflictMessage: "The approved file target changed before it could be deleted.",
      approvalLifetimeMilliseconds: dependencies.approvalLifetimeMilliseconds,
      reportError: dependencies.reportError,
      workspaceTrust: dependencies.workspaceTrust,
      result: "applied",
    });
  }
}
