import { runCommandToolName } from "@ctrl-zebra/builtin-tools";
import type {
  PreparedToolApproval,
  ToolApprovalOperation,
  ToolApprovalWorkflow,
} from "@ctrl-zebra/core";
import type { ApprovalDecisionIntent } from "@ctrl-zebra/protocol";

interface ApprovalWorkflowOwner extends ToolApprovalWorkflow {
  decide(approvalId: string, decision: ApprovalDecisionIntent): void;
  dispose(): void;
}

interface FileEditApprovalWorkflowOwner extends ApprovalWorkflowOwner {
  showDiff(approvalId: string): void;
}

export class ToolApprovalWorkflowRouter implements ToolApprovalWorkflow {
  constructor(
    private readonly fileEdits: FileEditApprovalWorkflowOwner,
    private readonly commands: ApprovalWorkflowOwner,
  ) {}

  create(prepared: PreparedToolApproval, signal: AbortSignal): Promise<ToolApprovalOperation> {
    if (prepared.risk === "execute" && prepared.call.name === runCommandToolName) {
      return this.commands.create(prepared, signal);
    }
    return this.fileEdits.create(prepared, signal);
  }

  showDiff(approvalId: string): void {
    this.fileEdits.showDiff(approvalId);
  }

  decide(approvalId: string, decision: ApprovalDecisionIntent): void {
    this.fileEdits.decide(approvalId, decision);
    this.commands.decide(approvalId, decision);
  }

  dispose(): void {
    this.fileEdits.dispose();
    this.commands.dispose();
  }
}
