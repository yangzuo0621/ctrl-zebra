import type { ApprovalStatus } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import {
  ApprovalStateMachine,
  type ApprovalStatusChangedEvent,
  InvalidApprovalStatusTransitionError,
} from "./index.js";

const statuses = [
  "pending",
  "approved",
  "denied",
  "cancelled",
  "expired",
  "invalidated",
  "consumed",
] as const satisfies readonly ApprovalStatus[];

const legalTransitionKeys = new Set([
  "pending:approved",
  "pending:denied",
  "pending:cancelled",
  "pending:expired",
  "pending:invalidated",
  "approved:cancelled",
  "approved:expired",
  "approved:invalidated",
  "approved:consumed",
]);

const transitionCases = statuses.flatMap((previousStatus) =>
  statuses.map(
    (status) =>
      [previousStatus, status, legalTransitionKeys.has(`${previousStatus}:${status}`)] as const,
  ),
);

describe("ApprovalStateMachine", () => {
  it.each(
    transitionCases,
  )("enforces the transition from %s to %s", (previousStatus, status, isLegal) => {
    const events: ApprovalStatusChangedEvent[] = [];
    const machine = new ApprovalStateMachine("approval-1", previousStatus, {
      emit(event) {
        events.push(event);
      },
    });

    if (isLegal) {
      machine.transitionTo(status);

      expect(machine.status).toBe(status);
      expect(events).toEqual([
        {
          type: "approval.status-changed",
          requestId: "approval-1",
          previousStatus,
          status,
        },
      ]);
      return;
    }

    expect(() => machine.transitionTo(status)).toThrow(InvalidApprovalStatusTransitionError);
    expect(machine.status).toBe(previousStatus);
    expect(events).toEqual([]);
  });

  it("permits exactly one consumer for an approved request", () => {
    const machine = new ApprovalStateMachine("approval-1", "approved", { emit() {} });

    machine.transitionTo("consumed");

    expect(machine.status).toBe("consumed");
    expect(() => machine.transitionTo("consumed")).toThrow(InvalidApprovalStatusTransitionError);
  });

  it("rejects a duplicate or conflicting decision without changing the approved state", () => {
    const machine = new ApprovalStateMachine("approval-1", "pending", { emit() {} });
    machine.transitionTo("approved");

    expect(() => machine.transitionTo("approved")).toThrow(InvalidApprovalStatusTransitionError);
    expect(() => machine.transitionTo("denied")).toThrow(InvalidApprovalStatusTransitionError);
    expect(machine.status).toBe("approved");
  });

  it("commits the new status before synchronously emitting the event", () => {
    let statusObservedBySink: ApprovalStatus | undefined;
    let machine: ApprovalStateMachine;
    machine = new ApprovalStateMachine("approval-1", "pending", {
      emit() {
        statusObservedBySink = machine.status;
      },
    });

    machine.transitionTo("approved");

    expect(statusObservedBySink).toBe("approved");
  });

  it("keeps the committed status when the event sink throws", () => {
    const sinkFailure = new Error("event sink failed");
    const machine = new ApprovalStateMachine("approval-1", "pending", {
      emit() {
        throw sinkFailure;
      },
    });

    expect(() => machine.transitionTo("approved")).toThrow(sinkFailure);
    expect(machine.status).toBe("approved");
  });
});
