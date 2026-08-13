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

type FileCreateApprovalWorkflowOwner = FileEditApprovalWorkflowOwner;

interface OwnedApproval {
  readonly owner: ApprovalWorkflowOwner;
  readonly operation: ToolApprovalOperation;
  readonly removeAbortListener: () => void;
}

export class ToolApprovalWorkflowRouter implements ToolApprovalWorkflow {
  readonly #owners = new Map<string, OwnedApproval>();

  constructor(
    private readonly fileEdits: FileEditApprovalWorkflowOwner,
    private readonly commands: ApprovalWorkflowOwner,
    private readonly mcpTools?: ApprovalWorkflowOwner,
    private readonly fileCreates?: FileCreateApprovalWorkflowOwner,
  ) {}

  async create(
    prepared: PreparedToolApproval,
    signal: AbortSignal,
  ): Promise<ToolApprovalOperation> {
    const owner = this.selectOwner(prepared);
    const operation = await owner.create(prepared, signal);
    try {
      signal.throwIfAborted();
      const approvalId = operation.request.id;
      if (this.#owners.has(approvalId)) {
        throw new Error("Approval identifier is already owned by another workflow.");
      }

      const abort = () => {
        operation.invalidate();
        this.#release(approvalId, owned);
      };
      const owned: OwnedApproval = {
        owner,
        operation,
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
              operation.invalidate();
              this.#release(approvalId, owned);
            }
            return decision;
          } catch (error) {
            operation.invalidate();
            this.#release(approvalId, owned);
            throw error;
          }
        },
        consume: async (consumptionSignal) => {
          try {
            return await operation.consume(consumptionSignal);
          } finally {
            operation.invalidate();
            this.#release(approvalId, owned);
          }
        },
        invalidate: () => {
          operation.invalidate();
          this.#release(approvalId, owned);
        },
      };
    } catch (error) {
      operation.invalidate();
      throw error;
    }
  }

  showDiff(approvalId: string): void {
    const owner = this.#owners.get(approvalId)?.owner;
    if (owner === this.fileEdits) {
      this.fileEdits.showDiff(approvalId);
    } else if (owner === this.fileCreates) {
      this.fileCreates?.showDiff(approvalId);
    }
  }

  decide(approvalId: string, decision: ApprovalDecisionIntent): void {
    this.#owners.get(approvalId)?.owner.decide(approvalId, decision);
  }

  dispose(): void {
    for (const owned of this.#owners.values()) {
      owned.operation.invalidate();
      owned.removeAbortListener();
    }
    this.#owners.clear();
    this.fileEdits.dispose();
    this.fileCreates?.dispose();
    this.commands.dispose();
    this.mcpTools?.dispose();
  }

  #selectMcpOwner(): ApprovalWorkflowOwner {
    if (this.mcpTools === undefined) {
      throw new Error("MCP Tool approval workflow is unavailable.");
    }
    return this.mcpTools;
  }

  private selectOwner(prepared: PreparedToolApproval): ApprovalWorkflowOwner {
    if (prepared.call.name.startsWith("mcp_")) {
      return this.#selectMcpOwner();
    }
    return prepared.risk === "execute" && prepared.call.name === runCommandToolName
      ? this.commands
      : prepared.call.name === "propose_file_create" && this.fileCreates !== undefined
        ? this.fileCreates
        : this.fileEdits;
  }

  #release(approvalId: string, owned: OwnedApproval): void {
    if (this.#owners.get(approvalId) !== owned) {
      return;
    }

    owned.removeAbortListener();
    this.#owners.delete(approvalId);
  }
}
