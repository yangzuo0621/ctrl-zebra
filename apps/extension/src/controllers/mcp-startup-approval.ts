import type { MessageOptions } from "vscode";

import type { McpServerConfiguration } from "../adapters/mcp-server-configuration.js";
import type { McpProcessOperation } from "../adapters/mcp-stdio-port.js";
import { defaultToolApprovalLifetimeMilliseconds } from "./approval-lifecycle.js";

export const defaultMcpStartupApprovalLifetimeMilliseconds =
  defaultToolApprovalLifetimeMilliseconds;
export const approveMcpServerStartLabel = "Start MCP Server";

export interface McpServerStartOperation extends McpProcessOperation {
  readonly configuration: McpServerConfiguration;
  readonly cwdUri: string;
}

export type McpStartupApprovalOutcome = "approved" | "denied" | "expired" | "cancelled";

interface McpStartupApprovalDependencies {
  readonly now: () => Date;
  readonly showWarningMessage: (
    message: string,
    options: MessageOptions,
    item: string,
  ) => Thenable<string | undefined>;
  readonly lifetimeMilliseconds?: number;
}

export class McpStartupApproval {
  constructor(private readonly dependencies: McpStartupApprovalDependencies) {}

  async request(
    operation: McpServerStartOperation,
    signal: AbortSignal,
  ): Promise<McpStartupApprovalOutcome> {
    signal.throwIfAborted();
    const createdAt = this.dependencies.now();
    const expiresAt = new Date(
      createdAt.getTime() +
        (this.dependencies.lifetimeMilliseconds ?? defaultMcpStartupApprovalLifetimeMilliseconds),
    );
    const detail = formatApprovalDetail(operation, createdAt, expiresAt);
    const decision = await raceWithCancellation(
      this.dependencies.showWarningMessage(
        `Start external MCP Server “${operation.configuration.displayName}”?`,
        { modal: true, detail },
        approveMcpServerStartLabel,
      ),
      signal,
    );

    if (decision === cancellationMarker) {
      return "cancelled";
    }
    if (this.dependencies.now().getTime() >= expiresAt.getTime()) {
      return "expired";
    }
    return decision === approveMcpServerStartLabel ? "approved" : "denied";
  }
}

function formatApprovalDetail(
  operation: McpServerStartOperation,
  createdAt: Date,
  expiresAt: Date,
): string {
  return [
    `Server ID: ${operation.configuration.serverId}`,
    `Protocol mode: ${effectiveProtocolMode(operation.configuration)}`,
    `Executable: ${JSON.stringify(operation.configuration.command)}`,
    `Arguments: ${JSON.stringify(operation.configuration.args)}`,
    `Working directory: ${operation.cwdUri}`,
    "Workspace trust: trusted",
    `Created: ${createdAt.toISOString()}`,
    `Expires: ${expiresAt.toISOString()}`,
    "Risk: This external process can have unknown local and network side effects.",
    "This approval is valid for this exact startup operation once only.",
  ].join("\n");
}

const cancellationMarker = Symbol("mcp-startup-approval-cancelled");

async function raceWithCancellation<T>(promise: Thenable<T>, signal: AbortSignal) {
  if (signal.aborted) {
    return cancellationMarker;
  }

  let removeAbortListener = () => {};
  const cancellation = new Promise<typeof cancellationMarker>((resolve) => {
    const onAbort = () => resolve(cancellationMarker);
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });

  try {
    return await Promise.race([Promise.resolve(promise), cancellation]);
  } finally {
    removeAbortListener();
  }
}

export function sameMcpStartOperation(
  left: McpServerStartOperation,
  right: McpServerStartOperation,
): boolean {
  return (
    left.cwdUri === right.cwdUri &&
    left.cwdPath === right.cwdPath &&
    effectiveProtocolMode(left.configuration) === effectiveProtocolMode(right.configuration) &&
    left.configuration.serverId === right.configuration.serverId &&
    left.configuration.displayName === right.configuration.displayName &&
    left.configuration.command === right.configuration.command &&
    arraysEqual(left.configuration.args, right.configuration.args)
  );
}

function effectiveProtocolMode(configuration: McpServerConfiguration): "modern-only" | "dual" {
  return configuration.protocolMode ?? "modern-only";
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
