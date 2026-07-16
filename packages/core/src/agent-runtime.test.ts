import type { UserMessage } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import {
  AgentRuntime,
  type AgentRuntimeEvent,
  type ModelEvent,
  type ModelGateway,
  type ModelRequest,
} from "./index.js";

const userMessage = {
  messageId: "message-1",
  sessionId: "session-1",
  createdAt: "2026-07-16T00:00:00.000Z",
  role: "user",
  content: "Say hello.",
} as const satisfies UserMessage;

describe("AgentRuntime", () => {
  it("emits text deltas in model order and completes the Session", async () => {
    const gateway = createModelGateway([
      { type: "text.delta", text: "Hel" },
      { type: "usage", usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 } },
      { type: "text.delta", text: "lo" },
      { type: "finish", reason: "stop" },
    ]);
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) });

    await runtime.run(userMessage, new AbortController().signal);

    expect(events).toEqual([
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "idle",
        status: "preparing",
      },
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "preparing",
        status: "streaming",
      },
      { type: "agent.text-delta", sessionId: "session-1", text: "Hel" },
      { type: "agent.text-delta", sessionId: "session-1", text: "lo" },
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "streaming",
        status: "completed",
      },
    ]);
  });

  it("sends only the supplied user content to the model", async () => {
    const requests: ModelRequest[] = [];
    const gateway = createModelGateway([], (request) => requests.push(request));
    const runtime = new AgentRuntime(gateway, { emit() {} });

    await runtime.run(userMessage, new AbortController().signal);

    expect(requests).toEqual([
      {
        messages: [{ role: "user", content: "Say hello." }],
      },
    ]);
  });

  it("passes the caller's AbortSignal to the model", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const gateway = createModelGateway([], (_request, signal) => {
      receivedSignal = signal;
    });
    const runtime = new AgentRuntime(gateway, { emit() {} });

    await runtime.run(userMessage, controller.signal);

    expect(receivedSignal).toBe(controller.signal);
  });

  it("stops emitting text and marks the Session cancelled when cancelled mid-stream", async () => {
    const cancellation = new Error("cancelled by test");
    const controller = new AbortController();
    const gateway: ModelGateway = {
      async *stream(_request, signal) {
        yield { type: "text.delta", text: "before cancellation" };
        signal.throwIfAborted();
        yield { type: "text.delta", text: "after cancellation" };
      },
    };
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(gateway, {
      emit(event) {
        events.push(event);
        if (event.type === "agent.text-delta") {
          controller.abort(cancellation);
        }
      },
    });

    await expect(runtime.run(userMessage, controller.signal)).resolves.toBeUndefined();

    expect(events).toEqual([
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "idle",
        status: "preparing",
      },
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "preparing",
        status: "streaming",
      },
      {
        type: "agent.text-delta",
        sessionId: "session-1",
        text: "before cancellation",
      },
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "streaming",
        status: "cancelled",
      },
    ]);
  });

  it("cancels before starting the model when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled before run"));
    let streamCalls = 0;
    const gateway = createModelGateway([], () => {
      streamCalls += 1;
    });
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) });

    await expect(runtime.run(userMessage, controller.signal)).resolves.toBeUndefined();

    expect(streamCalls).toBe(0);
    expect(events).toEqual([
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "idle",
        status: "preparing",
      },
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "preparing",
        status: "cancelled",
      },
    ]);
  });

  it("marks the Session failed and propagates a model failure", async () => {
    const failure = new Error("model stream failed");
    const gateway: ModelGateway = {
      async *stream() {
        yield { type: "text.delta", text: "partial" };
        throw failure;
      },
    };
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) });

    await expect(runtime.run(userMessage, new AbortController().signal)).rejects.toBe(failure);
    expect(events).toEqual([
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "idle",
        status: "preparing",
      },
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "preparing",
        status: "streaming",
      },
      { type: "agent.text-delta", sessionId: "session-1", text: "partial" },
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "streaming",
        status: "failed",
      },
    ]);
  });
});

function createModelGateway(
  events: readonly ModelEvent[],
  onRequest: (request: ModelRequest, signal: AbortSignal) => void = () => {},
): ModelGateway {
  return {
    async *stream(request, signal) {
      onRequest(request, signal);
      yield* events;
    },
  };
}
