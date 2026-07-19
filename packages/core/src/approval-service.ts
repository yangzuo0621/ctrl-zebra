import type { ApprovalDecision, ApprovalRequest, ApprovalRequestId } from "@ctrl-zebra/protocol";

export interface ApprovalRequestSink {
  emit(request: ApprovalRequest): void;
}

export interface ApprovalService {
  request(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision>;
}

export class ApprovalRequestAlreadyPendingError extends Error {
  constructor(readonly requestId: ApprovalRequestId) {
    super(`Approval request "${requestId}" is already pending.`);
    this.name = "ApprovalRequestAlreadyPendingError";
  }
}

export class ApprovalRequestNotPendingError extends Error {
  constructor(readonly requestId: ApprovalRequestId) {
    super(`Approval request "${requestId}" is not pending.`);
    this.name = "ApprovalRequestNotPendingError";
  }
}

interface PendingApproval {
  readonly requestId: ApprovalRequestId;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
  readonly resolve: (decision: ApprovalDecision) => void;
  readonly reject: (reason: unknown) => void;
}

export class CancellableApprovalService implements ApprovalService {
  readonly #requestSink: ApprovalRequestSink;
  readonly #pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();

  constructor(requestSink: ApprovalRequestSink) {
    this.#requestSink = requestSink;
  }

  request(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
    if (signal.aborted) {
      return Promise.reject(signal.reason);
    }

    if (this.#pendingApprovals.has(request.id)) {
      return Promise.reject(new ApprovalRequestAlreadyPendingError(request.id));
    }

    return new Promise<ApprovalDecision>((resolve, reject) => {
      const pending: PendingApproval = {
        requestId: request.id,
        signal,
        onAbort: () => {
          if (this.#removePending(pending)) {
            reject(signal.reason);
          }
        },
        resolve,
        reject,
      };

      this.#pendingApprovals.set(request.id, pending);
      signal.addEventListener("abort", pending.onAbort, { once: true });

      try {
        this.#requestSink.emit(request);
      } catch (error) {
        if (this.#removePending(pending)) {
          reject(error);
        }
      }
    });
  }

  respond(decision: ApprovalDecision): void {
    const pending = this.#pendingApprovals.get(decision.requestId);
    if (pending === undefined) {
      throw new ApprovalRequestNotPendingError(decision.requestId);
    }

    this.#removePending(pending);
    pending.resolve(decision);
  }

  cancel(requestId: ApprovalRequestId, reason: unknown): void {
    const pending = this.#pendingApprovals.get(requestId);
    if (pending === undefined) {
      throw new ApprovalRequestNotPendingError(requestId);
    }

    this.#removePending(pending);
    pending.reject(reason);
  }

  #removePending(pending: PendingApproval): boolean {
    if (this.#pendingApprovals.get(pending.requestId) !== pending) {
      return false;
    }

    this.#pendingApprovals.delete(pending.requestId);
    pending.signal.removeEventListener("abort", pending.onAbort);
    return true;
  }
}
