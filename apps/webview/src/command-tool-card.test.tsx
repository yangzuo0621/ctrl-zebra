import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DisplayToolCall } from "./chat-store.js";
import { CommandToolCard } from "./command-tool-card.js";

const call = {
  id: "call-command",
  name: "run_command",
  input: {
    command: "node",
    args: ["scripts/check.mjs", "--safe value"],
    cwd: ".",
    timeoutMs: 30_000,
  },
} as const;

describe("CommandToolCard", () => {
  it("covers pending, running, termination, and successful exit states", async () => {
    const user = userEvent.setup();
    const onTerminate = vi.fn();
    const view = render(
      <CommandToolCard
        toolCall={{ call, status: "pending" }}
        runStatus="streaming"
        onTerminate={onTerminate}
      />,
    );

    expect(screen.getByRole("article", { name: "run_command" })).toBeVisible();
    expect(screen.getByLabelText("Command status")).toHaveTextContent("Pending");
    expect(screen.getByRole("group", { name: "Command request" })).toHaveTextContent(
      '"command": "node"',
    );
    expect(screen.queryByRole("button", { name: "Terminate command" })).not.toBeInTheDocument();

    view.rerender(
      <CommandToolCard
        toolCall={{ call, status: "running" }}
        runStatus="streaming"
        onTerminate={onTerminate}
      />,
    );

    expect(screen.getByLabelText("Command status")).toHaveTextContent("Running");
    const terminate = screen.getByRole("button", { name: "Terminate command" });
    await user.click(terminate);
    await user.click(terminate);

    expect(onTerminate).toHaveBeenCalledOnce();
    expect(terminate).toBeDisabled();
    expect(screen.getByLabelText("Command status")).toHaveTextContent("Terminating…");

    view.rerender(
      <CommandToolCard
        toolCall={success({ exitCode: 0, signal: null }, true)}
        runStatus="streaming"
        onTerminate={onTerminate}
      />,
    );

    expect(screen.getByLabelText("Command status")).toHaveTextContent("Exited (0)");
    expect(screen.getByRole("group", { name: "Standard output" })).toHaveTextContent("checked");
    expect(screen.getByRole("group", { name: "Standard error" })).toHaveTextContent("warning");
    expect(screen.getByLabelText("Command exit")).toHaveTextContent("Exit code0");
    expect(screen.getByText("Command output truncated.")).toBeVisible();
  });

  it("shows a signal exit and empty output explicitly", () => {
    render(
      <CommandToolCard
        toolCall={success({ exitCode: null, signal: "SIGTERM" })}
        runStatus="streaming"
        onTerminate={() => {}}
      />,
    );

    expect(screen.getByLabelText("Command status")).toHaveTextContent("Exited (SIGTERM)");
    expect(screen.getByRole("group", { name: "Standard output" })).toHaveTextContent("No stdout.");
    expect(screen.getByRole("group", { name: "Standard error" })).toHaveTextContent("No stderr.");
    expect(screen.getByLabelText("Command exit")).toHaveTextContent("SignalSIGTERM");
  });

  it("renders a safe failure and a cancelled active command as distinct outcomes", () => {
    const view = render(
      <CommandToolCard
        toolCall={{
          call,
          status: "error",
          result: {
            callId: call.id,
            name: call.name,
            status: "error",
            error: { code: "failed", message: "The command exceeded its timeout." },
          },
        }}
        runStatus="failed"
        onTerminate={() => {}}
      />,
    );

    expect(screen.getByLabelText("Command status")).toHaveTextContent("Failed");
    expect(screen.getByRole("alert")).toHaveTextContent("exceeded its timeout");

    view.rerender(
      <CommandToolCard
        toolCall={{ call, status: "running" }}
        runStatus="cancelled"
        onTerminate={() => {}}
      />,
    );

    expect(screen.getByLabelText("Command status")).toHaveTextContent("Terminated");
    expect(screen.getByRole("button", { name: "Terminate command" })).toBeDisabled();
  });

  it("rejects an unexpected success output at the UI boundary", () => {
    render(
      <CommandToolCard
        toolCall={{
          call,
          status: "success",
          result: {
            callId: call.id,
            name: call.name,
            status: "success",
            output: { stdout: "private", exitCode: 0 },
            truncated: false,
          },
        }}
        runStatus="streaming"
        onTerminate={() => {}}
      />,
    );

    expect(screen.getByLabelText("Command status")).toHaveTextContent("Invalid result");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Command output could not be displayed safely.",
    );
  });
});

function success(
  exit: { readonly exitCode: number | null; readonly signal: string | null },
  truncated = false,
): DisplayToolCall {
  return {
    call,
    status: "success",
    result: {
      callId: call.id,
      name: call.name,
      status: "success",
      output: {
        stdout: exit.exitCode === null ? "" : "checked\n",
        stderr: exit.exitCode === null ? "" : "warning\n",
        exitCode: exit.exitCode,
        signal: exit.signal,
      },
      truncated,
    },
  };
}
