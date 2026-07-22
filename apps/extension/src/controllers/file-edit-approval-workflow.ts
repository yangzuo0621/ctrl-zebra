import {
  approvalRequestSchema,
  CancellableApprovalService,
  type PreparedToolApproval,
  parseTextEditPlan,
  type TextEditPlan,
  type ToolApprovalOperation,
  type ToolApprovalWorkflow,
} from "@ctrl-zebra/core";
import type { ApprovalDecisionIntent, ApprovalRequest, ApprovalStatus } from "@ctrl-zebra/protocol";

import type { WorkspaceTrustPolicy } from "./workspace-trust-policy.js";

type FileEditOwnership = Pick<PreparedToolApproval, "sessionId" | "runId">;

export const defaultApprovalLifetimeMilliseconds = 5 * 60 * 1_000;

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
    ownership: FileEditOwnership,
    signal: AbortSignal,
  ) => Promise<"applied" | "conflict">;
  readonly approvalLifetimeMilliseconds?: number;
  readonly reportError: (message: string) => void;
  readonly workspaceTrust: WorkspaceTrustPolicy;
}

interface ApprovalRecord {
  readonly request: ApprovalRequest;
  readonly plan: TextEditPlan;
  readonly ownership: FileEditOwnership;
  status: ApprovalStatus;
  signal?: AbortSignal;
  expiration?: ReturnType<typeof setTimeout>;
  consuming: boolean;
}

export class FileEditApprovalWorkflow implements ToolApprovalWorkflow, FileEditApprovalActions {
  readonly #dependencies: FileEditApprovalWorkflowDependencies;
  readonly #service = new CancellableApprovalService({ emit() {} });
  readonly #records = new Map<string, ApprovalRecord>();

  constructor(dependencies: FileEditApprovalWorkflowDependencies) {
    this.#dependencies = dependencies;
  }

  async create(
    prepared: PreparedToolApproval,
    signal: AbortSignal,
  ): Promise<ToolApprovalOperation> {
    this.#dependencies.workspaceTrust.requireTrusted();
    const plan = parseTextEditPlan(prepared.prepared.output);
    signal.throwIfAborted();
    const workspaceRootUri = await this.#dependencies.bindPlan(plan, signal);
    signal.throwIfAborted();
    const createdAt = this.#dependencies.now();
    const expiresAt = new Date(
      createdAt.getTime() +
        (this.#dependencies.approvalLifetimeMilliseconds ?? defaultApprovalLifetimeMilliseconds),
    );
    const request = approvalRequestSchema.parse({
      id: this.#dependencies.createId(),
      scope: {
        sessionId: prepared.sessionId,
        call: prepared.call,
        risk: prepared.risk,
        workspaceRootUri,
        resources: [{ uri: plan.uri, revision: plan.originalRevision }],
      },
      presentation: {
        title: "Apply proposed file edits",
        summary: `${plan.edits.length} text edit${plan.edits.length === 1 ? "" : "s"} will be applied to ${plan.uri}.`,
      },
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    if (this.#records.has(request.id)) {
      throw new Error("Approval identifier is already active.");
    }
    const record: ApprovalRecord = {
      request,
      plan,
      ownership: { sessionId: prepared.sessionId, runId: prepared.runId },
      status: "pending",
      consuming: false,
    };
    this.#records.set(request.id, record);

    return {
      request,
      requestDecision: (signal) => this.#requestDecision(record, signal),
      consume: (signal) => this.#consume(record, signal),
    };
  }

  showDiff(approvalId: string): void {
    const record = this.#records.get(approvalId);
    if (record === undefined) {
      return;
    }
    if (record.status !== "pending" && record.status !== "approved") {
      return;
    }

    const signal = record.signal;
    if (signal === undefined || signal.aborted) {
      return;
    }

    void this.#dependencies
      .validatePlan(record.plan, signal)
      .then(() => this.#dependencies.presentDiff(record.plan, signal))
      .catch(() => this.#dependencies.reportError("The proposed diff could not be opened."));
  }

  decide(approvalId: string, decision: ApprovalDecisionIntent): void {
    const record = this.#records.get(approvalId);
    if (record === undefined) {
      return;
    }
    if (record.status !== "pending") {
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

  async #requestDecision(record: ApprovalRecord, signal: AbortSignal) {
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
      if (hasApprovalStatus(record, "expired")) {
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

  async #consume(record: ApprovalRecord, signal: AbortSignal) {
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
      record.status = "invalidated";
      this.#records.delete(record.request.id);
      return {
        outcome: "conflict" as const,
        message: "Workspace trust changed before the approved file edits could be applied.",
      };
    }

    record.consuming = true;
    this.#dependencies.workspaceTrust.requireTrusted();
    const result = await this.#dependencies.applyPlan(record.plan, record.ownership, signal);
    signal.throwIfAborted();
    if (result === "conflict") {
      record.status = "invalidated";
      this.#records.delete(record.request.id);
      return {
        outcome: "conflict" as const,
        message: "The approved file changed before its edits could be applied.",
      };
    }

    record.status = "consumed";
    this.#records.delete(record.request.id);
    return { outcome: "approved" as const };
  }

  #expire(record: ApprovalRecord): void {
    if (record.status !== "pending") {
      return;
    }

    record.status = "expired";
    this.#clearExpiration(record);
    this.#service.cancel(record.request.id, new ApprovalExpiredError());
  }

  #clearExpiration(record: ApprovalRecord): void {
    if (record.expiration !== undefined) {
      clearTimeout(record.expiration);
      record.expiration = undefined;
    }
  }
}

export class ApprovalExpiredError extends Error {
  constructor() {
    super("The approval request expired.");
    this.name = "ApprovalExpiredError";
  }
}

function hasApprovalStatus(record: ApprovalRecord, status: ApprovalStatus): boolean {
  return record.status === status;
}
