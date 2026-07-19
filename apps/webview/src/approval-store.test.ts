import type { ApprovalDecisionIntent, ExtensionToWebviewMessage } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import { createApprovalStore } from "./approval-store.js";
import type { WebviewHost } from "./vscode-api.js";

describe("approval store", () => {
  it("routes one decision for the current pending Approval and blocks duplicates", () => {
    const host = new FakeWebviewHost();
    const store = createApprovalStore(host);
    store.getState().receive(approvalState("pending"));

    expect(store.getState().decide("approved")).toBe(true);
    expect(store.getState().decide("denied")).toBe(false);

    expect(host.actions).toEqual([
      {
        type: "decision",
        requestId: "request-1",
        approvalId: "approval-1",
        decision: "approved",
      },
    ]);
  });

  it("does not send Diff or decision actions for a terminal Approval", () => {
    const host = new FakeWebviewHost();
    const store = createApprovalStore(host);
    store.getState().receive(approvalState("expired"));

    store.getState().showDiff();

    expect(store.getState().decide("approved")).toBe(false);
    expect(host.actions).toEqual([]);
  });
});

class FakeWebviewHost implements WebviewHost {
  readonly actions: unknown[] = [];
  submit(): void {}
  cancel(): void {}
  listSessions(): void {}
  restoreSession(): void {}
  subscribe(): () => void {
    return () => {};
  }
  showApprovalDiff(requestId: string, approvalId: string): void {
    this.actions.push({ type: "show-diff", requestId, approvalId });
  }
  decideApproval(requestId: string, approvalId: string, decision: ApprovalDecisionIntent): void {
    this.actions.push({ type: "decision", requestId, approvalId, decision });
  }
}

function approvalState(status: "pending" | "expired"): ExtensionToWebviewMessage {
  return {
    protocolVersion: 1,
    type: "extension/approval-state",
    requestId: "request-1",
    status,
    approval: {
      id: "approval-1",
      scope: {
        sessionId: "session-1",
        call: { id: "call-1", name: "propose_file_edit", input: {} },
        risk: "write",
        resources: [{ uri: "file:///workspace/example.ts" }],
      },
      presentation: { title: "Edit file", summary: "Edit one file." },
      createdAt: "2026-07-19T00:00:00.000Z",
      expiresAt: "2026-07-19T00:05:00.000Z",
    },
  };
}
