import type { ApprovalRequestId, ApprovalStatus } from "@ctrl-zebra/protocol";

import type { DomainEvent, EventSink } from "./events.js";

const legalTransitions = {
  pending: ["approved", "denied", "cancelled", "expired", "invalidated"],
  approved: ["cancelled", "expired", "invalidated", "consumed"],
  denied: [],
  cancelled: [],
  expired: [],
  invalidated: [],
  consumed: [],
} as const satisfies Record<ApprovalStatus, readonly ApprovalStatus[]>;

export interface ApprovalStatusChangedEvent extends DomainEvent {
  readonly type: "approval.status-changed";
  readonly requestId: ApprovalRequestId;
  readonly previousStatus: ApprovalStatus;
  readonly status: ApprovalStatus;
}

export class InvalidApprovalStatusTransitionError extends Error {
  readonly previousStatus: ApprovalStatus;
  readonly status: ApprovalStatus;

  constructor(previousStatus: ApprovalStatus, status: ApprovalStatus) {
    super(`Cannot transition Approval status from ${previousStatus} to ${status}.`);
    this.name = "InvalidApprovalStatusTransitionError";
    this.previousStatus = previousStatus;
    this.status = status;
  }
}

export class ApprovalStateMachine {
  readonly #requestId: ApprovalRequestId;
  readonly #eventSink: EventSink<ApprovalStatusChangedEvent>;
  #status: ApprovalStatus;

  constructor(
    requestId: ApprovalRequestId,
    status: ApprovalStatus,
    eventSink: EventSink<ApprovalStatusChangedEvent>,
  ) {
    this.#requestId = requestId;
    this.#status = status;
    this.#eventSink = eventSink;
  }

  get status(): ApprovalStatus {
    return this.#status;
  }

  transitionTo(status: ApprovalStatus): void {
    const previousStatus = this.#status;
    const allowedStatuses: readonly ApprovalStatus[] = legalTransitions[previousStatus];

    if (!allowedStatuses.includes(status)) {
      throw new InvalidApprovalStatusTransitionError(previousStatus, status);
    }

    this.#status = status;
    this.#eventSink.emit({
      type: "approval.status-changed",
      requestId: this.#requestId,
      previousStatus,
      status,
    });
  }
}
