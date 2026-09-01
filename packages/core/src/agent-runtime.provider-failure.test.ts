import { describe, expect, it } from "vitest";
import { userMessage } from "./agent-runtime-test-support.js";
import type { AgentRuntimeEvent, ModelGateway } from "./index.js";
import { AgentRuntime } from "./index.js";

describe("AgentRuntime Provider failure", () => {
  it("marks the Session failed and propagates a model failure", async () => {
    const failure = new Error("model stream failed");
    const gateway: ModelGateway = {
      async *stream() {
        yield { type: "reasoning.start", blockId: "provider-block" };
        yield { type: "reasoning.delta", blockId: "provider-block", text: "partial" };
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
      {
        type: "agent.reasoning-start",
        sessionId: "session-1",
        blockId: "reasoning-1",
      },
      {
        type: "agent.reasoning-delta",
        sessionId: "session-1",
        blockId: "reasoning-1",
        text: "partial",
      },
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "streaming",
        status: "failed",
      },
    ]);
  });
});
