import { describe, expect, it, vi } from "vitest";
import {
  createModelGateway,
  createScriptedModelGateway,
  emptyInputSchema,
  userMessage,
} from "./agent-runtime-test-support.js";
import type {
  AgentRuntimeEvent,
  ModelRequest,
  PreparedToolApproval,
  ToolApprovalOperation,
  ToolApprovalWorkflow,
} from "./index.js";
import { AgentRuntime, ToolRegistry } from "./index.js";

describe("AgentRuntime approval", () => {
  it("allocates a fresh approval ownership identity for each Run", async () => {
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "tool.call", call: { id: "call-1", name: "edit_file", input: {} } },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text.delta", text: "First edit approved." },
          { type: "finish", reason: "stop" },
        ],
        [
          { type: "tool.call", call: { id: "call-2", name: "edit_file", input: {} } },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text.delta", text: "Second edit approved." },
          { type: "finish", reason: "stop" },
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
    const runIds: string[] = [];
    const approvalIds: string[] = [];
    const consume = vi.fn(async () => ({ outcome: "approved" as const }));
    let nextApproval = 1;
    const workflow: ToolApprovalWorkflow = {
      async create(prepared): Promise<ToolApprovalOperation> {
        runIds.push(prepared.runId);
        const approvalId = `approval-${nextApproval}`;
        nextApproval += 1;
        approvalIds.push(approvalId);
        return {
          request: {
            id: approvalId,
            scope: {
              sessionId: prepared.sessionId,
              runId: prepared.runId,
              call: prepared.call,
              risk: "write",
              resources: [],
            },
            presentation: { title: "Edit", summary: "Edit one file." },
            createdAt: "2026-07-19T00:00:00.000Z",
            expiresAt: "2026-07-19T00:05:00.000Z",
          },
          requestDecision: async () => ({
            requestId: approvalId,
            decision: "approved",
            decidedAt: "2026-07-19T00:01:00.000Z",
          }),
          consume,
          invalidate: vi.fn(),
        };
      },
    };
    const runIdQueue = ["run-1", "run-2"];
    const runtime = new AgentRuntime(gateway, { emit() {} }, registry, {
      approvalWorkflow: workflow,
      createRunId: () => runIdQueue.shift() ?? "run-unexpected",
    });

    await runtime.run(
      { ...userMessage, content: "Modify the file." },
      new AbortController().signal,
    );
    await runtime.run(
      { ...userMessage, messageId: "message-2", content: "Modify the file again." },
      new AbortController().signal,
    );

    expect(runIds).toEqual(["run-1", "run-2"]);
    expect(new Set(runIds).size).toBe(2);
    expect(approvalIds).toEqual(["approval-1", "approval-2"]);
    expect(consume).toHaveBeenCalledTimes(2);
    expect(requests).toHaveLength(4);
  });

  it.each(["missing-run-id", "prior-run-id", "session-mismatch", "call-mismatch"] as const)(
    "fails closed for an approval scope with a $1",
    async (mismatch) => {
      const requests: ModelRequest[] = [];
      const gateway = createModelGateway(
        [
          {
            type: "tool.call",
            call: { id: "call-approval", name: "edit_file", input: {} },
          },
          { type: "finish", reason: "tool-calls" },
        ],
        (request) => requests.push(request),
      );
      const registry = new ToolRegistry();
      const execute = vi.fn(async () => ({ output: null, truncated: false }));
      registry.register({
        name: "edit_file",
        description: "Edit a file.",
        inputSchema: emptyInputSchema,
        risk: "write",
        parseInput: () => null,
        execute,
        prepareApproval: async () => ({ output: null, truncated: false }),
      });
      const requestDecision = vi.fn(async () => ({
        requestId: "approval-invalid",
        decision: "approved" as const,
        decidedAt: "2026-07-19T00:01:00.000Z",
      }));
      const consume = vi.fn(async () => ({ outcome: "approved" as const }));
      const invalidate = vi.fn();
      const workflow: ToolApprovalWorkflow = {
        async create(prepared) {
          const baseScope = {
            sessionId: prepared.sessionId,
            runId: prepared.runId,
            call: prepared.call,
            risk: prepared.risk,
            resources: [],
          };
          const scope =
            mismatch === "missing-run-id"
              ? (({ runId: _runId, ...withoutRunId }) => withoutRunId)(baseScope)
              : mismatch === "prior-run-id"
                ? { ...baseScope, runId: "run-previous" }
                : mismatch === "session-mismatch"
                  ? { ...baseScope, sessionId: "session-other" }
                  : { ...baseScope, call: { ...prepared.call, id: "stale-call" } };
          return {
            request: {
              id: "approval-invalid",
              scope,
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
      const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) }, registry, {
        approvalWorkflow: workflow,
        createRunId: () => "run-current",
      });

      await expect(
        runtime.run({ ...userMessage, content: "Modify the file." }, new AbortController().signal),
      ).rejects.toThrow("not bound to the current Session, Run, and Tool Call");

      expect(requests).toHaveLength(1);
      expect(execute).not.toHaveBeenCalled();
      expect(requestDecision).not.toHaveBeenCalled();
      expect(consume).not.toHaveBeenCalled();
      expect(invalidate).toHaveBeenCalledOnce();
      expect(events.filter((event) => event.type === "agent.approval-state")).toHaveLength(0);
      expect(events.at(-1)).toMatchObject({ status: "failed" });
    },
  );

  it("returns a policy denial without executing a network-risk tool", async () => {
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "tool.call", call: { id: "call-network", name: "send_request", input: {} } },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text.delta", text: "That network operation is not allowed." },
          { type: "finish", reason: "stop" },
        ],
      ],
      requests,
    );
    const execute = vi.fn(async () => ({ output: null, truncated: false }));
    const registry = new ToolRegistry();
    registry.register({
      name: "send_request",
      description: "Send a request.",
      inputSchema: emptyInputSchema,
      risk: "network",
      parseInput: () => null,
      execute,
    });
    const runtime = new AgentRuntime(gateway, { emit() {} }, registry);

    await runtime.run(userMessage, new AbortController().signal);

    expect(execute).not.toHaveBeenCalled();
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      result: {
        callId: "call-network",
        name: "send_request",
        status: "error",
        error: { code: "denied", message: 'Tool "send_request" is denied by policy.' },
      },
    });
  });

  it("passes the exact execute-risk command to the per-call approval workflow", async () => {
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          {
            type: "tool.call",
            call: {
              id: "call-command",
              name: "run_command",
              input: { command: "node", args: ["check.mjs"], cwd: ".", timeoutMs: 30_000 },
            },
          },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text.delta", text: "The approved command completed." },
          { type: "finish", reason: "stop" },
        ],
      ],
      requests,
    );
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({
      output: { stdout: "ok", stderr: "", exitCode: 0, signal: null },
      truncated: false,
    }));
    registry.register({
      name: "run_command",
      description: "Run a command.",
      inputSchema: emptyInputSchema,
      risk: "execute",
      parseInput: (input) => input,
      execute,
      prepareApproval: async (input) => ({ output: input, truncated: false }),
    });
    const create = vi.fn(
      async (prepared: PreparedToolApproval): Promise<ToolApprovalOperation> => ({
        request: {
          id: "approval-command",
          scope: {
            sessionId: prepared.sessionId,
            runId: prepared.runId,
            call: prepared.call,
            risk: prepared.risk,
            resources: [],
          },
          presentation: { title: "Run command", summary: "Run node in file:///workspace." },
          createdAt: "2026-07-19T00:00:00.000Z",
          expiresAt: "2026-07-19T00:05:00.000Z",
        },
        requestDecision: async () => ({
          requestId: "approval-command",
          decision: "approved",
          decidedAt: "2026-07-19T00:01:00.000Z",
        }),
        consume: async () => ({ outcome: "approved" }),
        invalidate: vi.fn(),
      }),
    );
    const runtime = new AgentRuntime(gateway, { emit() {} }, registry, {
      approvalWorkflow: { create },
    });

    await runtime.run(
      { ...userMessage, content: "Run node check.mjs in the workspace." },
      new AbortController().signal,
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      call: {
        id: "call-command",
        name: "run_command",
        input: { command: "node", args: ["check.mjs"], cwd: ".", timeoutMs: 30_000 },
      },
      risk: "execute",
    });
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      result: {
        callId: "call-command",
        name: "run_command",
        status: "success",
        output: { stdout: "ok", stderr: "", exitCode: 0, signal: null },
        truncated: false,
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
  ] as const)(
    "returns an $outcome file-edit result to the model and continues",
    async (scenario) => {
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
          expect(prepared.runId).toMatch(/^run-/);
          expect(prepared.runId).not.toBe(userMessage.messageId);
          return {
            request: {
              id: "approval-edit",
              scope: {
                sessionId: prepared.sessionId,
                runId: prepared.runId,
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
            invalidate: vi.fn(),
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
      expect(requests[1]?.messages.at(-1)).toEqual({
        role: "tool",
        result: scenario.expectedResult,
      });
      expect(
        events.filter((event) => event.type === "agent.approval-state").map(({ status }) => status),
      ).toEqual(scenario.expectedApprovalStatuses);
      expect(events).toContainEqual({
        type: "agent.text-delta",
        sessionId: "session-1",
        text: `continued after ${scenario.outcome}`,
      });
    },
  );

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
    const requestDecision = vi.fn(async (signal: AbortSignal) => {
      signal.throwIfAborted();
      throw new Error("Expected cancellation before approval wait.");
    });
    const invalidate = vi.fn();
    const workflow: ToolApprovalWorkflow = {
      async create(prepared) {
        expect(prepared.runId).toMatch(/^run-/);
        expect(prepared.runId).not.toBe(userMessage.messageId);
        return {
          request: {
            id: "approval-cancel",
            scope: {
              sessionId: prepared.sessionId,
              runId: prepared.runId,
              call: prepared.call,
              risk: "write",
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
    expect(requestDecision).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual({
      type: "session.status-changed",
      sessionId: "session-1",
      previousStatus: "awaiting_approval",
      status: "cancelled",
    });
  });

  it("reports approval preparation causes without exposing them in the Tool Result", async () => {
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "tool.call", call: { id: "call-approval-failed", name: "edit_file", input: {} } },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text.delta", text: "The approval preparation failed safely." },
          { type: "finish", reason: "stop" },
        ],
      ],
      requests,
    );
    const cause = new Error("private approval path");
    const diagnostics: unknown[] = [];
    const create = vi.fn(async () => {
      throw new Error("Approval workflow should not be called.");
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "edit_file",
      description: "Edit a file.",
      inputSchema: emptyInputSchema,
      risk: "write",
      parseInput: () => null,
      execute: async () => ({ output: null, truncated: false }),
      prepareApproval: async () => {
        throw cause;
      },
    });
    const runtime = new AgentRuntime(gateway, { emit: () => {} }, registry, {
      approvalWorkflow: { create },
      diagnosticSink: { emit: (diagnostic) => diagnostics.push(diagnostic) },
    });

    await runtime.run(userMessage, new AbortController().signal);

    expect(create).not.toHaveBeenCalled();
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      result: {
        callId: "call-approval-failed",
        name: "edit_file",
        status: "error",
        error: {
          code: "failed",
          message: 'Tool "edit_file" failed while preparing approval.',
        },
      },
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        type: "agent.internal-error",
        phase: "prepare-approval",
        sessionId: "session-1",
        toolCallId: "call-approval-failed",
        cause,
      }),
    ]);
    expect(JSON.stringify(requests)).not.toContain("private approval path");
  });

  it("invalidates an approval when the decision workflow fails before consumption", async () => {
    const requests: ModelRequest[] = [];
    const gateway = createScriptedModelGateway(
      [
        [
          { type: "tool.call", call: { id: "call-decision-error", name: "edit_file", input: {} } },
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
    const decisionFailure = new Error("approval service unavailable");
    const requestDecision = vi.fn(async () => {
      throw decisionFailure;
    });
    const consume = vi.fn(async () => ({ outcome: "approved" as const }));
    const invalidate = vi.fn();
    const workflow: ToolApprovalWorkflow = {
      async create(prepared) {
        return {
          request: {
            id: "approval-decision-error",
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
    const runtime = new AgentRuntime(gateway, { emit: (event) => events.push(event) }, registry, {
      approvalWorkflow: workflow,
    });

    await expect(runtime.run(userMessage, new AbortController().signal)).rejects.toBe(
      decisionFailure,
    );

    expect(requests).toHaveLength(1);
    expect(requestDecision).toHaveBeenCalledOnce();
    expect(consume).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({ status: "failed" });
  });
});
