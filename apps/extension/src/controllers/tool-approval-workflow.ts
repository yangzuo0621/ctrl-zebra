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

interface OwnedApproval {
  readonly owner: ApprovalWorkflowOwner;
  readonly removeAbortListener: () => void;
}

export class ToolApprovalWorkflowRouter implements ToolApprovalWorkflow {
  readonly #owners = new Map<string, OwnedApproval>();

  constructor(
    private readonly fileEdits: FileEditApprovalWorkflowOwner,
    private readonly commands: ApprovalWorkflowOwner,
  ) {}

  async create(
    prepared: PreparedToolApproval,
    signal: AbortSignal,
  ): Promise<ToolApprovalOperation> {
    const owner =
      prepared.risk === "execute" && prepared.call.name === runCommandToolName
        ? this.commands
        : this.fileEdits;
    const operation = await owner.create(prepared, signal);
    signal.throwIfAborted();
    const approvalId = operation.request.id;
    if (this.#owners.has(approvalId)) {
      throw new Error("Approval identifier is already owned by another workflow.");
    }

    const abort = () => this.#release(approvalId, owned);
    const owned: OwnedApproval = {
      owner,
      removeAbortListener: () => signal.removeEventListener("abort", abort),
    };
    this.#owners.set(approvalId, owned);
    signal.addEventListener("abort", abort, { once: true });

    return {
      request: operation.request,
      requestDecision: async (decisionSignal) => {
        try {
          const decision = await operation.requestDecision(decisionSignal);
          if (decision.decision !== "approved") {
            this.#release(approvalId, owned);
          }
          return decision;
        } catch (error) {
          this.#release(approvalId, owned);
          throw error;
        }
      },
      consume: async (consumptionSignal) => {
        try {
          return await operation.consume(consumptionSignal);
        } finally {
          this.#release(approvalId, owned);
        }
      },
    };
  }

  showDiff(approvalId: string): void {
    if (this.#owners.get(approvalId)?.owner === this.fileEdits) {
      this.fileEdits.showDiff(approvalId);
    }
  }

  decide(approvalId: string, decision: ApprovalDecisionIntent): void {
    this.#owners.get(approvalId)?.owner.decide(approvalId, decision);
  }

  dispose(): void {
    for (const owned of this.#owners.values()) {
      owned.removeAbortListener();
    }
    this.#owners.clear();
    this.fileEdits.dispose();
    this.commands.dispose();
  }

  #release(approvalId: string, owned: OwnedApproval): void {
    if (this.#owners.get(approvalId) !== owned) {
      return;
    }

    owned.removeAbortListener();
    this.#owners.delete(approvalId);
  }
}
