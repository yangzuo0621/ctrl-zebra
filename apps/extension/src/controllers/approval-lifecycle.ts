import { CancellableApprovalService } from "@ctrl-zebra/core";
import type { ApprovalDecisionIntent, ApprovalRequest, ApprovalStatus } from "@ctrl-zebra/protocol";

export interface ApprovalLifecycleRecord {
  readonly request: ApprovalRequest;
  status: ApprovalStatus;
  signal?: AbortSignal;
  expiration?: ReturnType<typeof setTimeout>;
  consuming: boolean;
}

export class ApprovalLifecycle<Record extends ApprovalLifecycleRecord> {
  readonly #service = new CancellableApprovalService({ emit() {} });
  readonly #records = new Map<string, Record>();

  constructor(private readonly now: () => Date) {}

  register(record: Record): void {
    if (this.#records.has(record.request.id)) {
      throw new Error("Approval identifier is already active.");
    }
    this.#records.set(record.request.id, record);
  }

  get(approvalId: string): Record | undefined {
    return this.#records.get(approvalId);
  }

  decide(approvalId: string, decision: ApprovalDecisionIntent): void {
    const record = this.#records.get(approvalId);
    if (record === undefined || record.status !== "pending") {
      return;
    }

    if (this.#isExpired(record)) {
      this.#expire(record);
      return;
    }

    this.#service.respond({
      requestId: record.request.id,
      decision,
      decidedAt: this.now().toISOString(),
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

  async requestDecision(record: Record, signal: AbortSignal) {
    if (record.status !== "pending" || record.signal !== undefined) {
      throw new Error("Approval operation is not pending.");
    }

    record.signal = signal;
    const remaining = Date.parse(record.request.expiresAt) - this.now().getTime();
    if (remaining <= 0) {
      record.status = "expired";
      this.#release(record);
      return { requestId: record.request.id, decision: "expired" as const };
    }

    const decision = this.#service.request(record.request, signal);
    record.expiration = setTimeout(() => this.#expire(record), remaining);
    try {
      const value = await decision;
      record.status = value.decision;
      if (value.decision === "denied") {
        this.#release(record);
      }
      return value;
    } catch (error) {
      if (hasApprovalStatus(record, "expired")) {
        this.#release(record);
        return { requestId: record.request.id, decision: "expired" as const };
      }
      if (record.status === "pending" && signal.aborted) {
        record.status = "cancelled";
        this.#release(record);
      }
      throw error;
    } finally {
      this.#clearExpiration(record);
    }
  }

  validateConsumption(record: Record, signal: AbortSignal): boolean {
    signal.throwIfAborted();
    if (record.status !== "approved" || record.consuming) {
      throw new Error("Approval is not available for consumption.");
    }
    if (this.#isExpired(record)) {
      this.finish(record, "expired");
      return false;
    }

    return true;
  }

  markConsuming(record: Record): void {
    if (
      this.#records.get(record.request.id) !== record ||
      record.status !== "approved" ||
      record.consuming
    ) {
      throw new Error("Approval is not available for consumption.");
    }
    record.consuming = true;
  }

  finish(record: Record, status: "consumed" | "expired" | "invalidated"): void {
    record.status = status;
    this.#release(record);
  }

  #expire(record: Record): void {
    if (record.status !== "pending") {
      return;
    }

    record.status = "expired";
    this.#clearExpiration(record);
    this.#service.cancel(record.request.id, new ApprovalExpiredError());
  }

  #release(record: Record): void {
    if (this.#records.get(record.request.id) !== record) {
      return;
    }

    this.#clearExpiration(record);
    this.#records.delete(record.request.id);
  }

  #clearExpiration(record: Record): void {
    if (record.expiration !== undefined) {
      clearTimeout(record.expiration);
      record.expiration = undefined;
    }
  }

  #isExpired(record: Record): boolean {
    return this.now().getTime() >= Date.parse(record.request.expiresAt);
  }
}

class ApprovalExpiredError extends Error {
  constructor() {
    super("The approval request expired.");
    this.name = "ApprovalExpiredError";
  }
}

function hasApprovalStatus(record: ApprovalLifecycleRecord, status: ApprovalStatus): boolean {
  return record.status === status;
}
