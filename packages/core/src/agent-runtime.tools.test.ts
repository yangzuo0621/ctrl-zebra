import { describe, expect, it, vi } from "vitest";
import { agentSystemInstruction } from "./agent-behavior-policy.js";
import {
  createNumberTool,
  createScriptedModelGateway,
  emptyInputSchema,
  userMessage,
} from "./agent-runtime-test-support.js";
import type { AgentRuntimeEvent, AgentTool, ModelRequest } from "./index.js";
import {
  AgentRuntime,
  MaxToolStepsExceededError,
  maxToolOutputEntries,
  ToolExecutionError,
  ToolRegistry,
  ToolRepetitionDetectedError,
  ToolUnavailableError,
} from "./index.js";

describe("AgentRuntime Tool loop", () => {
  it("executes one Tool Call and returns its structured result to the model", async () => {
    const readRequest = { ...userMessage, content: "Look up zebra facts in the workspace." };
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "reasoning.start", blockId: "provider-block" },
          { type: "reasoning.delta", blockId: "provider-block", text: "Need a lookup." },
          {
            type: "tool.call",
            call: { id: "call-1", name: "lookup_zebra", input: { query: "stripes" } },
          },
          { type: "reasoning.delta", blockId: "provider-block", text: " Run it." },
          { type: "reasoning.end", blockId: "provider-block" },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "reasoning.start", blockId: "provider-block" },
          { type: "reasoning.delta", blockId: "provider-block", text: "Use the result." },
          { type: "reasoning.end", blockId: "provider-block" },
          { type: "text.delta", text: "Zebras have stripes." },
          { type: "finish", reason: "stop" },
        ],
      ],
      requests,
    );
    const execute = vi.fn(async (input: { query: string }) => ({
      output: { answer: `matched ${input.query}` },
      truncated: false,
    }));
    const tool = {
      name: "lookup_zebra",
      description: "Look up zebra facts.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Search query." } },
        required: ["query"],
        additionalProperties: false,
      },
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

    await runtime.run(readRequest, new AbortController().signal);

    expect(execute).toHaveBeenCalledWith({ query: "stripes" }, { signal: expect.any(AbortSignal) });
    expect(requests).toEqual([
      {
        instructions: agentSystemInstruction,
        messages: [{ role: "user", content: readRequest.content }],
        tools: [
          {
            name: "lookup_zebra",
            description: "Look up zebra facts.",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string", description: "Search query." } },
              required: ["query"],
              additionalProperties: false,
            },
          },
        ],
      },
      {
        instructions: agentSystemInstruction,
        messages: [
          { role: "user", content: readRequest.content },
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
        tools: [
          {
            name: "lookup_zebra",
            description: "Look up zebra facts.",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string", description: "Search query." } },
              required: ["query"],
              additionalProperties: false,
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
    expect(events.filter((event) => event.type === "agent.tool-state")).toEqual([
      {
        type: "agent.tool-state",
        sessionId: "session-1",
        call: {
          id: "call-1",
          name: "lookup_zebra",
          input: { query: "stripes" },
        },
        status: "pending",
      },
      {
        type: "agent.tool-state",
        sessionId: "session-1",
        call: {
          id: "call-1",
          name: "lookup_zebra",
          input: { query: "stripes" },
        },
        status: "running",
      },
      {
        type: "agent.tool-state",
        sessionId: "session-1",
        call: {
          id: "call-1",
          name: "lookup_zebra",
          input: { query: "stripes" },
        },
        status: "success",
        result: {
          callId: "call-1",
          name: "lookup_zebra",
          status: "success",
          output: { answer: "matched stripes" },
          truncated: false,
        },
      },
    ]);
    expect(
      events
        .filter((event) => event.type === "agent.reasoning-start")
        .map((event) => event.blockId),
    ).toEqual(["reasoning-1", "reasoning-2"]);
    const firstPendingIndex = events.findIndex(
      (event) => event.type === "agent.tool-state" && event.status === "pending",
    );
    const trailingReasoningIndex = events.findIndex(
      (event) => event.type === "agent.reasoning-delta" && event.text === " Run it.",
    );
    expect(firstPendingIndex).toBeLessThan(trailingReasoningIndex);
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
        [
          { type: "text.delta", text: "The requested tool is unavailable." },
          { type: "finish", reason: "stop" },
        ],
      ],
      requests,
    );
    const runtime = new AgentRuntime(gateway, { emit() {} });

    await runtime.run(
      { ...userMessage, content: "Run node check.mjs in the workspace." },
      new AbortController().signal,
    );

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

  it("preserves tool-provided truncation metadata in the Tool Result", async () => {
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "tool.call", call: { id: "call-1", name: "limited_tool", input: null } },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text.delta", text: "The result was truncated." },
          { type: "finish", reason: "stop" },
        ],
      ],
      requests,
    );
    const registry = new ToolRegistry();
    registry.register({
      name: "limited_tool",
      description: "Return a limited result.",
      inputSchema: emptyInputSchema,
      risk: "read",
      parseInput: () => null,
      execute: async () => ({ output: ["first.txt"], truncated: true }),
    });
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) }, registry);

    await runtime.run(userMessage, new AbortController().signal);

    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      result: {
        callId: "call-1",
        name: "limited_tool",
        status: "success",
        output: ["first.txt"],
        truncated: true,
      },
    });
  });

  it("limits tool output before returning it to the model", async () => {
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "tool.call", call: { id: "call-1", name: "large_tool", input: null } },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text.delta", text: "The bounded result is available." },
          { type: "finish", reason: "stop" },
        ],
      ],
      requests,
    );
    const registry = new ToolRegistry();
    registry.register({
      name: "large_tool",
      description: "Return more entries than the model may receive.",
      inputSchema: emptyInputSchema,
      risk: "read",
      parseInput: () => null,
      execute: async () => ({
        output: Array.from({ length: maxToolOutputEntries + 1 }, (_, index) => index),
        truncated: false,
      }),
    });
    const runtime = new AgentRuntime(gateway, { emit() {} }, registry);

    await runtime.run(userMessage, new AbortController().signal);

    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      result: {
        callId: "call-1",
        name: "large_tool",
        status: "success",
        output: Array.from({ length: maxToolOutputEntries }, (_, index) => index),
        truncated: true,
      },
    });
  });

  it("rejects non-JSON tool output before applying limits", async () => {
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "tool.call", call: { id: "call-1", name: "invalid_tool", input: null } },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text.delta", text: "The tool returned invalid output." },
          { type: "finish", reason: "stop" },
        ],
      ],
      requests,
    );
    const registry = new ToolRegistry();
    registry.register({
      name: "invalid_tool",
      description: "Return an invalid value.",
      inputSchema: emptyInputSchema,
      risk: "read",
      parseInput: () => null,
      execute: async () => ({ output: undefined, truncated: false }),
    });
    const runtime = new AgentRuntime(gateway, { emit() {} }, registry);

    await runtime.run(userMessage, new AbortController().signal);

    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      result: {
        callId: "call-1",
        name: "invalid_tool",
        status: "error",
        error: {
          code: "invalid-output",
          message: 'Tool "invalid_tool" returned invalid output.',
        },
      },
    });
  });

  it("executes consecutive Tool Calls in strict order until the model completes", async () => {
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          {
            type: "tool.call",
            call: { id: "call-1", name: "first_tool", input: { value: 1 } },
          },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          {
            type: "tool.call",
            call: { id: "call-2", name: "second_tool", input: { value: 2 } },
          },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text.delta", text: "done" },
          { type: "finish", reason: "stop" },
        ],
      ],
      requests,
    );
    const executionOrder: string[] = [];
    const registry = new ToolRegistry();
    registry.register(createNumberTool("first_tool", executionOrder));
    registry.register(createNumberTool("second_tool", executionOrder));
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) }, registry);

    await runtime.run(userMessage, new AbortController().signal);

    expect(executionOrder).toEqual(["first_tool:1", "second_tool:2"]);
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.tools?.length === 2)).toBe(true);
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      result: { callId: "call-1", name: "first_tool", status: "success" },
    });
    expect(requests[2]?.messages.at(-1)).toMatchObject({
      role: "tool",
      result: { callId: "call-2", name: "second_tool", status: "success" },
    });
    expect(events.filter((event) => event.type === "session.status-changed")).toEqual([
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
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "streaming",
        status: "executing_tool",
      },
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "executing_tool",
        status: "streaming",
      },
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "streaming",
        status: "executing_tool",
      },
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "executing_tool",
        status: "streaming",
      },
      {
        type: "session.status-changed",
        sessionId: "session-1",
        previousStatus: "streaming",
        status: "completed",
      },
    ]);
  });

  it("returns a safe failed Tool Result when execution throws and continues the loop", async () => {
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          {
            type: "tool.call",
            call: { id: "call-failed", name: "failing_tool", input: null },
          },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text.delta", text: "The tool failed safely." },
          { type: "finish", reason: "stop" },
        ],
      ],
      requests,
    );
    const diagnostics: unknown[] = [];
    const registry = new ToolRegistry();
    registry.register({
      name: "failing_tool",
      description: "Fail during execution.",
      inputSchema: emptyInputSchema,
      risk: "read",
      parseInput: () => null,
      execute: async () => {
        throw new Error("private provider detail");
      },
    });
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) }, registry, {
      diagnosticSink: { emit: (diagnostic) => diagnostics.push(diagnostic) },
    });

    await runtime.run(userMessage, new AbortController().signal);

    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      result: {
        callId: "call-failed",
        name: "failing_tool",
        status: "error",
        error: {
          code: "failed",
          message: 'Tool "failing_tool" failed during execution.',
        },
      },
    });
    expect(JSON.stringify(requests)).not.toContain("private provider detail");
    expect(diagnostics).toEqual([
      expect.objectContaining({
        type: "agent.internal-error",
        phase: "execute-tool",
        sessionId: "session-1",
        toolCallId: "call-failed",
        cause: expect.any(Error),
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("private provider detail");
    expect(events.filter((event) => event.type === "agent.tool-state")).toEqual([
      expect.objectContaining({ type: "agent.tool-state", status: "pending" }),
      expect.objectContaining({ type: "agent.tool-state", status: "running" }),
      expect.objectContaining({
        type: "agent.tool-state",
        status: "error",
        result: expect.objectContaining({ status: "error" }),
      }),
    ]);
  });

  it("fails before executing a Tool Call that exceeds the maximum step count", async () => {
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "tool.call", call: { id: "call-1", name: "step_tool", input: null } },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "tool.call", call: { id: "call-2", name: "step_tool", input: null } },
          { type: "finish", reason: "tool-calls" },
        ],
      ],
      [],
    );
    const execute = vi.fn(async () => ({ output: null, truncated: false }));
    const registry = new ToolRegistry();
    registry.register({
      name: "step_tool",
      description: "Execute a bounded step.",
      inputSchema: emptyInputSchema,
      risk: "read",
      parseInput: () => null,
      execute,
    });
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) }, registry, {
      maxToolSteps: 1,
    });

    await expect(runtime.run(userMessage, new AbortController().signal)).rejects.toEqual(
      new MaxToolStepsExceededError(1),
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({
      type: "session.status-changed",
      sessionId: "session-1",
      previousStatus: "streaming",
      status: "failed",
    });
  });

  it("stops before executing the Tool Call that reaches the repetition threshold", async () => {
    const repeatedCalls = Array.from({ length: 3 }, (_, index) => [
      {
        type: "tool.call" as const,
        call: { id: `call-${index + 1}`, name: "step_tool" as const, input: { value: 1 } },
      },
      { type: "finish" as const, reason: "tool-calls" as const },
    ]);
    const gateway = createScriptedModelGateway(repeatedCalls, []);
    const execute = vi.fn(async () => ({ output: null, truncated: false }));
    const registry = new ToolRegistry();
    registry.register({
      name: "step_tool",
      description: "Execute a repeated step.",
      inputSchema: {
        type: "object",
        properties: {
          value: { type: "integer", description: "Stable repeated value." },
        },
        required: ["value"],
        additionalProperties: false,
      },
      risk: "read",
      parseInput: () => null,
      execute,
    });
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) }, registry, {
      toolRepetitionThreshold: 3,
    });

    await expect(runtime.run(userMessage, new AbortController().signal)).rejects.toEqual(
      new ToolRepetitionDetectedError("step_tool", 3, 3),
    );
    expect(execute).toHaveBeenCalledTimes(2);
    expect(events.filter((event) => event.type === "agent.tool-state")).toHaveLength(6);
    expect(events.at(-1)).toEqual({
      type: "session.status-changed",
      sessionId: "session-1",
      previousStatus: "streaming",
      status: "failed",
    });
  });

  it.each([
    [new ToolExecutionError("invalid-input", "The Tool input is invalid."), "invalid-input"],
    [
      new ToolExecutionError("invalid-output", "External Tool output is invalid."),
      "invalid-output",
    ],
    [new ToolUnavailableError(), "unknown-tool"],
  ] as const)("maps a controlled Tool boundary failure to %s", async (failure, expectedCode) => {
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "tool.call", call: { id: "call-1", name: "list_files", input: {} } },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text.delta", text: "Handled." },
          { type: "finish", reason: "stop" },
        ],
      ],
      requests,
    );
    const registry = new ToolRegistry();
    registry.register({
      name: "list_files",
      description: "List files.",
      inputSchema: emptyInputSchema,
      risk: "read",
      parseInput() {
        if (failure instanceof ToolUnavailableError) throw failure;
        return {};
      },
      async execute() {
        throw failure;
      },
    });
    const runtime = new AgentRuntime(gateway, { emit() {} }, registry);

    await runtime.run({ ...userMessage, content: "List files." }, new AbortController().signal);

    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      result: { status: "error", error: { code: expectedCode } },
    });
  });
});
