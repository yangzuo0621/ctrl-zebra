import { parseTextEditPlan, type TextEditPlan } from "@ctrl-zebra/core";
import type { ApprovalDecisionIntent } from "@ctrl-zebra/protocol";

import {
  defaultFileMutationApprovalLifetimeMilliseconds,
  FileMutationApprovalWorkflow,
} from "./file-mutation-approval-workflow.js";
import type { WorkspaceTrustPolicy } from "./workspace-trust-policy.js";

export const defaultApprovalLifetimeMilliseconds = defaultFileMutationApprovalLifetimeMilliseconds;

export interface FileEditApprovalActions {
  showDiff(approvalId: string): void;
  decide(approvalId: string, decision: ApprovalDecisionIntent): void;
}

interface FileEditApprovalWorkflowDependencies {
  readonly createId: () => string;
  readonly now: () => Date;
  readonly bindPlan: (plan: TextEditPlan, signal: AbortSignal) => Promise<string>;
  readonly validatePlan: (plan: TextEditPlan, signal: AbortSignal) => Promise<void>;
  readonly presentDiff: (plan: TextEditPlan, signal: AbortSignal) => Promise<void>;
  readonly applyPlan: (
    plan: TextEditPlan,
    ownership: { readonly sessionId: string; readonly runId: string },
    signal: AbortSignal,
  ) => Promise<"applied" | "conflict">;
  readonly approvalLifetimeMilliseconds?: number;
  readonly reportError: (message: string) => void;
  readonly workspaceTrust: WorkspaceTrustPolicy;
}

export class FileEditApprovalWorkflow
  extends FileMutationApprovalWorkflow<TextEditPlan>
  implements FileEditApprovalActions
{
  constructor(dependencies: FileEditApprovalWorkflowDependencies) {
    super({
      createId: dependencies.createId,
      now: dependencies.now,
      parsePlan: parseTextEditPlan,
      bindPlan: dependencies.bindPlan,
      resources: (plan) => [{ uri: plan.uri, revision: plan.originalRevision }],
      validatePlan: dependencies.validatePlan,
      presentDiff: dependencies.presentDiff,
      applyPlan: dependencies.applyPlan,
      title: "Apply proposed file edits",
      summary: (plan) =>
        `${plan.edits.length} text edit${plan.edits.length === 1 ? "" : "s"} will be applied to ${plan.uri}.`,
      conflictMessage: "The approved file changed before its edits could be applied.",
      trustConflictMessage:
        "Workspace trust changed before the approved file edits could be applied.",
      approvalLifetimeMilliseconds: dependencies.approvalLifetimeMilliseconds,
      reportError: dependencies.reportError,
      workspaceTrust: dependencies.workspaceTrust,
      result: "approved",
    });
  }
}
