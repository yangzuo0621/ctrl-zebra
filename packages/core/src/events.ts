import type {
  ApprovalRequest,
  ApprovalStatus,
  CheckpointRunId,
  RunTokenBudgetSnapshot,
  SessionId,
  SessionStatus,
  ToolCall,
  ToolErrorResult,
  ToolSuccessResult,
} from "@ctrl-zebra/protocol";

export interface DomainEvent {
  readonly type: string;
}

export interface EventSink<Event extends DomainEvent = DomainEvent> {
  emit(event: Event): void;
}

export interface SessionStatusChangedEvent extends DomainEvent {
  readonly type: "session.status-changed";
  readonly sessionId: SessionId;
  readonly previousStatus: SessionStatus;
  readonly status: SessionStatus;
}

export interface AgentTextDeltaEvent extends DomainEvent {
  readonly type: "agent.text-delta";
  readonly sessionId: SessionId;
  readonly text: string;
}

export interface AgentUsageEvent extends DomainEvent {
  readonly type: "agent.usage";
  readonly sessionId: SessionId;
  readonly usage: import("@ctrl-zebra/protocol").TokenUsage;
}

export interface AgentRunBudgetEvent extends DomainEvent {
  readonly type: "agent.run-budget";
  readonly sessionId: SessionId;
  readonly budget: RunTokenBudgetSnapshot;
}

export interface AgentReasoningStartEvent extends DomainEvent {
  readonly type: "agent.reasoning-start";
  readonly sessionId: SessionId;
  readonly blockId: string;
}

export interface AgentReasoningDeltaEvent extends DomainEvent {
  readonly type: "agent.reasoning-delta";
  readonly sessionId: SessionId;
  readonly blockId: string;
  readonly text: string;
}

export interface AgentReasoningEndEvent extends DomainEvent {
  readonly type: "agent.reasoning-end";
  readonly sessionId: SessionId;
  readonly blockId: string;
}

export type AgentReasoningEvent =
  | AgentReasoningStartEvent
  | AgentReasoningDeltaEvent
  | AgentReasoningEndEvent;

interface AgentToolStateEventBase extends DomainEvent {
  readonly type: "agent.tool-state";
  readonly sessionId: SessionId;
  readonly call: ToolCall;
}

export type AgentToolStateEvent =
  | (AgentToolStateEventBase & { readonly status: "pending" | "running" })
  | (AgentToolStateEventBase & {
      readonly status: "success";
      readonly result: ToolSuccessResult;
    })
  | (AgentToolStateEventBase & {
      readonly status: "error";
      readonly result: ToolErrorResult;
    });

export interface AgentApprovalStateEvent extends DomainEvent {
  readonly type: "agent.approval-state";
  readonly sessionId: SessionId;
  readonly approval: ApprovalRequest;
  readonly status: ApprovalStatus;
}

export type AgentRuntimeEvent =
  | AgentTextDeltaEvent
  | AgentUsageEvent
  | AgentRunBudgetEvent
  | AgentReasoningEvent
  | AgentToolStateEvent
  | AgentApprovalStateEvent
  | SessionStatusChangedEvent;

export type AgentRuntimeDiagnosticPhase = "prepare-approval" | "execute-tool";

/** Local-only diagnostic that never enters the Runtime event stream or public Protocol. */
export interface AgentRuntimeDiagnostic {
  readonly type: "agent.internal-error";
  readonly phase: AgentRuntimeDiagnosticPhase;
  readonly sessionId: SessionId;
  readonly runId: CheckpointRunId;
  readonly toolCallId: ToolCall["id"];
  readonly cause: unknown;
}

export interface AgentRuntimeDiagnosticSink {
  emit(diagnostic: AgentRuntimeDiagnostic): void;
}
