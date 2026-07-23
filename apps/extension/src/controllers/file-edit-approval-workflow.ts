import {
  approvalRequestSchema,
  type PreparedToolApproval,
  parseTextEditPlan,
  type TextEditPlan,
  type ToolApprovalOperation,
  type ToolApprovalWorkflow,
} from "@ctrl-zebra/core";
import type { ApprovalDecisionIntent, ApprovalRequest } from "@ctrl-zebra/protocol";

import { ApprovalLifecycle, type ApprovalLifecycleRecord } from "./approval-lifecycle.js";
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

interface ApprovalRecord extends ApprovalLifecycleRecord {
  readonly request: ApprovalRequest;
  readonly plan: TextEditPlan;
  readonly ownership: FileEditOwnership;
}

export class FileEditApprovalWorkflow implements ToolApprovalWorkflow, FileEditApprovalActions {
  readonly #dependencies: FileEditApprovalWorkflowDependencies;
  readonly #lifecycle: ApprovalLifecycle<ApprovalRecord>;

  constructor(dependencies: FileEditApprovalWorkflowDependencies) {
    this.#dependencies = dependencies;
    this.#lifecycle = new ApprovalLifecycle(dependencies.now);
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
    const record: ApprovalRecord = {
      request,
      plan,
      ownership: { sessionId: prepared.sessionId, runId: prepared.runId },
      status: "pending",
      consuming: false,
    };
    this.#lifecycle.register(record);

    return {
      request,
      requestDecision: (signal) => this.#lifecycle.requestDecision(record, signal),
      consume: (signal) => this.#consume(record, signal),
    };
  }

  showDiff(approvalId: string): void {
    const record = this.#lifecycle.get(approvalId);
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
    this.#lifecycle.decide(approvalId, decision);
  }

  dispose(): void {
    this.#lifecycle.dispose();
  }

  async #consume(record: ApprovalRecord, signal: AbortSignal) {
    if (!this.#lifecycle.validateConsumption(record, signal)) {
      return { outcome: "expired" as const };
    }
    if (!this.#dependencies.workspaceTrust.isTrusted()) {
      this.#lifecycle.finish(record, "invalidated");
      return {
        outcome: "conflict" as const,
        message: "Workspace trust changed before the approved file edits could be applied.",
      };
    }

    this.#lifecycle.markConsuming(record);
    this.#dependencies.workspaceTrust.requireTrusted();
    const result = await this.#dependencies.applyPlan(record.plan, record.ownership, signal);
    signal.throwIfAborted();
    if (result === "conflict") {
      this.#lifecycle.finish(record, "invalidated");
      return {
        outcome: "conflict" as const,
        message: "The approved file changed before its edits could be applied.",
      };
    }

    this.#lifecycle.finish(record, "consumed");
    return { outcome: "approved" as const };
  }
}
