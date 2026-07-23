import type { ApprovalRequest } from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";

import { ApprovalLifecycle, type ApprovalLifecycleRecord } from "./approval-lifecycle.js";

describe("ApprovalLifecycle", () => {
  it("registers one owner, approves it, and permits one consumption", async () => {
    const lifecycle = createLifecycle();
    const record = createRecord("approval-1");
    lifecycle.register(record);

    expect(() => lifecycle.register(createRecord("approval-1"))).toThrow(
      "Approval identifier is already active.",
    );
    const decision = lifecycle.requestDecision(record, new AbortController().signal);
    lifecycle.decide(record.request.id, "approved");

    await expect(decision).resolves.toMatchObject({ decision: "approved" });
    expect(lifecycle.validateConsumption(record, new AbortController().signal)).toBe(true);
    lifecycle.markConsuming(record);
    expect(() => lifecycle.validateConsumption(record, new AbortController().signal)).toThrow(
      "not available",
    );
    expect(() => lifecycle.markConsuming(record)).toThrow("not available");
    lifecycle.finish(record, "consumed");
    expect(lifecycle.get(record.request.id)).toBeUndefined();
    expect(() => lifecycle.validateConsumption(record, new AbortController().signal)).toThrow(
      "not available",
    );
  });

  it("releases denied and already-expired records without allowing consumption", async () => {
    const lifecycle = createLifecycle();
    const denied = createRecord("denied");
    lifecycle.register(denied);
    const deniedDecision = lifecycle.requestDecision(denied, new AbortController().signal);

    lifecycle.decide(denied.request.id, "denied");

    await expect(deniedDecision).resolves.toMatchObject({ decision: "denied" });
    expect(lifecycle.get(denied.request.id)).toBeUndefined();
    expect(() => lifecycle.validateConsumption(denied, new AbortController().signal)).toThrow(
      "not available",
    );

    const expired = createRecord("expired", "2026-07-18T23:59:59.000Z");
    lifecycle.register(expired);
    await expect(lifecycle.requestDecision(expired, new AbortController().signal)).resolves.toEqual(
      {
        requestId: expired.request.id,
        decision: "expired",
      },
    );
    expect(lifecycle.get(expired.request.id)).toBeUndefined();
  });

  it("settles a pending wait when its timer expires", async () => {
    vi.useFakeTimers();
    try {
      const lifecycle = createLifecycle();
      const record = createRecord("approval-1");
      lifecycle.register(record);
      const decision = lifecycle.requestDecision(record, new AbortController().signal);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);

      await expect(decision).resolves.toEqual({
        requestId: record.request.id,
        decision: "expired",
      });
      expect(record.status).toBe("expired");
      expect(lifecycle.get(record.request.id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases cancelled waits and cancels pending waits on dispose", async () => {
    const lifecycle = createLifecycle();
    const cancelled = createRecord("cancelled");
    lifecycle.register(cancelled);
    const controller = new AbortController();
    const cancellation = new Error("cancel approval");
    const cancelledDecision = lifecycle.requestDecision(cancelled, controller.signal);

    controller.abort(cancellation);

    await expect(cancelledDecision).rejects.toBe(cancellation);
    expect(cancelled.status).toBe("cancelled");
    expect(lifecycle.get(cancelled.request.id)).toBeUndefined();

    const disposed = createRecord("disposed");
    lifecycle.register(disposed);
    const disposedDecision = lifecycle.requestDecision(disposed, new AbortController().signal);
    lifecycle.dispose();

    await expect(disposedDecision).rejects.toThrow("Approval workflow disposed.");
    expect(disposed.status).toBe("cancelled");
    expect(lifecycle.get(disposed.request.id)).toBeUndefined();
  });
});

function createLifecycle(): ApprovalLifecycle<ApprovalLifecycleRecord> {
  return new ApprovalLifecycle(() => new Date("2026-07-19T00:00:00.000Z"));
}

function createRecord(id: string, expiresAt = "2026-07-19T00:05:00.000Z"): ApprovalLifecycleRecord {
  return {
    request: { id, expiresAt } as ApprovalRequest,
    status: "pending",
    consuming: false,
  };
}
