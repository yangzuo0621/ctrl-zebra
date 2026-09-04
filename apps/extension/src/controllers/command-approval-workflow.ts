import {
  parseRunCommandInput,
  type RunCommandInput,
  runCommandToolName,
} from "@ctrl-zebra/builtin-tools";
import {
  maxApprovalPresentationSummaryCharacters,
  type PreparedToolApproval,
  type ToolApprovalOperation,
  type ToolApprovalWorkflow,
} from "@ctrl-zebra/core";
import type { ApprovalDecisionIntent, ApprovalRequest } from "@ctrl-zebra/protocol";

import {
  ApprovalLifecycle,
  type ApprovalLifecycleRecord,
  buildApprovalRequest,
  defaultToolApprovalLifetimeMilliseconds,
} from "./approval-lifecycle.js";
import type { WorkspaceTrustPolicy } from "./workspace-trust-policy.js";

export const defaultCommandApprovalLifetimeMilliseconds = defaultToolApprovalLifetimeMilliseconds;

export interface CommandCwdBinding {
  readonly workspaceRootUri: string;
  readonly cwdUri: string;
}

export interface CommandApprovalActions {
  decide(approvalId: string, decision: ApprovalDecisionIntent): void;
}

interface CommandApprovalWorkflowDependencies {
  readonly createId: () => string;
  readonly now: () => Date;
  readonly bindCwd: (cwd: string, signal: AbortSignal) => Promise<CommandCwdBinding>;
  readonly workspaceTrust: WorkspaceTrustPolicy;
  readonly approvalLifetimeMilliseconds?: number;
}

interface CommandApprovalRecord extends ApprovalLifecycleRecord {
  readonly request: ApprovalRequest;
  readonly input: RunCommandInput;
  readonly binding: CommandCwdBinding;
}

export class CommandApprovalWorkflow implements ToolApprovalWorkflow, CommandApprovalActions {
  readonly #dependencies: CommandApprovalWorkflowDependencies;
  readonly #lifecycle: ApprovalLifecycle<CommandApprovalRecord>;

  constructor(dependencies: CommandApprovalWorkflowDependencies) {
    this.#dependencies = dependencies;
    this.#lifecycle = new ApprovalLifecycle(dependencies.now);
  }

  async create(
    prepared: PreparedToolApproval,
    signal: AbortSignal,
  ): Promise<ToolApprovalOperation> {
    this.#dependencies.workspaceTrust.requireTrusted();
    if (prepared.risk !== "execute" || prepared.call.name !== runCommandToolName) {
      throw new InvalidCommandApprovalError();
    }
    const input = parseRunCommandInput(prepared.call.input);
    signal.throwIfAborted();
    const binding = await this.#dependencies.bindCwd(input.cwd, signal);
    signal.throwIfAborted();
    const summary = formatCommandApprovalSummary(input, binding.cwdUri);
    if (summary.length > maxApprovalPresentationSummaryCharacters) {
      throw new CommandApprovalPresentationTooLargeError();
    }

    const request = buildApprovalRequest(
      this.#dependencies.now,
      {
        id: this.#dependencies.createId(),
        scope: {
          sessionId: prepared.sessionId,
          runId: prepared.runId,
          call: prepared.call,
          risk: prepared.risk,
          workspaceRootUri: binding.workspaceRootUri,
          resources: [{ uri: binding.cwdUri }],
        },
        presentation: {
          title: "Run command",
          summary,
        },
      },
      this.#dependencies.approvalLifetimeMilliseconds,
    );
    const record: CommandApprovalRecord = {
      request,
      input,
      binding,
      status: "pending",
      consuming: false,
    };
    return this.#lifecycle.open(record, (consumptionSignal) =>
      this.#consume(record, consumptionSignal),
    );
  }

  decide(approvalId: string, decision: ApprovalDecisionIntent): void {
    this.#lifecycle.decide(approvalId, decision);
  }

  dispose(): void {
    this.#lifecycle.dispose();
  }

  async #consume(record: CommandApprovalRecord, signal: AbortSignal) {
    if (!this.#lifecycle.validateConsumption(record, signal)) {
      return { outcome: "expired" as const };
    }

    if (!this.#dependencies.workspaceTrust.isTrusted()) {
      return this.#invalidateForTrustChange(record);
    }
    const currentBinding = await this.#dependencies.bindCwd(record.input.cwd, signal);
    signal.throwIfAborted();
    if (
      !this.#dependencies.workspaceTrust.isTrusted() ||
      currentBinding.workspaceRootUri !== record.binding.workspaceRootUri ||
      currentBinding.cwdUri !== record.binding.cwdUri
    ) {
      return this.#invalidateForTrustChange(record);
    }

    this.#lifecycle.markConsuming(record);
    this.#lifecycle.finish(record, "consumed");
    return { outcome: "approved" as const };
  }

  #invalidateForTrustChange(record: CommandApprovalRecord) {
    this.#lifecycle.finish(record, "invalidated");
    return {
      outcome: "conflict" as const,
      message: "Workspace trust or command scope changed before execution.",
    };
  }
}

export class InvalidCommandApprovalError extends Error {
  constructor() {
    super("The command approval operation is invalid.");
    this.name = "InvalidCommandApprovalError";
  }
}

export class CommandApprovalPresentationTooLargeError extends Error {
  constructor() {
    super("The command is too large to present for approval.");
    this.name = "CommandApprovalPresentationTooLargeError";
  }
}

function formatCommandApprovalSummary(input: RunCommandInput, cwdUri: string): string {
  return [
    `Executable: ${JSON.stringify(input.command)}`,
    `Arguments: ${JSON.stringify(input.args)}`,
    `Working directory: ${cwdUri}`,
    `Timeout: ${input.timeoutMs} ms`,
  ].join("\n");
}
