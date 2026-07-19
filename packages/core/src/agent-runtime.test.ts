import type { UserMessage } from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  AgentRuntime,
  type AgentRuntimeEvent,
  type AgentTool,
  MaxToolStepsExceededError,
  type ModelEvent,
  type ModelGateway,
  type ModelRequest,
  maxToolOutputEntries,
  type ToolApprovalWorkflow,
  ToolRegistry,
} from "./index.js";

const emptyInputSchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

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

    await runtime.run(userMessage, new AbortController().signal);

    expect(execute).toHaveBeenCalledWith({ query: "stripes" }, { signal: expect.any(AbortSignal) });
    expect(requests).toEqual([
      {
        messages: [{ role: "user", content: "Say hello." }],
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

  it("returns a policy denial without executing a denied-risk tool", async () => {
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "tool.call", call: { id: "call-exec", name: "run_command", input: {} } },
          { type: "finish", reason: "tool-calls" },
        ],
        [{ type: "finish", reason: "stop" }],
      ],
      requests,
    );
    const execute = vi.fn(async () => ({ output: null, truncated: false }));
    const registry = new ToolRegistry();
    registry.register({
      name: "run_command",
      description: "Run a command.",
      inputSchema: emptyInputSchema,
      risk: "execute",
      parseInput: () => null,
      execute,
    });
    const runtime = new AgentRuntime(gateway, { emit() {} }, registry);

    await runtime.run(userMessage, new AbortController().signal);

    expect(execute).not.toHaveBeenCalled();
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      result: {
        callId: "call-exec",
        name: "run_command",
        status: "error",
        error: { code: "denied", message: 'Tool "run_command" is denied by policy.' },
      },
    });
  });

  it.each([
    {
      outcome: "approved",
      decision: "approved",
      consumption: { outcome: "approved" },
      expectedResult: {
        callId: "call-edit",
        name: "propose_file_edit",
        status: "success",
        output: { outcome: "approved" },
        truncated: false,
      },
      expectedApprovalStatuses: ["pending", "approved", "consumed"],
    },
    {
      outcome: "denied",
      decision: "denied",
      consumption: { outcome: "approved" },
      expectedResult: {
        callId: "call-edit",
        name: "propose_file_edit",
        status: "error",
        error: { code: "denied", message: 'The user denied tool "propose_file_edit".' },
      },
      expectedApprovalStatuses: ["pending", "denied"],
    },
    {
      outcome: "conflict",
      decision: "approved",
      consumption: { outcome: "conflict", message: "The approved file changed." },
      expectedResult: {
        callId: "call-edit",
        name: "propose_file_edit",
        status: "error",
        error: { code: "conflict", message: "The approved file changed." },
      },
      expectedApprovalStatuses: ["pending", "approved", "invalidated"],
    },
    {
      outcome: "expired",
      decision: "expired",
      consumption: { outcome: "approved" },
      expectedResult: {
        callId: "call-edit",
        name: "propose_file_edit",
        status: "error",
        error: { code: "failed", message: 'Approval for tool "propose_file_edit" expired.' },
      },
      expectedApprovalStatuses: ["pending", "expired"],
    },
  ] as const)("returns an $outcome file-edit result to the model and continues", async (scenario) => {
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          {
            type: "tool.call",
            call: {
              id: "call-edit",
              name: "propose_file_edit",
              input: {},
            },
          },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text.delta", text: `continued after ${scenario.outcome}` },
          { type: "finish", reason: "stop" },
        ],
      ],
      requests,
    );
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ output: null, truncated: false }));
    const prepareApproval = vi.fn(async () => ({
      output: {
        uri: "file:///workspace/src/file.ts",
        originalRevision: { kind: "document_version", value: 1 },
        edits: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: "zebra",
          },
        ],
      },
      truncated: false,
    }));
    registry.register({
      name: "propose_file_edit",
      description: "Prepare a file edit.",
      inputSchema: emptyInputSchema,
      risk: "write",
      parseInput: () => null,
      execute,
      prepareApproval,
    });
    const consume = vi.fn(async () => scenario.consumption);
    const workflow: ToolApprovalWorkflow = {
      async create(prepared) {
        return {
          request: {
            id: "approval-edit",
            scope: {
              sessionId: prepared.sessionId,
              call: prepared.call,
              risk: "write",
              resources: [],
            },
            presentation: { title: "Apply edit", summary: "Apply one edit." },
            createdAt: "2026-07-19T00:00:00.000Z",
            expiresAt: "2026-07-19T00:05:00.000Z",
          },
          requestDecision: async () => ({
            requestId: "approval-edit",
            decision: scenario.decision,
            ...(scenario.decision === "expired" ? {} : { decidedAt: "2026-07-19T00:01:00.000Z" }),
          }),
          consume,
        };
      },
    };
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) }, registry, {
      approvalWorkflow: workflow,
    });

    await runtime.run(userMessage, new AbortController().signal);

    expect(execute).not.toHaveBeenCalled();
    expect(prepareApproval).toHaveBeenCalledOnce();
    expect(consume).toHaveBeenCalledTimes(scenario.decision === "approved" ? 1 : 0);
    expect(requests[1]?.messages.at(-1)).toEqual({ role: "tool", result: scenario.expectedResult });
    expect(
      events.filter((event) => event.type === "agent.approval-state").map(({ status }) => status),
    ).toEqual(scenario.expectedApprovalStatuses);
    expect(events).toContainEqual({
      type: "agent.text-delta",
      sessionId: "session-1",
      text: `continued after ${scenario.outcome}`,
    });
  });

  it("cancels while awaiting approval without consuming or continuing the model", async () => {
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "tool.call", call: { id: "call-edit", name: "edit_file", input: {} } },
          { type: "finish", reason: "tool-calls" },
        ],
      ],
      requests,
    );
    const registry = new ToolRegistry();
    registry.register({
      name: "edit_file",
      description: "Edit a file.",
      inputSchema: emptyInputSchema,
      risk: "write",
      parseInput: () => null,
      execute: async () => ({ output: null, truncated: false }),
      prepareApproval: async () => ({ output: null, truncated: false }),
    });
    const consume = vi.fn(async () => ({ outcome: "approved" as const }));
    const workflow: ToolApprovalWorkflow = {
      async create(prepared) {
        return {
          request: {
            id: "approval-cancel",
            scope: {
              sessionId: prepared.sessionId,
              call: prepared.call,
              risk: "write",
              resources: [],
            },
            presentation: { title: "Edit", summary: "Edit one file." },
            createdAt: "2026-07-19T00:00:00.000Z",
            expiresAt: "2026-07-19T00:05:00.000Z",
          },
          requestDecision: async (signal) => {
            signal.throwIfAborted();
            throw new Error("Expected cancellation before approval wait.");
          },
          consume,
        };
      },
    };
    const controller = new AbortController();
    const cancellation = new Error("cancel approval");
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(
      gateway,
      {
        emit(event) {
          events.push(event);
          if (event.type === "agent.approval-state" && event.status === "pending") {
            controller.abort(cancellation);
          }
        },
      },
      registry,
      { approvalWorkflow: workflow },
    );

    await expect(runtime.run(userMessage, controller.signal)).resolves.toBeUndefined();

    expect(requests).toHaveLength(1);
    expect(consume).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({
      type: "session.status-changed",
      sessionId: "session-1",
      previousStatus: "awaiting_approval",
      status: "cancelled",
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
        [{ type: "finish", reason: "stop" }],
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
        [{ type: "finish", reason: "stop" }],
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
        [{ type: "finish", reason: "stop" }],
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
        [{ type: "finish", reason: "stop" }],
      ],
      requests,
    );
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
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) }, registry);

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

  it("cancels during Tool execution without starting another model step", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel tool execution");
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "tool.call", call: { id: "call-1", name: "waiting_tool", input: null } },
          { type: "finish", reason: "tool-calls" },
        ],
      ],
      requests,
    );
    const started = Promise.withResolvers<void>();
    const registry = new ToolRegistry();
    registry.register({
      name: "waiting_tool",
      description: "Wait until cancelled.",
      inputSchema: emptyInputSchema,
      risk: "read",
      parseInput: () => null,
      execute: async (_input, { signal }) => {
        started.resolve();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    });
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) }, registry);

    const run = runtime.run(userMessage, controller.signal);
    await started.promise;
    controller.abort(cancellation);

    await expect(run).resolves.toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(events.at(-1)).toEqual({
      type: "session.status-changed",
      sessionId: "session-1",
      previousStatus: "executing_tool",
      status: "cancelled",
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

function createNumberTool(name: "first_tool" | "second_tool", executionOrder: string[]) {
  return {
    name,
    description: `Execute ${name}.`,
    inputSchema: {
      type: "object",
      properties: { value: { type: "integer", description: "Numeric value." } },
      required: ["value"],
      additionalProperties: false,
    },
    risk: "read" as const,
    parseInput(value: unknown) {
      if (
        typeof value !== "object" ||
        value === null ||
        !("value" in value) ||
        typeof value.value !== "number"
      ) {
        throw new Error("invalid value");
      }

      return { value: value.value };
    },
    async execute(input: { value: number }) {
      executionOrder.push(`${name}:${input.value}`);
      return { output: { value: input.value }, truncated: false };
    },
  } satisfies AgentTool<{ value: number }, { value: number }>;
}
