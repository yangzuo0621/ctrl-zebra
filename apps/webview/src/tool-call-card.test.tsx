import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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

  it("renders a bounded success summary and truncation marker", () => {
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
});
