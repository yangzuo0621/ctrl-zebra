import { describe, expect, it, vi } from "vitest";
import { agentSystemInstruction } from "./agent-behavior-policy.js";
import {
  createModelGateway,
  createScriptedModelGateway,
  emptyInputSchema,
  userMessage,
} from "./agent-runtime-test-support.js";
import type { AgentRuntimeEvent, ModelRequest } from "./index.js";
import {
  AgentRuntime,
  EmptyAgentResponseError,
  InvalidModelUsageError,
  ToolRegistry,
  UnexpectedToolCallError,
} from "./index.js";

describe("AgentRuntime model stream and finish", () => {
  it("emits text deltas in model order and completes the Session", async () => {
    const gateway = createModelGateway([
      { type: "text.delta", text: "Hel" },
      { type: "usage", usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 } },
      { type: "text.delta", text: "lo" },
      { type: "finish", reason: "stop" },
      { type: "reasoning.start", blockId: "late" },
      { type: "reasoning.delta", blockId: "late", text: "late" },
      { type: "reasoning.end", blockId: "late" },
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
      {
        type: "agent.usage",
        sessionId: "session-1",
        usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
      },
      { type: "agent.text-delta", sessionId: "session-1", text: "lo" },
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "streaming",
        status: "completed",
      },
    ]);
  });

  it("emits one bounded Provider Usage event per model response and skips missing Usage", async () => {
    const events: AgentRuntimeEvent[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "text.delta", text: "First" },
          { type: "usage", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } },
          { type: "usage", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } },
          { type: "tool.call", call: { id: "call-usage", name: "lookup_zebra", input: {} } },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text.delta", text: "Second" },
          { type: "usage", usage: { outputTokens: 4 } },
          { type: "finish", reason: "stop" },
        ],
      ],
      [],
    );
    const registry = new ToolRegistry();
    registry.register({
      name: "lookup_zebra",
      description: "Look up a zebra.",
      inputSchema: emptyInputSchema,
      risk: "read",
      parseInput: () => ({}),
      async execute() {
        return { output: { ok: true }, truncated: false };
      },
    });
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) }, registry);

    await runtime.run(
      { ...userMessage, content: "Inspect workspace." },
      new AbortController().signal,
    );

    expect(events.filter((event) => event.type === "agent.usage")).toEqual([
      {
        type: "agent.usage",
        sessionId: "session-1",
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      },
      { type: "agent.usage", sessionId: "session-1", usage: { outputTokens: 4 } },
    ]);
  });

  it("rejects invalid Provider Usage and never emits it after cancellation", async () => {
    const invalidEvents: AgentRuntimeEvent[] = [];
    const invalidRuntime = new AgentRuntime(
      createModelGateway([
        { type: "usage", usage: { inputTokens: -1 } },
        { type: "text.delta", text: "ignored" },
        { type: "finish", reason: "stop" },
      ]),
      { emit: (event) => invalidEvents.push(event) },
    );
    await expect(
      invalidRuntime.run(userMessage, new AbortController().signal),
    ).rejects.toBeInstanceOf(InvalidModelUsageError);
    expect(invalidEvents.some((event) => event.type === "agent.usage")).toBe(false);

    const controller = new AbortController();
    const lateEvents: AgentRuntimeEvent[] = [];
    const lateRuntime = new AgentRuntime(
      createModelGateway([
        { type: "text.delta", text: "before" },
        { type: "usage", usage: { totalTokens: 7 } },
        { type: "finish", reason: "stop" },
      ]),
      {
        emit: (event) => {
          lateEvents.push(event);
          if (event.type === "agent.text-delta") {
            controller.abort(new Error("cancelled"));
          }
        },
      },
    );
    await expect(lateRuntime.run(userMessage, controller.signal)).resolves.toBeUndefined();
    expect(lateEvents.some((event) => event.type === "agent.usage")).toBe(false);
  });

  it("publishes reasoning and text in source order with run-scoped block IDs", async () => {
    const gateway = createModelGateway([
      { type: "reasoning.start", blockId: "provider-block" },
      { type: "reasoning.delta", blockId: "provider-block", text: "Check " },
      { type: "text.delta", text: "Hel" },
      { type: "reasoning.delta", blockId: "provider-block", text: "facts." },
      { type: "reasoning.end", blockId: "provider-block" },
      { type: "text.delta", text: "lo" },
      { type: "finish", reason: "stop" },
    ]);
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) });

    await runtime.run(userMessage, new AbortController().signal);

    expect(
      events.filter(
        (event) =>
          event.type === "agent.reasoning-start" ||
          event.type === "agent.reasoning-delta" ||
          event.type === "agent.reasoning-end" ||
          event.type === "agent.text-delta",
      ),
    ).toEqual([
      { type: "agent.reasoning-start", sessionId: "session-1", blockId: "reasoning-1" },
      {
        type: "agent.reasoning-delta",
        sessionId: "session-1",
        blockId: "reasoning-1",
        text: "Check ",
      },
      { type: "agent.text-delta", sessionId: "session-1", text: "Hel" },
      {
        type: "agent.reasoning-delta",
        sessionId: "session-1",
        blockId: "reasoning-1",
        text: "facts.",
      },
      { type: "agent.reasoning-end", sessionId: "session-1", blockId: "reasoning-1" },
      { type: "agent.text-delta", sessionId: "session-1", text: "lo" },
    ]);
  });

  it("sends the stable system instruction and supplied user content to the model", async () => {
    const requests: ModelRequest[] = [];
    const gateway = createModelGateway(
      [
        { type: "text.delta", text: "Hello." },
        { type: "finish", reason: "stop" },
      ],
      (request) => requests.push(request),
    );
    const runtime = new AgentRuntime(gateway, { emit() {} });

    await runtime.run(userMessage, new AbortController().signal);

    expect(requests).toEqual([
      {
        instructions: agentSystemInstruction,
        messages: [{ role: "user", content: "Say hello." }],
      },
    ]);
  });

  it("withholds tools for a greeting and completes with conversational text", async () => {
    const requests: ModelRequest[] = [];
    const execute = vi.fn(async () => ({ output: null, truncated: false }));
    const registry = new ToolRegistry();
    registry.register({
      name: "list_files",
      description: "List workspace files.",
      inputSchema: emptyInputSchema,
      risk: "read",
      parseInput: () => null,
      execute,
    });
    const gateway = createModelGateway(
      [
        { type: "text.delta", text: "Hello! How can I help?" },
        { type: "finish", reason: "stop" },
      ],
      (request) => requests.push(request),
    );
    const runtime = new AgentRuntime(gateway, { emit() {} }, registry);

    await runtime.run({ ...userMessage, content: "hello" }, new AbortController().signal);

    expect(requests).toEqual([
      {
        instructions: agentSystemInstruction,
        messages: [{ role: "user", content: "hello" }],
      },
    ]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an undeclared Tool Call for a greeting without executing it", async () => {
    const execute = vi.fn(async () => ({ output: null, truncated: false }));
    const registry = new ToolRegistry();
    registry.register({
      name: "list_files",
      description: "List workspace files.",
      inputSchema: emptyInputSchema,
      risk: "read",
      parseInput: () => null,
      execute,
    });
    const gateway = createModelGateway([
      { type: "tool.call", call: { id: "call-1", name: "list_files", input: {} } },
      { type: "finish", reason: "tool-calls" },
    ]);
    const runtime = new AgentRuntime(gateway, { emit() {} }, registry);

    await expect(
      runtime.run({ ...userMessage, content: "hello" }, new AbortController().signal),
    ).rejects.toEqual(new UnexpectedToolCallError("list_files"));
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails instead of completing when the model returns no usable text", async () => {
    const events: AgentRuntimeEvent[] = [];
    const gateway = createModelGateway([
      { type: "reasoning.start", blockId: "reasoning-1" },
      { type: "reasoning.delta", blockId: "reasoning-1", text: "  " },
      { type: "reasoning.end", blockId: "reasoning-1" },
      { type: "text.delta", text: "  " },
      { type: "finish", reason: "stop" },
    ]);
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) });

    await expect(runtime.run(userMessage, new AbortController().signal)).rejects.toEqual(
      new EmptyAgentResponseError(false),
    );
    expect(events.at(-1)).toMatchObject({
      type: "session.status-changed",
      status: "failed",
    });
  });

  it("fails when a Tool result is not followed by a usable final response", async () => {
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "tool.call", call: { id: "call-1", name: "list_files", input: {} } },
          { type: "finish", reason: "tool-calls" },
        ],
        [{ type: "finish", reason: "stop" }],
      ],
      [],
    );
    const registry = new ToolRegistry();
    registry.register({
      name: "list_files",
      description: "List workspace files.",
      inputSchema: emptyInputSchema,
      risk: "read",
      parseInput: () => null,
      execute: async () => ({ output: { files: [] }, truncated: false }),
    });
    const runtime = new AgentRuntime(gateway, { emit() {} }, registry);

    await expect(
      runtime.run({ ...userMessage, content: "List files." }, new AbortController().signal),
    ).rejects.toEqual(new EmptyAgentResponseError(true));
  });
});
