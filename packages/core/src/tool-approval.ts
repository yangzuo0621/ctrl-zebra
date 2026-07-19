import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRequestId,
  CheckpointRunId,
  SessionId,
  ToolCall,
} from "@ctrl-zebra/protocol";

import type { ToolExecutionOutput } from "./tool-registry.js";

export interface PreparedToolApproval {
  readonly sessionId: SessionId;
  readonly runId: CheckpointRunId;
  readonly call: ToolCall;
  readonly risk: "write" | "execute";
  readonly prepared: ToolExecutionOutput<unknown>;
}

export type ApprovedToolConsumption =
  | { readonly outcome: "approved" }
  | { readonly outcome: "conflict"; readonly message: string }
  | { readonly outcome: "expired" };

export type ToolApprovalDecision =
  | ApprovalDecision
  | { readonly requestId: ApprovalRequestId; readonly decision: "expired" };

export interface ToolApprovalOperation {
  readonly request: ApprovalRequest;
  requestDecision(signal: AbortSignal): Promise<ToolApprovalDecision>;
  consume(signal: AbortSignal): Promise<ApprovedToolConsumption>;
}

export interface ToolApprovalWorkflow {
  create(prepared: PreparedToolApproval, signal: AbortSignal): Promise<ToolApprovalOperation>;
}
