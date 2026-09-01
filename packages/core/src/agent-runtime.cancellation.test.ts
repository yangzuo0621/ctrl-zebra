import { describe, expect, it, vi } from "vitest";
import {
  createCountingModelGateway,
  createModelGateway,
  createScriptedModelGateway,
  emptyInputSchema,
  userMessage,
} from "./agent-runtime-test-support.js";
import type {
  AgentRuntimeEvent,
  ModelGateway,
  ModelRequest,
  ToolApprovalWorkflow,
} from "./index.js";
import { AgentRuntime, ToolRegistry } from "./index.js";

describe("AgentRuntime cancellation and abort", () => {
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

  it("stops before the model when the preparing-to-streaming status sink aborts", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel preparing transition");
    let streamCalls = 0;
    const gateway = createModelGateway(
      [
        { type: "text.delta", text: "must not stream" },
        { type: "finish", reason: "stop" },
      ],
      () => {
        streamCalls += 1;
      },
    );
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(gateway, {
      emit(event) {
        events.push(event);
        if (event.type === "session.status-changed" && event.status === "streaming") {
          controller.abort(cancellation);
        }
      },
    });

    await expect(runtime.run(userMessage, controller.signal)).resolves.toBeUndefined();

    expect(streamCalls).toBe(0);
    expect(events.some((event) => event.type === "agent.text-delta")).toBe(false);
    expect(events.at(-1)).toMatchObject({ status: "cancelled" });
  });

  it("stops before approval events when the awaiting-approval status sink aborts", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel awaiting approval transition");
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "tool.call", call: { id: "call-await", name: "edit_file", input: {} } },
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
      execute: vi.fn(async () => ({ output: null, truncated: false })),
      prepareApproval: async () => ({ output: null, truncated: false }),
    });
    const requestDecision = vi.fn(async () => ({
      requestId: "approval-await",
      decision: "approved" as const,
      decidedAt: "2026-07-19T00:01:00.000Z",
    }));
    const consume = vi.fn(async () => ({ outcome: "approved" as const }));
    const invalidate = vi.fn();
    const workflow: ToolApprovalWorkflow = {
      async create(prepared) {
        return {
          request: {
            id: "approval-await",
            scope: {
              sessionId: prepared.sessionId,
              runId: prepared.runId,
              call: prepared.call,
              risk: prepared.risk,
              resources: [],
            },
            presentation: { title: "Edit", summary: "Edit one file." },
            createdAt: "2026-07-19T00:00:00.000Z",
            expiresAt: "2026-07-19T00:05:00.000Z",
          },
          requestDecision,
          consume,
          invalidate,
        };
      },
    };
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(
      gateway,
      {
        emit(event) {
          events.push(event);
          if (event.type === "session.status-changed" && event.status === "awaiting_approval") {
            controller.abort(cancellation);
          }
        },
      },
      registry,
      { approvalWorkflow: workflow },
    );

    await expect(runtime.run(userMessage, controller.signal)).resolves.toBeUndefined();

    expect(requests).toHaveLength(1);
    expect(requestDecision).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.type === "agent.approval-state")).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ status: "cancelled" });
  });

  it("stops before the next model step when the post-tool status sink aborts", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel after tool transition");
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "tool.call", call: { id: "call-post-tool", name: "list_files", input: {} } },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text.delta", text: "must not continue" },
          { type: "finish", reason: "stop" },
        ],
      ],
      requests,
    );
    const execute = vi.fn(async () => ({ output: ["file.txt"], truncated: false }));
    const registry = new ToolRegistry();
    registry.register({
      name: "list_files",
      description: "List files.",
      inputSchema: emptyInputSchema,
      risk: "read",
      parseInput: () => null,
      execute,
    });
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(
      gateway,
      {
        emit(event) {
          events.push(event);
          if (
            event.type === "session.status-changed" &&
            event.previousStatus === "executing_tool" &&
            event.status === "streaming"
          ) {
            controller.abort(cancellation);
          }
        },
      },
      registry,
    );

    await expect(runtime.run(userMessage, controller.signal)).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(1);
    expect(events).not.toContainEqual({
      type: "agent.text-delta",
      sessionId: "session-1",
      text: "must not continue",
    });
    expect(events.at(-1)).toMatchObject({ status: "cancelled" });
  });

  it("passes the caller's AbortSignal to the model", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const gateway = createModelGateway(
      [
        { type: "text.delta", text: "Hello." },
        { type: "finish", reason: "stop" },
      ],
      (_request, signal) => {
        receivedSignal = signal;
      },
    );
    const runtime = new AgentRuntime(gateway, { emit() {} });

    await runtime.run(userMessage, controller.signal);

    expect(receivedSignal).toBe(controller.signal);
  });

  it("stops emitting reasoning and marks the Session cancelled when cancelled mid-stream", async () => {
    const cancellation = new Error("cancelled by test");
    const controller = new AbortController();
    const gateway: ModelGateway = {
      async *stream(_request, signal) {
        yield { type: "reasoning.start", blockId: "provider-block" };
        yield {
          type: "reasoning.delta",
          blockId: "provider-block",
          text: "before cancellation",
        };
        signal.throwIfAborted();
        yield { type: "reasoning.end", blockId: "provider-block" };
        yield { type: "text.delta", text: "after cancellation" };
      },
    };
    const events: AgentRuntimeEvent[] = [];
    const runtime = new AgentRuntime(gateway, {
      emit(event) {
        events.push(event);
        if (event.type === "agent.reasoning-delta") {
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
        type: "agent.reasoning-start",
        sessionId: "session-1",
        blockId: "reasoning-1",
      },
      {
        type: "agent.reasoning-delta",
        sessionId: "session-1",
        blockId: "reasoning-1",
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

  it.each([
    {
      name: "text delta",
      events: [{ type: "text.delta", text: "first" }],
      target: "agent.text-delta",
      targetNextCount: 1,
    },
    {
      name: "reasoning start",
      events: [{ type: "reasoning.start", blockId: "provider-block" }],
      target: "agent.reasoning-start",
      targetNextCount: 1,
    },
    {
      name: "reasoning delta",
      events: [
        { type: "reasoning.start", blockId: "provider-block" },
        { type: "reasoning.delta", blockId: "provider-block", text: "first" },
      ],
      target: "agent.reasoning-delta",
      targetNextCount: 2,
    },
    {
      name: "reasoning end",
      events: [
        { type: "reasoning.start", blockId: "provider-block" },
        { type: "reasoning.end", blockId: "provider-block" },
      ],
      target: "agent.reasoning-end",
      targetNextCount: 2,
    },
    {
      name: "pending Tool state",
      events: [
        {
          type: "tool.call",
          call: { id: "call-1", name: "list_files", input: {} },
        },
      ],
      target: "agent.tool-state",
      targetNextCount: 1,
    },
  ] as const)(
    "does not request another model event after a synchronous %s sink abort",
    async (testCase) => {
      const controller = new AbortController();
      const cancellation = new Error(`cancel after ${testCase.name}`);
      let nextCount = 0;
      const events: AgentRuntimeEvent[] = [];
      const runtime = new AgentRuntime(
        createCountingModelGateway(testCase.events, () => {
          nextCount += 1;
        }),
        {
          emit(event) {
            events.push(event);
            if (event.type === testCase.target) {
              controller.abort(cancellation);
            }
          },
        },
      );

      await expect(runtime.run(userMessage, controller.signal)).resolves.toBeUndefined();

      expect(nextCount).toBe(testCase.targetNextCount);
      expect(events.filter((event) => event.type === testCase.target)).toHaveLength(1);
      expect(
        events.filter((event) => event.type === "agent.tool-state" && event.status !== "pending"),
      ).toHaveLength(0);
      expect(events.at(-1)).toMatchObject({ status: "cancelled" });
    },
  );

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
});
