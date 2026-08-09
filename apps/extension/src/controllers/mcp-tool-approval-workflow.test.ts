import { type AgentTool, type PreparedToolApproval, ToolRegistry } from "@ctrl-zebra/core";
import type { McpToolSnapshotView } from "@ctrl-zebra/mcp-client";
import { describe, expect, it } from "vitest";

import { McpToolApprovalWorkflow } from "./mcp-tool-approval-workflow.js";

const registryName = "mcp_calculate_123456789abc";
const preparation = {
  kind: "mcp-tool-call",
  server: { serverId: "local_fixture", displayName: "Local fixture" },
  generation: 3,
  registryName,
  mcpToolName: "calculate",
  schemaId: "a".repeat(64),
  arguments: { count: 2 },
} as const;

describe("McpToolApprovalWorkflow", () => {
  it("creates and atomically consumes one exact five-minute approval", async () => {
    const fixture = createFixture();
    const operation = await fixture.workflow.create(prepared(), new AbortController().signal);

    expect(operation.request.scope).toMatchObject({
      sessionId: "session-1",
      runId: "run-1",
      call: { id: "call-1", name: registryName, input: { count: 2 } },
      risk: "execute",
      source: {
        kind: "mcp",
        serverId: "local_fixture",
        registryName,
        mcpToolName: "calculate",
        generation: 3,
        schemaId: "a".repeat(64),
      },
    });
    expect(Date.parse(operation.request.expiresAt) - Date.parse(operation.request.createdAt)).toBe(
      5 * 60 * 1_000,
    );
    const decision = operation.requestDecision(new AbortController().signal);
    fixture.workflow.decide(operation.request.id, "approved");
    await expect(decision).resolves.toMatchObject({ decision: "approved" });
    await expect(operation.consume(new AbortController().signal)).resolves.toEqual({
      outcome: "approved",
    });
    await expect(operation.consume(new AbortController().signal)).rejects.toThrow(
      "Approval is not available for consumption.",
    );
  });

  it("invalidates approval after generation, schema, or trust changes", async () => {
    const fixture = createFixture();
    const operation = await fixture.workflow.create(prepared(), new AbortController().signal);
    const decision = operation.requestDecision(new AbortController().signal);
    fixture.workflow.decide(operation.request.id, "approved");
    await decision;
    fixture.generation = 4;

    await expect(operation.consume(new AbortController().signal)).resolves.toMatchObject({
      outcome: "conflict",
    });
  });

  it("keeps denial and expiry distinct and never consumes either", async () => {
    const deniedFixture = createFixture();
    const deniedOperation = await deniedFixture.workflow.create(
      prepared(),
      new AbortController().signal,
    );
    const deniedDecision = deniedOperation.requestDecision(new AbortController().signal);
    deniedFixture.workflow.decide(deniedOperation.request.id, "denied");
    await expect(deniedDecision).resolves.toMatchObject({ decision: "denied" });
    await expect(deniedOperation.consume(new AbortController().signal)).rejects.toThrow(
      "Approval is not available for consumption.",
    );

    const expiredFixture = createFixture();
    const expiredOperation = await expiredFixture.workflow.create(
      prepared(),
      new AbortController().signal,
    );
    expiredFixture.advance(5 * 60 * 1_000);
    await expect(
      expiredOperation.requestDecision(new AbortController().signal),
    ).resolves.toMatchObject({ decision: "expired" });
    await expect(expiredOperation.consume(new AbortController().signal)).rejects.toThrow(
      "Approval is not available for consumption.",
    );
  });

  it("rejects stale or mismatched preparation before presenting approval", async () => {
    const fixture = createFixture();
    await expect(
      fixture.workflow.create(
        prepared({ prepared: { output: { ...preparation, generation: 4 }, truncated: false } }),
        new AbortController().signal,
      ),
    ).rejects.toThrow("stale connection generation");
    await expect(
      fixture.workflow.create(
        prepared({ call: { id: "call-1", name: registryName, input: { count: 3 } } }),
        new AbortController().signal,
      ),
    ).rejects.toThrow("does not match the proposed call");
  });

  it("invalidates a created operation before a decision and releases its registration", async () => {
    const fixture = createFixture();
    const operation = await fixture.workflow.create(prepared(), new AbortController().signal);

    operation.invalidate();
    operation.invalidate();
    fixture.workflow.decide(operation.request.id, "approved");

    await expect(operation.consume(new AbortController().signal)).rejects.toThrow("not available");
    expect(() => fixture.workflow.decide(operation.request.id, "approved")).not.toThrow();
  });
});

function createFixture() {
  let generation = 3;
  let now = new Date("2026-08-03T00:00:00.000Z");
  const registry = new ToolRegistry();
  registry.register({
    name: registryName,
    description: "Calculate.",
    inputSchema: {
      type: "object",
      properties: { count: { type: "integer", description: "Count." } },
      required: ["count"],
      additionalProperties: false,
    },
    risk: "execute",
    parseInput(value) {
      if (JSON.stringify(value) !== '{"count":2}') throw new Error("invalid");
      return value;
    },
    async execute() {
      return { output: null, truncated: false };
    },
  } satisfies AgentTool);
  const workflow = new McpToolApprovalWorkflow({
    createId: () => "approval-1",
    now: () => now,
    workspaceTrust: { isTrusted: () => true, requireTrusted() {} },
    getToolSnapshot: (): McpToolSnapshotView => ({
      server: preparation.server,
      generation,
      tools: [
        {
          registryName,
          mcpToolName: preparation.mcpToolName,
          schemaId: preparation.schemaId,
        },
      ],
      registry,
    }),
  });
  return {
    workflow,
    set generation(value: number) {
      generation = value;
    },
    advance(milliseconds: number) {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

function prepared(overrides: Partial<PreparedToolApproval> = {}): PreparedToolApproval {
  return {
    sessionId: "session-1",
    runId: "run-1",
    call: { id: "call-1", name: registryName, input: { count: 2 } },
    risk: "execute",
    prepared: { output: preparation, truncated: false },
    ...overrides,
  };
}
