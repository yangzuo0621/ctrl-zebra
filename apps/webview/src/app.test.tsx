import { protocolVersion } from "@ctrl-zebra/protocol";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./app.js";
import { strings } from "./strings.js";
import { createWebviewHostFixture } from "./test/support/webview-host.js";

describe("App streaming chat", () => {
  let animationFrames: Array<FrameRequestCallback | undefined>;

  beforeEach(() => {
    animationFrames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (frameId: number) => {
      animationFrames[frameId - 1] = undefined;
    });
  });

  it("lists Agent changes and requests a selected Checkpoint restore", async () => {
    const host = createWebviewHostFixture();
    const ids = ["checkpoint-list-1", "checkpoint-restore-1"];
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => ids.shift() ?? "unexpected"} />);

    await user.click(screen.getByRole("button", { name: "Sessions" }));
    await user.click(screen.getByRole("button", { name: "Refresh changes" }));
    expect(host.sent.at(-1)).toEqual({
      protocolVersion,
      type: "webview/list-checkpoints",
      requestId: "checkpoint-list-1",
    });
    act(() =>
      host.emit({
        protocolVersion,
        type: "extension/checkpoint-list",
        requestId: "checkpoint-list-1",
        checkpoints: [
          {
            id: "checkpoint-1",
            sessionId: "session-1",
            runId: "run-1",
            createdAt: "2026-07-19T10:00:00.000Z",
            files: [
              {
                uri: "file:///workspace/example.ts",
                beforeHash: "a".repeat(64),
                afterHash: "b".repeat(64),
              },
            ],
          },
        ],
      }),
    );

    expect(screen.getByText("file:///workspace/example.ts")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Restore change" }));
    expect(host.sent.at(-1)).toEqual({
      protocolVersion,
      type: "webview/restore-checkpoint",
      requestId: "checkpoint-restore-1",
      checkpointId: "checkpoint-1",
    });
    expect(screen.getByText("Restoring Checkpoint…")).toBeVisible();
    act(() =>
      host.emit({
        protocolVersion,
        type: "extension/checkpoint-restored",
        requestId: "checkpoint-restore-1",
        checkpointId: "checkpoint-1",
      }),
    );
    expect(screen.getByText("Checkpoint restored.")).toBeVisible();
  });

  it("lists saved sessions and restores their messages", async () => {
    const host = createWebviewHostFixture();
    const ids = ["list-1", "restore-1"];
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => ids.shift() ?? "unexpected"} />);

    await user.click(screen.getByRole("button", { name: "Sessions" }));
    expect(screen.getByRole("option", { name: "No saved sessions" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(host.sent.at(-1)).toEqual({
      protocolVersion,
      type: "webview/list-sessions",
      requestId: "list-1",
    });
    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/session-list",
        requestId: "list-1",
        sessions: [
          {
            sessionId: "session-1",
            status: "completed",
            createdAt: "2026-07-19T10:00:00.000Z",
          },
        ],
      });
    });

    expect(screen.getByRole("button", { name: "New chat" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(host.sent.at(-1)).toEqual({
      protocolVersion,
      type: "webview/restore-session",
      requestId: "restore-1",
      sessionId: "session-1",
    });
    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/session-restored",
        requestId: "restore-1",
        session: {
          sessionId: "session-1",
          status: "completed",
          eventLogTailDamaged: false,
          messages: [
            {
              messageId: "message-1",
              sessionId: "session-1",
              createdAt: "2026-07-19T10:00:00.000Z",
              role: "user",
              content: "Saved question",
            },
            {
              messageId: "assistant-2",
              sessionId: "session-1",
              createdAt: "2026-07-19T10:00:01.000Z",
              role: "assistant",
              content: "Saved answer",
            },
          ],
        },
      });
    });

    expect(screen.getByText("Saved question")).toBeVisible();
    expect(screen.getByText("Saved answer")).toBeVisible();
    expect(
      screen.getByRole("listitem", { name: strings.app.assistantMessageLabel }),
    ).toHaveAttribute("data-role", "assistant");
  });

  it("shows the confirmed current Session and carries it into the next submit", async () => {
    const host = createWebviewHostFixture();
    const ids = ["request-1", "request-2"];
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => ids.shift() ?? "unexpected"} />);

    await user.type(screen.getByRole("textbox", { name: "Message" }), "First question.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(host.sent.at(-1)).toEqual({
      protocolVersion,
      type: "webview/submit",
      requestId: "request-1",
      content: "First question.",
    });
    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/session-started",
        requestId: "request-1",
        sessionId: "session-host",
      });
      host.emit({
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-1",
        status: "completed",
      });
    });

    expect(screen.getByText("Current Session: session-host")).toBeVisible();
    expect(screen.getByRole("status", { name: "Session status" })).toHaveTextContent(
      "Current Session confirmed.",
    );

    await user.type(screen.getByRole("textbox", { name: "Message" }), "Follow-up.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(host.sent.at(-1)).toEqual({
      protocolVersion,
      type: "webview/submit",
      requestId: "request-2",
      content: "Follow-up.",
      sessionId: "session-host",
    });
  });

  it("starts a focused New chat and omits the previous Session ID", async () => {
    const host = createWebviewHostFixture();
    const ids = ["request-1", "new-chat-1", "request-2"];
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => ids.shift() ?? "unexpected"} />);

    await user.type(screen.getByRole("textbox", { name: "Message" }), "Old question.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/session-started",
        requestId: "request-1",
        sessionId: "session-old",
      });
      host.emit({
        protocolVersion,
        type: "extension/text-delta",
        requestId: "request-1",
        text: "Old answer.",
      });
      animationFrames[0]?.(0);
      host.emit({
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-1",
        status: "completed",
      });
    });
    expect(screen.getByText("Old answer.")).toBeVisible();

    await user.type(screen.getByRole("textbox", { name: "Message" }), "Stale draft");
    await user.click(screen.getByRole("button", { name: "New chat" }));
    expect(host.sent.at(-1)).toEqual({
      protocolVersion,
      type: "webview/new-chat",
      requestId: "new-chat-1",
    });
    expect(screen.queryByText("Old answer.")).not.toBeInTheDocument();
    expect(screen.getByText("Current Session: New chat")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveFocus();

    await user.type(screen.getByRole("textbox", { name: "Message" }), "New question.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(host.sent.at(-1)).toEqual({
      protocolVersion,
      type: "webview/submit",
      requestId: "request-2",
      content: "New question.",
    });
  });

  it("shows an interrupted recovery without starting a run", async () => {
    const host = createWebviewHostFixture();
    const ids = ["list-interrupted", "restore-interrupted"];
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => ids.shift() ?? "unexpected"} />);
    await user.click(screen.getByRole("button", { name: "Sessions" }));
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    act(() =>
      host.emit({
        protocolVersion,
        type: "extension/session-list",
        requestId: "list-interrupted",
        sessions: [
          {
            sessionId: "session-interrupted",
            status: "interrupted",
            createdAt: "2026-07-19T10:00:00.000Z",
          },
        ],
      }),
    );
    await user.click(screen.getByRole("button", { name: "Restore" }));
    act(() =>
      host.emit({
        protocolVersion,
        type: "extension/session-restored",
        requestId: "restore-interrupted",
        session: {
          sessionId: "session-interrupted",
          status: "interrupted",
          messages: [],
          eventLogTailDamaged: false,
        },
      }),
    );

    expect(screen.getByRole("status", { name: "Run status" })).toHaveTextContent(
      "Session was interrupted by a restart.",
    );
    expect(host.sent.some(({ type }) => type === "webview/submit")).toBe(false);
  });

  it("submits user content and renders a correlated pending response", async () => {
    const host = createWebviewHostFixture();
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => "request-1"} />);

    await user.type(screen.getByRole("textbox", { name: "Message" }), "Say hello.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(host.sent).toEqual([
      {
        protocolVersion,
        type: "webview/submit",
        requestId: "request-1",
        content: "Say hello.",
      },
    ]);
    expect(screen.getByText("Say hello.")).toBeVisible();
    expect(screen.getByText("Waiting for response…")).toBeVisible();
    expect(screen.getByRole("status", { name: "Run status" })).toHaveTextContent(
      "Preparing response…",
    );
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
  });

  it("edits a completed user message and sends the target-bound replacement", async () => {
    const host = createWebviewHostFixture();
    const ids = ["request-1", "request-edit"];
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => ids.shift() ?? "unexpected"} />);

    await user.type(screen.getByRole("textbox", { name: "Message" }), "Original question");
    await user.click(screen.getByRole("button", { name: "Send" }));
    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/session-started",
        requestId: "request-1",
        sessionId: "session-1",
      });
      host.emit({
        protocolVersion,
        type: "extension/text-delta",
        requestId: "request-1",
        text: "Original answer",
      });
      animationFrames[0]?.(0);
      host.emit({
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-1",
        status: "completed",
      });
    });

    await user.click(screen.getByRole("button", { name: strings.chat.editScope }));
    const editor = screen.getByRole("textbox", { name: "Edit message" });
    await user.clear(editor);
    await user.type(editor, "Edited question");
    await user.click(screen.getByRole("button", { name: "Send edited message" }));
    expect(host.sent.at(-1)).toEqual({
      protocolVersion,
      type: "webview/edit-message",
      requestId: "request-edit",
      sessionId: "session-1",
      messageId: "request-1:user",
      content: "Edited question",
    });
    expect(screen.getByText("Original answer")).toBeVisible();

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/text-delta",
        requestId: "request-edit",
        text: "Edited answer",
      });
      animationFrames[1]?.(0);
    });
    expect(screen.getByText("Edited question")).toBeVisible();
    expect(screen.getByText("Edited answer")).toBeVisible();
    expect(screen.queryByText("Original answer")).not.toBeInTheDocument();
  });

  it("batches ordered deltas and flushes the final response on completion", async () => {
    const host = createWebviewHostFixture();
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => "request-1"} />);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Say hello.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-1",
        status: "streaming",
      });
      host.emit({
        protocolVersion,
        type: "extension/text-delta",
        requestId: "request-1",
        text: "Hel",
      });
      host.emit({
        protocolVersion,
        type: "extension/text-delta",
        requestId: "request-1",
        text: "lo",
      });
    });

    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
    act(() => animationFrames[0]?.(0));
    expect(screen.getByText("Hello")).toBeVisible();

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/text-delta",
        requestId: "request-1",
        text: "!",
      });
      host.emit({
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-1",
        status: "completed",
      });
    });

    expect(screen.getByText("Hello!")).toBeVisible();
    expect(screen.getByRole("status", { name: "Run status" })).toHaveTextContent(
      "Response complete.",
    );
    expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled();
  });

  it("shows a partial answer and an explicit prompt when the response is truncated", async () => {
    const host = createWebviewHostFixture();
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => "request-truncated"} />);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Keep answering.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-truncated",
        status: "streaming",
      });
      host.emit({
        protocolVersion,
        type: "extension/text-delta",
        requestId: "request-truncated",
        text: "Partial answer",
      });
      host.emit({
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-truncated",
        status: "truncated",
      });
    });

    expect(screen.getByText("Partial answer")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The response was truncated before completion. Ask a follow-up to continue.",
    );
    expect(screen.getByRole("status", { name: "Run status" })).toHaveTextContent(
      "Response truncated.",
    );
    expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled();
  });

  it.each([
    ["authentication", "Check the selected provider and saved API key."],
    ["network", "Check your connection and try again."],
    ["rate-limit", "Wait a moment, then try again."],
    ["context", "Start a new chat or shorten the request."],
    ["tool", "Review the tool results and try again."],
    ["internal", "Try again or reload the window if it continues."],
  ] as const)("renders the %s run error prompt as an alert", async (code, message) => {
    const host = createWebviewHostFixture();
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => "request-error"} />);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Hello.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/run-error",
        requestId: "request-error",
        code,
        message,
      });
      host.emit({
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-error",
        status: "failed",
      });
    });

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("status", { name: "Run status" })).toHaveTextContent(
      "Response failed.",
    );
  });

  it("clears a previous run error when a new run begins", async () => {
    const host = createWebviewHostFixture();
    const ids = ["request-1", "request-2"];
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => ids.shift() ?? "unexpected"} />);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "First.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/run-error",
        requestId: "request-1",
        code: "internal",
        message: "Safe internal guidance.",
      });
      host.emit({
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-1",
        status: "failed",
      });
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Safe internal guidance.");

    await user.type(screen.getByRole("textbox", { name: "Message" }), "Second.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends cancellation and ignores every later delta", async () => {
    const host = createWebviewHostFixture();
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => "request-1"} />);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Keep going.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/text-delta",
        requestId: "request-1",
        text: "```ts\nconst before = 1;",
      });
      animationFrames[0]?.(0);
    });
    const assistantMessage = screen.getByRole("listitem", {
      name: strings.app.assistantMessageLabel,
    });
    const projectionBeforeCancel = assistantMessage.textContent;
    expect(screen.getByText("const before = 1;")).toBeVisible();
    expect(screen.getByRole("button", { name: strings.markdown.copy })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(host.sent.at(-1)).toEqual({
      protocolVersion,
      type: "webview/cancel",
      requestId: "request-1",
    });

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-1",
        status: "cancelled",
      });
      host.emit({
        protocolVersion,
        type: "extension/text-delta",
        requestId: "request-1",
        text: "\n```\n# late delta",
      });
    });

    expect(assistantMessage.textContent).toBe(projectionBeforeCancel);
    expect(screen.getByText("const before = 1;")).toBeVisible();
    expect(screen.queryByText("late delta")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Run status" })).toHaveTextContent(
      "Response cancelled.",
    );
  });

  it("updates one Tool Call card through pending, running, and success", async () => {
    const host = createWebviewHostFixture();
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => "request-tool"} />);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Read the file.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    const call = {
      id: "call-1",
      name: "read_file",
      input: { path: "README.md" },
    } as const;

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-tool",
        status: "streaming",
      });
      host.emit({
        protocolVersion,
        type: "extension/tool-state",
        requestId: "request-tool",
        call,
        source: { kind: "builtin" },
        status: "pending",
      });
    });

    expect(
      screen.getAllByRole("article", { name: `${strings.tool.cardLabel}: read_file` }),
    ).toHaveLength(1);
    expect(screen.getByLabelText("Tool status")).toHaveTextContent("Pending");

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/tool-state",
        requestId: "request-tool",
        call,
        source: { kind: "builtin" },
        status: "running",
      });
    });

    expect(
      screen.getAllByRole("article", { name: `${strings.tool.cardLabel}: read_file` }),
    ).toHaveLength(1);
    expect(screen.getByLabelText("Tool status")).toHaveTextContent("Running");

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/tool-state",
        requestId: "request-tool",
        call,
        source: { kind: "builtin" },
        status: "success",
        result: {
          callId: "call-1",
          name: "read_file",
          status: "success",
          output: { content: "Hello" },
          truncated: false,
        },
      });
    });

    expect(
      screen.getAllByRole("article", { name: `${strings.tool.cardLabel}: read_file` }),
    ).toHaveLength(1);
    expect(screen.getByLabelText("Tool status")).toHaveTextContent("Success");
    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByRole("group", { name: "Result" })).toHaveTextContent("Hello");
  });

  it("renders a pending Approval and sends only its identifier and user intent", async () => {
    const host = createWebviewHostFixture();
    const user = userEvent.setup();
    render(<App host={host} />);

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/approval-state",
        requestId: "request-approval",
        status: "pending",
        approval: {
          id: "approval-1",
          scope: {
            sessionId: "session-1",
            call: { id: "call-1", name: "propose_file_edit", input: {} },
            risk: "write",
            resources: [{ uri: "file:///workspace/example.ts" }],
          },
          presentation: { title: "Update example.ts", summary: "Replace one line." },
          createdAt: "2026-07-19T00:00:00.000Z",
          expiresAt: "2026-07-19T00:05:00.000Z",
        },
      });
    });

    await user.click(screen.getByRole("button", { name: "View Diff" }));
    await user.click(screen.getByRole("button", { name: "Reject" }));

    expect(host.sent).toEqual([
      {
        protocolVersion,
        type: "webview/show-approval-diff",
        requestId: "request-approval",
        approvalId: "approval-1",
      },
      {
        protocolVersion,
        type: "webview/approval-decision",
        requestId: "request-approval",
        approvalId: "approval-1",
        decision: "denied",
      },
    ]);
    expect(screen.getByText("Submitting rejection…")).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("terminates the active command through the correlated Run cancellation", async () => {
    const host = createWebviewHostFixture();
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => "request-command"} />);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Run the check.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    const call = {
      id: "call-command",
      name: "run_command",
      input: { command: "node", args: ["check.mjs"], cwd: ".", timeoutMs: 30_000 },
    } as const;

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-command",
        status: "streaming",
      });
      host.emit({
        protocolVersion,
        type: "extension/tool-state",
        requestId: "request-command",
        call,
        source: { kind: "builtin" },
        status: "running",
      });
    });

    await user.click(screen.getByRole("button", { name: "Terminate command" }));

    expect(host.sent).toEqual([
      {
        protocolVersion,
        type: "webview/submit",
        requestId: "request-command",
        content: "Run the check.",
      },
      {
        protocolVersion,
        type: "webview/cancel",
        requestId: "request-command",
      },
    ]);

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-command",
        status: "cancelled",
      });
    });

    expect(screen.getByLabelText("Command status")).toHaveTextContent("Terminated");
    expect(screen.getByRole("status", { name: "Command status" })).toBeVisible();
  });

  it("renders reasoning beside answer and Tool state without reopening a collapsed block", async () => {
    const host = createWebviewHostFixture();
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => "request-reasoning"} />);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Inspect this.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-reasoning",
        status: "streaming",
      });
      host.emit({
        protocolVersion,
        type: "extension/reasoning-start",
        requestId: "request-reasoning",
        blockId: "reasoning-1",
      });
      host.emit({
        protocolVersion,
        type: "extension/reasoning-delta",
        requestId: "request-reasoning",
        blockId: "reasoning-1",
        text: "Inspect contracts.",
      });
      host.emit({
        protocolVersion,
        type: "extension/text-delta",
        requestId: "request-reasoning",
        text: "Final answer.",
      });
      host.emit({
        protocolVersion,
        type: "extension/tool-state",
        requestId: "request-reasoning",
        call: { id: "call-1", name: "read_file", input: { path: "README.md" } },
        source: { kind: "builtin" },
        status: "pending",
      });
      animationFrames[0]?.(0);
    });

    expect(screen.getByRole("region", { name: strings.reasoning.regionLabel })).toBeVisible();
    expect(screen.getByText("Inspect contracts.")).toBeVisible();
    expect(screen.getByText("Final answer.")).toBeVisible();
    expect(
      screen.getByRole("article", { name: `${strings.tool.cardLabel}: read_file` }),
    ).toBeVisible();
    expect(
      screen.getByRole("status", { name: strings.app.reasoningStatusLabel }),
    ).toHaveTextContent(strings.reasoning.started);

    const disclosure = screen.getByRole("button", { name: strings.reasoning.toggle(true) });
    await user.click(disclosure);
    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/reasoning-delta",
        requestId: "request-reasoning",
        blockId: "reasoning-1",
        text: " Continue.",
      });
      animationFrames[1]?.(0);
    });

    expect(screen.getByRole("button", { name: strings.reasoning.toggle(false) })).toHaveFocus();
    expect(screen.queryByText("Inspect contracts. Continue.")).not.toBeInTheDocument();
  });

  it("does not render reasoning UI when the Provider sends no retained summary", async () => {
    const host = createWebviewHostFixture();
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => "request-no-reasoning"} />);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Answer normally.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/text-delta",
        requestId: "request-no-reasoning",
        text: "Normal answer.",
      });
      animationFrames[0]?.(0);
    });

    expect(screen.getByText("Normal answer.")).toBeVisible();
    expect(
      screen.queryByRole("region", { name: strings.reasoning.regionLabel }),
    ).not.toBeInTheDocument();
  });

  it("restores a completed reasoning summary collapsed without a live announcement", async () => {
    const host = createWebviewHostFixture();
    const ids = ["list-reasoning", "restore-reasoning"];
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => ids.shift() ?? "unexpected"} />);
    await user.click(screen.getByRole("button", { name: "Sessions" }));
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    act(() =>
      host.emit({
        protocolVersion,
        type: "extension/session-list",
        requestId: "list-reasoning",
        sessions: [
          {
            sessionId: "session-reasoning",
            status: "completed",
            createdAt: "2026-07-31T00:00:00.000Z",
          },
        ],
      }),
    );
    await user.click(screen.getByRole("button", { name: "Restore" }));
    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/reasoning-restored",
        requestId: "restore-reasoning",
        sessionId: "session-reasoning",
        blocks: [
          {
            blockId: "reasoning-restored",
            startSequence: 2,
            endSequence: 4,
            content: "Recovered summary",
            state: "complete",
            truncated: false,
          },
        ],
        runTruncated: false,
      });
      host.emit({
        protocolVersion,
        type: "extension/session-restored",
        requestId: "restore-reasoning",
        session: {
          sessionId: "session-reasoning",
          status: "completed",
          eventLogTailDamaged: false,
          messages: [
            {
              messageId: "assistant-restored",
              sessionId: "session-reasoning",
              createdAt: "2026-07-31T00:00:01.000Z",
              role: "assistant",
              content: "Recovered answer",
            },
          ],
        },
      });
    });

    expect(screen.getByRole("button", { name: strings.reasoning.toggle(false) })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("Recovered summary")).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: strings.app.reasoningStatusLabel }),
    ).toBeEmptyDOMElement();
  });

  it("populates composer draft when selecting an onboarding sample prompt (T1104)", async () => {
    const host = createWebviewHostFixture();
    const user = userEvent.setup();
    render(<App host={host} />);

    expect(screen.getByRole("heading", { name: "Welcome to CtrlZebra" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Explain workspace structure" }));

    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
      "Explain workspace structure",
    );
  });

  it("submits message on Enter key without Shift and renders code blocks safely (T1105)", async () => {
    const host = createWebviewHostFixture();
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => "request-enter"} />);

    const input = screen.getByRole("textbox", { name: "Message" });
    await user.type(input, "Generate code{Enter}");

    expect(host.sent).toEqual([
      {
        protocolVersion,
        type: "webview/submit",
        requestId: "request-enter",
        content: "Generate code",
      },
    ]);

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/text-delta",
        requestId: "request-enter",
        text: "Here is code:\n```ts\nconst x = 42;\n```",
      });
      animationFrames[0]?.(0);
    });

    expect(screen.getByText("const x = 42;")).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy" })).toBeVisible();
  });

  it("blocks a form submit while an editor-context Refresh is pending", async () => {
    const host = createWebviewHostFixture();
    const user = userEvent.setup();
    render(<App host={host} createRequestId={ids(["editor-refresh", "submit"])} />);
    act(() =>
      host.emit({
        protocolVersion,
        type: "extension/editor-context",
        requestId: "editor-ready",
        viewGeneration: 1,
        sessionGeneration: 0,
        eventSequence: 1,
        status: "ready",
        cardGeneration: 1,
        captureId: "capture-1",
        contextId: "context-1",
        scope: "selection",
        context: {
          source: {
            uri: { scheme: "file", authority: "", path: "src/index.ts" },
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            languageId: "typescript",
            documentVersion: 1,
            stale: false,
            truncated: false,
          },
          text: "const",
        },
      }),
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: strings.editorContext.refresh }));
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    const form = screen.getByRole("textbox", { name: "Message" }).closest("form");
    expect(form).not.toBeNull();
    if (form !== null) fireEvent.submit(form);
    expect(host.sent.some((message) => message.type === "webview/submit")).toBe(false);
  });
});

function ids(values: readonly string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `id-${index}`;
}
