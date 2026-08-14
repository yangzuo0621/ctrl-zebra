import { type FileRenamePlan, parseFileRenamePlan } from "@ctrl-zebra/core";

import { FileMutationApprovalWorkflow } from "./file-mutation-approval-workflow.js";
import type { WorkspaceTrustPolicy } from "./workspace-trust-policy.js";

interface FileRenameApprovalWorkflowDependencies {
  readonly createId: () => string;
  readonly now: () => Date;
  readonly hashText: (text: string) => string;
  readonly bindPlan: (plan: FileRenamePlan, signal: AbortSignal) => Promise<string>;
  readonly validatePlan: (plan: FileRenamePlan, signal: AbortSignal) => Promise<void>;
  readonly presentDiff: (plan: FileRenamePlan, signal: AbortSignal) => Promise<void>;
  readonly applyPlan: (
    plan: FileRenamePlan,
    ownership: { readonly sessionId: string; readonly runId: string },
    signal: AbortSignal,
  ) => Promise<"applied" | "conflict">;
  readonly approvalLifetimeMilliseconds?: number;
  readonly reportError: (message: string) => void;
  readonly workspaceTrust: WorkspaceTrustPolicy;
}

export class FileRenameApprovalWorkflow extends FileMutationApprovalWorkflow<FileRenamePlan> {
  constructor(dependencies: FileRenameApprovalWorkflowDependencies) {
    super({
      createId: dependencies.createId,
      now: dependencies.now,
      parsePlan: (value) => parseFileRenamePlan(value, dependencies.hashText),
      bindPlan: dependencies.bindPlan,
      resources: (plan) => [{ uri: plan.sourceUri }, { uri: plan.targetUri }],
      validatePlan: dependencies.validatePlan,
      presentDiff: dependencies.presentDiff,
      applyPlan: dependencies.applyPlan,
      title: "Rename proposed file",
      summary: (plan) => `Rename ${plan.sourcePath} to ${plan.targetPath}.`,
      conflictMessage: "The approved source or target changed before it could be renamed.",
      approvalLifetimeMilliseconds: dependencies.approvalLifetimeMilliseconds,
      reportError: dependencies.reportError,
      workspaceTrust: dependencies.workspaceTrust,
      result: "applied",
    });
  }
}
