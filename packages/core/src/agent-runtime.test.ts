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

    await runtime.run(userMessage);

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

    await runtime.run(userMessage);

    expect(requests).toEqual([
      {
        messages: [{ role: "user", content: "Say hello." }],
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

    await expect(runtime.run(userMessage)).rejects.toBe(failure);
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
  onRequest: (request: ModelRequest) => void = () => {},
): ModelGateway {
  return {
    async *stream(request) {
      onRequest(request);
      yield* events;
    },
  };
}
