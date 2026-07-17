import type { UserMessage } from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  AgentRuntime,
  type AgentRuntimeEvent,
  type AgentTool,
  type ModelEvent,
  type ModelGateway,
  type ModelRequest,
  ToolRegistry,
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

  it("executes one Tool Call and returns its structured result to the model", async () => {
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          {
            type: "tool.call",
            call: { id: "call-1", name: "lookup_zebra", input: { query: "stripes" } },
          },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text.delta", text: "Zebras have stripes." },
          { type: "finish", reason: "stop" },
        ],
      ],
      requests,
    );
    const execute = vi.fn(async (input: { query: string }) => ({
      answer: `matched ${input.query}`,
    }));
    const tool = {
      name: "lookup_zebra",
      risk: "read",
      parseInput(value) {
        if (
          typeof value !== "object" ||
          value === null ||
          !("query" in value) ||
          typeof value.query !== "string"
        ) {
          throw new Error("invalid query");
        }

        return { query: value.query };
      },
      execute,
    } satisfies AgentTool<{ query: string }, { answer: string }>;
    const registry = new ToolRegistry();
    registry.register(tool);
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) }, registry);

    await runtime.run(userMessage, new AbortController().signal);

    expect(execute).toHaveBeenCalledWith({ query: "stripes" }, { signal: expect.any(AbortSignal) });
    expect(requests).toEqual([
      { messages: [{ role: "user", content: "Say hello." }] },
      {
        messages: [
          { role: "user", content: "Say hello." },
          {
            role: "assistant",
            toolCall: {
              id: "call-1",
              name: "lookup_zebra",
              input: { query: "stripes" },
            },
          },
          {
            role: "tool",
            result: {
              callId: "call-1",
              name: "lookup_zebra",
              status: "success",
              output: { answer: "matched stripes" },
              truncated: false,
            },
          },
        ],
      },
    ]);
    expect(events).toContainEqual({
      type: "session.status-changed",
      sessionId: "session-1",
      previousStatus: "streaming",
      status: "executing_tool",
    });
    expect(events).toContainEqual({
      type: "session.status-changed",
      sessionId: "session-1",
      previousStatus: "executing_tool",
      status: "streaming",
    });
    expect(events.at(-2)).toEqual({
      type: "agent.text-delta",
      sessionId: "session-1",
      text: "Zebras have stripes.",
    });
    expect(events.at(-1)).toEqual({
      type: "session.status-changed",
      sessionId: "session-1",
      previousStatus: "streaming",
      status: "completed",
    });
  });

  it("returns an unknown-tool result without executing a tool", async () => {
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          {
            type: "tool.call",
            call: { id: "call-missing", name: "missing_tool", input: null },
          },
          { type: "finish", reason: "tool-calls" },
        ],
        [{ type: "finish", reason: "stop" }],
      ],
      requests,
    );
    const runtime = new AgentRuntime(gateway, { emit() {} });

    await runtime.run(userMessage, new AbortController().signal);

    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      result: {
        callId: "call-missing",
        name: "missing_tool",
        status: "error",
        error: {
          code: "unknown-tool",
          message: "Unknown tool: missing_tool.",
        },
      },
    });
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

function createScriptedModelGateway(
  steps: readonly (readonly ModelEvent[])[],
  requests: ModelRequest[],
): ModelGateway {
  let nextStep = 0;

  return {
    async *stream(request, signal) {
      requests.push(request);
      const events = steps[nextStep];
      nextStep += 1;

      if (events === undefined) {
        throw new Error("FakeModel has no scripted response for this request.");
      }

      for (const event of events) {
        signal.throwIfAborted();
        yield event;
      }
    },
  };
}
