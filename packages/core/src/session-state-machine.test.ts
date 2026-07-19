import type { SessionStatus } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import {
  InvalidSessionStatusTransitionError,
  SessionStateMachine,
  type SessionStatusChangedEvent,
} from "./index.js";

const statuses = [
  "idle",
  "preparing",
  "streaming",
  "awaiting_approval",
  "executing_tool",
  "completed",
  "cancelled",
  "failed",
  "interrupted",
] as const satisfies readonly SessionStatus[];

const legalTransitionKeys = new Set([
  "idle:preparing",
  "preparing:streaming",
  "preparing:cancelled",
  "preparing:failed",
  "streaming:awaiting_approval",
  "streaming:executing_tool",
  "streaming:completed",
  "streaming:cancelled",
  "streaming:failed",
  "awaiting_approval:streaming",
  "awaiting_approval:executing_tool",
  "awaiting_approval:cancelled",
  "awaiting_approval:failed",
  "executing_tool:streaming",
  "executing_tool:cancelled",
  "executing_tool:failed",
]);

const transitionCases = statuses.flatMap((previousStatus) =>
  statuses.map(
    (status) =>
      [previousStatus, status, legalTransitionKeys.has(`${previousStatus}:${status}`)] as const,
  ),
);

describe("SessionStateMachine", () => {
  it.each(
    transitionCases,
  )("enforces the transition from %s to %s", (previousStatus, status, isLegal) => {
    const events: SessionStatusChangedEvent[] = [];
    const machine = new SessionStateMachine("session-1", previousStatus, {
      emit(event) {
        events.push(event);
      },
    });

    if (isLegal) {
      machine.transitionTo(status);

      expect(machine.status).toBe(status);
      expect(events).toEqual([
        {
          type: "session.status-changed",
          sessionId: "session-1",
          previousStatus,
          status,
        },
      ]);
      return;
    }

    expect(() => machine.transitionTo(status)).toThrow(InvalidSessionStatusTransitionError);
    expect(machine.status).toBe(previousStatus);
    expect(events).toEqual([]);
  });

  it("commits the new status before synchronously emitting the event", () => {
    let statusObservedBySink: SessionStatus | undefined;
    let machine: SessionStateMachine;
    machine = new SessionStateMachine("session-1", "idle", {
      emit() {
        statusObservedBySink = machine.status;
      },
    });

    machine.transitionTo("preparing");

    expect(statusObservedBySink).toBe("preparing");
  });

  it("keeps the committed status when the event sink throws", () => {
    const sinkFailure = new Error("event sink failed");
    const machine = new SessionStateMachine("session-1", "idle", {
      emit() {
        throw sinkFailure;
      },
    });

    expect(() => machine.transitionTo("preparing")).toThrow(sinkFailure);
    expect(machine.status).toBe("preparing");
  });
});
