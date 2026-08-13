import type {
  PreparedToolApproval,
  ToolApprovalOperation,
  ToolApprovalWorkflow,
} from "@ctrl-zebra/core";
import {
  type ApprovalDecisionIntent,
  type ApprovalRequest,
  type ApprovalResource,
  approvalRequestSchema,
} from "@ctrl-zebra/protocol";

import { ApprovalLifecycle, type ApprovalLifecycleRecord } from "./approval-lifecycle.js";
import type { WorkspaceTrustPolicy } from "./workspace-trust-policy.js";

export const defaultFileMutationApprovalLifetimeMilliseconds = 5 * 60 * 1_000;

export interface FileMutationApprovalActions {
  showDiff(approvalId: string): void;
  decide(approvalId: string, decision: ApprovalDecisionIntent): void;
}

export interface FileMutationApprovalWorkflowDependencies<Plan> {
  readonly createId: () => string;
  readonly now: () => Date;
  readonly parsePlan: (value: unknown) => Plan;
  readonly bindPlan: (plan: Plan, signal: AbortSignal) => Promise<string>;
  readonly resources: (plan: Plan) => readonly ApprovalResource[];
  readonly validatePlan: (plan: Plan, signal: AbortSignal) => Promise<void>;
  readonly presentDiff: (plan: Plan, signal: AbortSignal) => Promise<void>;
  readonly applyPlan: (
    plan: Plan,
    ownership: { readonly sessionId: string; readonly runId: string },
    signal: AbortSignal,
  ) => Promise<"applied" | "conflict">;
  readonly title: string;
  readonly summary: (plan: Plan) => string;
  readonly conflictMessage: string;
  readonly trustConflictMessage?: string;
  readonly approvalLifetimeMilliseconds?: number;
  readonly reportError: (message: string) => void;
  readonly workspaceTrust: WorkspaceTrustPolicy;
  readonly result: "approved" | "applied";
}

interface ApprovalRecord<Plan> extends ApprovalLifecycleRecord {
  readonly request: ApprovalRequest;
  readonly plan: Plan;
  readonly ownership: { readonly sessionId: string; readonly runId: string };
}

export class FileMutationApprovalWorkflow<Plan>
  implements ToolApprovalWorkflow, FileMutationApprovalActions
{
  readonly #dependencies: FileMutationApprovalWorkflowDependencies<Plan>;
  readonly #lifecycle: ApprovalLifecycle<ApprovalRecord<Plan>>;

  constructor(dependencies: FileMutationApprovalWorkflowDependencies<Plan>) {
    this.#dependencies = dependencies;
    this.#lifecycle = new ApprovalLifecycle(dependencies.now);
  }

  async create(
    prepared: PreparedToolApproval,
    signal: AbortSignal,
  ): Promise<ToolApprovalOperation> {
    this.#dependencies.workspaceTrust.requireTrusted();
    const plan = this.#dependencies.parsePlan(prepared.prepared.output);
    signal.throwIfAborted();
    const workspaceRootUri = await this.#dependencies.bindPlan(plan, signal);
    signal.throwIfAborted();
    const createdAt = this.#dependencies.now();
    const expiresAt = new Date(
      createdAt.getTime() +
        (this.#dependencies.approvalLifetimeMilliseconds ??
          defaultFileMutationApprovalLifetimeMilliseconds),
    );
    const request = approvalRequestSchema.parse({
      id: this.#dependencies.createId(),
      scope: {
        sessionId: prepared.sessionId,
        runId: prepared.runId,
        call: prepared.call,
        risk: prepared.risk,
        workspaceRootUri,
        resources: this.#dependencies.resources(plan),
      },
      presentation: {
        title: this.#dependencies.title,
        summary: this.#dependencies.summary(plan),
      },
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    const record: ApprovalRecord<Plan> = {
      request,
      plan,
      ownership: { sessionId: prepared.sessionId, runId: prepared.runId },
      status: "pending",
      consuming: false,
    };
    this.#lifecycle.register(record);

    return {
      request,
      requestDecision: (decisionSignal) => this.#lifecycle.requestDecision(record, decisionSignal),
      consume: (consumeSignal) => this.#consume(record, consumeSignal),
      invalidate: () => this.#lifecycle.invalidate(record),
    };
  }

  showDiff(approvalId: string): void {
    const record = this.#lifecycle.get(approvalId);
    if (record === undefined || (record.status !== "pending" && record.status !== "approved")) {
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

  async #consume(record: ApprovalRecord<Plan>, signal: AbortSignal) {
    if (!this.#lifecycle.validateConsumption(record, signal)) {
      return { outcome: "expired" as const };
    }
    if (!this.#dependencies.workspaceTrust.isTrusted()) {
      this.#lifecycle.finish(record, "invalidated");
      return {
        outcome: "conflict" as const,
        message: this.#dependencies.trustConflictMessage ?? this.#dependencies.conflictMessage,
      };
    }

    this.#lifecycle.markConsuming(record);
    this.#dependencies.workspaceTrust.requireTrusted();
    const result = await this.#dependencies.applyPlan(record.plan, record.ownership, signal);
    signal.throwIfAborted();
    if (result === "conflict") {
      this.#lifecycle.finish(record, "invalidated");
      return { outcome: "conflict" as const, message: this.#dependencies.conflictMessage };
    }

    this.#lifecycle.finish(record, "consumed");
    return { outcome: this.#dependencies.result };
  }
}
