import { type FileCreatePlan, parseFileCreatePlan } from "@ctrl-zebra/core";

import { FileMutationApprovalWorkflow } from "./file-mutation-approval-workflow.js";
import type { WorkspaceTrustPolicy } from "./workspace-trust-policy.js";

interface FileCreateApprovalWorkflowDependencies {
  readonly createId: () => string;
  readonly now: () => Date;
  readonly bindPlan: (plan: FileCreatePlan, signal: AbortSignal) => Promise<string>;
  readonly validatePlan: (plan: FileCreatePlan, signal: AbortSignal) => Promise<void>;
  readonly presentDiff: (plan: FileCreatePlan, signal: AbortSignal) => Promise<void>;
  readonly applyPlan: (
    plan: FileCreatePlan,
    ownership: { readonly sessionId: string; readonly runId: string },
    signal: AbortSignal,
  ) => Promise<"applied" | "conflict">;
  readonly approvalLifetimeMilliseconds?: number;
  readonly reportError: (message: string) => void;
  readonly workspaceTrust: WorkspaceTrustPolicy;
}

export class FileCreateApprovalWorkflow extends FileMutationApprovalWorkflow<FileCreatePlan> {
  constructor(dependencies: FileCreateApprovalWorkflowDependencies) {
    super({
      createId: dependencies.createId,
      now: dependencies.now,
      parsePlan: parseFileCreatePlan,
      bindPlan: dependencies.bindPlan,
      resources: (plan) => [{ uri: plan.uri }],
      validatePlan: dependencies.validatePlan,
      presentDiff: dependencies.presentDiff,
      applyPlan: dependencies.applyPlan,
      title: "Create proposed file",
      summary: (plan) => `Create ${plan.path} (${plan.content.length} text characters).`,
      conflictMessage: "The approved file target changed before it could be created.",
      approvalLifetimeMilliseconds: dependencies.approvalLifetimeMilliseconds,
      reportError: dependencies.reportError,
      workspaceTrust: dependencies.workspaceTrust,
      result: "applied",
    });
  }
}
