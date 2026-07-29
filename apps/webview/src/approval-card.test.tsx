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
      "workspace/src/example.ts",
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

  it("shows an exact command approval without offering a file diff", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(
      <ApprovalCard
        item={{
          ...approval,
          approval: {
            ...approval.approval,
            scope: {
              sessionId: "session-1",
              call: {
                id: "call-command",
                name: "run_command",
                input: {
                  command: "node",
                  args: ["scripts/check.mjs", "--safe value"],
                  cwd: ".",
                  timeoutMs: 30_000,
                },
              },
              risk: "execute",
              workspaceRootUri: "file:///workspace",
              resources: [{ uri: "file:///workspace" }],
            },
            presentation: {
              title: "Run command",
              summary:
                'Executable: "node"\nArguments: ["scripts/check.mjs","--safe value"]\nWorking directory: file:///workspace\nTimeout: 30000 ms',
            },
          },
        }}
        onViewDiff={() => {}}
        onApprove={onApprove}
        onReject={() => {}}
      />,
    );

    expect(screen.getByText("Command approval")).toBeVisible();
    expect(screen.getByText(/Executable: "node"/)).toHaveTextContent(
      "Working directory: workspace",
    );
    expect(screen.queryByRole("button", { name: "View Diff" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it("renders cancelled as terminal and disables every action", () => {
    renderCard("cancelled");

    expect(screen.getByRole("status")).toHaveTextContent("Approval cancelled.");
    expect(screen.getByRole("button", { name: "View Diff" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("renders expired as terminal and disables every action", () => {
    renderCard("expired");

    expect(screen.getByRole("status")).toHaveTextContent("Approval expired.");
    expect(screen.getByRole("button", { name: "View Diff" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("shows explicit risk badge for write risk in embedded mode", () => {
    render(
      <ApprovalCard
        embedded
        item={{ ...approval, status: "pending" }}
        onViewDiff={() => {}}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    );

    expect(screen.getByText("write")).toBeVisible();
  });

  it("shows explicit risk badge for execute risk in embedded mode", () => {
    render(
      <ApprovalCard
        embedded
        item={{
          ...approval,
          status: "pending",
          approval: {
            ...approval.approval,
            scope: {
              ...approval.approval.scope,
              call: {
                id: "call-command",
                name: "run_command",
                input: { command: "npm test" },
              },
              risk: "execute",
            },
          },
        }}
        onViewDiff={() => {}}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    );

    expect(screen.getByText("execute")).toBeVisible();
  });
});

function renderCard(
  status: ApprovalStatus,
  callbacks?: {
    onViewDiff?: () => void;
    onApprove?: () => void;
    onReject?: () => void;
  },
) {
  render(
    <ApprovalCard
      item={{ ...approval, status }}
      onViewDiff={callbacks?.onViewDiff ?? (() => {})}
      onApprove={callbacks?.onApprove ?? (() => {})}
      onReject={callbacks?.onReject ?? (() => {})}
    />,
  );
}
