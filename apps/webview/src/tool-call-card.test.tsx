import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DisplayApproval } from "./approval-store.js";
import type { DisplayToolCall } from "./chat-store.js";
import { ToolCallCard } from "./tool-call-card.js";

const call = {
  id: "call-1",
  name: "read_file",
  input: { path: "README.md", startLine: 1 },
} as const;

describe("ToolCallCard", () => {
  it("renders the pending state with the tool name and arguments", () => {
    render(<ToolCallCard toolCall={{ call, status: "pending" }} />);

    expect(screen.getByRole("article", { name: "read_file" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "read_file" })).toBeVisible();
    expect(screen.getByLabelText("Tool status")).toHaveTextContent("Pending");
    expect(screen.getByRole("group", { name: "Arguments" })).toHaveTextContent(
      '"path": "README.md"',
    );
  });

  it("renders the running state", () => {
    render(<ToolCallCard toolCall={{ call, status: "running" }} />);

    expect(screen.getByLabelText("Tool status")).toHaveTextContent("Running");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a bounded success summary and truncation marker when expanded", () => {
    const toolCall = {
      call,
      status: "success",
      result: {
        callId: "call-1",
        name: "read_file",
        status: "success",
        output: { content: "hello" },
        truncated: true,
      },
    } as const satisfies DisplayToolCall;

    render(<ToolCallCard toolCall={toolCall} />);

    expect(screen.getByLabelText("Tool status")).toHaveTextContent("Success");
    expect(screen.queryByRole("group", { name: "Result" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    expect(screen.getByRole("group", { name: "Result" })).toHaveTextContent('"content": "hello"');
    expect(screen.getByText("Result truncated.")).toBeVisible();
  });

  it("renders the safe structured error as an alert", () => {
    const toolCall = {
      call,
      status: "error",
      result: {
        callId: "call-1",
        name: "read_file",
        status: "error",
        error: { code: "failed", message: "The file could not be read." },
      },
    } as const satisfies DisplayToolCall;

    render(<ToolCallCard toolCall={toolCall} />);

    expect(screen.getByLabelText("Tool status")).toHaveTextContent("Error");
    expect(screen.getByRole("alert")).toHaveTextContent("The file could not be read.");
    expect(screen.queryByRole("group", { name: "Result" })).not.toBeInTheDocument();
  });

  it("renders awaiting approval state with status badge and embedded risk badge", () => {
    const editCall = {
      id: "call-2",
      name: "propose_file_edit",
      input: { path: "src/index.ts" },
    } as const;

    const approval = {
      requestId: "req-1",
      status: "pending",
      approval: {
        id: "app-1",
        scope: {
          sessionId: "sess-1",
          call: editCall,
          risk: "write",
          workspaceRootUri: "file:///workspace",
          resources: [{ uri: "file:///workspace/src/index.ts" }],
        },
        presentation: {
          title: "Update index.ts",
          summary: "Update file content",
        },
        createdAt: "2026-07-29T00:00:00.000Z",
        expiresAt: "2026-07-29T00:05:00.000Z",
      },
    } as const satisfies DisplayApproval;

    render(<ToolCallCard toolCall={{ call: editCall, status: "pending" }} approval={approval} />);

    expect(screen.getByLabelText("Tool status")).toHaveTextContent("Awaiting Decision");
    expect(screen.getByText("write")).toBeVisible();
  });
});
