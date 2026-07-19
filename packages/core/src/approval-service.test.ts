import type { ApprovalDecision, ApprovalRequest } from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  ApprovalRequestAlreadyPendingError,
  ApprovalRequestNotPendingError,
  CancellableApprovalService,
} from "./approval-service.js";

const request = {
  id: "approval-1",
  scope: {
    sessionId: "session-1",
    call: {
      id: "call-1",
      name: "propose_file_edit",
      input: { uri: "file:///workspace/example.ts" },
    },
    risk: "write",
    workspaceRootUri: "file:///workspace",
    resources: [{ uri: "file:///workspace/example.ts" }],
  },
  presentation: {
    title: "Apply file edit",
    summary: "Update example.ts",
  },
  createdAt: "2026-07-19T00:00:00.000Z",
  expiresAt: "2026-07-19T00:05:00.000Z",
} satisfies ApprovalRequest;

function decision(kind: ApprovalDecision["decision"]): ApprovalDecision {
  return {
    requestId: request.id,
    decision: kind,
    decidedAt: "2026-07-19T00:01:00.000Z",
  };
}

describe("CancellableApprovalService", () => {
  it.each(["approved", "denied"] as const)("settles with an exact %s decision", async (kind) => {
    const emit = vi.fn();
    const service = new CancellableApprovalService({ emit });
    const pendingDecision = service.request(request, new AbortController().signal);
    const expectedDecision = decision(kind);

    service.respond(expectedDecision);

    await expect(pendingDecision).resolves.toBe(expectedDecision);
    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(request);
  });

  it("rejects with the cancellation reason and ignores a later response", async () => {
    const service = new CancellableApprovalService({ emit() {} });
    const controller = new AbortController();
    const cancellation = new Error("cancel approval wait");
    const pendingDecision = service.request(request, controller.signal);

    controller.abort(cancellation);

    await expect(pendingDecision).rejects.toBe(cancellation);
    expect(() => service.respond(decision("approved"))).toThrow(ApprovalRequestNotPendingError);
  });

  it("does not publish a request when the signal is already cancelled", async () => {
    const emit = vi.fn();
    const service = new CancellableApprovalService({ emit });
    const controller = new AbortController();
    const cancellation = new Error("cancelled before request");
    controller.abort(cancellation);

    await expect(service.request(request, controller.signal)).rejects.toBe(cancellation);
    expect(emit).not.toHaveBeenCalled();
  });

  it("allows the trusted owner to expire a pending request", async () => {
    const service = new CancellableApprovalService({ emit() {} });
    const expiration = new Error("approval expired");
    const pendingDecision = service.request(request, new AbortController().signal);

    service.cancel(request.id, expiration);

    await expect(pendingDecision).rejects.toBe(expiration);
    expect(() => service.cancel(request.id, expiration)).toThrow(ApprovalRequestNotPendingError);
  });

  it("rejects duplicate responses without changing the first decision", async () => {
    const service = new CancellableApprovalService({ emit() {} });
    const pendingDecision = service.request(request, new AbortController().signal);
    const approved = decision("approved");

    service.respond(approved);

    expect(() => service.respond(decision("denied"))).toThrow(ApprovalRequestNotPendingError);
    await expect(pendingDecision).resolves.toBe(approved);
  });

  it("rejects a duplicate pending request ID without publishing it", async () => {
    const emit = vi.fn();
    const service = new CancellableApprovalService({ emit });
    const controller = new AbortController();
    const firstDecision = service.request(request, controller.signal);

    await expect(service.request(request, new AbortController().signal)).rejects.toBeInstanceOf(
      ApprovalRequestAlreadyPendingError,
    );
    expect(emit).toHaveBeenCalledOnce();

    controller.abort(new Error("test cleanup"));
    await expect(firstDecision).rejects.toThrow("test cleanup");
  });

  it("cleans up when publishing the request fails", async () => {
    const publishingError = new Error("request sink failed");
    const service = new CancellableApprovalService({
      emit() {
        throw publishingError;
      },
    });

    await expect(service.request(request, new AbortController().signal)).rejects.toBe(
      publishingError,
    );
    expect(() => service.respond(decision("approved"))).toThrow(ApprovalRequestNotPendingError);
  });
});
