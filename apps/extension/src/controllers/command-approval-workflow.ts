import {
  parseRunCommandInput,
  type RunCommandInput,
  runCommandToolName,
} from "@ctrl-zebra/builtin-tools";
import {
  approvalRequestSchema,
  CancellableApprovalService,
  maxApprovalPresentationSummaryCharacters,
  type PreparedToolApproval,
  type ToolApprovalOperation,
  type ToolApprovalWorkflow,
} from "@ctrl-zebra/core";
import type { ApprovalDecisionIntent, ApprovalRequest, ApprovalStatus } from "@ctrl-zebra/protocol";

import type { WorkspaceTrustPolicy } from "./workspace-trust-policy.js";

export const defaultCommandApprovalLifetimeMilliseconds = 5 * 60 * 1_000;

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

interface CommandApprovalRecord {
  readonly request: ApprovalRequest;
  readonly input: RunCommandInput;
  readonly binding: CommandCwdBinding;
  status: ApprovalStatus;
  signal?: AbortSignal;
  expiration?: ReturnType<typeof setTimeout>;
  consuming: boolean;
}

export class CommandApprovalWorkflow implements ToolApprovalWorkflow, CommandApprovalActions {
  readonly #dependencies: CommandApprovalWorkflowDependencies;
  readonly #service = new CancellableApprovalService({ emit() {} });
  readonly #records = new Map<string, CommandApprovalRecord>();

  constructor(dependencies: CommandApprovalWorkflowDependencies) {
    this.#dependencies = dependencies;
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

    const createdAt = this.#dependencies.now();
    const expiresAt = new Date(
      createdAt.getTime() +
        (this.#dependencies.approvalLifetimeMilliseconds ??
          defaultCommandApprovalLifetimeMilliseconds),
    );
    const request = approvalRequestSchema.parse({
      id: this.#dependencies.createId(),
      scope: {
        sessionId: prepared.sessionId,
        call: prepared.call,
        risk: prepared.risk,
        workspaceRootUri: binding.workspaceRootUri,
        resources: [{ uri: binding.cwdUri }],
      },
      presentation: {
        title: "Run command",
        summary,
      },
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    if (this.#records.has(request.id)) {
      throw new Error("Approval identifier is already active.");
    }

    const record: CommandApprovalRecord = {
      request,
      input,
      binding,
      status: "pending",
      consuming: false,
    };
    this.#records.set(request.id, record);
    return {
      request,
      requestDecision: (decisionSignal) => this.#requestDecision(record, decisionSignal),
      consume: (consumptionSignal) => this.#consume(record, consumptionSignal),
    };
  }

  decide(approvalId: string, decision: ApprovalDecisionIntent): void {
    const record = this.#records.get(approvalId);
    if (record === undefined || record.status !== "pending") {
      return;
    }

    if (this.#dependencies.now().getTime() >= Date.parse(record.request.expiresAt)) {
      this.#expire(record);
      return;
    }

    this.#service.respond({
      requestId: record.request.id,
      decision,
      decidedAt: this.#dependencies.now().toISOString(),
    });
  }

  dispose(): void {
    for (const record of this.#records.values()) {
      this.#clearExpiration(record);
      if (record.status === "pending" && record.signal !== undefined) {
        record.status = "cancelled";
        this.#service.cancel(record.request.id, new Error("Approval workflow disposed."));
      }
    }
    this.#records.clear();
  }

  async #requestDecision(record: CommandApprovalRecord, signal: AbortSignal) {
    if (record.status !== "pending" || record.signal !== undefined) {
      throw new Error("Approval operation is not pending.");
    }

    record.signal = signal;
    const remaining = Date.parse(record.request.expiresAt) - this.#dependencies.now().getTime();
    if (remaining <= 0) {
      record.status = "expired";
      this.#records.delete(record.request.id);
      return { requestId: record.request.id, decision: "expired" as const };
    }

    const decision = this.#service.request(record.request, signal);
    record.expiration = setTimeout(() => this.#expire(record), remaining);
    try {
      const value = await decision;
      record.status = value.decision;
      if (value.decision === "denied") {
        this.#records.delete(record.request.id);
      }
      return value;
    } catch (error) {
      if (hasCommandApprovalStatus(record, "expired")) {
        this.#records.delete(record.request.id);
        return { requestId: record.request.id, decision: "expired" as const };
      }
      if (record.status === "pending" && signal.aborted) {
        record.status = "cancelled";
        this.#records.delete(record.request.id);
      }
      throw error;
    } finally {
      this.#clearExpiration(record);
    }
  }

  async #consume(record: CommandApprovalRecord, signal: AbortSignal) {
    signal.throwIfAborted();
    if (record.status !== "approved" || record.consuming) {
      throw new Error("Approval is not available for consumption.");
    }
    if (this.#dependencies.now().getTime() >= Date.parse(record.request.expiresAt)) {
      record.status = "expired";
      this.#records.delete(record.request.id);
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

    record.consuming = true;
    record.status = "consumed";
    this.#records.delete(record.request.id);
    return { outcome: "approved" as const };
  }

  #invalidateForTrustChange(record: CommandApprovalRecord) {
    record.status = "invalidated";
    this.#records.delete(record.request.id);
    return {
      outcome: "conflict" as const,
      message: "Workspace trust or command scope changed before execution.",
    };
  }

  #expire(record: CommandApprovalRecord): void {
    if (record.status !== "pending") {
      return;
    }
    record.status = "expired";
    this.#clearExpiration(record);
    this.#service.cancel(record.request.id, new CommandApprovalExpiredError());
  }

  #clearExpiration(record: CommandApprovalRecord): void {
    if (record.expiration !== undefined) {
      clearTimeout(record.expiration);
      record.expiration = undefined;
    }
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

export class CommandApprovalExpiredError extends Error {
  constructor() {
    super("The command approval request expired.");
    this.name = "CommandApprovalExpiredError";
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

function hasCommandApprovalStatus(record: CommandApprovalRecord, status: ApprovalStatus): boolean {
  return record.status === status;
}
