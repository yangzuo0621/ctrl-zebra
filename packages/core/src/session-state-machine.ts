import type { SessionId, SessionStatus } from "@ctrl-zebra/protocol";

import type { DomainEvent, EventSink } from "./events.js";

const legalTransitions = {
  idle: ["preparing"],
  preparing: ["streaming", "cancelled", "failed"],
  streaming: ["awaiting_approval", "executing_tool", "completed", "cancelled", "failed"],
  awaiting_approval: ["streaming", "executing_tool", "cancelled", "failed"],
  executing_tool: ["streaming", "cancelled", "failed"],
  completed: [],
  cancelled: [],
  failed: [],
  interrupted: [],
} as const satisfies Record<SessionStatus, readonly SessionStatus[]>;

const runResetStatuses = new Set<SessionStatus>([
  "idle",
  "completed",
  "cancelled",
  "failed",
  "interrupted",
]);

export interface SessionStatusChangedEvent extends DomainEvent {
  readonly type: "session.status-changed";
  readonly sessionId: SessionId;
  readonly previousStatus: SessionStatus;
  readonly status: SessionStatus;
}

export class InvalidSessionStatusTransitionError extends Error {
  readonly previousStatus: SessionStatus;
  readonly status: SessionStatus;

  constructor(previousStatus: SessionStatus, status: SessionStatus) {
    super(`Cannot transition Session status from ${previousStatus} to ${status}.`);
    this.name = "InvalidSessionStatusTransitionError";
    this.previousStatus = previousStatus;
    this.status = status;
  }
}

export class SessionStateMachine {
  readonly #sessionId: SessionId;
  readonly #eventSink: EventSink<SessionStatusChangedEvent>;
  #status: SessionStatus;

  constructor(
    sessionId: SessionId,
    status: SessionStatus,
    eventSink: EventSink<SessionStatusChangedEvent>,
  ) {
    this.#sessionId = sessionId;
    this.#status = status;
    this.#eventSink = eventSink;
  }

  get status(): SessionStatus {
    return this.#status;
  }

  /**
   * Starts a fresh Run without resuming any work owned by the previous status.
   * Terminal and recovery states are reset only through this explicit gate.
   */
  beginRun(): void {
    const previousStatus = this.#status;
    if (!runResetStatuses.has(previousStatus)) {
      throw new InvalidSessionStatusTransitionError(previousStatus, "preparing");
    }

    this.#commit("preparing");
  }

  transitionTo(status: SessionStatus): void {
    const previousStatus = this.#status;
    const allowedStatuses: readonly SessionStatus[] = legalTransitions[previousStatus];
    if (!allowedStatuses.includes(status)) {
      throw new InvalidSessionStatusTransitionError(previousStatus, status);
    }

    this.#commit(status);
  }

  #commit(status: SessionStatus): void {
    const previousStatus = this.#status;
    this.#status = status;
    this.#eventSink.emit({
      type: "session.status-changed",
      sessionId: this.#sessionId,
      previousStatus,
      status,
    });
  }
}
