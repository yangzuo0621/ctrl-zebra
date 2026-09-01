import { describe, expect, it } from "vitest";
import {
  createModelGateway,
  createNumberTool,
  createScriptedModelGateway,
  userMessage,
} from "./agent-runtime-test-support.js";
import type { AgentRuntimeEvent, ModelGateway, ModelRequest } from "./index.js";
import { AgentRuntime, ToolRegistry } from "./index.js";

describe("AgentRuntime Run budget", () => {
  it("stops a Provider without Usage from starting when the estimate reaches the limit", async () => {
    const events: AgentRuntimeEvent[] = [];
    let streamCalls = 0;
    const gateway: ModelGateway = {
      async *stream() {
        streamCalls += 1;
        yield { type: "text.delta", text: "late" };
        yield { type: "finish", reason: "stop" };
      },
    };
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) }, undefined, {
      runTokenBudget: { maxTokens: 2, warningTokens: 1 },
      tokenCounter: { count: () => 1 },
    });

    await expect(runtime.run(userMessage, new AbortController().signal)).resolves.toBeUndefined();

    expect(streamCalls).toBe(1);
    expect(events).toContainEqual({
      type: "agent.run-budget",
      sessionId: "session-1",
      budget: {
        state: "warning",
        source: "estimate",
        maxTokens: 2,
        warningTokens: 1,
        estimatedTokens: 1,
        effectiveTokens: 1,
      },
    });
    expect(events).toContainEqual({
      type: "agent.run-budget",
      sessionId: "session-1",
      budget: expect.objectContaining({
        state: "exceeded",
        source: "estimate",
        estimatedTokens: 2,
      }),
    });
    expect(events.at(-1)).toMatchObject({ status: "budget-exceeded" });
    expect(events.some((event) => event.type === "agent.text-delta")).toBe(false);
  });

  it("stops at a Provider Usage boundary before a later finish event", async () => {
    const events: AgentRuntimeEvent[] = [];
    const gateway = createModelGateway([
      { type: "usage", usage: { totalTokens: 5 } },
      { type: "finish", reason: "stop" },
    ]);
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) }, undefined, {
      runTokenBudget: { maxTokens: 5, warningTokens: 3 },
      tokenCounter: { count: () => 0 },
    });

    await expect(runtime.run(userMessage, new AbortController().signal)).resolves.toBeUndefined();

    expect(events.map((event) => event.type)).toContain("agent.usage");
    expect(events).toContainEqual({
      type: "agent.run-budget",
      sessionId: "session-1",
      budget: {
        state: "exceeded",
        source: "actual",
        maxTokens: 5,
        warningTokens: 3,
        estimatedTokens: 0,
        actualTokens: 5,
        effectiveTokens: 5,
      },
    });
    expect(events.at(-1)).toMatchObject({ status: "budget-exceeded" });
    expect(events.some((event) => event.type === "agent.text-delta")).toBe(false);
  });

  it("does not begin another Tool loop after a Tool result reaches the limit", async () => {
    const requests: ModelRequest[] = [];
    const executionOrder: string[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "tool.call", call: { id: "call-1", name: "first_tool", input: { value: 1 } } },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text.delta", text: "must not stream" },
          { type: "finish", reason: "stop" },
        ],
      ],
      requests,
    );
    const registry = new ToolRegistry();
    registry.register(createNumberTool("first_tool", executionOrder));
    const runtime = new AgentRuntime(gateway, { emit() {} }, registry, {
      runTokenBudget: { maxTokens: 3, warningTokens: 2 },
      tokenCounter: { count: () => 1 },
    });

    await expect(
      runtime.run({ ...userMessage, content: "List files." }, new AbortController().signal),
    ).resolves.toBeUndefined();

    expect(requests).toHaveLength(1);
    expect(executionOrder).toEqual(["first_tool:1"]);
  });

  it("gives cancellation priority over a simultaneous budget boundary", async () => {
    const controller = new AbortController();
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(
      createModelGateway([{ type: "text.delta", text: "late" }]),
      {
        emit(event) {
          events.push(event);
          if (event.type === "agent.run-budget") {
            controller.abort(new Error("user cancelled"));
          }
        },
      },
      undefined,
      {
        runTokenBudget: { maxTokens: 1, warningTokens: 1 },
        tokenCounter: { count: () => 1 },
      },
    );

    await expect(runtime.run(userMessage, controller.signal)).resolves.toBeUndefined();

    expect(events.some((event) => event.type === "agent.run-budget")).toBe(true);
    expect(events.at(-1)).toMatchObject({ status: "cancelled" });
    expect(
      events.some(
        (event) => event.type === "session.status-changed" && event.status === "budget-exceeded",
      ),
    ).toBe(false);
  });
});
