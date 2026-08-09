import {
  approvalRequestSchema,
  maxApprovalPresentationSummaryCharacters,
  type PreparedToolApproval,
  type ToolApprovalOperation,
  type ToolApprovalWorkflow,
} from "@ctrl-zebra/core";
import {
  type McpToolApprovalPreparation,
  type McpToolSnapshotView,
  parseMcpToolApprovalPreparation,
} from "@ctrl-zebra/mcp-client";
import type { ApprovalDecisionIntent, ApprovalRequest } from "@ctrl-zebra/protocol";

import { ApprovalLifecycle, type ApprovalLifecycleRecord } from "./approval-lifecycle.js";
import type { WorkspaceTrustPolicy } from "./workspace-trust-policy.js";

export const defaultMcpToolApprovalLifetimeMilliseconds = 5 * 60 * 1_000;

interface McpToolApprovalWorkflowDependencies {
  readonly createId: () => string;
  readonly now: () => Date;
  readonly workspaceTrust: WorkspaceTrustPolicy;
  readonly getToolSnapshot: () => McpToolSnapshotView | undefined;
  readonly approvalLifetimeMilliseconds?: number;
}

interface McpToolApprovalRecord extends ApprovalLifecycleRecord {
  readonly request: ApprovalRequest;
  readonly preparation: McpToolApprovalPreparation;
}

export class McpToolApprovalWorkflow implements ToolApprovalWorkflow {
  readonly #lifecycle: ApprovalLifecycle<McpToolApprovalRecord>;

  constructor(private readonly dependencies: McpToolApprovalWorkflowDependencies) {
    this.#lifecycle = new ApprovalLifecycle(dependencies.now);
  }

  async create(
    prepared: PreparedToolApproval,
    signal: AbortSignal,
  ): Promise<ToolApprovalOperation> {
    this.dependencies.workspaceTrust.requireTrusted();
    if (prepared.risk !== "execute") {
      throw new Error("MCP Tools must use trusted execute risk.");
    }
    const preparation = parseMcpToolApprovalPreparation(prepared.prepared.output);
    if (
      preparation.registryName !== prepared.call.name ||
      !sameJson(preparation.arguments, prepared.call.input)
    ) {
      throw new Error("MCP Tool approval does not match the proposed call.");
    }
    signal.throwIfAborted();
    if (!this.isCurrent(preparation)) {
      throw new Error("MCP Tool approval targets a stale connection generation.");
    }

    const createdAt = this.dependencies.now();
    const expiresAt = new Date(
      createdAt.getTime() +
        (this.dependencies.approvalLifetimeMilliseconds ??
          defaultMcpToolApprovalLifetimeMilliseconds),
    );
    const request = approvalRequestSchema.parse({
      id: this.dependencies.createId(),
      scope: {
        sessionId: prepared.sessionId,
        runId: prepared.runId,
        call: prepared.call,
        risk: "execute",
        source: {
          kind: "mcp",
          serverId: preparation.server.serverId,
          registryName: preparation.registryName,
          mcpToolName: preparation.mcpToolName,
          generation: preparation.generation,
          schemaId: preparation.schemaId,
        },
        resources: [],
      },
      presentation: {
        title: `Run external Tool from ${preparation.server.displayName}`,
        summary: formatApprovalSummary(preparation),
      },
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    const record: McpToolApprovalRecord = {
      request,
      preparation,
      status: "pending",
      consuming: false,
    };
    this.#lifecycle.register(record);
    return {
      request,
      requestDecision: (decisionSignal) => this.#lifecycle.requestDecision(record, decisionSignal),
      consume: (consumptionSignal) => this.#consume(record, consumptionSignal),
      invalidate: () => this.#lifecycle.invalidate(record),
    };
  }

  decide(approvalId: string, decision: ApprovalDecisionIntent): void {
    this.#lifecycle.decide(approvalId, decision);
  }

  dispose(): void {
    this.#lifecycle.dispose();
  }

  async #consume(record: McpToolApprovalRecord, signal: AbortSignal) {
    if (!this.#lifecycle.validateConsumption(record, signal)) {
      return { outcome: "expired" as const };
    }
    if (!this.dependencies.workspaceTrust.isTrusted() || !this.isCurrent(record.preparation)) {
      this.#lifecycle.finish(record, "invalidated");
      return {
        outcome: "conflict" as const,
        message:
          "The MCP connection, Tool definition, or workspace trust changed before execution.",
      };
    }

    this.#lifecycle.markConsuming(record);
    this.#lifecycle.finish(record, "consumed");
    return { outcome: "approved" as const };
  }

  private isCurrent(preparation: McpToolApprovalPreparation): boolean {
    const snapshot = this.dependencies.getToolSnapshot();
    if (
      snapshot === undefined ||
      snapshot.server.serverId !== preparation.server.serverId ||
      snapshot.generation !== preparation.generation
    ) {
      return false;
    }
    const descriptor = snapshot.tools.find(
      (tool) => tool.registryName === preparation.registryName,
    );
    if (
      descriptor?.mcpToolName !== preparation.mcpToolName ||
      descriptor.schemaId !== preparation.schemaId
    ) {
      return false;
    }
    try {
      snapshot.registry.get(preparation.registryName)?.parseInput(preparation.arguments);
      return snapshot.registry.get(preparation.registryName) !== undefined;
    } catch {
      return false;
    }
  }
}

function formatApprovalSummary(preparation: McpToolApprovalPreparation): string {
  const prefix = [
    `Server: ${preparation.server.displayName} (${preparation.server.serverId})`,
    `Tool: ${preparation.mcpToolName}`,
    "Warning: external Server; local and network side effects are unknown.",
    "Arguments: ",
  ].join("\n");
  const argumentsText = JSON.stringify(preparation.arguments);
  const remaining = Math.max(0, maxApprovalPresentationSummaryCharacters - prefix.length);
  const suffix =
    argumentsText.length <= remaining
      ? argumentsText
      : `${argumentsText.slice(0, Math.max(0, remaining - 1))}…`;
  return `${prefix}${suffix}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
