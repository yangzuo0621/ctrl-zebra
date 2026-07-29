import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DisplayApproval } from "./approval-store.js";
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
    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByRole("group", { name: "Standard output" })).toHaveTextContent("checked");
    expect(screen.getByRole("group", { name: "Standard error" })).toHaveTextContent("warning");
    expect(screen.getByLabelText("Command exit")).toHaveTextContent("Exit code0");
    expect(screen.getByText("Command output truncated.")).toBeVisible();
  });

  it("shows a signal exit and empty output explicitly", async () => {
    const user = userEvent.setup();
    render(
      <CommandToolCard
        toolCall={success({ exitCode: null, signal: "SIGTERM", stdout: "", stderr: "" })}
        runStatus="streaming"
        onTerminate={() => {}}
      />,
    );

    expect(screen.getByLabelText("Command status")).toHaveTextContent("Exited (SIGTERM)");
    await user.click(screen.getByRole("button", { name: "Details" }));
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
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Command execution was cancelled before it completed.",
    );
  });

  it("renders awaiting approval state with status badge and embedded execute risk badge", () => {
    const approval = {
      requestId: "req-cmd-1",
      status: "pending",
      approval: {
        id: "app-cmd-1",
        scope: {
          sessionId: "sess-1",
          call,
          risk: "execute",
          workspaceRootUri: "file:///workspace",
          resources: [{ uri: "file:///workspace" }],
        },
        presentation: {
          title: "Run command",
          summary: "Run npm test",
        },
        createdAt: "2026-07-29T00:00:00.000Z",
        expiresAt: "2026-07-29T00:05:00.000Z",
      },
    } as const satisfies DisplayApproval;

    render(
      <CommandToolCard
        toolCall={{ call, status: "pending" }}
        runStatus="idle"
        approval={approval}
        onTerminate={() => {}}
      />,
    );

    expect(screen.getByLabelText("Command status")).toHaveTextContent("Awaiting Decision");
    expect(screen.getByText("execute")).toBeVisible();
  });
});

function success(
  output: { exitCode: number | null; signal: string | null; stdout?: string; stderr?: string },
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
        stdout: output.stdout ?? "checked",
        stderr: output.stderr ?? "warning",
        exitCode: output.exitCode,
        signal: output.signal,
      },
      truncated,
    },
  };
}
