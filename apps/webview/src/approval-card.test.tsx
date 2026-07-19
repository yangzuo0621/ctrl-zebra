import type { ApprovalStatus } from "@ctrl-zebra/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApprovalCard } from "./approval-card.js";
import type { DisplayApproval } from "./approval-store.js";

const approval = {
  requestId: "request-1",
  status: "pending",
  approval: {
    id: "approval-1",
    scope: {
      sessionId: "session-1",
      call: {
        id: "call-1",
        name: "propose_file_edit",
        input: { path: "src/example.ts", edits: [] },
      },
      risk: "write",
      workspaceRootUri: "file:///workspace",
      resources: [
        {
          uri: "file:///workspace/src/example.ts",
          revision: { kind: "document_version", value: 7 },
        },
      ],
    },
    presentation: {
      title: "Update example.ts",
      summary: "Replace one line in example.ts.",
    },
    createdAt: "2026-07-19T00:00:00.000Z",
    expiresAt: "2026-07-19T00:05:00.000Z",
  },
} as const satisfies DisplayApproval;

describe("ApprovalCard", () => {
  it("shows the exact operation and supports View Diff and Approve", async () => {
    const user = userEvent.setup();
    const onViewDiff = vi.fn();
    const onApprove = vi.fn();
    renderCard("pending", { onViewDiff, onApprove });

    expect(screen.getByRole("article", { name: "Update example.ts" })).toHaveTextContent(
      "file:///workspace/src/example.ts",
    );
    expect(screen.getByText("Replace one line in example.ts.")).toBeVisible();
    expect(screen.getByText("write")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "View Diff" }));
    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(onViewDiff).toHaveBeenCalledOnce();
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it("supports rejecting a pending operation", async () => {
    const user = userEvent.setup();
    const onReject = vi.fn();
    renderCard("pending", { onReject });

    await user.click(screen.getByRole("button", { name: "Reject" }));

    expect(onReject).toHaveBeenCalledOnce();
  });

  it.each([
    ["cancelled", "Approval cancelled."],
    ["expired", "Approval expired."],
  ] as const)("renders %s as terminal and disables every action", (status, text) => {
    renderCard(status);

    expect(screen.getByRole("status")).toHaveTextContent(text);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });
});

function renderCard(
  status: ApprovalStatus,
  callbacks: {
    readonly onViewDiff?: () => void;
    readonly onApprove?: () => void;
    readonly onReject?: () => void;
  } = {},
) {
  render(
    <ApprovalCard
      item={{ ...approval, status }}
      onViewDiff={callbacks.onViewDiff ?? (() => {})}
      onApprove={callbacks.onApprove ?? (() => {})}
      onReject={callbacks.onReject ?? (() => {})}
    />,
  );
}
