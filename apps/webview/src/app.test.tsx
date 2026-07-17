import {
  type ExtensionToWebviewMessage,
  protocolVersion,
  type WebviewToExtensionMessage,
} from "@ctrl-zebra/protocol";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./app.js";
import type { WebviewHost } from "./vscode-api.js";

class FakeWebviewHost implements WebviewHost {
  readonly sent: WebviewToExtensionMessage[] = [];
  readonly listeners = new Set<(message: ExtensionToWebviewMessage) => void>();

  submit(requestId: string, content: string): void {
    this.sent.push({ protocolVersion, type: "webview/submit", requestId, content });
  }

  cancel(requestId: string): void {
    this.sent.push({ protocolVersion, type: "webview/cancel", requestId });
  }

  subscribe(listener: (message: ExtensionToWebviewMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(message: ExtensionToWebviewMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}

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

  it("submits user content and renders a correlated pending response", async () => {
    const host = new FakeWebviewHost();
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
    expect(screen.getByRole("status")).toHaveTextContent("Preparing response…");
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
  });

  it("batches ordered deltas and flushes the final response on completion", async () => {
    const host = new FakeWebviewHost();
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
    expect(screen.getByRole("status")).toHaveTextContent("Response complete.");
    expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled();
  });

  it("sends cancellation and ignores every later delta", async () => {
    const host = new FakeWebviewHost();
    const user = userEvent.setup();
    render(<App host={host} createRequestId={() => "request-1"} />);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Keep going.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/text-delta",
        requestId: "request-1",
        text: "Before",
      });
      animationFrames[0]?.(0);
    });
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
        text: " after",
      });
    });

    expect(screen.getByText("Before")).toBeVisible();
    expect(screen.queryByText("Before after")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Response cancelled.");
  });

  it("updates one Tool Call card through pending, running, and success", async () => {
    const host = new FakeWebviewHost();
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
        status: "pending",
      });
    });

    expect(screen.getAllByRole("article", { name: "read_file" })).toHaveLength(1);
    expect(screen.getByLabelText("Tool status")).toHaveTextContent("Pending");

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/tool-state",
        requestId: "request-tool",
        call,
        status: "running",
      });
    });

    expect(screen.getAllByRole("article", { name: "read_file" })).toHaveLength(1);
    expect(screen.getByLabelText("Tool status")).toHaveTextContent("Running");

    act(() => {
      host.emit({
        protocolVersion,
        type: "extension/tool-state",
        requestId: "request-tool",
        call,
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

    expect(screen.getAllByRole("article", { name: "read_file" })).toHaveLength(1);
    expect(screen.getByLabelText("Tool status")).toHaveTextContent("Success");
    expect(screen.getByRole("group", { name: "Result" })).toHaveTextContent("Hello");
  });
});
